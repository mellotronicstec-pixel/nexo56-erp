import 'server-only';
import { and, asc, desc, eq, gt, inArray, like, lt, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { Money } from '@/core/money/money';
import { Quantity } from '@/core/quantity/quantity';
import { buildOffsetPage, resolveOffset, type OffsetPage } from '@/core/db/pagination';
import {
  isBelowMinimum,
  nextAverageCost,
  normalizeBarcode,
  normalizePartCode,
  normalizePartNumber,
  partSearchKey,
  type MovementType,
} from '@/modules/inventory/domain/inventory';
import {
  parts,
  stockBalances,
  stockLocations,
  stockMovements,
  stockReservations,
  stockTransfers,
} from '@/modules/inventory/infrastructure/schema';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Consultas de Estoque (Prompt 10, itens 92 a 100).
 *
 * TODA consulta carrega o escopo: `tenant_id` sempre, e `unit_id` em tudo que
 * e da unidade. Nao existe aqui um `findById(id)` sem escopo (item 116) — e o
 * atalho que, um refactor depois, vira IDOR entre empresas.
 *
 * SEM N+1 (item 99): a listagem de pecas e UM `LEFT JOIN` com o saldo da
 * unidade ativa, e nao uma consulta de saldo por linha. Com 300 pecas por
 * pagina, a diferenca e entre uma ida ao banco e trezentas.
 */

export const PART_LIST_MAX = 300;

export interface PartListFilters {
  search?: string;
  /** `below_minimum`, `without_stock`, `with_reservation`, `inactive`. */
  filter?: string;
  locationId?: string;
  page?: number;
  pageSize?: number;
}

export interface PartListItem {
  id: string;
  code: string;
  name: string;
  brand: string | null;
  partNumber: string | null;
  unitOfMeasure: string;
  status: string;
  onHand: string;
  reserved: string;
  available: string;
  minimumQuantity: string;
  belowMinimum: boolean;
  locationName: string | null;
}

/**
 * Busca tolerante a formatacao (itens 94 e 95).
 *
 * Cada campo e procurado na sua PROPRIA forma normalizada: nome e fabricante
 * sem acento e em minuscula; codigo, referencia e codigo de barras compactos e
 * em maiuscula. Jogar tudo num `LIKE` sobre o texto cru faria "TELA-01" nao
 * encontrar a peca cadastrada como "tela 01".
 *
 * NAO E BUSCA INTELIGENTE (item 95 e 172): nao ha sinonimo, nao ha correcao
 * ortografica e nao ha IA. E `LIKE` sobre colunas indexadas, e e o que a
 * etiqueta da prateleira precisa.
 */
function buildPartSearch(rawQuery: string): SQL | undefined {
  const conditions: SQL[] = [];

  const text = partSearchKey(rawQuery);
  if (text) {
    conditions.push(like(parts.nameSearch, `%${text}%`), like(parts.brandSearch, `%${text}%`));
  }

  const code = normalizePartCode(rawQuery);
  if (code) {
    conditions.push(
      like(parts.codeNormalized, `%${code}%`),
      like(parts.partNumberNormalized, `%${normalizePartNumber(rawQuery)}%`),
      like(parts.barcodeNormalized, `%${normalizeBarcode(rawQuery)}%`),
    );
  }

  if (conditions.length === 0) return undefined;
  return or(...conditions);
}

/**
 * Lista as pecas com o saldo da UNIDADE ATIVA (item 92).
 *
 * Sem unidade ativa nao ha saldo a mostrar: quantidade tem lugar, e somar
 * todas as lojas numa coluna so contrariaria o isolamento do Prompt 03. O
 * catalogo continua sendo do tenant — o que depende da unidade e o numero.
 */
export async function listParts(
  context: TenantContext,
  filters: PartListFilters = {},
): Promise<OffsetPage<PartListItem>> {
  const { limit, offset, page } = resolveOffset(filters);

  if (!context.activeUnitId) {
    return buildOffsetPage<PartListItem>([], 0, { page, pageSize: limit });
  }

  const unitId = context.activeUnitId;
  const db = getDb();

  const conditions: SQL[] = [eq(parts.tenantId, context.tenantId)];

  const search = filters.search?.trim();
  if (search) {
    const condition = buildPartSearch(search);
    if (condition) conditions.push(condition);
  }

  const available = sql<string>`COALESCE(${stockBalances.onHand}, 0) - COALESCE(${stockBalances.reserved}, 0)`;

  switch (filters.filter) {
    case 'below_minimum':
      conditions.push(
        and(
          gt(stockBalances.minimumQuantity, '0'),
          sql`${available} < ${stockBalances.minimumQuantity}`,
        ) as SQL,
      );
      break;
    case 'without_stock':
      conditions.push(sql`COALESCE(${stockBalances.onHand}, 0) <= 0`);
      break;
    case 'with_reservation':
      conditions.push(gt(stockBalances.reserved, '0'));
      break;
    case 'inactive':
      conditions.push(eq(parts.status, 'inactive'));
      break;
    case 'active':
      conditions.push(eq(parts.status, 'active'));
      break;
    default:
      break;
  }

  if (filters.locationId) {
    conditions.push(eq(stockBalances.primaryLocationId, filters.locationId));
  }

  const where = and(...conditions);

  const rows = await db
    .select({
      id: parts.id,
      code: parts.code,
      name: parts.name,
      brand: parts.brand,
      partNumber: parts.partNumber,
      unitOfMeasure: parts.unitOfMeasure,
      status: parts.status,
      onHand: stockBalances.onHand,
      reserved: stockBalances.reserved,
      minimumQuantity: stockBalances.minimumQuantity,
      locationName: stockLocations.name,
    })
    .from(parts)
    .leftJoin(
      stockBalances,
      and(eq(stockBalances.partId, parts.id), eq(stockBalances.unitId, unitId)),
    )
    .leftJoin(stockLocations, eq(stockLocations.id, stockBalances.primaryLocationId))
    .where(where)
    /** Ordenacao deterministica: nome, e `id` como desempate (item 98). */
    .orderBy(asc(parts.nameSearch), asc(parts.id))
    .limit(limit)
    .offset(offset);

  const [totals] = await db
    .select({ total: sql<number>`count(*)` })
    .from(parts)
    .leftJoin(
      stockBalances,
      and(eq(stockBalances.partId, parts.id), eq(stockBalances.unitId, unitId)),
    )
    .where(where);

  const items = rows.map((row) => toListItem(row));
  return buildOffsetPage(items, Number(totals?.total ?? 0), { page, pageSize: limit });
}

function toListItem(row: {
  id: string;
  code: string;
  name: string;
  brand: string | null;
  partNumber: string | null;
  unitOfMeasure: string;
  status: string;
  onHand: string | null;
  reserved: string | null;
  minimumQuantity: string | null;
  locationName: string | null;
}): PartListItem {
  const zero = Quantity.zero();
  const onHand = row.onHand ? Quantity.parse(row.onHand) : zero;
  const reserved = row.reserved ? Quantity.parse(row.reserved) : zero;
  const minimum = row.minimumQuantity ? Quantity.parse(row.minimumQuantity) : zero;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    brand: row.brand,
    partNumber: row.partNumber,
    unitOfMeasure: row.unitOfMeasure,
    status: row.status,
    onHand: onHand.toString(),
    reserved: reserved.toString(),
    available: onHand.subtract(reserved).toString(),
    minimumQuantity: minimum.toString(),
    belowMinimum: isBelowMinimum({ onHand, reserved }, minimum),
    locationName: row.locationName,
  };
}

/** Pecas ativas para o seletor do editor de orcamento (item 108). */
export async function searchPartsForPicker(
  context: TenantContext,
  rawQuery: string,
  limit = 20,
): Promise<
  Array<{
    id: string;
    code: string;
    name: string;
    unitOfMeasure: string;
    suggestedPrice: string | null;
  }>
> {
  const query = rawQuery.trim();
  const conditions: SQL[] = [eq(parts.tenantId, context.tenantId), eq(parts.status, 'active')];

  if (query) {
    const condition = buildPartSearch(query);
    if (condition) conditions.push(condition);
  }

  return getDb()
    .select({
      id: parts.id,
      code: parts.code,
      name: parts.name,
      unitOfMeasure: parts.unitOfMeasure,
      suggestedPrice: parts.suggestedPrice,
    })
    .from(parts)
    .where(and(...conditions))
    .orderBy(asc(parts.nameSearch), asc(parts.id))
    .limit(Math.min(limit, 50));
}

// ---------------------------------------------------------------------------
// Ficha da peca (item 100)
// ---------------------------------------------------------------------------

export interface UnitBalanceItem {
  unitId: string;
  unitName: string;
  onHand: string;
  reserved: string;
  available: string;
  minimumQuantity: string;
  averageCost: string | null;
  locationName: string | null;
}

/**
 * Saldo da peca em TODAS as unidades que a pessoa pode operar (item 100).
 *
 * Mostra as outras unidades porque e a pergunta real do balcao — "tem essa
 * peca em alguma loja nossa?" — e e o que torna a transferencia uma decisao
 * informada. Unidade a que a pessoa nao tem acesso nao aparece: acesso a
 * unidade e membership, e a listagem nao e atalho para contorna-lo.
 */
export async function listUnitBalances(
  context: TenantContext,
  partId: string,
): Promise<UnitBalanceItem[]> {
  if (context.authorizedUnitIds.length === 0) return [];

  const rows = await getDb()
    .select({
      unitId: units.id,
      unitName: units.name,
      onHand: stockBalances.onHand,
      reserved: stockBalances.reserved,
      minimumQuantity: stockBalances.minimumQuantity,
      averageCost: stockBalances.averageCost,
      locationName: stockLocations.name,
    })
    .from(units)
    .leftJoin(
      stockBalances,
      and(eq(stockBalances.unitId, units.id), eq(stockBalances.partId, partId)),
    )
    .leftJoin(stockLocations, eq(stockLocations.id, stockBalances.primaryLocationId))
    .where(
      and(eq(units.tenantId, context.tenantId), inArray(units.id, [...context.authorizedUnitIds])),
    )
    .orderBy(asc(units.name), asc(units.id));

  const zero = Quantity.zero();
  return rows.map((row) => {
    const onHand = row.onHand ? Quantity.parse(row.onHand) : zero;
    const reserved = row.reserved ? Quantity.parse(row.reserved) : zero;
    return {
      unitId: row.unitId,
      unitName: row.unitName,
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: onHand.subtract(reserved).toString(),
      minimumQuantity: row.minimumQuantity ?? zero.toString(),
      averageCost: row.averageCost,
      locationName: row.locationName,
    };
  });
}

export interface MovementListItem {
  id: string;
  type: string;
  quantity: string;
  resultingOnHand: string;
  unitCost: string | null;
  totalCost: string | null;
  originKind: string;
  reference: string | null;
  reason: string | null;
  serviceOrderId: string | null;
  serviceOrderNumber: number | null;
  actorName: string | null;
  occurredAt: Date;
}

/**
 * Movimentacoes da peca NAQUELA unidade (item 68).
 *
 * Paginacao por cursor, e nao por offset: o ledger so cresce pela ponta, e
 * `OFFSET 5000` faria o banco varrer e descartar cinco mil linhas para mostrar
 * vinte (convencao de docs/database/conventions.md).
 */
export async function listMovements(
  context: TenantContext,
  unitId: string,
  partId: string,
  options: { limit?: number; before?: Date } = {},
): Promise<MovementListItem[]> {
  if (!context.authorizedUnitIds.includes(unitId)) return [];

  const conditions: SQL[] = [
    eq(stockMovements.tenantId, context.tenantId),
    eq(stockMovements.unitId, unitId),
    eq(stockMovements.partId, partId),
  ];
  if (options.before) conditions.push(lt(stockMovements.occurredAt, options.before));

  return getDb()
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      resultingOnHand: stockMovements.resultingOnHand,
      unitCost: stockMovements.unitCost,
      totalCost: stockMovements.totalCost,
      originKind: stockMovements.originKind,
      reference: stockMovements.reference,
      reason: stockMovements.reason,
      serviceOrderId: stockMovements.serviceOrderId,
      serviceOrderNumber: serviceOrders.number,
      actorName: users.name,
      occurredAt: stockMovements.occurredAt,
    })
    .from(stockMovements)
    .leftJoin(serviceOrders, eq(serviceOrders.id, stockMovements.serviceOrderId))
    .leftJoin(users, eq(users.id, stockMovements.actorId))
    .where(and(...conditions))
    .orderBy(desc(stockMovements.occurredAt), desc(stockMovements.id))
    .limit(Math.min(options.limit ?? 25, 100));
}

export interface ReservationListItem {
  id: string;
  partId: string;
  partCode: string;
  partName: string;
  unitOfMeasure: string;
  quantity: string;
  consumedQuantity: string;
  releasedQuantity: string;
  remaining: string;
  status: string;
  serviceOrderId: string;
  serviceOrderNumber: number;
  createdAt: Date;
}

/** Reservas de uma Ordem de Servico. Usada na ficha da OS. */
export async function listReservationsForServiceOrder(
  context: TenantContext,
  serviceOrderId: string,
): Promise<ReservationListItem[]> {
  const rows = await getDb()
    .select({
      id: stockReservations.id,
      unitId: stockReservations.unitId,
      partId: stockReservations.partId,
      partCode: parts.code,
      partName: parts.name,
      unitOfMeasure: parts.unitOfMeasure,
      quantity: stockReservations.quantity,
      consumedQuantity: stockReservations.consumedQuantity,
      releasedQuantity: stockReservations.releasedQuantity,
      status: stockReservations.status,
      serviceOrderId: stockReservations.serviceOrderId,
      serviceOrderNumber: serviceOrders.number,
      createdAt: stockReservations.createdAt,
    })
    .from(stockReservations)
    .innerJoin(parts, eq(parts.id, stockReservations.partId))
    .innerJoin(serviceOrders, eq(serviceOrders.id, stockReservations.serviceOrderId))
    .where(
      and(
        eq(stockReservations.tenantId, context.tenantId),
        eq(stockReservations.serviceOrderId, serviceOrderId),
      ),
    )
    .orderBy(desc(stockReservations.createdAt), desc(stockReservations.id))
    .limit(100);

  return rows
    .filter((row) => context.authorizedUnitIds.includes(row.unitId))
    .map((row) => ({
      id: row.id,
      partId: row.partId,
      partCode: row.partCode,
      partName: row.partName,
      unitOfMeasure: row.unitOfMeasure,
      quantity: row.quantity,
      consumedQuantity: row.consumedQuantity,
      releasedQuantity: row.releasedQuantity,
      remaining: Quantity.parse(row.quantity)
        .subtract(Quantity.parse(row.consumedQuantity))
        .subtract(Quantity.parse(row.releasedQuantity))
        .toString(),
      status: row.status,
      serviceOrderId: row.serviceOrderId,
      serviceOrderNumber: row.serviceOrderNumber,
      createdAt: row.createdAt,
    }));
}

/** Reservas abertas de uma peca na unidade. Usada na ficha da peca. */
export async function listReservationsForPart(
  context: TenantContext,
  unitId: string,
  partId: string,
): Promise<ReservationListItem[]> {
  if (!context.authorizedUnitIds.includes(unitId)) return [];

  const rows = await getDb()
    .select({
      id: stockReservations.id,
      partId: stockReservations.partId,
      partCode: parts.code,
      partName: parts.name,
      unitOfMeasure: parts.unitOfMeasure,
      quantity: stockReservations.quantity,
      consumedQuantity: stockReservations.consumedQuantity,
      releasedQuantity: stockReservations.releasedQuantity,
      status: stockReservations.status,
      serviceOrderId: stockReservations.serviceOrderId,
      serviceOrderNumber: serviceOrders.number,
      createdAt: stockReservations.createdAt,
    })
    .from(stockReservations)
    .innerJoin(parts, eq(parts.id, stockReservations.partId))
    .innerJoin(serviceOrders, eq(serviceOrders.id, stockReservations.serviceOrderId))
    .where(
      and(
        eq(stockReservations.tenantId, context.tenantId),
        eq(stockReservations.unitId, unitId),
        eq(stockReservations.partId, partId),
        eq(stockReservations.status, 'open'),
      ),
    )
    .orderBy(asc(stockReservations.createdAt), asc(stockReservations.id))
    .limit(100);

  return rows.map((row) => ({
    ...row,
    remaining: Quantity.parse(row.quantity)
      .subtract(Quantity.parse(row.consumedQuantity))
      .subtract(Quantity.parse(row.releasedQuantity))
      .toString(),
  }));
}

/** Localizacoes ativas da unidade, para os seletores. */
export async function listLocations(
  context: TenantContext,
  unitId: string,
  includeInactive = false,
): Promise<Array<{ id: string; name: string; code: string | null; status: string }>> {
  if (!context.authorizedUnitIds.includes(unitId)) return [];

  const conditions: SQL[] = [
    eq(stockLocations.tenantId, context.tenantId),
    eq(stockLocations.unitId, unitId),
  ];
  if (!includeInactive) conditions.push(eq(stockLocations.status, 'active'));

  return getDb()
    .select({
      id: stockLocations.id,
      name: stockLocations.name,
      code: stockLocations.code,
      status: stockLocations.status,
    })
    .from(stockLocations)
    .where(and(...conditions))
    .orderBy(asc(stockLocations.name), asc(stockLocations.id));
}

/** Transferencias recentes envolvendo a unidade. */
export async function listTransfers(
  context: TenantContext,
  unitId: string,
  limit = 25,
): Promise<
  Array<{
    id: string;
    number: number;
    partCode: string;
    partName: string;
    quantity: string;
    fromUnitId: string;
    toUnitId: string;
    createdAt: Date;
  }>
> {
  if (!context.authorizedUnitIds.includes(unitId)) return [];

  return getDb()
    .select({
      id: stockTransfers.id,
      number: stockTransfers.number,
      partCode: parts.code,
      partName: parts.name,
      quantity: stockTransfers.quantity,
      fromUnitId: stockTransfers.fromUnitId,
      toUnitId: stockTransfers.toUnitId,
      createdAt: stockTransfers.createdAt,
    })
    .from(stockTransfers)
    .innerJoin(parts, eq(parts.id, stockTransfers.partId))
    .where(
      and(
        eq(stockTransfers.tenantId, context.tenantId),
        or(eq(stockTransfers.fromUnitId, unitId), eq(stockTransfers.toUnitId, unitId)),
      ),
    )
    .orderBy(desc(stockTransfers.createdAt), desc(stockTransfers.id))
    .limit(Math.min(limit, 100));
}

// ---------------------------------------------------------------------------
// Reconciliacao (item 25)
// ---------------------------------------------------------------------------

export interface BalanceReconciliation {
  ledgerOnHand: string;
  materializedOnHand: string;
  onHandMatches: boolean;
  ledgerAverageCost: string | null;
  materializedAverageCost: string | null;
  averageCostMatches: boolean;
  movementCount: number;
}

/**
 * Recalcula o saldo A PARTIR DO LEDGER e compara com o materializado.
 *
 * E O QUE TORNA A MATERIALIZACAO HONESTA (item 25). Saldo materializado so e
 * aceitavel se for reconciliavel: sem esta funcao, "o saldo esta certo" seria
 * uma crenca, e a primeira divergencia apareceria como reclamacao de cliente.
 *
 * A media e recalculada pela MESMA regra do dominio (`nextAverageCost`),
 * aplicada na ordem cronologica das entradas — e por isso que o calculo do
 * `UPDATE` e verificavel, e nao apenas confiavel.
 */
export async function reconcileBalance(
  context: TenantContext,
  unitId: string,
  partId: string,
): Promise<BalanceReconciliation> {
  const db = getDb();

  const movements = await db
    .select({
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      unitCost: stockMovements.unitCost,
      occurredAt: stockMovements.occurredAt,
      id: stockMovements.id,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.tenantId, context.tenantId),
        eq(stockMovements.unitId, unitId),
        eq(stockMovements.partId, partId),
      ),
    )
    .orderBy(asc(stockMovements.occurredAt), asc(stockMovements.id));

  let onHand = Quantity.zero();
  let average: Money | null = null;

  for (const movement of movements) {
    const signed = Quantity.parse(movement.quantity);

    if (signed.isPositive()) {
      average = nextAverageCost(
        onHand,
        average,
        signed,
        movement.unitCost ? Money.parse(movement.unitCost) : null,
      );
    }

    onHand = onHand.add(signed);
  }

  const [row] = await db
    .select({ onHand: stockBalances.onHand, averageCost: stockBalances.averageCost })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.tenantId, context.tenantId),
        eq(stockBalances.unitId, unitId),
        eq(stockBalances.partId, partId),
      ),
    )
    .limit(1);

  const materializedOnHand = row ? Quantity.parse(row.onHand) : Quantity.zero();
  const materializedAverage = row?.averageCost ? Money.parse(row.averageCost) : null;

  return {
    ledgerOnHand: onHand.toString(),
    materializedOnHand: materializedOnHand.toString(),
    onHandMatches: onHand.equals(materializedOnHand),
    ledgerAverageCost: average?.toString() ?? null,
    materializedAverageCost: materializedAverage?.toString() ?? null,
    averageCostMatches:
      average === null || materializedAverage === null
        ? average === materializedAverage
        : average.equals(materializedAverage),
    movementCount: movements.length,
  };
}

export type { MovementType };

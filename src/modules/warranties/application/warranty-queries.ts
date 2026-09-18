import 'server-only';
import { and, desc, eq, gte, inArray, like, lte, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import {
  buildOffsetPage,
  resolveOffset,
  type OffsetPage,
  type OffsetPageRequest,
} from '@/core/db/pagination';
import { normalizeSearchable } from '@/core/text/normalize';
import { addDays, todayIn } from '@/core/time/civil-date';
import { customers } from '@/modules/customers/infrastructure/schema';
import { equipment } from '@/modules/equipment/infrastructure/schema';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  isWarrantyEnforceable,
  temporalClassOf,
  WARRANTY_TYPES,
  type TemporalClass,
} from '@/modules/warranties/domain/warranty';
import {
  warranties,
  warrantyCoverageItems,
  warrantyReturns,
  warrantyTimeline,
} from '@/modules/warranties/infrastructure/schema';

/**
 * CONSULTAS DE GARANTIAS (Prompt 13, itens 79, 80, 86 e 114).
 *
 * TODA LISTA E PAGINADA NO BANCO, com filtro e ordenacao no SQL. Nenhuma
 * consulta traz a tabela inteira para filtrar em JavaScript, e nenhuma faz
 * N+1.
 *
 * "VIGENTE" E "EXPIRADA" SAO DERIVADOS, nunca lidos de coluna: a comparacao
 * usa a data civil de HOJE no fuso da EMPRESA, calculada no servidor.
 */

export interface WarrantyListFilters extends OffsetPageRequest {
  search?: string;
  type?: string;
  /** `valid` | `expired` | `future` — o recorte temporal, derivado. */
  temporal?: string;
  status?: string;
  customerId?: string;
  equipmentId?: string;
  serviceOrderId?: string;
  unitId?: string;
  /** Vence dentro de N dias. Sustenta o painel "proximas de vencer". */
  expiringInDays?: number;
}

export interface WarrantyListItem {
  id: string;
  number: number;
  type: string;
  status: string;
  customerName: string | null;
  equipmentLabel: string | null;
  serviceOrderNumber: number | null;
  startsOn: string;
  endsOn: string;
  temporal: TemporalClass;
  enforceable: boolean;
  returnCount: number;
  unitId: string;
  unitName: string | null;
}

export async function listWarranties(
  context: TenantContext,
  filters: WarrantyListFilters = {},
): Promise<OffsetPage<WarrantyListItem>> {
  const { limit, offset, page } = resolveOffset(filters);
  const hoje = todayIn(context.tenantTimezone);

  const conditions: SQL[] = [eq(warranties.tenantId, context.tenantId)];

  /**
   * A GARANTIA E DO TENANT (item 38), mas so aparece se a pessoa acessa a
   * unidade que a concedeu — senao um usuario da loja Norte enxergaria a
   * carteira inteira da empresa.
   */
  if (context.authorizedUnitIds.length === 0) {
    return buildOffsetPage<WarrantyListItem>([], 0, { page, pageSize: limit });
  }
  conditions.push(inArray(warranties.unitId, [...context.authorizedUnitIds]));

  if (filters.unitId) conditions.push(eq(warranties.unitId, filters.unitId));
  if (filters.type && (WARRANTY_TYPES as readonly string[]).includes(filters.type)) {
    conditions.push(eq(warranties.type, filters.type));
  }
  if (filters.status) conditions.push(eq(warranties.status, filters.status));
  if (filters.customerId) conditions.push(eq(warranties.customerId, filters.customerId));
  if (filters.equipmentId) conditions.push(eq(warranties.equipmentId, filters.equipmentId));
  if (filters.serviceOrderId)
    conditions.push(eq(warranties.serviceOrderId, filters.serviceOrderId));

  /** O recorte temporal roda no SQL para a paginacao continuar correta. */
  if (filters.temporal === 'valid') {
    conditions.push(
      eq(warranties.status, 'active'),
      lte(warranties.startsOn, hoje),
      gte(warranties.endsOn, hoje),
    );
  } else if (filters.temporal === 'expired') {
    conditions.push(sql`${warranties.endsOn} < ${hoje}`);
  } else if (filters.temporal === 'future') {
    conditions.push(sql`${warranties.startsOn} > ${hoje}`);
  }

  if (filters.expiringInDays !== undefined) {
    conditions.push(
      eq(warranties.status, 'active'),
      gte(warranties.endsOn, hoje),
      lte(warranties.endsOn, addDays(hoje, filters.expiringInDays)),
    );
  }

  if (filters.search) {
    const texto = normalizeSearchable(filters.search);
    const digitos = filters.search.replace(/\D/g, '');
    const alternativas: SQL[] = [];
    if (texto) alternativas.push(like(customers.nameNormalized, `%${texto}%`));
    if (digitos) alternativas.push(eq(warranties.number, Number(digitos)));
    const combinado = alternativas.length > 0 ? or(...alternativas) : undefined;
    if (combinado) conditions.push(combinado);
  }

  const where = and(...conditions);

  const [rows, [totals]] = await Promise.all([
    getDb()
      .select({
        id: warranties.id,
        number: warranties.number,
        type: warranties.type,
        status: warranties.status,
        startsOn: warranties.startsOn,
        endsOn: warranties.endsOn,
        unitId: warranties.unitId,
        unitName: units.name,
        customerName: customers.name,
        equipmentKind: equipment.kind,
        equipmentBrand: equipment.brand,
        equipmentModel: equipment.model,
        serviceOrderNumber: serviceOrders.number,
        /** Subconsulta escalar: um SELECT, nunca um por linha. */
        returnCount: sql<number>`(
          SELECT COUNT(*) FROM ${warrantyReturns}
          WHERE ${warrantyReturns.warrantyId} = ${warranties.id}
        )`,
      })
      .from(warranties)
      .leftJoin(units, eq(units.id, warranties.unitId))
      .leftJoin(customers, eq(customers.id, warranties.customerId))
      .leftJoin(equipment, eq(equipment.id, warranties.equipmentId))
      .leftJoin(serviceOrders, eq(serviceOrders.id, warranties.serviceOrderId))
      .where(where)
      /** Ordenacao DETERMINISTICA: o `id` desempata para a pagina 2 nao repetir. */
      .orderBy(desc(warranties.endsOn), desc(warranties.id))
      .limit(limit)
      .offset(offset),

    getDb()
      .select({ total: sql<number>`COUNT(*)` })
      .from(warranties)
      .leftJoin(customers, eq(customers.id, warranties.customerId))
      .where(where),
  ]);

  const items: WarrantyListItem[] = rows.map((row) => ({
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status,
    customerName: row.customerName,
    equipmentLabel:
      [row.equipmentBrand, row.equipmentModel].filter(Boolean).join(' ') || row.equipmentKind,
    serviceOrderNumber: row.serviceOrderNumber,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    temporal: temporalClassOf(row, hoje),
    enforceable: isWarrantyEnforceable(row, hoje),
    returnCount: Number(row.returnCount ?? 0),
    unitId: row.unitId,
    unitName: row.unitName,
  }));

  return buildOffsetPage(items, Number(totals?.total ?? 0), { page, pageSize: limit });
}

export async function findWarrantyDetail(context: TenantContext, warrantyId: string) {
  const db = getDb();

  const [row] = await db
    .select()
    .from(warranties)
    .where(and(eq(warranties.tenantId, context.tenantId), eq(warranties.id, warrantyId)))
    .limit(1);

  if (!row) return null;
  if (!context.authorizedUnitIds.includes(row.unitId)) return null;

  const hoje = todayIn(context.tenantTimezone);

  const [cobertura, retornos, timeline, cliente, aparelho, unidade, ordem] = await Promise.all([
    db
      .select({
        id: warrantyCoverageItems.id,
        kind: warrantyCoverageItems.kind,
        description: warrantyCoverageItems.description,
        partId: warrantyCoverageItems.partId,
      })
      .from(warrantyCoverageItems)
      .where(
        and(
          eq(warrantyCoverageItems.tenantId, context.tenantId),
          eq(warrantyCoverageItems.warrantyId, warrantyId),
        ),
      )
      .orderBy(warrantyCoverageItems.position),

    db
      .select({
        id: warrantyReturns.id,
        registeredAt: warrantyReturns.registeredAt,
        referenceDate: warrantyReturns.referenceDate,
        customerReport: warrantyReturns.customerReport,
        coverageAssessment: warrantyReturns.coverageAssessment,
        wasEnforceable: warrantyReturns.wasEnforceable,
        returnServiceOrderId: warrantyReturns.returnServiceOrderId,
        returnServiceOrderNumber: serviceOrders.number,
        unitId: warrantyReturns.unitId,
      })
      .from(warrantyReturns)
      .leftJoin(serviceOrders, eq(serviceOrders.id, warrantyReturns.returnServiceOrderId))
      .where(
        and(
          eq(warrantyReturns.tenantId, context.tenantId),
          eq(warrantyReturns.warrantyId, warrantyId),
        ),
      )
      .orderBy(desc(warrantyReturns.registeredAt)),

    db
      .select({
        id: warrantyTimeline.id,
        kind: warrantyTimeline.kind,
        summary: warrantyTimeline.summary,
        reason: warrantyTimeline.reason,
        actorId: warrantyTimeline.actorId,
        occurredAt: warrantyTimeline.occurredAt,
      })
      .from(warrantyTimeline)
      .where(
        and(
          eq(warrantyTimeline.tenantId, context.tenantId),
          eq(warrantyTimeline.warrantyId, warrantyId),
        ),
      )
      .orderBy(desc(warrantyTimeline.occurredAt), desc(warrantyTimeline.id))
      .limit(100),

    db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(eq(customers.id, row.customerId))
      .limit(1),

    db
      .select({
        id: equipment.id,
        kind: equipment.kind,
        brand: equipment.brand,
        model: equipment.model,
      })
      .from(equipment)
      .where(eq(equipment.id, row.equipmentId))
      .limit(1),

    db.select({ name: units.name }).from(units).where(eq(units.id, row.unitId)).limit(1),

    row.serviceOrderId
      ? db
          .select({
            id: serviceOrders.id,
            number: serviceOrders.number,
            status: serviceOrders.status,
          })
          .from(serviceOrders)
          .where(eq(serviceOrders.id, row.serviceOrderId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  /** Nomes dos atores em UMA consulta, nunca uma por linha. */
  const actorIds = [
    ...new Set(timeline.map((e) => e.actorId).filter((v): v is string => Boolean(v))),
  ];
  const nomes = new Map<string, string>();
  if (actorIds.length > 0) {
    const rows_ = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, context.tenantId), inArray(users.id, actorIds)));
    for (const entry of rows_) nomes.set(entry.id, entry.name);
  }

  return {
    warranty: row,
    temporal: temporalClassOf(row, hoje),
    enforceable: isWarrantyEnforceable(row, hoje),
    referenceDate: hoje,
    coverage: cobertura,
    returns: retornos,
    timeline: timeline.map((e) => ({
      ...e,
      actorName: e.actorId ? (nomes.get(e.actorId) ?? null) : null,
    })),
    customer: cliente[0] ?? null,
    equipment: aparelho[0] ?? null,
    unitName: unidade[0]?.name ?? null,
    originServiceOrder: ordem[0] ?? null,
  };
}

/** Garantias de um equipamento, para a ficha dele e para o fluxo de retorno. */
export async function listWarrantiesForEquipment(context: TenantContext, equipmentId: string) {
  const hoje = todayIn(context.tenantTimezone);

  const rows = await getDb()
    .select({
      id: warranties.id,
      number: warranties.number,
      type: warranties.type,
      status: warranties.status,
      startsOn: warranties.startsOn,
      endsOn: warranties.endsOn,
      unitId: warranties.unitId,
      serviceOrderId: warranties.serviceOrderId,
      serviceOrderNumber: serviceOrders.number,
      coversWholeService: warranties.coversWholeService,
    })
    .from(warranties)
    .leftJoin(serviceOrders, eq(serviceOrders.id, warranties.serviceOrderId))
    .where(and(eq(warranties.tenantId, context.tenantId), eq(warranties.equipmentId, equipmentId)))
    .orderBy(desc(warranties.endsOn));

  return rows
    .filter((row) => context.authorizedUnitIds.includes(row.unitId))
    .map((row) => ({
      ...row,
      temporal: temporalClassOf(row, hoje),
      enforceable: isWarrantyEnforceable(row, hoje),
    }));
}

/** Garantias ligadas a uma OS — para a secao na ficha dela (item 74). */
export async function listWarrantiesForServiceOrder(
  context: TenantContext,
  serviceOrderId: string,
) {
  const hoje = todayIn(context.tenantTimezone);

  const rows = await getDb()
    .select({
      id: warranties.id,
      number: warranties.number,
      type: warranties.type,
      status: warranties.status,
      startsOn: warranties.startsOn,
      endsOn: warranties.endsOn,
      unitId: warranties.unitId,
    })
    .from(warranties)
    .where(
      and(eq(warranties.tenantId, context.tenantId), eq(warranties.serviceOrderId, serviceOrderId)),
    )
    .orderBy(desc(warranties.endsOn));

  return rows
    .filter((row) => context.authorizedUnitIds.includes(row.unitId))
    .map((row) => ({
      ...row,
      temporal: temporalClassOf(row, hoje),
      enforceable: isWarrantyEnforceable(row, hoje),
    }));
}

/** O retorno que originou uma OS, para a ficha dizer "Garantia da OS #...". */
export async function findReturnByServiceOrder(context: TenantContext, serviceOrderId: string) {
  const [row] = await getDb()
    .select({
      id: warrantyReturns.id,
      warrantyId: warrantyReturns.warrantyId,
      warrantyNumber: warranties.number,
      originalServiceOrderId: warrantyReturns.originalServiceOrderId,
      originalNumber: serviceOrders.number,
      registeredAt: warrantyReturns.registeredAt,
    })
    .from(warrantyReturns)
    .innerJoin(warranties, eq(warranties.id, warrantyReturns.warrantyId))
    .leftJoin(serviceOrders, eq(serviceOrders.id, warrantyReturns.originalServiceOrderId))
    .where(
      and(
        eq(warrantyReturns.tenantId, context.tenantId),
        eq(warrantyReturns.returnServiceOrderId, serviceOrderId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** O retorno gerado A PARTIR de uma OS, para a original mostrar o vinculo. */
export async function listReturnsFromOriginalServiceOrder(
  context: TenantContext,
  serviceOrderId: string,
) {
  return getDb()
    .select({
      id: warrantyReturns.id,
      warrantyId: warrantyReturns.warrantyId,
      warrantyNumber: warranties.number,
      returnServiceOrderId: warrantyReturns.returnServiceOrderId,
      returnNumber: serviceOrders.number,
      registeredAt: warrantyReturns.registeredAt,
      coverageAssessment: warrantyReturns.coverageAssessment,
    })
    .from(warrantyReturns)
    .innerJoin(warranties, eq(warranties.id, warrantyReturns.warrantyId))
    .leftJoin(serviceOrders, eq(serviceOrders.id, warrantyReturns.returnServiceOrderId))
    .where(
      and(
        eq(warrantyReturns.tenantId, context.tenantId),
        eq(warrantyReturns.originalServiceOrderId, serviceOrderId),
      ),
    )
    .orderBy(desc(warrantyReturns.registeredAt));
}

export interface WarrantyOverview {
  active: number;
  expiringSoon: number;
  returnsInPeriod: number;
  returnsCovered: number;
}

/**
 * Painel operacional (item 86). SO metricas cuja definicao e conferivel.
 *
 * NAO HA RANKING DE TECNICO. Um numero que aponta pessoas muda o
 * comportamento da equipe antes de melhorar o processo: o tecnico passa a
 * evitar o conserto dificil, nao a errar menos.
 *
 * "Retorno coberto" usa a definicao escrita no dominio (item 87) — retorno
 * sob garantia vigente e avaliado como coberto —, e nao "qualquer OS nova do
 * mesmo cliente".
 */
export async function loadWarrantyOverview(
  context: TenantContext,
  period: { from: string; to: string },
): Promise<WarrantyOverview> {
  if (context.authorizedUnitIds.length === 0) {
    return { active: 0, expiringSoon: 0, returnsInPeriod: 0, returnsCovered: 0 };
  }

  const hoje = todayIn(context.tenantTimezone);
  const unidades = inArray(warranties.unitId, [...context.authorizedUnitIds]);
  const db = getDb();

  const [[ativas], [vencendo], [retornos]] = await Promise.all([
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(warranties)
      .where(
        and(
          eq(warranties.tenantId, context.tenantId),
          unidades,
          eq(warranties.status, 'active'),
          lte(warranties.startsOn, hoje),
          gte(warranties.endsOn, hoje),
        ),
      ),

    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(warranties)
      .where(
        and(
          eq(warranties.tenantId, context.tenantId),
          unidades,
          eq(warranties.status, 'active'),
          gte(warranties.endsOn, hoje),
          lte(warranties.endsOn, addDays(hoje, 30)),
        ),
      ),

    db
      .select({
        total: sql<number>`COUNT(*)`,
        cobertos: sql<number>`SUM(CASE WHEN ${warrantyReturns.coverageAssessment} = 'covered' AND ${warrantyReturns.wasEnforceable} = 1 THEN 1 ELSE 0 END)`,
      })
      .from(warrantyReturns)
      .where(
        and(
          eq(warrantyReturns.tenantId, context.tenantId),
          inArray(warrantyReturns.unitId, [...context.authorizedUnitIds]),
          sql`${warrantyReturns.referenceDate} BETWEEN ${period.from} AND ${period.to}`,
        ),
      ),
  ]);

  return {
    active: Number(ativas?.n ?? 0),
    expiringSoon: Number(vencendo?.n ?? 0),
    returnsInPeriod: Number(retornos?.total ?? 0),
    returnsCovered: Number(retornos?.cobertos ?? 0),
  };
}

/** Retornos recentes, para a aba "Retornos". */
export async function listWarrantyReturns(context: TenantContext, limit = 50) {
  if (context.authorizedUnitIds.length === 0) return [];

  return getDb()
    .select({
      id: warrantyReturns.id,
      warrantyId: warrantyReturns.warrantyId,
      warrantyNumber: warranties.number,
      warrantyType: warranties.type,
      customerName: customers.name,
      registeredAt: warrantyReturns.registeredAt,
      referenceDate: warrantyReturns.referenceDate,
      coverageAssessment: warrantyReturns.coverageAssessment,
      wasEnforceable: warrantyReturns.wasEnforceable,
      returnServiceOrderId: warrantyReturns.returnServiceOrderId,
      returnNumber: serviceOrders.number,
      unitId: warrantyReturns.unitId,
    })
    .from(warrantyReturns)
    .innerJoin(warranties, eq(warranties.id, warrantyReturns.warrantyId))
    .leftJoin(customers, eq(customers.id, warrantyReturns.customerId))
    .leftJoin(serviceOrders, eq(serviceOrders.id, warrantyReturns.returnServiceOrderId))
    .where(
      and(
        eq(warrantyReturns.tenantId, context.tenantId),
        inArray(warrantyReturns.unitId, [...context.authorizedUnitIds]),
      ),
    )
    .orderBy(desc(warrantyReturns.registeredAt))
    .limit(Math.min(limit, 200));
}

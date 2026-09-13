import 'server-only';
import { and, asc, count, desc, eq, inArray, like, or, type SQL } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { buildOffsetPage, resolveOffset, type OffsetPage } from '@/core/db/pagination';
import { customers } from '@/modules/customers/infrastructure/schema';
import {
  normalizeSearchable,
  normalizeSerial,
  type EquipmentStatus,
  type Voltage,
} from '@/modules/equipment/domain/equipment';
import {
  equipment,
  equipmentIntakeAccessories,
  equipmentIntakeConditions,
  equipmentIntakes,
  equipmentMedia,
} from '@/modules/equipment/infrastructure/schema';
import { units } from '@/modules/tenancy/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Consultas de equipamentos e recebimentos (Prompt 06, itens 53, 97 a 99).
 *
 * Busca, filtro, ordenacao e paginacao acontecem no banco. A listagem faz
 * DUAS consultas para N equipamentos (a pagina e os clientes dela), nunca uma
 * por linha.
 */

export interface EquipmentListFilters {
  query?: string;
  customerId?: string;
  status?: EquipmentStatus;
  page?: number;
  pageSize?: number;
}

export interface EquipmentListItem {
  id: string;
  kind: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  voltage: Voltage;
  status: EquipmentStatus;
  customerId: string;
  customerName: string;
  updatedAt: Date;
}

/**
 * Condicao de busca (item 53).
 *
 * Texto compara com as colunas normalizadas; o termo tambem vira serial
 * normalizado, porque quem digita "y1-2345" precisa achar "Y12345".
 */
function buildSearch(rawQuery: string): SQL | undefined {
  const text = normalizeSearchable(rawQuery);
  if (!text) return undefined;

  const serial = normalizeSerial(rawQuery);

  const conditions: SQL[] = [
    like(equipment.kindNormalized, `%${text}%`),
    like(equipment.brandNormalized, `%${text}%`),
    like(equipment.modelNormalized, `%${text}%`),
  ];

  if (serial.length >= 3) {
    conditions.push(like(equipment.serialNormalized, `%${serial}%`));
  }

  return or(...conditions);
}

export async function listEquipment(
  context: TenantContext,
  filters: EquipmentListFilters = {},
): Promise<OffsetPage<EquipmentListItem>> {
  const db = getDb();
  const { limit, offset, page } = resolveOffset(filters);

  const where = and(
    eq(equipment.tenantId, context.tenantId),
    filters.query ? buildSearch(filters.query) : undefined,
    filters.customerId ? eq(equipment.customerId, filters.customerId) : undefined,
    filters.status ? eq(equipment.status, filters.status) : undefined,
  );

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: equipment.id,
        kind: equipment.kind,
        brand: equipment.brand,
        model: equipment.model,
        serial: equipment.serial,
        voltage: equipment.voltage,
        status: equipment.status,
        customerId: equipment.customerId,
        updatedAt: equipment.updatedAt,
      })
      .from(equipment)
      .where(where)
      // Ordenacao deterministica: coluna + id como desempate (Prompt 02).
      .orderBy(desc(equipment.updatedAt), desc(equipment.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(equipment).where(where),
  ]);

  /** Nomes dos clientes da pagina em UMA consulta — nao uma por equipamento. */
  const names = new Map<string, string>();
  if (rows.length > 0) {
    const owners = await db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, context.tenantId),
          inArray(
            customers.id,
            rows.map((row) => row.customerId),
          ),
        ),
      );
    for (const owner of owners) names.set(owner.id, owner.name);
  }

  const items: EquipmentListItem[] = rows.map((row) => ({
    ...row,
    customerName: names.get(row.customerId) ?? 'Cliente removido',
  }));

  return buildOffsetPage(items, Number(totals?.total ?? 0), { page, pageSize: limit });
}

export interface EquipmentDetail {
  equipment: typeof equipment.$inferSelect;
  customer: { id: string; name: string } | null;
  media: (typeof equipmentMedia.$inferSelect)[];
  intakes: {
    intake: typeof equipmentIntakes.$inferSelect;
    unitName: string | null;
    accessories: (typeof equipmentIntakeAccessories.$inferSelect)[];
    conditions: (typeof equipmentIntakeConditions.$inferSelect)[];
    mediaCount: number;
  }[];
}

/**
 * Ficha do equipamento, escopada por tenant.
 *
 * Carrega o que a tela mostra e nada alem (item 117): metadados das fotos, sem
 * os bytes; acessorios e condicoes dos recebimentos daquele aparelho, em
 * consultas agrupadas.
 */
export async function findEquipmentDetail(
  context: TenantContext,
  equipmentId: string,
): Promise<EquipmentDetail | null> {
  const db = getDb();

  const [row] = await db
    .select()
    .from(equipment)
    .where(and(eq(equipment.tenantId, context.tenantId), eq(equipment.id, equipmentId)))
    .limit(1);

  if (!row) return null;

  const [owners, media, intakeRows] = await Promise.all([
    db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.tenantId, context.tenantId), eq(customers.id, row.customerId)))
      .limit(1),
    db
      .select()
      .from(equipmentMedia)
      .where(
        and(
          eq(equipmentMedia.tenantId, context.tenantId),
          eq(equipmentMedia.equipmentId, equipmentId),
        ),
      )
      .orderBy(desc(equipmentMedia.createdAt)),
    db
      .select({ intake: equipmentIntakes, unitName: units.name })
      .from(equipmentIntakes)
      .leftJoin(units, eq(units.id, equipmentIntakes.unitId))
      .where(
        and(
          eq(equipmentIntakes.tenantId, context.tenantId),
          eq(equipmentIntakes.equipmentId, equipmentId),
        ),
      )
      .orderBy(desc(equipmentIntakes.receivedAt), desc(equipmentIntakes.id)),
  ]);

  const intakeIds = intakeRows.map((item) => item.intake.id);

  // Acessorios e condicoes de TODOS os recebimentos em duas consultas.
  const [accessories, conditions] =
    intakeIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(equipmentIntakeAccessories)
            .where(
              and(
                eq(equipmentIntakeAccessories.tenantId, context.tenantId),
                inArray(equipmentIntakeAccessories.intakeId, intakeIds),
              ),
            ),
          db
            .select()
            .from(equipmentIntakeConditions)
            .where(
              and(
                eq(equipmentIntakeConditions.tenantId, context.tenantId),
                inArray(equipmentIntakeConditions.intakeId, intakeIds),
              ),
            ),
        ])
      : [[], []];

  return {
    equipment: row,
    customer: owners[0] ?? null,
    media,
    intakes: intakeRows.map((item) => ({
      intake: item.intake,
      unitName: item.unitName,
      accessories: accessories.filter((accessory) => accessory.intakeId === item.intake.id),
      conditions: conditions.filter((condition) => condition.intakeId === item.intake.id),
      mediaCount: media.filter((file) => file.intakeId === item.intake.id).length,
    })),
  };
}

/** Equipamentos de um cliente — usado na ficha do cliente e no recebimento. */
export async function listEquipmentByCustomer(
  context: TenantContext,
  customerId: string,
): Promise<EquipmentListItem[]> {
  const page = await listEquipment(context, { customerId, pageSize: 50 });
  return page.items;
}

/**
 * Possiveis duplicados (item 55).
 *
 * AVISO, nunca bloqueio: dois aparelhos iguais do mesmo cliente existem (duas
 * caixas de som do mesmo par), e fabricantes reutilizam serial. Quem decide e
 * quem esta atendendo.
 */
export async function findSimilarEquipment(
  context: TenantContext,
  input: {
    customerId: string;
    serial?: string | null;
    brand?: string | null;
    model?: string | null;
  },
): Promise<EquipmentListItem[]> {
  const db = getDb();
  const serial = input.serial ? normalizeSerial(input.serial) : '';

  const sinais: SQL[] = [];
  if (serial.length >= 3) sinais.push(eq(equipment.serialNormalized, serial));
  if (input.brand && input.model) {
    sinais.push(
      and(
        eq(equipment.customerId, input.customerId),
        eq(equipment.brandNormalized, normalizeSearchable(input.brand)),
        eq(equipment.modelNormalized, normalizeSearchable(input.model)),
      ) as SQL,
    );
  }

  if (sinais.length === 0) return [];

  const rows = await db
    .select({
      id: equipment.id,
      kind: equipment.kind,
      brand: equipment.brand,
      model: equipment.model,
      serial: equipment.serial,
      voltage: equipment.voltage,
      status: equipment.status,
      customerId: equipment.customerId,
      updatedAt: equipment.updatedAt,
      customerName: customers.name,
    })
    .from(equipment)
    .innerJoin(
      customers,
      and(eq(customers.id, equipment.customerId), eq(customers.tenantId, equipment.tenantId)),
    )
    .where(and(eq(equipment.tenantId, context.tenantId), or(...sinais)))
    .orderBy(asc(equipment.createdAt))
    .limit(5);

  return rows;
}

export interface IntakeListItem {
  id: string;
  receivedAt: Date;
  unitId: string;
  unitName: string | null;
  equipmentId: string;
  equipmentKind: string;
  equipmentBrand: string | null;
  equipmentModel: string | null;
  customerName: string;
}

/**
 * Recebimentos da UNIDADE ATIVA (itens 67 e 108).
 *
 * O filtro por unidade nao e conveniencia de tela: recebimento pertence a
 * unidade, e quem opera numa loja nao ve a entrada registrada em outra. A
 * unidade vem do contexto, nunca de parametro.
 */
export async function listIntakes(
  context: TenantContext,
  filters: { page?: number; pageSize?: number } = {},
): Promise<OffsetPage<IntakeListItem>> {
  const db = getDb();
  const { limit, offset, page } = resolveOffset(filters);

  const where = and(
    eq(equipmentIntakes.tenantId, context.tenantId),
    context.activeUnitId
      ? eq(equipmentIntakes.unitId, context.activeUnitId)
      : inArray(equipmentIntakes.unitId, [...context.authorizedUnitIds, '']),
  );

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: equipmentIntakes.id,
        receivedAt: equipmentIntakes.receivedAt,
        unitId: equipmentIntakes.unitId,
        unitName: units.name,
        equipmentId: equipment.id,
        equipmentKind: equipment.kind,
        equipmentBrand: equipment.brand,
        equipmentModel: equipment.model,
        customerName: customers.name,
      })
      .from(equipmentIntakes)
      .innerJoin(
        equipment,
        and(
          eq(equipment.id, equipmentIntakes.equipmentId),
          eq(equipment.tenantId, equipmentIntakes.tenantId),
        ),
      )
      .innerJoin(
        customers,
        and(eq(customers.id, equipment.customerId), eq(customers.tenantId, equipment.tenantId)),
      )
      .leftJoin(units, eq(units.id, equipmentIntakes.unitId))
      .where(where)
      .orderBy(desc(equipmentIntakes.receivedAt), desc(equipmentIntakes.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(equipmentIntakes).where(where),
  ]);

  return buildOffsetPage(rows, Number(totals?.total ?? 0), { page, pageSize: limit });
}

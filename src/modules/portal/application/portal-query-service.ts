import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { todayIn } from '@/core/time/civil-date';
import { equipmentTitle } from '@/modules/equipment/domain/equipment';
import { equipment } from '@/modules/equipment/infrastructure/schema';
import { checkFeatureEnabledForTenant } from '@/modules/features/application/effective-access';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  externalServiceOrderStatusLabel,
  externalServiceOrderStatusTone,
  maskEquipmentSerial,
  PORTAL_VISIBLE_TIMELINE_KINDS,
  type PortalContext,
} from '@/modules/portal/domain/portal';
import { assertOwned } from './portal-ownership';
import { serviceOrders, serviceOrderTimeline } from '@/modules/service-orders/infrastructure/schema';
import { tenants } from '@/modules/tenancy/infrastructure/schema';
import {
  formatDuration,
  formatWarrantyNumber,
  temporalClassOf,
  warrantyTypeLabel,
  type DurationUnit,
  type TemporalClass,
} from '@/modules/warranties/domain/warranty';
import { warranties } from '@/modules/warranties/infrastructure/schema';

/**
 * PROJECAO EXTERNA (Prompt 17, item 38 a 47).
 *
 * Este arquivo e a UNICA porta entre os dados operacionais e o Portal. Toda
 * consulta filtra por `tenantId` E `customerId` no WHERE — nunca busca por id
 * e checa depois — e devolve DTO PROPRIO, nunca a linha do banco. Um campo
 * novo em `service_orders` ou `warranties` fica invisivel ao Portal ate
 * alguem decidir, aqui, que ele pode sair — o mesmo padrao de permissao (nao
 * de bloqueio) da lista de timeline em `domain/portal.ts`.
 */

// ---------------------------------------------------------------------------
// Ordens de Servico
// ---------------------------------------------------------------------------

export interface PortalServiceOrderSummary {
  id: string;
  number: number;
  statusLabel: string;
  statusTone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  equipmentTitle: string;
  openedAt: Date;
}

export async function listMyServiceOrders(
  context: PortalContext,
): Promise<PortalServiceOrderSummary[]> {
  const rows = await getDb()
    .select({
      id: serviceOrders.id,
      number: serviceOrders.number,
      status: serviceOrders.status,
      openedAt: serviceOrders.openedAt,
      equipmentKind: equipment.kind,
      equipmentBrand: equipment.brand,
      equipmentModel: equipment.model,
    })
    .from(serviceOrders)
    .innerJoin(equipment, eq(equipment.id, serviceOrders.equipmentId))
    .where(
      and(eq(serviceOrders.tenantId, context.tenantId), eq(serviceOrders.customerId, context.customerId)),
    )
    .orderBy(desc(serviceOrders.openedAt));

  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    statusLabel: externalServiceOrderStatusLabel(row.status),
    statusTone: externalServiceOrderStatusTone(row.status),
    equipmentTitle: equipmentTitle({
      kind: row.equipmentKind,
      brand: row.equipmentBrand,
      model: row.equipmentModel,
    }),
    openedAt: row.openedAt,
  }));
}

export interface PortalServiceOrderTimelineEntry {
  summary: string;
  occurredAt: Date;
}

export interface PortalServiceOrderDetail extends PortalServiceOrderSummary {
  /** As proprias palavras do cliente na abertura — nunca `internal_notes`. */
  customerReport: string;
  timeline: PortalServiceOrderTimelineEntry[];
}

export async function getMyServiceOrder(
  context: PortalContext,
  serviceOrderId: string,
): Promise<PortalServiceOrderDetail> {
  const db = getDb();

  const [row] = await db
    .select({
      id: serviceOrders.id,
      number: serviceOrders.number,
      status: serviceOrders.status,
      openedAt: serviceOrders.openedAt,
      customerReport: serviceOrders.customerReport,
      equipmentKind: equipment.kind,
      equipmentBrand: equipment.brand,
      equipmentModel: equipment.model,
    })
    .from(serviceOrders)
    .innerJoin(equipment, eq(equipment.id, serviceOrders.equipmentId))
    .where(
      and(
        eq(serviceOrders.id, serviceOrderId),
        eq(serviceOrders.tenantId, context.tenantId),
        eq(serviceOrders.customerId, context.customerId),
      ),
    )
    .limit(1);

  const os = assertOwned(row);

  /**
   * Filtro NA CONSULTA, nao so na leitura: um `kind` que a lista nunca
   * autorizou nao sai do banco para dentro do processo do Portal.
   */
  const timelineRows = await db
    .select({ summary: serviceOrderTimeline.summary, occurredAt: serviceOrderTimeline.occurredAt })
    .from(serviceOrderTimeline)
    .where(
      and(
        eq(serviceOrderTimeline.serviceOrderId, serviceOrderId),
        eq(serviceOrderTimeline.tenantId, context.tenantId),
        inArray(serviceOrderTimeline.kind, PORTAL_VISIBLE_TIMELINE_KINDS),
      ),
    )
    .orderBy(serviceOrderTimeline.occurredAt);

  return {
    id: os.id,
    number: os.number,
    statusLabel: externalServiceOrderStatusLabel(os.status),
    statusTone: externalServiceOrderStatusTone(os.status),
    equipmentTitle: equipmentTitle({
      kind: os.equipmentKind,
      brand: os.equipmentBrand,
      model: os.equipmentModel,
    }),
    openedAt: os.openedAt,
    customerReport: os.customerReport,
    /** `summary` pode ser nulo por construcao da tabela; sem texto, nada a mostrar. */
    timeline: timelineRows
      .filter((entry): entry is { summary: string; occurredAt: Date } => Boolean(entry.summary))
      .map((entry) => ({ summary: entry.summary, occurredAt: entry.occurredAt })),
  };
}

// ---------------------------------------------------------------------------
// Equipamentos
// ---------------------------------------------------------------------------

export interface PortalEquipmentSummary {
  id: string;
  title: string;
  kind: string;
  maskedSerial: string | null;
}

export async function listMyEquipment(context: PortalContext): Promise<PortalEquipmentSummary[]> {
  const rows = await getDb()
    .select({
      id: equipment.id,
      kind: equipment.kind,
      brand: equipment.brand,
      model: equipment.model,
      serial: equipment.serial,
    })
    .from(equipment)
    .where(and(eq(equipment.tenantId, context.tenantId), eq(equipment.customerId, context.customerId)))
    .orderBy(desc(equipment.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    title: equipmentTitle(row),
    kind: row.kind,
    maskedSerial: maskEquipmentSerial(row.serial),
  }));
}

// ---------------------------------------------------------------------------
// Garantias
// ---------------------------------------------------------------------------

export interface PortalWarrantySummary {
  id: string;
  number: string;
  typeLabel: string;
  temporal: TemporalClass;
  startsOn: string;
  endsOn: string;
  durationLabel: string;
  equipmentId: string;
}

/**
 * So aparece se `operations.warranties` estiver ligada PARA O TENANT (item
 * 47 e 122): garantia e capacidade OPCIONAL do painel interno, e o Portal
 * nao pode oferecer ao cliente uma secao que a propria empresa desligou.
 */
export async function listMyWarranties(context: PortalContext): Promise<PortalWarrantySummary[]> {
  const db = getDb();

  const [tenant] = await db
    .select({ planId: tenants.planId, timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, context.tenantId))
    .limit(1);
  if (!tenant) return [];

  const access = await checkFeatureEnabledForTenant(
    { tenantId: context.tenantId, planId: tenant.planId },
    FEATURES.OPERATIONS_WARRANTIES,
  );
  if (!access.allowed) return [];

  const hoje = todayIn(tenant.timezone);

  const rows = await db
    .select({
      id: warranties.id,
      number: warranties.number,
      type: warranties.type,
      startsOn: warranties.startsOn,
      endsOn: warranties.endsOn,
      durationAmount: warranties.durationAmount,
      durationUnit: warranties.durationUnit,
      equipmentId: warranties.equipmentId,
      status: warranties.status,
    })
    .from(warranties)
    .where(
      and(eq(warranties.tenantId, context.tenantId), eq(warranties.customerId, context.customerId)),
    )
    .orderBy(desc(warranties.startsOn));

  /** `draft` nunca sai: e trabalho em andamento de quem concede, nao um fato
   * do cliente ainda (a garantia so existe, para ele, quando emitida). */
  return rows
    .filter((row) => row.status !== 'draft')
    .map((row) => ({
      id: row.id,
      number: formatWarrantyNumber(row.number),
      typeLabel: warrantyTypeLabel(row.type),
      temporal: temporalClassOf(row, hoje),
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      durationLabel: formatDuration(row.durationAmount, row.durationUnit as DurationUnit),
      equipmentId: row.equipmentId,
    }));
}

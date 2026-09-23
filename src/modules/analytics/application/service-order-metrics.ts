import 'server-only';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import {
  isKnownStatus,
  SERVICE_ORDER_STATUSES,
  SERVICE_ORDER_STATUS_LABEL,
  TERMINAL_STATUSES,
  type ServiceOrderStatus,
} from '@/modules/service-orders/domain/workflow';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import type { AnalyticsScope } from '@/modules/analytics/domain/analytics-scope';
import {
  bucketBacklogAging,
  computeCycleTimeStats,
  type AgingBucketResult,
  type CycleTimeStats,
} from '@/modules/analytics/domain/service-order-analytics';

/**
 * ADAPTADOR DE ORDENS DE SERVICO (Prompt 18).
 *
 * SO LEITURA — mesma regra da Central de Trabalho (ADR-077): nenhum insert,
 * update ou delete, e um teste de fronteira falha se algum aparecer.
 *
 * O escopo de unidade e SEMPRE `scope.selectedUnitIds`, ja resolvido e
 * validado por `resolveAnalyticsScope` como subconjunto das unidades
 * autorizadas — este arquivo nunca aceita `unitId` de outra origem.
 */

export interface ServiceOrderStatusCount {
  status: ServiceOrderStatus;
  label: string;
  total: number;
}

export interface ServiceOrderMetrics {
  statusDistribution: ServiceOrderStatusCount[];
  openTotal: number;
  createdInPeriod: number;
  completedInPeriod: number;
  cancelledInPeriod: number;
  backlogAging: AgingBucketResult[];
  cycleTime: CycleTimeStats | null;
}

function emptyMetrics(): ServiceOrderMetrics {
  return {
    statusDistribution: SERVICE_ORDER_STATUSES.map((status) => ({
      status,
      label: SERVICE_ORDER_STATUS_LABEL[status],
      total: 0,
    })),
    openTotal: 0,
    createdInPeriod: 0,
    completedInPeriod: 0,
    cancelledInPeriod: 0,
    backlogAging: bucketBacklogAging([]),
    cycleTime: null,
  };
}

/** Mesma conversao civil->instante usada em `listServiceOrders` (item 13). */
function startOfDayUtc(civilDate: string): Date {
  return new Date(`${civilDate}T00:00:00.000Z`);
}

function endOfDayUtc(civilDate: string): Date {
  return new Date(`${civilDate}T23:59:59.999Z`);
}

interface StatusCountRow {
  status: string;
  total: number | string;
}

export async function loadServiceOrderMetrics(scope: AnalyticsScope): Promise<ServiceOrderMetrics> {
  if (scope.selectedUnitIds.length === 0) return emptyMetrics();

  const db = getDb();
  const unitIds = [...scope.selectedUnitIds];
  const tenantScope = and(
    eq(serviceOrders.tenantId, scope.tenantId),
    inArray(serviceOrders.unitId, unitIds),
  );

  const periodStart = startOfDayUtc(scope.period.from);
  const periodEnd = endOfDayUtc(scope.period.to);

  const [
    distributionRows,
    createdCountRows,
    completedCountRows,
    cancelledCountRows,
    agingRows,
    cycleRows,
  ] = await Promise.all([
    // Distribuicao por situacao, AGORA — sem filtro de periodo (item 38).
    db
      .select({ status: serviceOrders.status, total: sql<number>`COUNT(*)` })
      .from(serviceOrders)
      .where(tenantScope)
      .groupBy(serviceOrders.status),

    // Entradas no periodo — pelo fato oficial de abertura (item 35).
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(serviceOrders)
      .where(
        and(
          tenantScope,
          gte(serviceOrders.openedAt, periodStart),
          lte(serviceOrders.openedAt, periodEnd),
        ),
      ),

    // Finalizacoes no periodo — status_changed_at de quem esta 'completed'
    // agora. Terminal nunca muda de novo, entao esse instante E a
    // finalizacao (item 36); nunca `updated_at` (item 41).
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(serviceOrders)
      .where(
        and(
          tenantScope,
          eq(serviceOrders.status, 'completed'),
          gte(serviceOrders.statusChangedAt, periodStart),
          lte(serviceOrders.statusChangedAt, periodEnd),
        ),
      ),

    // Cancelamentos no periodo — separado de finalizacoes (item 37).
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(serviceOrders)
      .where(
        and(
          tenantScope,
          eq(serviceOrders.status, 'cancelled'),
          gte(serviceOrders.statusChangedAt, periodStart),
          lte(serviceOrders.statusChangedAt, periodEnd),
        ),
      ),

    // Antiguidade do backlog aberto, AGORA — a partir de `opened_at` (item 40).
    db
      .select({ ageDays: sql<number>`DATEDIFF(${scope.today}, DATE(${serviceOrders.openedAt}))` })
      .from(serviceOrders)
      .where(and(tenantScope, sql`${serviceOrders.status} NOT IN ('completed','cancelled')`)),

    // Tempo de ciclo: so OS finalizadas NO PERIODO (item 42).
    db
      .select({
        durationDays: sql<number>`DATEDIFF(DATE(${serviceOrders.statusChangedAt}), DATE(${serviceOrders.openedAt}))`,
      })
      .from(serviceOrders)
      .where(
        and(
          tenantScope,
          eq(serviceOrders.status, 'completed'),
          gte(serviceOrders.statusChangedAt, periodStart),
          lte(serviceOrders.statusChangedAt, periodEnd),
        ),
      ),
  ]);

  const porStatus = new Map<string, number>();
  for (const row of distributionRows as unknown as StatusCountRow[]) {
    porStatus.set(row.status, Number(row.total));
  }

  const statusDistribution: ServiceOrderStatusCount[] = SERVICE_ORDER_STATUSES.map((status) => ({
    status,
    label: SERVICE_ORDER_STATUS_LABEL[status],
    total: porStatus.get(status) ?? 0,
  }));

  const openTotal = statusDistribution
    .filter((row) => !(TERMINAL_STATUSES as readonly string[]).includes(row.status))
    .reduce((total, row) => total + row.total, 0);

  return {
    statusDistribution,
    openTotal,
    createdInPeriod: Number(
      (createdCountRows[0] as { total: number | string } | undefined)?.total ?? 0,
    ),
    completedInPeriod: Number(
      (completedCountRows[0] as { total: number | string } | undefined)?.total ?? 0,
    ),
    cancelledInPeriod: Number(
      (cancelledCountRows[0] as { total: number | string } | undefined)?.total ?? 0,
    ),
    backlogAging: bucketBacklogAging(
      (agingRows as unknown as { ageDays: number | string }[]).map((row) => Number(row.ageDays)),
    ),
    cycleTime: computeCycleTimeStats(
      (cycleRows as unknown as { durationDays: number | string }[]).map((row) =>
        Number(row.durationDays),
      ),
    ),
  };
}

export function isKnownServiceOrderStatus(value: string): value is ServiceOrderStatus {
  return isKnownStatus(value);
}

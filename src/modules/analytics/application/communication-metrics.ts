import 'server-only';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { civilDateRangeToUtc } from '@/core/time/civil-date';
import { communicationMessages } from '@/modules/communications/infrastructure/schema';
import type { AnalyticsScope } from '@/modules/analytics/domain/analytics-scope';

/**
 * ADAPTADOR DE COMUNICACAO (Prompt 18). SO LEITURA.
 *
 * NAO existe "taxa de entrega" nem "taxa de leitura" aqui, de proposito
 * (ADR-078, item 68/158): o modelo de dominio nao tem `delivered`/`read`
 * porque nenhum provedor real esta integrado, e o Painel preserva essa
 * limitacao em vez de mascara-la com um numero que pareceria confirmacao de
 * entrega.
 */

export interface CommunicationMetrics {
  registeredInPeriod: number;
  failedInPeriod: number;
}

export async function loadCommunicationMetrics(
  scope: AnalyticsScope,
): Promise<CommunicationMetrics> {
  if (scope.selectedUnitIds.length === 0) return { registeredInPeriod: 0, failedInPeriod: 0 };

  const unitIds = [...scope.selectedUnitIds];
  /**
   * Fronteira civil -> UTC (ADR-084, Prompt 19.1): ver quote-metrics.ts para
   * a explicacao completa do bug que isto substitui.
   */
  const { startUtc: periodStart, endExclusiveUtc: periodEndExclusive } = civilDateRangeToUtc(
    scope.period.from,
    scope.period.to,
    scope.timezone,
  );
  const baseScope = and(
    eq(communicationMessages.tenantId, scope.tenantId),
    inArray(communicationMessages.unitId, unitIds),
    gte(communicationMessages.createdAt, periodStart),
    lt(communicationMessages.createdAt, periodEndExclusive),
  );

  const [registeredRows, failedRows] = await Promise.all([
    getDb()
      .select({ total: sql<number>`COUNT(*)` })
      .from(communicationMessages)
      .where(baseScope),
    getDb()
      .select({ total: sql<number>`COUNT(*)` })
      .from(communicationMessages)
      .where(and(baseScope, eq(communicationMessages.status, 'failed'))),
  ]);

  return {
    registeredInPeriod: Number(
      (registeredRows[0] as { total: number | string } | undefined)?.total ?? 0,
    ),
    failedInPeriod: Number((failedRows[0] as { total: number | string } | undefined)?.total ?? 0),
  };
}

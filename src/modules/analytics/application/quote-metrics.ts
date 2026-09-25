import 'server-only';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { civilDateRangeToUtc } from '@/core/time/civil-date';
import { quotes } from '@/modules/quotes/infrastructure/schema';
import type { AnalyticsScope } from '@/modules/analytics/domain/analytics-scope';
import { computeApprovalRate } from '@/modules/analytics/domain/service-order-analytics';

/**
 * ADAPTADOR DE ORCAMENTOS (Prompt 18). SO LEITURA.
 */

export interface QuoteMetrics {
  sentInPeriod: number;
  approvedInPeriod: number;
  rejectedInPeriod: number;
  /** `null` = "—": nenhuma decisao (aprovada ou rejeitada) no periodo (item 18). */
  approvalRate: number | null;
}

function emptyMetrics(): QuoteMetrics {
  return { sentInPeriod: 0, approvedInPeriod: 0, rejectedInPeriod: 0, approvalRate: null };
}

export async function loadQuoteMetrics(scope: AnalyticsScope): Promise<QuoteMetrics> {
  if (scope.selectedUnitIds.length === 0) return emptyMetrics();

  const db = getDb();
  const unitIds = [...scope.selectedUnitIds];
  const tenantScope = and(eq(quotes.tenantId, scope.tenantId), inArray(quotes.unitId, unitIds));
  /**
   * Fronteira civil -> UTC (ADR-084, Prompt 19.1): `scope.period.from/to` sao
   * datas civis no fuso do tenant, nunca instantes UTC. `civilDateRangeToUtc`
   * converte para `[periodStart, periodEndExclusive)` no fuso correto — nunca
   * `${civil}T00:00:00.000Z` literal, que excluiria dados reais gravados nas
   * primeiras horas UTC do dia para qualquer fuso atras de UTC.
   */
  const { startUtc: periodStart, endExclusiveUtc: periodEndExclusive } = civilDateRangeToUtc(
    scope.period.from,
    scope.period.to,
    scope.timezone,
  );

  const [sentRows, approvedRows, rejectedRows] = await Promise.all([
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(quotes)
      .where(
        and(tenantScope, gte(quotes.sentAt, periodStart), lt(quotes.sentAt, periodEndExclusive)),
      ),
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(quotes)
      .where(
        and(
          tenantScope,
          eq(quotes.status, 'approved'),
          gte(quotes.decidedAt, periodStart),
          lt(quotes.decidedAt, periodEndExclusive),
        ),
      ),
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(quotes)
      .where(
        and(
          tenantScope,
          eq(quotes.status, 'rejected'),
          gte(quotes.decidedAt, periodStart),
          lt(quotes.decidedAt, periodEndExclusive),
        ),
      ),
  ]);

  const sentInPeriod = Number((sentRows[0] as { total: number | string } | undefined)?.total ?? 0);
  const approvedInPeriod = Number(
    (approvedRows[0] as { total: number | string } | undefined)?.total ?? 0,
  );
  const rejectedInPeriod = Number(
    (rejectedRows[0] as { total: number | string } | undefined)?.total ?? 0,
  );

  return {
    sentInPeriod,
    approvedInPeriod,
    rejectedInPeriod,
    approvalRate: computeApprovalRate(approvedInPeriod, rejectedInPeriod),
  };
}

import 'server-only';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
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

function startOfDayUtc(civilDate: string): Date {
  return new Date(`${civilDate}T00:00:00.000Z`);
}
function endOfDayUtc(civilDate: string): Date {
  return new Date(`${civilDate}T23:59:59.999Z`);
}

export async function loadQuoteMetrics(scope: AnalyticsScope): Promise<QuoteMetrics> {
  if (scope.selectedUnitIds.length === 0) return emptyMetrics();

  const db = getDb();
  const unitIds = [...scope.selectedUnitIds];
  const tenantScope = and(eq(quotes.tenantId, scope.tenantId), inArray(quotes.unitId, unitIds));
  const periodStart = startOfDayUtc(scope.period.from);
  const periodEnd = endOfDayUtc(scope.period.to);

  const [sentRows, approvedRows, rejectedRows] = await Promise.all([
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(quotes)
      .where(and(tenantScope, gte(quotes.sentAt, periodStart), lte(quotes.sentAt, periodEnd))),
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(quotes)
      .where(
        and(
          tenantScope,
          eq(quotes.status, 'approved'),
          gte(quotes.decidedAt, periodStart),
          lte(quotes.decidedAt, periodEnd),
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
          lte(quotes.decidedAt, periodEnd),
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

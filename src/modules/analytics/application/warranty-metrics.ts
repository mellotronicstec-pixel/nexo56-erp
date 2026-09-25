import 'server-only';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { civilDateRangeToUtc } from '@/core/time/civil-date';
import { warranties, warrantyReturns } from '@/modules/warranties/infrastructure/schema';
import type { AnalyticsScope } from '@/modules/analytics/domain/analytics-scope';

/**
 * ADAPTADOR DE GARANTIAS (Prompt 18). SO LEITURA.
 *
 * "Vigente" usa a MESMA regra de `temporalClassOf === 'valid'` (Prompt 13):
 * `status = 'active' AND starts_on <= hoje <= ends_on`. Custo de garantia
 * (`warranties.costs.view`) fica FORA do V1 — ver docs/modules/analytics/future.md.
 */

export interface WarrantyMetrics {
  activeCount: number;
  returnsInPeriod: number;
}

export async function loadWarrantyMetrics(scope: AnalyticsScope): Promise<WarrantyMetrics> {
  if (scope.selectedUnitIds.length === 0) return { activeCount: 0, returnsInPeriod: 0 };

  const unitIds = [...scope.selectedUnitIds];
  /**
   * Fronteira civil -> UTC (ADR-084, Prompt 19.1): ver quote-metrics.ts para
   * a explicacao completa do bug que isto substitui. `warranties.startsOn`/
   * `endsOn` abaixo permanecem comparacao DATA CIVIL x DATA CIVIL (`scope.today`)
   * — nao sao instantes, entao nao entram nesta correcao.
   */
  const { startUtc: periodStart, endExclusiveUtc: periodEndExclusive } = civilDateRangeToUtc(
    scope.period.from,
    scope.period.to,
    scope.timezone,
  );

  const [activeRows, returnRows] = await Promise.all([
    getDb()
      .select({ total: sql<number>`COUNT(*)` })
      .from(warranties)
      .where(
        and(
          eq(warranties.tenantId, scope.tenantId),
          inArray(warranties.unitId, unitIds),
          eq(warranties.status, 'active'),
          sql`${warranties.startsOn} <= ${scope.today}`,
          sql`${warranties.endsOn} >= ${scope.today}`,
        ),
      ),
    getDb()
      .select({ total: sql<number>`COUNT(*)` })
      .from(warrantyReturns)
      .where(
        and(
          eq(warrantyReturns.tenantId, scope.tenantId),
          inArray(warrantyReturns.unitId, unitIds),
          gte(warrantyReturns.registeredAt, periodStart),
          lt(warrantyReturns.registeredAt, periodEndExclusive),
        ),
      ),
  ]);

  return {
    activeCount: Number((activeRows[0] as { total: number | string } | undefined)?.total ?? 0),
    returnsInPeriod: Number((returnRows[0] as { total: number | string } | undefined)?.total ?? 0),
  };
}

import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { purchaseNeeds, purchaseOrders } from '@/modules/purchasing/infrastructure/schema';
import type { AnalyticsScope } from '@/modules/analytics/domain/analytics-scope';

/**
 * ADAPTADOR DE COMPRAS (Prompt 18). SO LEITURA.
 */

export interface PurchasingMetrics {
  openNeeds: number;
  openOrders: number;
}

export async function loadPurchasingMetrics(scope: AnalyticsScope): Promise<PurchasingMetrics> {
  if (scope.selectedUnitIds.length === 0) return { openNeeds: 0, openOrders: 0 };

  const unitIds = [...scope.selectedUnitIds];

  const [needRows, orderRows] = await Promise.all([
    getDb()
      .select({ total: sql<number>`COUNT(*)` })
      .from(purchaseNeeds)
      .where(
        and(
          eq(purchaseNeeds.tenantId, scope.tenantId),
          inArray(purchaseNeeds.unitId, unitIds),
          eq(purchaseNeeds.status, 'open'),
        ),
      ),
    getDb()
      .select({ total: sql<number>`COUNT(*)` })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.tenantId, scope.tenantId),
          inArray(purchaseOrders.unitId, unitIds),
          sql`${purchaseOrders.status} IN ('placed','partially_received')`,
        ),
      ),
  ]);

  return {
    openNeeds: Number((needRows[0] as { total: number | string } | undefined)?.total ?? 0),
    openOrders: Number((orderRows[0] as { total: number | string } | undefined)?.total ?? 0),
  };
}

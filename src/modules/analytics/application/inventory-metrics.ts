import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { stockBalances } from '@/modules/inventory/infrastructure/schema';
import type { AnalyticsScope } from '@/modules/analytics/domain/analytics-scope';

/**
 * ADAPTADOR DE ESTOQUE (Prompt 18). SO LEITURA.
 *
 * A regra de "abaixo do minimo" e a MESMA de `low-stock-job.ts` (Prompt 10,
 * item 58): `minimum_quantity > 0 AND (on_hand - reserved) < minimum_quantity`.
 * Este adaptador NAO filtra por `low_stock_alerted_at` — esse campo controla
 * se um EVENTO ja foi emitido, nao se o saldo esta baixo agora; o Painel
 * responde "quantos estao baixos agora", nao "quantos ainda nao alertamos".
 */

export interface InventoryMetrics {
  lowStockCount: number;
}

export async function loadInventoryMetrics(scope: AnalyticsScope): Promise<InventoryMetrics> {
  if (scope.selectedUnitIds.length === 0) return { lowStockCount: 0 };

  const rows = await getDb()
    .select({ total: sql<number>`COUNT(*)` })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.tenantId, scope.tenantId),
        inArray(stockBalances.unitId, [...scope.selectedUnitIds]),
        sql`${stockBalances.minimumQuantity} > 0`,
        sql`(${stockBalances.onHand} - ${stockBalances.reserved}) < ${stockBalances.minimumQuantity}`,
      ),
    );

  return { lowStockCount: Number((rows[0] as { total: number | string } | undefined)?.total ?? 0) };
}

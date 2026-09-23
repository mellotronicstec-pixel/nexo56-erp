import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { agendaTasks } from '@/modules/agenda/infrastructure/schema';
import type { AnalyticsScope } from '@/modules/analytics/domain/analytics-scope';

/**
 * ADAPTADOR DE AGENDA (Prompt 18). SO LEITURA.
 *
 * Mesma regra de `bucketFor` (Prompt 14): vencida = aberta com `due_date`
 * anterior a hoje; hoje = aberta com `due_date` igual a hoje.
 */

export interface AgendaMetrics {
  overdueTasks: number;
  todayTasks: number;
}

export async function loadAgendaMetrics(scope: AnalyticsScope): Promise<AgendaMetrics> {
  if (scope.selectedUnitIds.length === 0) return { overdueTasks: 0, todayTasks: 0 };

  const unitIds = [...scope.selectedUnitIds];
  const baseScope = and(
    eq(agendaTasks.tenantId, scope.tenantId),
    inArray(agendaTasks.unitId, unitIds),
    eq(agendaTasks.status, 'open'),
  );

  const [overdueRows, todayRows] = await Promise.all([
    getDb()
      .select({ total: sql<number>`COUNT(*)` })
      .from(agendaTasks)
      .where(
        and(
          baseScope,
          sql`${agendaTasks.dueDate} IS NOT NULL`,
          sql`${agendaTasks.dueDate} < ${scope.today}`,
        ),
      ),
    getDb()
      .select({ total: sql<number>`COUNT(*)` })
      .from(agendaTasks)
      .where(and(baseScope, eq(agendaTasks.dueDate, scope.today))),
  ]);

  return {
    overdueTasks: Number((overdueRows[0] as { total: number | string } | undefined)?.total ?? 0),
    todayTasks: Number((todayRows[0] as { total: number | string } | undefined)?.total ?? 0),
  };
}

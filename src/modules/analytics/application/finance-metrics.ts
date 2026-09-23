import 'server-only';
import { Money, sumMoney } from '@/core/money/money';
import { loadFinanceOverview } from '@/modules/finance/application/finance-queries';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import type { AnalyticsScope } from '@/modules/analytics/domain/analytics-scope';

/**
 * ADAPTADOR FINANCEIRO (Prompt 18). SO LEITURA.
 *
 * NENHUMA consulta SQL nova: reaproveita `loadFinanceOverview`, o MESMO
 * servico que a tela `/financeiro` usa — inclusive a mesma regra de reversao
 * (settlement estornado nunca conta) e a mesma leitura de DECIMAL via
 * `Money` (nunca `Number`).
 *
 * `loadFinanceOverview` e escrito para UMA unidade ativa por chamada
 * (`context.activeUnitId`). Para consolidar "todas as unidades autorizadas"
 * sem reescrever aquele servico, este adaptador chama uma vez POR unidade
 * selecionada (em paralelo) com um contexto clonado apontando para cada
 * unidade, e soma os valores com `Money` — nunca com `Number` ou `+`.
 */

export interface FinanceMetrics {
  /** Recebimentos liquidados no periodo, decimal BRL. */
  settlementsInPeriod: string;
  /** Saldo em aberto de contas a receber, decimal BRL. */
  receivableOpen: string;
  /** Saldo vencido de contas a receber, decimal BRL. */
  receivableOverdue: string;
}

function emptyMetrics(): FinanceMetrics {
  return { settlementsInPeriod: '0.00', receivableOpen: '0.00', receivableOverdue: '0.00' };
}

export async function loadFinanceMetrics(
  context: TenantContext,
  scope: AnalyticsScope,
): Promise<FinanceMetrics> {
  if (scope.selectedUnitIds.length === 0) return emptyMetrics();

  const overviews = await Promise.all(
    scope.selectedUnitIds.map((unitId) =>
      loadFinanceOverview(
        { ...context, activeUnitId: unitId },
        { from: scope.period.from, to: scope.period.to },
      ),
    ),
  );

  return {
    settlementsInPeriod: sumMoney(overviews.map((o) => Money.parse(o.receivedInPeriod))).toString(),
    receivableOpen: sumMoney(overviews.map((o) => Money.parse(o.receivableOpen))).toString(),
    receivableOverdue: sumMoney(overviews.map((o) => Money.parse(o.receivableOverdue))).toString(),
  };
}

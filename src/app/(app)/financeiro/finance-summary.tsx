import Link from 'next/link';
import { Badge, Card, CardBody, CardHeader } from '@/design-system/components';
import { formatBRL } from '@/core/money/format';
import type { FinancialSummary } from '@/modules/finance/application/finance-queries';
import {
  formatTitleNumber,
  TITLE_STATUS_TONE,
  titleStatusLabel,
} from '@/modules/finance/domain/finance';
import { dataCivil } from './format';

/**
 * Resumo financeiro reutilizavel (Prompt 12, itens 70 e 71).
 *
 * MOSTRA, NAO JULGA. Nao ha score de credito, nao ha limite, nao ha bloqueio
 * automatico. O sistema diz quanto esta em aberto e quanto venceu; quem decide
 * se atende ou nao e a pessoa no balcao, que conhece o cliente e a situacao.
 * Um bloqueio automatico numa loja de bairro recusaria justamente o cliente
 * antigo que sempre paga com dez dias de atraso.
 *
 * NA FICHA DO FORNECEDOR ISSO NAO E HISTORICO DE PRECOS: e o que a loja ainda
 * deve a ele. Preco de peca mora em Compras.
 */
export function FinanceSummaryCard({
  title,
  description,
  summary,
  emptyText,
}: {
  title: string;
  description: string;
  summary: FinancialSummary;
  emptyText: string;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} headingLevel={2} />
      <CardBody className="space-y-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-small text-ink-500">Total</dt>
            <dd className="font-semibold tabular-nums text-ink-900">{formatBRL(summary.total)}</dd>
          </div>
          <div>
            <dt className="text-small text-ink-500">Liquidado</dt>
            <dd className="font-semibold tabular-nums text-ink-900">
              {formatBRL(summary.settled)}
            </dd>
          </div>
          <div>
            <dt className="text-small text-ink-500">Em aberto</dt>
            <dd className="font-semibold tabular-nums text-ink-900">
              {formatBRL(summary.outstanding)}
            </dd>
          </div>
          <div>
            <dt className="text-small text-ink-500">Vencido</dt>
            <dd
              className={`font-semibold tabular-nums ${
                Number(summary.overdue) > 0 ? 'text-danger-700' : 'text-ink-900'
              }`}
            >
              {formatBRL(summary.overdue)}
            </dd>
          </div>
        </dl>

        {summary.titles.length === 0 ? (
          <p className="text-small text-ink-500">{emptyText}</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {summary.titles.map((titulo) => (
              <li key={titulo.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <Link
                  href={`/financeiro/titulos/${titulo.id}`}
                  className="touch-target inline-flex items-center font-medium text-brand-600 hover:underline"
                >
                  {formatTitleNumber(titulo.direction, titulo.number)}
                </Link>
                <span className="min-w-0 flex-1 truncate text-small text-ink-700">
                  {titulo.description}
                </span>
                <span className="text-small text-ink-500">vence {dataCivil(titulo.dueDate)}</span>
                <span className="text-small tabular-nums text-ink-900">
                  {formatBRL(titulo.outstanding)}
                </span>
                <Badge tone={TITLE_STATUS_TONE[titulo.status as never] ?? 'neutral'}>
                  {titleStatusLabel(titulo.status, titulo.direction)}
                </Badge>
                {titulo.overdue ? <Badge tone="danger">Vencido</Badge> : null}
              </li>
            ))}
          </ul>
        )}

        <p className="text-small text-ink-500">
          O Nexo56 mostra a situacao e nao decide por voce: nao ha score, limite nem bloqueio
          automatico.
        </p>
      </CardBody>
    </Card>
  );
}

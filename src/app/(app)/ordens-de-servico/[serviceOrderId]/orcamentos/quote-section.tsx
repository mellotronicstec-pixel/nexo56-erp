import Link from 'next/link';
import { Badge, Card, CardBody, EmptyState } from '@/design-system/components';
import { IconServiceOrder } from '@/design-system/icons';
import { formatBRL } from '@/core/money/format';
import { formatCivilDateBR } from '@/core/time/civil-date';
import type { QuoteListItem } from '@/modules/quotes/application/quote-queries';
import {
  formatQuoteNumber,
  quoteStatusLabel,
  quoteStatusTone,
} from '@/modules/quotes/domain/quote';
import { createQuoteAction } from './actions';
import { QuoteSimpleAction } from './quote-editor';

/**
 * Secao de Orcamentos na ficha da Ordem de Servico (Prompt 09, itens 80 a 83).
 *
 * A secao SO EXISTE PORQUE O MODULO EXISTE (item 81). Ate o Prompt 08 a ficha
 * nao tinha aba de orcamento justamente para nao prometer o que nao havia;
 * agora ela mostra propostas de verdade, com numero, situacao e valor.
 */
export function QuoteSection({
  serviceOrderId,
  quotes,
  numberFormat,
  canCreate,
  timeZone,
  idempotencyKey,
}: {
  serviceOrderId: string;
  quotes: QuoteListItem[];
  numberFormat: { prefix: string; padding: number };
  canCreate: boolean;
  timeZone: string;
  idempotencyKey: string;
}) {
  const formatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone });
  /** Ja existe proposta viva? Entao nao cabe outra (item 65). */
  const ativo = quotes.find((quote) => quote.isActive);

  return (
    <Card>
      {quotes.length === 0 ? (
        <EmptyState
          icon={<IconServiceOrder />}
          title="Nenhum orcamento"
          description="Monte uma proposta com os servicos e as pecas necessarias. Ela so vai ao cliente quando voce enviar."
          action={
            canCreate ? (
              <QuoteSimpleAction
                serviceOrderId={serviceOrderId}
                label="Criar orcamento"
                variant="primary"
                idempotencyKey={idempotencyKey}
                action={createQuoteAction}
              />
            ) : undefined
          }
        />
      ) : (
        <CardBody className="space-y-4">
          <ul className="divide-y divide-ink-200">
            {quotes.map((quote) => {
              const numero = formatQuoteNumber(
                quote.number,
                quote.revision,
                numberFormat.prefix,
                numberFormat.padding,
              );

              return (
                <li key={quote.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <Link
                        href={`/ordens-de-servico/${serviceOrderId}/orcamentos/${quote.id}`}
                        className="inline-flex items-center py-1 font-medium text-brand-600 hover:underline"
                      >
                        {numero}
                      </Link>
                      <p className="text-small text-ink-500">
                        {quote.itemCount} item(ns) · criado em {formatter.format(quote.createdAt)}
                        {quote.sentAt ? ` · enviado em ${formatter.format(quote.sentAt)}` : ''}
                        {quote.validUntil
                          ? ` · valido ate ${formatCivilDateBR(quote.validUntil)}`
                          : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-heading text-body-lg font-semibold tabular-nums text-ink-900">
                        {formatBRL(quote.total)}
                      </span>
                      {/* Cor com rotulo em texto ao lado, sempre. */}
                      <Badge tone={quoteStatusTone(quote.status)}>
                        {quoteStatusLabel(quote.status)}
                      </Badge>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {canCreate && !ativo ? (
            <QuoteSimpleAction
              serviceOrderId={serviceOrderId}
              label="Criar novo orcamento"
              idempotencyKey={idempotencyKey}
              action={createQuoteAction}
            />
          ) : null}

          {ativo ? (
            <p className="text-small text-ink-500">
              {/* POR QUE NAO POSSO (item 81): a condicao escrita, no lugar do botao. */}
              Ja existe uma proposta em aberto nesta Ordem de Servico. Conclua ou cancele{' '}
              {formatQuoteNumber(
                ativo.number,
                ativo.revision,
                numberFormat.prefix,
                numberFormat.padding,
              )}{' '}
              antes de criar outra.
            </p>
          ) : null}
        </CardBody>
      )}
    </Card>
  );
}

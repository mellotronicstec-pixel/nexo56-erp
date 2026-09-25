import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Section,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { formatAmount, formatBRL, formatQuantity } from '@/core/money/format';
import { formatCivilDateBR, isOverdue } from '@/core/time/civil-date';
import { can } from '@/modules/access-control/application/authorization-service';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { searchPartsForPicker } from '@/modules/inventory/application/inventory-queries';
import { findQuoteDetail } from '@/modules/quotes/application/quote-queries';
import {
  approvalSourceLabel,
  formatQuoteNumber,
  isQuoteEditable,
  itemKindLabel,
  quoteStatusLabel,
  quoteStatusTone,
  quoteTimelineLabel,
} from '@/modules/quotes/domain/quote';
import { findServiceOrderDetail } from '@/modules/service-orders/application/service-order-queries';
import { formatServiceOrderNumber } from '@/modules/service-orders/domain/service-order';
import {
  approveQuoteAction,
  cancelQuoteAction,
  rejectQuoteAction,
  reviseQuoteAction,
  saveQuoteDraftAction,
  sendQuoteAction,
} from '../actions';
import { QuoteDecision, QuoteEditor, QuoteSimpleAction } from '../quote-editor';

export const metadata: Metadata = { title: 'Orcamento' };

/**
 * Ficha do orcamento (Prompt 09, itens 82 a 88).
 *
 * O QUE ESTA PAGINA DECIDE: nada. Ela pergunta ao dominio em que situacao o
 * orcamento esta e ao controle de acesso o que esta pessoa pode fazer NA
 * UNIDADE DA ORDEM — e desenha isso. O que nao e possivel nao aparece; o que
 * depende de condicao aparece com a condicao escrita.
 */
export default async function QuotePage({
  params,
}: {
  params: Promise<{ serviceOrderId: string; quoteId: string }>;
}) {
  const { context } = await requireAccessForPage(FEATURES.CORE_QUOTES, PERMISSIONS.QUOTES_VIEW);
  const { serviceOrderId, quoteId } = await params;

  const [detail, orderDetail] = await Promise.all([
    findQuoteDetail(context, quoteId),
    findServiceOrderDetail(context, serviceOrderId),
  ]);

  // Outra empresa, outra unidade e inexistente terminam no mesmo lugar.
  if (!detail || !orderDetail) notFound();
  if (detail.quote.serviceOrderId !== serviceOrderId) notFound();

  const { quote, items, timeline } = detail;
  const numero = formatQuoteNumber(quote.number, quote.revision);
  const osNumero = formatServiceOrderNumber(orderDetail.order.number);

  const unitScope = { featureKey: FEATURES.CORE_QUOTES, unitId: quote.unitId } as const;
  const [podeEditar, podeEnviar, podeAprovar, podeRecusar, podeCancelar, podeCriar] =
    await Promise.all([
      can(context, { ...unitScope, permission: PERMISSIONS.QUOTES_UPDATE_DRAFT }),
      can(context, { ...unitScope, permission: PERMISSIONS.QUOTES_SEND }),
      can(context, { ...unitScope, permission: PERMISSIONS.QUOTES_APPROVE }),
      can(context, { ...unitScope, permission: PERMISSIONS.QUOTES_REJECT }),
      can(context, { ...unitScope, permission: PERMISSIONS.QUOTES_CANCEL }),
      can(context, { ...unitScope, permission: PERMISSIONS.QUOTES_CREATE }),
    ]);

  /**
   * PECAS DO CATALOGO, SO SE HOUVER CATALOGO (Prompt 10, itens 86 e 108).
   *
   * Estoque e modulo OPCIONAL: quando esta desligado — ou quando a pessoa nao
   * tem `inventory.view` — a lista vem vazia e o editor continua inteiro, com
   * linha PART escrita a mao. Essa e a razao de a consulta ser condicional e
   * de o editor aceitar `parts` vazio sem mudar de comportamento.
   */
  const podeVerEstoque = await can(context, {
    permission: PERMISSIONS.INVENTORY_VIEW,
    featureKey: FEATURES.OPERATIONS_INVENTORY,
    unitId: quote.unitId,
  });

  /** Autorizacao composta do Nexo56 AI para o campo "Observacoes para o cliente" (Prompt 20, item 95). */
  const aiWritingAccess = await can(context, {
    permission: PERMISSIONS.AI_USE,
    featureKey: FEATURES.AI_WRITING,
    unitId: quote.unitId,
  });

  const partOptions = podeVerEstoque.allowed
    ? (await searchPartsForPicker(context, '', 50)).map((part) => ({
        id: part.id,
        code: part.code,
        name: part.name,
        suggestedPrice: part.suggestedPrice,
      }))
    : [];

  const editavel = isQuoteEditable(quote.status);
  const enviado = quote.status === 'sent';
  const decidido = ['approved', 'rejected', 'expired', 'superseded', 'cancelled'].includes(
    quote.status,
  );

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: context.tenantTimezone,
  });

  const validadeVencida =
    quote.validUntil !== null && isOverdue(quote.validUntil, context.tenantTimezone);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={numero}
        eyebrow={`Orcamento da Ordem de Servico ${osNumero}`}
        breadcrumbs={[
          { label: 'Ordens de Servico', href: '/ordens-de-servico' },
          { label: osNumero, href: `/ordens-de-servico/${serviceOrderId}` },
          { label: numero },
        ]}
        metadata={
          <>
            <span>{orderDetail.customer.name}</span>
            <Link
              href={`/ordens-de-servico/${serviceOrderId}`}
              className="inline-flex items-center py-1 hover:underline"
            >
              Voltar a Ordem de Servico
            </Link>
          </>
        }
      />

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {/* Cor NUNCA sozinha: o rotulo em texto acompanha o tom. */}
            <Badge tone={quoteStatusTone(quote.status)}>{quoteStatusLabel(quote.status)}</Badge>
            {quote.supersedesQuoteId ? (
              <Badge tone="neutral">Revisao {quote.revision}</Badge>
            ) : null}
          </div>

          <dl className="grid gap-4 text-ui sm:grid-cols-3">
            <div>
              <dt className="text-small text-ink-500">Total</dt>
              <dd
                className="font-heading text-h5 font-semibold tabular-nums text-ink-900"
                data-testid="quote-total-value"
              >
                {formatBRL(quote.total)}
              </dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Valido ate</dt>
              <dd className="text-ink-900">
                {quote.validUntil ? (
                  <span className="flex flex-wrap items-center gap-2">
                    {formatCivilDateBR(quote.validUntil)}
                    {validadeVencida && quote.status === 'sent' ? (
                      <Badge tone="warning">Prazo vencido</Badge>
                    ) : null}
                  </span>
                ) : (
                  'Sem prazo definido'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Enviado em</dt>
              <dd className="text-ink-900">
                {quote.sentAt ? formatter.format(quote.sentAt) : 'Ainda nao enviado'}
              </dd>
            </div>
          </dl>

          {decidido && quote.decidedAt ? (
            <dl className="grid gap-4 border-t border-ink-200 pt-4 text-ui sm:grid-cols-3">
              <div>
                <dt className="text-small text-ink-500">Decisao</dt>
                <dd className="text-ink-900">{quoteStatusLabel(quote.status)}</dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Registrada em</dt>
                <dd className="text-ink-900">{formatter.format(quote.decidedAt)}</dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Origem</dt>
                {/*
                  HONESTIDADE (item 52): nao existe Portal. Quem registrou foi
                  alguem da equipe depois de falar com o cliente, e a ficha diz
                  isso — nao "o cliente aprovou online".
                */}
                <dd className="text-ink-900">
                  {quote.decisionSource
                    ? `${approvalSourceLabel(quote.decisionSource)}${
                        detail.decidedByName ? ` · ${detail.decidedByName}` : ''
                      }`
                    : '—'}
                </dd>
              </div>
              {quote.decisionReason ? (
                <div className="sm:col-span-3">
                  <dt className="text-small text-ink-500">Motivo</dt>
                  <dd className="whitespace-pre-wrap text-ink-800">{quote.decisionReason}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </CardBody>
      </Card>

      {/*
        ACOES: so as validas para esta situacao e esta pessoa (item 81). Um
        botao desabilitado e mudo ensina a equipe a ignorar a interface.
      */}
      {editavel || enviado || decidido ? (
        <Card>
          <CardHeader
            title="O que fazer agora"
            description={
              editavel
                ? 'Enquanto e rascunho, os valores podem ser alterados livremente.'
                : enviado
                  ? 'A proposta esta com o cliente. Registre a decisao dele quando houver.'
                  : 'Esta proposta esta encerrada. Uma revisao cria uma versao nova sem apagar esta.'
            }
            headingLevel={2}
          />
          <CardBody className="flex flex-wrap items-start gap-3">
            {editavel && podeEnviar.allowed ? (
              <QuoteDecision
                serviceOrderId={serviceOrderId}
                quoteId={quoteId}
                version={quote.version}
                label="Enviar orcamento"
                title="Enviar orcamento"
                description="A proposta e formalizada e a Ordem de Servico vai para Aguardando Aprovacao."
                confirmLabel="Confirmar envio"
                action={sendQuoteAction}
              />
            ) : null}

            {enviado && podeAprovar.allowed ? (
              <QuoteDecision
                serviceOrderId={serviceOrderId}
                quoteId={quoteId}
                version={quote.version}
                label="Registrar aprovacao"
                title="Registrar aprovacao do cliente"
                description="A Ordem de Servico segue para Aguardando Conserto. Registre apenas o que o cliente de fato aprovou."
                confirmLabel="Registrar aprovacao"
                action={approveQuoteAction}
              />
            ) : null}

            {enviado && podeRecusar.allowed ? (
              <QuoteDecision
                serviceOrderId={serviceOrderId}
                quoteId={quoteId}
                version={quote.version}
                label="Registrar recusa"
                title="Registrar recusa do cliente"
                description="A Ordem de Servico NAO e cancelada: ela continua aguardando uma decisao."
                confirmLabel="Registrar recusa"
                variant="destructive"
                requiresReason
                action={rejectQuoteAction}
              />
            ) : null}

            {(editavel || enviado) && podeCancelar.allowed ? (
              <QuoteDecision
                serviceOrderId={serviceOrderId}
                quoteId={quoteId}
                version={quote.version}
                label={editavel ? 'Descartar rascunho' : 'Cancelar orcamento'}
                title={editavel ? 'Descartar rascunho' : 'Cancelar orcamento'}
                description="Cancelar o orcamento NAO cancela a Ordem de Servico."
                confirmLabel="Confirmar"
                variant="destructive"
                requiresReason={enviado}
                action={cancelQuoteAction}
              />
            ) : null}

            {!editavel && podeCriar.allowed ? (
              <QuoteSimpleAction
                serviceOrderId={serviceOrderId}
                quoteId={quoteId}
                label={`Criar revisao ${quote.revision + 1}`}
                action={reviseQuoteAction}
              />
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {enviado ? (
        <Alert tone="info" title="Nada foi enviado automaticamente">
          O orcamento esta formalizado no sistema. Nao ha WhatsApp nem e-mail integrado — avise o
          cliente pelo canal de sempre e registre aqui a resposta dele.
        </Alert>
      ) : null}

      {/* RASCUNHO: editor completo. ENCERRADO: leitura, com os valores congelados. */}
      {editavel && podeEditar.allowed ? (
        <QuoteEditor
          serviceOrderId={serviceOrderId}
          quoteId={quoteId}
          version={quote.version}
          initialItems={items.map((item) => ({
            kind: item.kind,
            description: item.description,
            quantity: formatQuantity(item.quantity),
            unitPrice: item.unitPrice,
            discount: item.discount === '0.00' ? '' : item.discount,
            partId: item.partId ?? '',
          }))}
          initialDiscount={quote.discount}
          initialValidUntil={quote.validUntil ?? ''}
          initialCustomerNotes={quote.customerNotes ?? ''}
          initialInternalNotes={quote.internalNotes ?? ''}
          action={saveQuoteDraftAction}
          parts={partOptions}
          aiAvailable={aiWritingAccess.allowed}
        />
      ) : (
        <Section id="itens" title="Itens" description="Os valores desta proposta, como ficaram.">
          <Card>
            {items.length === 0 ? (
              <CardBody>
                <p className="text-ui text-ink-600">Este orcamento nao tem itens.</p>
              </CardBody>
            ) : (
              <CardBody className="p-0">
                <div className="overflow-x-auto">
                  <Table caption={`Itens do orcamento ${numero}`}>
                    <THead>
                      <TR>
                        <TH>Tipo</TH>
                        <TH>Descricao</TH>
                        <TH align="right">Qtd.</TH>
                        <TH align="right">Unitario</TH>
                        <TH align="right">Desconto</TH>
                        <TH align="right">Total</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {items.map((item) => (
                        <TR key={item.id}>
                          <TD>{itemKindLabel(item.kind)}</TD>
                          <TD>{item.description}</TD>
                          <TD align="right" className="tabular-nums">
                            {formatQuantity(item.quantity)}
                          </TD>
                          <TD align="right" className="tabular-nums">
                            {formatAmount(item.unitPrice)}
                          </TD>
                          <TD align="right" className="tabular-nums">
                            {item.discount === '0.00' ? '—' : formatAmount(item.discount)}
                          </TD>
                          <TD align="right" className="tabular-nums font-medium">
                            {formatAmount(item.total)}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>

                <dl className="flex flex-col gap-1 border-t border-ink-200 px-4 py-3 text-ui sm:items-end">
                  <div className="flex justify-between gap-6 sm:justify-end">
                    <dt className="text-ink-500">Subtotal</dt>
                    <dd className="tabular-nums text-ink-800">{formatBRL(quote.subtotal)}</dd>
                  </div>
                  {quote.discount !== '0.00' ? (
                    <div className="flex justify-between gap-6 sm:justify-end">
                      <dt className="text-ink-500">Desconto</dt>
                      <dd className="tabular-nums text-ink-800">− {formatBRL(quote.discount)}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-6 sm:justify-end">
                    <dt className="font-semibold text-ink-700">Total</dt>
                    <dd className="font-heading text-h5 font-semibold tabular-nums text-ink-900">
                      {formatBRL(quote.total)}
                    </dd>
                  </div>
                </dl>
              </CardBody>
            )}
          </Card>
        </Section>
      )}

      {!editavel && (quote.customerNotes || quote.internalNotes) ? (
        <Section id="observacoes" title="Observacoes">
          <Card>
            <CardBody className="space-y-4">
              {quote.customerNotes ? (
                <div>
                  <p className="text-small text-ink-500">Para o cliente</p>
                  <p className="whitespace-pre-wrap text-ui text-ink-800">{quote.customerNotes}</p>
                </div>
              ) : null}
              {quote.internalNotes ? (
                <div>
                  <p className="text-small text-ink-500">Internas — nao vao ao cliente</p>
                  <p className="whitespace-pre-wrap text-ui text-ink-800">{quote.internalNotes}</p>
                </div>
              ) : null}
            </CardBody>
          </Card>
        </Section>
      ) : null}

      <Section
        id="historico"
        title="Historico"
        description="O que aconteceu com esta proposta, do mais recente para o mais antigo."
      >
        <Card>
          <CardBody>
            <ul className="divide-y divide-ink-200">
              {timeline.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <p className="font-medium text-ink-900">
                    {entry.summary ?? quoteTimelineLabel(entry.kind)}
                  </p>
                  {entry.reason ? (
                    <p className="whitespace-pre-wrap text-ui text-ink-700">{entry.reason}</p>
                  ) : null}
                  <p className="text-small text-ink-500">
                    {formatter.format(entry.occurredAt)}
                    {entry.actorName ? ` · ${entry.actorName}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

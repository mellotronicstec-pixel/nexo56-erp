import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  MetricCard,
  PageHeader,
  Section,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { formatBRL } from '@/core/money/format';
import { Money } from '@/core/money/money';
import { todayIn } from '@/core/time/civil-date';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listAccountsWithOpenCashSession } from '@/modules/finance/application/cash-service';
import { findTitleDetail } from '@/modules/finance/application/finance-queries';
import {
  listAccountsForUnit,
  listActiveCategories,
  listActivePaymentMethods,
} from '@/modules/finance/application/finance-settings-service';
import {
  formatTitleNumber,
  isTitleOverdue,
  isTitleSettleable,
  paymentMethodKindLabel,
  settlementPermission,
  TITLE_DIRECTION_LABEL,
  TITLE_STATUS_TONE,
  titleManagePermission,
  titleOriginLabel,
  titleStatusLabel,
  titleTimelineLabel,
  type TitleDirection,
} from '@/modules/finance/domain/finance';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import {
  cancelTitleAction,
  reverseSettlementAction,
  settleTitleAction,
  updateTitleAction,
} from '../../actions';
import { dataCivil, instante } from '../../format';
import { SettlePanel } from './settle-panel';
import { CancelTitleForm, ReverseSettlementForm, TitleEditForm } from './title-admin';

export const metadata: Metadata = { title: 'Titulo financeiro' };

interface PageProps {
  params: Promise<{ titleId: string }>;
}

/**
 * Ficha do titulo (Prompt 12, item 67).
 *
 * A TELA RESPONDE TRES PERGUNTAS, nessa ordem: quanto ainda falta, quando
 * vence, e o que ja foi pago. O saldo vem primeiro porque e a pergunta que a
 * pessoa no balcao esta fazendo em voz alta enquanto abre a tela.
 *
 * O HISTORICO NAO E DECORACAO. Cada liquidacao, cada estorno e cada edicao
 * aparecem com quem fez e quando. Um valor que muda sem rastro e a razao pela
 * qual ninguem confia no financeiro do sistema antigo.
 *
 * O QUE A PESSOA NAO PODE FAZER NAO APARECE, em vez de aparecer desabilitado:
 * um botao cinza que ninguem explica gera chamado no suporte. Esconder e
 * cortesia — a recusa de verdade acontece no caso de uso, na unidade DO
 * TITULO, que nem sempre e a unidade ativa da sessao.
 */
export default async function TitleDetailPage({ params }: PageProps) {
  const { context } = await requireAccessForPage(FEATURES.FINANCE_CORE, PERMISSIONS.FINANCE_VIEW);
  const { titleId } = await params;

  const detail = await findTitleDetail(context, titleId);
  if (!detail) notFound();

  const titulo = detail.title;
  const direction = titulo.direction as TitleDirection;

  const valor = Money.parse(titulo.amount);
  const liquidado = Money.parse(titulo.settledAmount);
  const saldo = valor.subtract(liquidado);

  const vencido = isTitleOverdue(
    { status: titulo.status, dueDate: titulo.dueDate, outstanding: saldo },
    context.tenantTimezone,
  );

  const liquidavel = isTitleSettleable(titulo.status) && !saldo.isZero();
  const podeLiquidar = hasPermission(context, settlementPermission(direction)) && liquidavel;
  const podeGerenciar = hasPermission(context, titleManagePermission(direction));
  const podeEstornar = hasPermission(context, PERMISSIONS.FINANCE_REVERSE);
  const podeCancelar = podeGerenciar && liquidado.isZero() && titulo.status !== 'cancelled';

  /**
   * As opcoes so sao buscadas quando ha painel para mostra-las: quem nao pode
   * liquidar nao paga quatro consultas para ver uma tela sem o formulario.
   */
  const [contas, formas, categorias, contasComCaixaAberto] = await Promise.all([
    podeLiquidar ? listAccountsForUnit(context, titulo.unitId) : Promise.resolve([]),
    podeLiquidar ? listActivePaymentMethods(context) : Promise.resolve([]),
    podeGerenciar
      ? listActiveCategories(context, direction === 'receivable' ? 'revenue' : 'expense')
      : Promise.resolve([]),
    podeLiquidar ? listAccountsWithOpenCashSession(context, titulo.unitId) : Promise.resolve([]),
  ]);

  const parcelasEmAberto = detail.installments
    .filter((parcela) => parcela.status !== 'settled' && parcela.status !== 'cancelled')
    .map((parcela) => ({
      id: parcela.id,
      number: parcela.number,
      amount: parcela.amount,
      settledAmount: parcela.settledAmount,
      outstanding: Money.parse(parcela.amount)
        .subtract(Money.parse(parcela.settledAmount))
        .toString(),
      dueDate: parcela.dueDate,
    }))
    .filter((parcela) => Number(parcela.outstanding) > 0);

  const estornaveis = detail.settlements
    .filter((lancamento) => lancamento.status === 'confirmed')
    .map((lancamento) => ({
      id: lancamento.id,
      amount: lancamento.amount,
      effectiveDate: lancamento.effectiveDate,
      accountName: lancamento.accountName,
      methodName: lancamento.methodName,
    }));

  const numero = formatTitleNumber(direction, titulo.number);
  const listaHref =
    direction === 'receivable' ? '/financeiro/contas-a-receber' : '/financeiro/contas-a-pagar';
  const listaLabel = direction === 'receivable' ? 'Contas a receber' : 'Contas a pagar';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={`${numero} — ${titulo.description}`}
        description={`${TITLE_DIRECTION_LABEL[direction]} da unidade ${detail.unitName ?? '—'}.`}
        breadcrumbs={[
          { label: 'Financeiro', href: '/financeiro' },
          { label: listaLabel, href: listaHref },
          { label: numero },
        ]}
        metadata={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TITLE_STATUS_TONE[titulo.status as never] ?? 'neutral'}>
              {titleStatusLabel(titulo.status, direction)}
            </Badge>
            {vencido ? <Badge tone="danger">Vencido</Badge> : null}
            <span className="text-small text-ink-500">
              Origem: {titleOriginLabel(titulo.origin)}
            </span>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Valor do titulo"
          value={formatBRL(titulo.amount)}
          hint={
            titulo.installmentCount > 1
              ? `Dividido em ${titulo.installmentCount} parcelas.`
              : 'Parcela unica.'
          }
        />
        <MetricCard
          label={direction === 'receivable' ? 'Ja recebido' : 'Ja pago'}
          value={formatBRL(titulo.settledAmount)}
          hint="Soma dos lancamentos confirmados. Estornos ja estao descontados."
        />
        <MetricCard
          label="Saldo em aberto"
          value={
            <span className={vencido && !saldo.isZero() ? 'text-danger-700' : undefined}>
              {formatBRL(saldo.toString())}
            </span>
          }
          hint={`Vence em ${dataCivil(titulo.dueDate)}.`}
        />
      </div>

      {titulo.status === 'cancelled' ? (
        <Alert tone="warning">
          Este titulo foi cancelado. Os lancamentos ja registrados continuam no historico — cancelar
          nao apaga o que aconteceu.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Dados"
          description="O que o titulo e, de quem e para quando."
          headingLevel={2}
        />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-small text-ink-500">
                {direction === 'receivable' ? 'Cliente' : 'Favorecido'}
              </dt>
              <dd className="font-medium text-ink-900">
                {titulo.customerId ? (
                  <Link
                    href={`/clientes/${titulo.customerId}`}
                    className="text-brand-600 hover:underline"
                  >
                    {detail.counterpartyName ?? '—'}
                  </Link>
                ) : titulo.supplierId ? (
                  <Link
                    href={`/fornecedores/${titulo.supplierId}`}
                    className="text-brand-600 hover:underline"
                  >
                    {detail.counterpartyName ?? '—'}
                  </Link>
                ) : (
                  (detail.counterpartyName ?? '—')
                )}
              </dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Emissao</dt>
              <dd className="font-medium text-ink-900">{dataCivil(titulo.issuedAt)}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Vencimento</dt>
              <dd className="font-medium text-ink-900">{dataCivil(titulo.dueDate)}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Unidade</dt>
              <dd className="font-medium text-ink-900">{detail.unitName ?? '—'}</dd>
            </div>
            {titulo.serviceOrderId ? (
              <div>
                <dt className="text-small text-ink-500">Ordem de Servico</dt>
                <dd className="font-medium">
                  <Link
                    href={`/ordens-de-servico/${titulo.serviceOrderId}`}
                    className="text-brand-600 hover:underline"
                  >
                    Abrir a OS de origem
                  </Link>
                </dd>
              </div>
            ) : null}
            {titulo.purchaseOrderId ? (
              <div>
                <dt className="text-small text-ink-500">Pedido de compra</dt>
                <dd className="font-medium">
                  <Link
                    href={`/compras/${titulo.purchaseOrderId}`}
                    className="text-brand-600 hover:underline"
                  >
                    Abrir o pedido de origem
                  </Link>
                </dd>
              </div>
            ) : null}
            {titulo.notes ? (
              <div className="sm:col-span-2">
                <dt className="text-small text-ink-500">Observacao</dt>
                <dd className="whitespace-pre-line text-ink-900">{titulo.notes}</dd>
              </div>
            ) : null}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Parcelas"
          description="Todo titulo tem ao menos uma. A vista e simplesmente 1 de 1."
          headingLevel={2}
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <Table caption={`Parcelas do titulo ${numero}`}>
              <THead>
                <TR>
                  <TH>Parcela</TH>
                  <TH>Vencimento</TH>
                  <TH align="right">Valor</TH>
                  <TH align="right">{direction === 'receivable' ? 'Recebido' : 'Pago'}</TH>
                  <TH align="right">Saldo</TH>
                  <TH>Situacao</TH>
                </TR>
              </THead>
              <TBody>
                {detail.installments.map((parcela) => {
                  const saldoParcela = Money.parse(parcela.amount).subtract(
                    Money.parse(parcela.settledAmount),
                  );
                  return (
                    <TR key={parcela.id}>
                      <TD className="whitespace-nowrap font-medium text-ink-900">
                        {parcela.number} de {titulo.installmentCount}
                      </TD>
                      <TD className="whitespace-nowrap">{dataCivil(parcela.dueDate)}</TD>
                      <TD align="right" className="whitespace-nowrap tabular-nums">
                        {formatBRL(parcela.amount)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap tabular-nums">
                        {formatBRL(parcela.settledAmount)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap tabular-nums">
                        {formatBRL(saldoParcela.toString())}
                      </TD>
                      <TD>
                        <Badge tone={TITLE_STATUS_TONE[parcela.status as never] ?? 'neutral'}>
                          {titleStatusLabel(parcela.status, direction)}
                        </Badge>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        </CardBody>
      </Card>

      {podeLiquidar ? (
        <SettlePanel
          titleId={titulo.id}
          direction={direction}
          installments={parcelasEmAberto}
          accounts={contas.map((conta) => ({ id: conta.id, name: conta.name, kind: conta.kind }))}
          methods={formas}
          accountsWithOpenCash={contasComCaixaAberto}
          today={todayIn(context.tenantTimezone)}
          action={settleTitleAction}
        />
      ) : null}

      <Card>
        <CardHeader
          title="Lancamentos"
          description="Cada recebimento, cada pagamento e cada estorno registrados neste titulo."
          headingLevel={2}
        />
        <CardBody className="p-0">
          {detail.settlements.length === 0 ? (
            <p className="px-4 py-6 text-small text-ink-500">
              Nenhum lancamento ainda. O saldo continua integralmente em aberto.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table caption={`Lancamentos do titulo ${numero}`}>
                <THead>
                  <TR>
                    <TH>Data</TH>
                    <TH align="right">Valor</TH>
                    <TH>Conta</TH>
                    <TH>Forma</TH>
                    <TH>Parcela</TH>
                    <TH>Quem</TH>
                    <TH>Situacao</TH>
                  </TR>
                </THead>
                <TBody>
                  {detail.settlements.map((lancamento) => (
                    <TR key={lancamento.id}>
                      <TD className="whitespace-nowrap">
                        {dataCivil(lancamento.effectiveDate)}
                        <span className="block text-small text-ink-500">
                          {instante(lancamento.createdAt)}
                        </span>
                      </TD>
                      <TD align="right" className="whitespace-nowrap tabular-nums">
                        {formatBRL(lancamento.amount)}
                      </TD>
                      <TD>{lancamento.accountName}</TD>
                      <TD>
                        {lancamento.methodName}
                        {lancamento.cardInstallments && lancamento.cardInstallments > 1 ? (
                          <span className="block text-small text-ink-500">
                            {lancamento.cardInstallments}x no{' '}
                            {paymentMethodKindLabel(lancamento.methodKind).toLowerCase()}
                          </span>
                        ) : null}
                      </TD>
                      <TD>{lancamento.installmentNumber}</TD>
                      <TD>{lancamento.actorName ?? '—'}</TD>
                      <TD>
                        {lancamento.status === 'reversed' ? (
                          <>
                            <Badge tone="danger">Estornada</Badge>
                            {lancamento.reversalReason ? (
                              <span className="mt-1 block text-small text-ink-500">
                                {lancamento.reversalReason}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <Badge tone="success">Confirmada</Badge>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {podeEstornar ? (
        <ReverseSettlementForm
          titleId={titulo.id}
          settlements={estornaveis}
          action={reverseSettlementAction}
        />
      ) : null}

      {podeGerenciar && titulo.status !== 'cancelled' ? (
        <Card>
          <CardHeader
            title="Editar"
            description="Valor, vencimento e parcelas nao se editam depois de criados: o que se corrige aqui e o texto."
            headingLevel={2}
          />
          <CardBody>
            <TitleEditForm
              titleId={titulo.id}
              description={titulo.description}
              categoryId={titulo.categoryId}
              notes={titulo.notes}
              categories={categorias}
              action={updateTitleAction}
            />
          </CardBody>
        </Card>
      ) : null}

      {podeCancelar ? <CancelTitleForm titleId={titulo.id} action={cancelTitleAction} /> : null}

      <Section id="historico-do-titulo" title="Historico" headingLevel={2}>
        <Card>
          <CardBody className="p-0">
            {detail.timeline.length === 0 ? (
              <p className="px-4 py-6 text-small text-ink-500">Sem registros.</p>
            ) : (
              <ol className="divide-y divide-ink-100">
                {detail.timeline.map((evento) => (
                  <li key={evento.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-ink-900">
                        {titleTimelineLabel(evento.kind)}
                      </span>
                      <span className="text-small text-ink-500">{instante(evento.occurredAt)}</span>
                    </div>
                    <p className="text-small text-ink-700">{evento.summary}</p>
                    {evento.reason ? (
                      <p className="text-small text-ink-500">Motivo: {evento.reason}</p>
                    ) : null}
                    <p className="text-small text-ink-500">{evento.actorName ?? 'Sistema'}</p>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

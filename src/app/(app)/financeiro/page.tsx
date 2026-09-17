import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  linkButtonClass,
  MetricCard,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { IconCashRegister, IconFinance, IconPlus } from '@/design-system/icons';
import { formatBRL } from '@/core/money/format';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { loadCashFlow, loadFinanceOverview } from '@/modules/finance/application/finance-queries';
import { accountKindLabel, TITLE_DIRECTION_LABEL } from '@/modules/finance/domain/finance';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { dataCivil, periodoDoMes } from './format';

export const metadata: Metadata = { title: 'Financeiro' };

/**
 * Visao geral do Financeiro (Prompt 12, itens 62, 63 e 64).
 *
 * SO METRICAS CUJA DEFINICAO E CONFERIVEL. Nao ha "lucro", nao ha DRE e nao ha
 * margem: receita menos algumas despesas nao e lucro, e um numero grande com
 * nome errado e pior do que numero nenhum — a pessoa toma decisao com ele.
 *
 * REALIZADO E PREVISTO EM BLOCOS SEPARADOS, nunca somados (item 64). O
 * realizado saiu do ledger: aconteceu. O previsto e parcela em aberto por
 * vencimento: e promessa. Somar os dois transformaria promessa em dinheiro,
 * que e exatamente o erro que este modulo existe para evitar.
 *
 * TUDO E DA UNIDADE ATIVA. O caixa de uma loja nao e o da outra.
 */

export default async function FinanceOverviewPage() {
  const { context } = await requireAccessForPage(FEATURES.FINANCE_CORE, PERMISSIONS.FINANCE_VIEW);

  const periodo = periodoDoMes(context.tenantTimezone);
  const [overview, fluxo] = await Promise.all([
    loadFinanceOverview(context, periodo),
    loadCashFlow(context, periodo),
  ]);

  const podeLancar =
    hasPermission(context, PERMISSIONS.FINANCE_RECEIVABLES_MANAGE) ||
    hasPermission(context, PERMISSIONS.FINANCE_PAYABLES_MANAGE);
  const podeAbrirCaixa = hasPermission(context, PERMISSIONS.FINANCE_CASH_OPEN);
  const podeConfigurar = hasPermission(context, PERMISSIONS.FINANCE_SETTINGS_MANAGE);

  const temVencido = Number(overview.receivableOverdue) > 0 || Number(overview.payableOverdue) > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Financeiro"
        description="O que ha para receber, o que ha para pagar e o que efetivamente entrou ou saiu nesta unidade."
        breadcrumbs={[{ label: 'Financeiro' }]}
        metadata={
          <span>
            Periodo: {dataCivil(periodo.from)} a {dataCivil(periodo.to)}
          </span>
        }
        actions={
          podeLancar ? (
            <Link href="/financeiro/novo-lancamento" className={linkButtonClass('primary')}>
              <IconPlus size={18} />
              Novo lancamento
            </Link>
          ) : null
        }
      />

      {/*
        A NAVEGACAO DO MODULO FICA NO CORPO, nao no cabecalho.

        Quatro botoes no slot de acoes do PageHeader nao cabiam em 768px: aquele
        slot e `shrink-0` de proposito — a acao principal nao deve encolher — e
        o resultado era a pagina inteira rolando na horizontal no tablet. Aqui a
        barra quebra linha a vontade, e o cabecalho fica com a unica acao que de
        fato cria alguma coisa.
      */}
      <nav aria-label="Secoes do Financeiro" className="flex flex-wrap gap-2">
        <Link href="/financeiro/contas-a-receber" className={linkButtonClass('secondary')}>
          Contas a receber
        </Link>
        <Link href="/financeiro/contas-a-pagar" className={linkButtonClass('secondary')}>
          Contas a pagar
        </Link>
        {podeAbrirCaixa ? (
          <Link href="/financeiro/caixa" className={linkButtonClass('secondary')}>
            <IconCashRegister size={18} />
            Caixa
          </Link>
        ) : null}
      </nav>

      {!context.activeUnitId ? (
        <Alert tone="warning">
          Escolha uma unidade para ver o financeiro. O caixa de uma loja nao e o da outra, e somar
          as duas num numero so responderia uma pergunta que ninguem faz no balcao.
        </Alert>
      ) : null}

      <section aria-labelledby="titulo-indicadores" className="space-y-3">
        <h2 id="titulo-indicadores" className="text-heading-sm text-ink-900">
          Situacao
        </h2>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="A receber em aberto"
            value={formatBRL(overview.receivableOpen)}
            hint="Saldo dos titulos de cliente ainda nao recebidos."
          />
          <MetricCard
            label="A receber vencido"
            value={
              <span
                className={Number(overview.receivableOverdue) > 0 ? 'text-danger-700' : undefined}
              >
                {formatBRL(overview.receivableOverdue)}
              </span>
            }
            hint="Ja passou do vencimento e ainda deve."
          />
          <MetricCard
            label="A pagar em aberto"
            value={formatBRL(overview.payableOpen)}
            hint="Saldo das obrigacoes ainda nao pagas."
          />
          <MetricCard
            label="A pagar vencido"
            value={
              <span className={Number(overview.payableOverdue) > 0 ? 'text-danger-700' : undefined}>
                {formatBRL(overview.payableOverdue)}
              </span>
            }
            hint="Ja passou do vencimento e ainda nao foi pago."
          />
        </div>

        {temVencido ? (
          <Alert tone="warning">
            Ha valores vencidos. &quot;Vencido&quot; e calculado na hora, comparando o vencimento
            com o dia de hoje no fuso da empresa — nao existe uma coluna que alguem esqueceu de
            atualizar.
          </Alert>
        ) : null}
      </section>

      {/*
        `min-w-0` NAO E DECORACAO.

        Item de grid nasce com `min-width: auto`, e por isso cresce ate o
        min-content do que tem dentro — aqui, a largura minima da tabela. O
        `overflow-x-auto` de dentro nunca chegava a agir, porque o cartao ja
        havia esticado: em 360px a pagina inteira rolava para o lado.
      */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader
            title="Realizado no periodo"
            description="Dinheiro que efetivamente entrou e saiu. Saiu do razao financeiro, nao de previsao."
            headingLevel={2}
          />
          <CardBody>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-small text-ink-500">Recebido</dt>
                <dd className="text-heading-sm font-semibold tabular-nums text-success-700">
                  {formatBRL(overview.receivedInPeriod)}
                </dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Pago</dt>
                <dd className="text-heading-sm font-semibold tabular-nums text-ink-900">
                  {formatBRL(overview.paidInPeriod)}
                </dd>
              </div>
            </dl>

            {fluxo.realized.length === 0 ? (
              <p className="mt-4 text-small text-ink-500">
                Nenhum movimento registrado neste periodo.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <Table caption="Movimento realizado por dia">
                  <THead>
                    <TR>
                      <TH>Dia</TH>
                      <TH align="right">Entrou</TH>
                      <TH align="right">Saiu</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {fluxo.realized.map((linha) => (
                      <TR key={linha.date}>
                        <TD className="whitespace-nowrap">{dataCivil(linha.date)}</TD>
                        <TD align="right" className="whitespace-nowrap tabular-nums">
                          {formatBRL(linha.inflow)}
                        </TD>
                        <TD align="right" className="whitespace-nowrap tabular-nums">
                          {formatBRL(linha.outflow)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="min-w-0">
          <CardHeader
            title="Previsto no periodo"
            description="Parcelas em aberto por vencimento. E promessa, nao dinheiro: por isso nao se soma ao realizado."
            headingLevel={2}
          />
          <CardBody>
            {fluxo.forecast.length === 0 ? (
              <p className="text-small text-ink-500">
                Nenhuma parcela em aberto vence neste periodo.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table caption="Vencimentos previstos por dia">
                  <THead>
                    <TR>
                      <TH>Dia</TH>
                      <TH align="right">A receber</TH>
                      <TH align="right">A pagar</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {fluxo.forecast.map((linha) => (
                      <TR key={linha.date}>
                        <TD className="whitespace-nowrap">{dataCivil(linha.date)}</TD>
                        <TD align="right" className="whitespace-nowrap tabular-nums">
                          {formatBRL(linha.inflow)}
                        </TD>
                        <TD align="right" className="whitespace-nowrap tabular-nums">
                          {formatBRL(linha.outflow)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Contas financeiras"
          description="Saldo de cada conta desta unidade e das contas compartilhadas da empresa."
          headingLevel={2}
          action={
            podeConfigurar ? (
              <Link
                href="/financeiro/configuracoes"
                className="touch-target inline-flex items-center text-ui font-semibold text-brand-600 hover:underline"
              >
                Configurar
              </Link>
            ) : null
          }
        />
        <CardBody className="p-0">
          {overview.accounts.length === 0 ? (
            <EmptyState
              icon={<IconFinance />}
              title="Nenhuma conta financeira"
              description="Sem uma conta nao ha onde o dinheiro entrar. Cadastre ao menos o caixa da loja."
              action={
                podeConfigurar ? (
                  <Link
                    href="/financeiro/configuracoes"
                    className={linkButtonClass('primary', 'sm')}
                  >
                    Configurar Financeiro
                  </Link>
                ) : null
              }
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {overview.accounts.map((conta) => (
                <li key={conta.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900">{conta.name}</p>
                    <p className="text-small text-ink-500">{accountKindLabel(conta.kind)}</p>
                  </div>
                  <span className="whitespace-nowrap font-semibold tabular-nums text-ink-900">
                    {formatBRL(conta.balance)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Proximos vencimentos"
          description="O que vence primeiro, nas duas direcoes, para quem abre a loja de manha."
          headingLevel={2}
        />
        <CardBody className="p-0">
          {overview.upcoming.length === 0 ? (
            <EmptyState
              icon={<IconFinance />}
              title="Nada vencendo"
              description="Nenhum titulo em aberto nesta unidade."
            />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <Table caption="Proximos vencimentos">
                  <THead>
                    <TR>
                      <TH>Vencimento</TH>
                      <TH>Titulo</TH>
                      <TH>Quem</TH>
                      <TH>Direcao</TH>
                      <TH align="right">Saldo</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {overview.upcoming.map((item) => (
                      <TR key={item.titleId}>
                        <TD className="whitespace-nowrap">
                          {dataCivil(item.dueDate)}
                          {item.overdue ? (
                            <Badge tone="danger" className="ml-2">
                              Vencido
                            </Badge>
                          ) : null}
                        </TD>
                        <TD>
                          <Link
                            href={`/financeiro/titulos/${item.titleId}`}
                            className="font-medium text-brand-600 hover:underline"
                          >
                            {item.description}
                          </Link>
                        </TD>
                        <TD>{item.counterpartyName ?? '—'}</TD>
                        <TD>{TITLE_DIRECTION_LABEL[item.direction]}</TD>
                        <TD align="right" className="whitespace-nowrap tabular-nums">
                          {formatBRL(item.outstanding)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>

              <CardList label="Proximos vencimentos" className="md:hidden">
                {overview.upcoming.map((item) => (
                  <CardListItem key={item.titleId}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/financeiro/titulos/${item.titleId}`}
                          className="touch-target inline-flex items-center font-medium text-brand-600"
                        >
                          {item.description}
                        </Link>
                        <p className="truncate text-small text-ink-500">
                          {item.counterpartyName ?? TITLE_DIRECTION_LABEL[item.direction]}
                        </p>
                      </div>
                      {item.overdue ? <Badge tone="danger">Vencido</Badge> : null}
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-small">
                      <div>
                        <dt className="text-ink-500">Vencimento</dt>
                        <dd className="font-medium text-ink-900">{dataCivil(item.dueDate)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-500">Saldo</dt>
                        <dd className="font-medium tabular-nums text-ink-900">
                          {formatBRL(item.outstanding)}
                        </dd>
                      </div>
                    </dl>
                  </CardListItem>
                ))}
              </CardList>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

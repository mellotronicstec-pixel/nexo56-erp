import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  MetricCard,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { formatBRL } from '@/core/money/format';
import { Money } from '@/core/money/money';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  findOpenSessionForUnit,
  summarizeSession,
} from '@/modules/finance/application/cash-service';
import {
  listAccountMovements,
  listCashSessions,
} from '@/modules/finance/application/finance-queries';
import { listAccountsForUnit } from '@/modules/finance/application/finance-settings-service';
import {
  expectedCashAmount,
  movementOriginLabel,
  supportsCashSession,
} from '@/modules/finance/domain/finance';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { IconCashRegister } from '@/design-system/icons';
import {
  closeCashSessionAction,
  openCashSessionAction,
  recordCashAdjustmentAction,
} from '../actions';
import { dataDeInstante, instante } from '../format';
import { CashAdjustmentForm, CloseCashForm, OpenCashForm } from './cash-forms';

export const metadata: Metadata = { title: 'Caixa' };

/**
 * Caixa operacional da unidade (Prompt 12, itens 21 a 27).
 *
 * O CAIXA E DA UNIDADE, nao da empresa: cada loja abre e fecha o seu, e o
 * dinheiro de uma nao conserta a diferenca da outra.
 *
 * A TELA MOSTRA O QUE PASSOU PELA SESSAO, nao o saldo geral da conta. Quem
 * fecha a gaveta quer conferir o que entrou HOJE, no turno dele — o saldo
 * historico da conta e outra pergunta, respondida pelo extrato.
 */
export default async function CashPage() {
  const { context } = await requireAccessForPage(
    FEATURES.FINANCE_CORE,
    PERMISSIONS.FINANCE_CASH_OPEN,
  );

  if (!context.activeUnitId) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          title="Caixa"
          breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Caixa' }]}
        />
        <Alert tone="warning">
          Escolha uma unidade para abrir o caixa. Cada loja tem a sua gaveta, e o caixa de uma nao
          fecha o da outra.
        </Alert>
      </div>
    );
  }

  const unitId = context.activeUnitId;

  const [sessaoAberta, contas, sessoes] = await Promise.all([
    findOpenSessionForUnit(context, unitId),
    listAccountsForUnit(context, unitId),
    listCashSessions(context, 15),
  ]);

  /**
   * SO CONTA QUE O CASO DE USO VAI ACEITAR (Prompt 12, itens 21 e 54).
   *
   * Duas condicoes, nao uma. `supportsCashSession` sozinho deixava passar a
   * conta em especie COMPARTILHADA pela empresa (`unit_id` nulo) — o navegador
   * a oferecia, a pessoa contava o troco, preenchia o valor inicial e so entao
   * levava a recusa "um caixa pertence a uma loja". O erro estava certo; a tela
   * e que oferecia o que ia ser negado.
   *
   * Caixa e gaveta fisica: ela fica num endereco. Uma conta sem unidade seria
   * uma gaveta que ninguem sabe quem conta no fim do dia.
   */
  const contasDinheiro = contas.filter(
    (conta) => supportsCashSession(conta.kind) && conta.unitId !== null,
  );

  const podeFechar = hasPermission(context, PERMISSIONS.FINANCE_CASH_CLOSE);
  const podeAjustar = hasPermission(context, PERMISSIONS.FINANCE_CASH_ADJUST);

  const resumo = sessaoAberta ? await summarizeSession(context, sessaoAberta.id) : null;
  const movimentos = sessaoAberta
    ? await listAccountMovements(context, sessaoAberta.financialAccountId, 25)
    : [];

  const esperado =
    sessaoAberta && resumo
      ? expectedCashAmount({
          openingAmount: Money.parse(sessaoAberta.openingAmount),
          inflow: resumo.inflow,
          outflow: resumo.outflow,
        })
      : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Caixa"
        description="Abertura, suprimento, sangria e fechamento da gaveta desta unidade."
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Caixa' }]}
        metadata={
          sessaoAberta ? (
            <Badge tone="success">Caixa aberto desde {instante(sessaoAberta.openedAt)}</Badge>
          ) : (
            <Badge tone="neutral">Caixa fechado</Badge>
          )
        }
      />

      {sessaoAberta === null ? (
        <OpenCashForm
          accounts={contasDinheiro.map((conta) => ({ id: conta.id, name: conta.name }))}
          action={openCashSessionAction}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              label="Abertura"
              value={formatBRL(sessaoAberta.openingAmount)}
              hint={`Conta: ${sessaoAberta.accountName}.`}
            />
            <MetricCard
              label="Entrou na sessao"
              value={formatBRL(resumo?.inflow.toString() ?? '0.00')}
              hint="Recebimentos e suprimentos registrados neste turno."
            />
            <MetricCard
              label="Saiu na sessao"
              value={formatBRL(resumo?.outflow.toString() ?? '0.00')}
              hint="Pagamentos e sangrias registrados neste turno."
            />
          </div>

          {podeAjustar ? (
            <CashAdjustmentForm sessionId={sessaoAberta.id} action={recordCashAdjustmentAction} />
          ) : null}

          {podeFechar && esperado ? (
            <CloseCashForm
              sessionId={sessaoAberta.id}
              expectedAmount={esperado.toString()}
              action={closeCashSessionAction}
            />
          ) : null}

          <Card>
            <CardHeader
              title="Extrato da conta"
              description="Ultimos movimentos da conta deste caixa. O razao nao se edita: um erro se corrige com um movimento contrario."
              headingLevel={2}
            />
            <CardBody className="p-0">
              {movimentos.length === 0 ? (
                <p className="px-4 py-6 text-small text-ink-500">Nenhum movimento ainda.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table caption="Movimentos da conta do caixa">
                    <THead>
                      <TR>
                        <TH>Quando</TH>
                        <TH>Origem</TH>
                        <TH align="right">Entrou</TH>
                        <TH align="right">Saiu</TH>
                        <TH align="right">Saldo</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {movimentos.map((movimento) => (
                        <TR key={movimento.id}>
                          <TD className="whitespace-nowrap">{instante(movimento.occurredAt)}</TD>
                          <TD>
                            {movementOriginLabel(movimento.originKind)}
                            {movimento.reversalOfMovementId ? (
                              <Badge tone="warning" className="ml-2">
                                Estorno
                              </Badge>
                            ) : null}
                          </TD>
                          <TD align="right" className="whitespace-nowrap tabular-nums">
                            {movimento.direction === 'inflow' ? formatBRL(movimento.amount) : '—'}
                          </TD>
                          <TD align="right" className="whitespace-nowrap tabular-nums">
                            {movimento.direction === 'outflow' ? formatBRL(movimento.amount) : '—'}
                          </TD>
                          <TD align="right" className="whitespace-nowrap tabular-nums">
                            {formatBRL(movimento.resultingBalance)}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}

      <Card>
        <CardHeader
          title="Fechamentos anteriores"
          description="Cada sessao com o que foi contado, o que era esperado e a diferenca."
          headingLevel={2}
        />
        <CardBody className="p-0">
          {sessoes.length === 0 ? (
            <EmptyState
              icon={<IconCashRegister />}
              title="Nenhuma sessao ainda"
              description="O primeiro caixa desta unidade ainda nao foi aberto."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table caption="Sessoes de caixa desta unidade">
                <THead>
                  <TR>
                    <TH>Dia</TH>
                    <TH>Conta</TH>
                    <TH align="right">Abertura</TH>
                    <TH align="right">Esperado</TH>
                    <TH align="right">Contado</TH>
                    <TH align="right">Diferenca</TH>
                    <TH>Situacao</TH>
                  </TR>
                </THead>
                <TBody>
                  {sessoes.map((sessao) => {
                    const diferenca = Number(sessao.differenceAmount ?? '0');
                    return (
                      <TR key={sessao.id}>
                        <TD className="whitespace-nowrap">
                          {dataDeInstante(sessao.openedAt)}
                          {sessao.closedAt ? (
                            <span className="block text-small text-ink-500">
                              fechado {instante(sessao.closedAt)}
                            </span>
                          ) : null}
                        </TD>
                        <TD>{sessao.accountName}</TD>
                        <TD align="right" className="whitespace-nowrap tabular-nums">
                          {formatBRL(sessao.openingAmount)}
                        </TD>
                        <TD align="right" className="whitespace-nowrap tabular-nums">
                          {sessao.expectedAmount ? formatBRL(sessao.expectedAmount) : '—'}
                        </TD>
                        <TD align="right" className="whitespace-nowrap tabular-nums">
                          {sessao.countedAmount ? formatBRL(sessao.countedAmount) : '—'}
                        </TD>
                        <TD align="right" className="whitespace-nowrap tabular-nums">
                          {sessao.differenceAmount === null ? (
                            '—'
                          ) : diferenca === 0 ? (
                            <span className="text-success-700">Bateu</span>
                          ) : (
                            <span className="text-danger-700">
                              {diferenca > 0 ? 'Sobra ' : 'Falta '}
                              {formatBRL(sessao.differenceAmount.replace('-', ''))}
                            </span>
                          )}
                        </TD>
                        <TD>
                          <Badge tone={sessao.status === 'open' ? 'success' : 'neutral'}>
                            {sessao.status === 'open' ? 'Aberto' : 'Fechado'}
                          </Badge>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      <p className="text-small text-ink-500">
        A diferenca de um fechamento nunca desaparece: sobra e falta ficam gravadas com quem fechou
        e quando.{' '}
        <Link href="/financeiro" className="font-semibold text-brand-600 hover:underline">
          Voltar ao Financeiro
        </Link>
        .
      </p>
    </div>
  );
}

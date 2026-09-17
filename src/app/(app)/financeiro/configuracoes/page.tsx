import type { Metadata } from 'next';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { formatBRL } from '@/core/money/format';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  listAllCategories,
  listAllPaymentMethods,
  listFinancialAccounts,
} from '@/modules/finance/application/finance-queries';
import {
  accountKindLabel,
  CATEGORY_KIND_LABEL,
  paymentMethodKindLabel,
  type CategoryKind,
} from '@/modules/finance/domain/finance';
import { listUnits } from '@/modules/tenancy/application/tenancy-queries';
import {
  changeAccountStatusAction,
  changeCategoryStatusAction,
  changePaymentMethodStatusAction,
  createAccountAction,
  createCategoryAction,
  createPaymentMethodAction,
  ensureFinanceDefaultsAction,
} from '../actions';
import {
  AccountForm,
  CategoryForm,
  DefaultsForm,
  PaymentMethodForm,
  StatusToggleForm,
} from './settings-forms';

export const metadata: Metadata = { title: 'Configuracoes do Financeiro' };

/**
 * Configuracao do Financeiro (Prompt 12, itens 14 a 20 e 62).
 *
 * TRES CADASTROS QUE SAO TRES COISAS DIFERENTES, e confundi-los e o erro mais
 * caro deste modulo:
 *
 *   CONTA FINANCEIRA e ONDE o dinheiro fica (a gaveta, o banco, a carteira
 *   digital). Tem saldo.
 *
 *   FORMA DE PAGAMENTO e COMO o dinheiro se moveu (dinheiro, PIX, cartao).
 *   Nao tem saldo, e vocabulario do balcao.
 *
 *   CATEGORIA e POR QUE (venda de servico, aluguel, energia). Serve para
 *   agrupar, nunca para bloquear um lancamento.
 *
 * Um sistema que trata "PIX" como conta acaba com quatro saldos que ninguem
 * consegue conciliar com o extrato bancario de verdade.
 *
 * NADA SE EXCLUI AQUI. O que ja foi usado explica o passado; o que nao serve
 * mais se desativa e para de aparecer nos formularios novos.
 */
export default async function FinanceSettingsPage() {
  const { context } = await requireAccessForPage(
    FEATURES.FINANCE_CORE,
    PERMISSIONS.FINANCE_SETTINGS_MANAGE,
  );

  const [contas, formas, categorias, unidades] = await Promise.all([
    listFinancialAccounts(context),
    listAllPaymentMethods(context),
    listAllCategories(context),
    listUnits(context),
  ]);

  const unidadesAutorizadas = unidades.filter((unit) =>
    context.authorizedUnitIds.includes(unit.id),
  );

  const semNada = formas.length === 0 && categorias.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Configuracoes do Financeiro"
        description="Onde o dinheiro fica, como ele se move e por que ele entrou ou saiu."
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Configuracoes' }]}
      />

      {semNada ? (
        <Card>
          <CardHeader
            title="Comecar pelo basico"
            description="Dinheiro, PIX, cartoes e as categorias mais comuns de uma assistencia tecnica."
            headingLevel={2}
          />
          <CardBody>
            <DefaultsForm action={ensureFinanceDefaultsAction} />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Contas financeiras"
          description="ONDE o dinheiro fica. Tem saldo, e o saldo e consequencia dos movimentos."
          headingLevel={2}
        />
        <CardBody className="space-y-4">
          <AccountForm
            units={unidadesAutorizadas.map((unit) => ({ id: unit.id, name: unit.name }))}
            action={createAccountAction}
          />

          {contas.length === 0 ? (
            <Alert tone="info">
              Nenhuma conta ainda. Sem uma conta nao ha onde registrar a entrada do dinheiro.
            </Alert>
          ) : (
            <div className="overflow-x-auto">
              <Table caption="Contas financeiras da empresa">
                <THead>
                  <TR>
                    <TH>Conta</TH>
                    <TH>Tipo</TH>
                    <TH>Alcance</TH>
                    <TH align="right">Saldo</TH>
                    <TH>Situacao</TH>
                    <TH align="right" srOnly>
                      Acoes
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {contas.map((conta) => (
                    <TR key={conta.id}>
                      <TD className="font-medium text-ink-900">{conta.name}</TD>
                      <TD>{accountKindLabel(conta.kind)}</TD>
                      <TD>{conta.unitId ? (conta.unitName ?? '—') : 'Toda a empresa'}</TD>
                      <TD align="right" className="whitespace-nowrap tabular-nums">
                        {formatBRL(conta.currentBalance)}
                      </TD>
                      <TD>
                        <Badge tone={conta.status === 'active' ? 'success' : 'neutral'}>
                          {conta.status === 'active' ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </TD>
                      <TD align="right">
                        <StatusToggleForm
                          field="accountId"
                          id={conta.id}
                          status={conta.status}
                          label={`a conta ${conta.name}`}
                          action={changeAccountStatusAction}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Formas de pagamento"
          description="COMO o dinheiro se moveu. Nao tem saldo: e o vocabulario do balcao, nao uma conta."
          headingLevel={2}
        />
        <CardBody className="space-y-4">
          <PaymentMethodForm action={createPaymentMethodAction} />

          <Alert tone="info">
            Registrar &quot;PIX&quot; ou &quot;cartao&quot; aqui e anotar o que foi combinado. O
            Nexo56 nao fala com banco nem com adquirente, e nao confirma recebimento sozinho.
          </Alert>

          {formas.length === 0 ? (
            <p className="text-small text-ink-500">Nenhuma forma de pagamento cadastrada.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {formas.map((forma) => (
                <li key={forma.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900">{forma.name}</p>
                    <p className="text-small text-ink-500">{paymentMethodKindLabel(forma.kind)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={forma.status === 'active' ? 'success' : 'neutral'}>
                      {forma.status === 'active' ? 'Ativa' : 'Inativa'}
                    </Badge>
                    <StatusToggleForm
                      field="methodId"
                      id={forma.id}
                      status={forma.status}
                      label={`a forma ${forma.name}`}
                      action={changePaymentMethodStatusAction}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Categorias"
          description="POR QUE o dinheiro entrou ou saiu. Serve para agrupar, nunca para impedir um lancamento."
          headingLevel={2}
        />
        <CardBody className="space-y-4">
          <CategoryForm action={createCategoryAction} />

          {categorias.length === 0 ? (
            <p className="text-small text-ink-500">Nenhuma categoria cadastrada.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {categorias.map((categoria) => (
                <li key={categoria.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900">{categoria.name}</p>
                    <p className="text-small text-ink-500">
                      {CATEGORY_KIND_LABEL[categoria.kind as CategoryKind] ?? categoria.kind}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={categoria.status === 'active' ? 'success' : 'neutral'}>
                      {categoria.status === 'active' ? 'Ativa' : 'Inativa'}
                    </Badge>
                    <StatusToggleForm
                      field="categoryId"
                      id={categoria.id}
                      status={categoria.status}
                      label={`a categoria ${categoria.name}`}
                      action={changeCategoryStatusAction}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

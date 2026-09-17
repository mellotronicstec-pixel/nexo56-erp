import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, linkButtonClass, PageHeader, Tabs } from '@/design-system/components';
import { todayIn } from '@/core/time/civil-date';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { listCustomers } from '@/modules/customers/application/customer-queries';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listActiveCategories } from '@/modules/finance/application/finance-settings-service';
import { titleManagePermission, type TitleDirection } from '@/modules/finance/domain/finance';
import { listActiveSuppliers } from '@/modules/purchasing/application/purchasing-queries';
import { listUnits } from '@/modules/tenancy/application/tenancy-queries';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { createExpenseAction, createTitleAction } from '../actions';
import { single } from '../format';
import { NewTitleForm } from './new-title-form';

export const metadata: Metadata = { title: 'Novo lancamento' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Lancamento manual (Prompt 12, itens 28 e 29).
 *
 * O CAMINHO MANUAL EXISTE, mas nao e o principal. A cobranca de uma OS nasce
 * na OS; a conta de uma compra nasce no recebimento. Esta tela e para o que
 * nao tem origem operacional: o aluguel, a energia, a venda de balcao sem OS.
 * Por isso ela avisa, em vez de deixar a pessoa duplicar uma cobranca que o
 * modulo de origem ja saberia criar sem risco de duplicidade.
 */
export default async function NewTitlePage({ searchParams }: PageProps) {
  const { context } = await requireAccessForPage(FEATURES.FINANCE_CORE, PERMISSIONS.FINANCE_VIEW);

  const params = await searchParams;
  const pedido = single(params.direcao);
  const direction: TitleDirection = pedido === 'payable' ? 'payable' : 'receivable';

  const podeLancar = hasPermission(context, titleManagePermission(direction));

  if (!context.activeUnitId) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Novo lancamento"
          breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Novo lancamento' }]}
        />
        <Alert tone="warning">
          Escolha uma unidade antes de lancar. Todo titulo pertence a uma loja: sem isso nao ha onde
          cobrar nem de qual caixa pagar.
        </Alert>
      </div>
    );
  }

  const unitId = context.activeUnitId;

  const [unidades, clientes, fornecedores, categorias] = await Promise.all([
    listUnits(context),
    direction === 'receivable'
      ? listCustomers(context, { status: 'active', sort: 'name', pageSize: 200 })
      : Promise.resolve(null),
    direction === 'payable' ? listActiveSuppliers(context) : Promise.resolve([]),
    listActiveCategories(context, direction === 'receivable' ? 'revenue' : 'expense'),
  ]);

  const unitName = unidades.find((unit) => unit.id === unitId)?.name ?? 'unidade ativa';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Novo lancamento"
        description="Para o que nao tem origem operacional. O resto nasce onde acontece."
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Novo lancamento' }]}
      />

      <Tabs
        items={[
          { label: 'A receber', href: '/financeiro/novo-lancamento?direcao=receivable' },
          { label: 'A pagar', href: '/financeiro/novo-lancamento?direcao=payable' },
        ]}
        activeHref={`/financeiro/novo-lancamento?direcao=${direction}`}
        label="Direcao do lancamento"
      />

      {!podeLancar ? (
        <Alert tone="warning">
          Voce nao tem permissao para lancar{' '}
          {direction === 'receivable' ? 'contas a receber' : 'contas a pagar'} nesta unidade.
        </Alert>
      ) : (
        <>
          <Alert tone="info">
            {direction === 'receivable' ? (
              <>
                A cobranca de um servico nasce na propria Ordem de Servico, com o valor do orcamento
                aprovado e sem risco de duplicidade.{' '}
                <Link href="/ordens-de-servico" className="font-semibold underline">
                  Abrir as Ordens de Servico
                </Link>
                .
              </>
            ) : (
              <>
                A conta de uma compra nasce no recebimento da mercadoria — uma conta por
                recebimento, para que a entrega parcial some exatamente.{' '}
                <Link href="/compras" className="font-semibold underline">
                  Abrir os pedidos de compra
                </Link>
                .
              </>
            )}
          </Alert>

          <NewTitleForm
            direction={direction}
            unitId={unitId}
            unitName={unitName}
            customers={(clientes?.items ?? []).map((item) => ({ id: item.id, name: item.name }))}
            suppliers={fornecedores.map((item) => ({ id: item.id, name: item.name }))}
            categories={categorias}
            today={todayIn(context.tenantTimezone)}
            createTitleAction={createTitleAction}
            createExpenseAction={createExpenseAction}
          />
        </>
      )}

      <p>
        <Link href="/financeiro" className={linkButtonClass('secondary', 'sm')}>
          Voltar ao Financeiro
        </Link>
      </p>
    </div>
  );
}

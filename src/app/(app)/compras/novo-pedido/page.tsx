import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, linkButtonClass, PageHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listActiveSuppliers } from '@/modules/purchasing/application/purchasing-queries';
import { listUnits } from '@/modules/tenancy/application/tenancy-queries';
import { createPurchaseOrderAction } from '../actions';
import { NewPurchaseOrderForm } from './new-order-form';

export const metadata: Metadata = { title: 'Novo pedido de compra' };

/**
 * Abertura de pedido (Prompt 11, itens 3.2 e 13).
 *
 * A UNIDADE NAO E ESCOLHIDA NUM SELECT: e a unidade ativa da sessao. A
 * mercadoria chega em um endereco, e deixar a pessoa escolher "para qual loja"
 * no meio do formulario e como ela erra o destino da carga.
 */
export default async function NewPurchaseOrderPage() {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_PURCHASING,
    PERMISSIONS.PURCHASES_CREATE,
  );

  const [suppliers, units] = await Promise.all([
    context.activeUnitId ? listActiveSuppliers(context) : Promise.resolve([]),
    listUnits(context),
  ]);
  const activeUnit = units.find((unit) => unit.id === context.activeUnitId) ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Novo pedido de compra"
        description="O pedido pertence a unidade que vai receber a mercadoria."
        breadcrumbs={[{ label: 'Compras', href: '/compras' }, { label: 'Novo pedido' }]}
      />

      {!context.activeUnitId || !activeUnit ? (
        <Alert tone="warning">
          Escolha uma unidade antes de abrir um pedido. Pedido sem destino nao existe: alguem
          precisa receber a mercadoria.
        </Alert>
      ) : suppliers.length === 0 ? (
        <Alert tone="info">
          Nenhum fornecedor ativo cadastrado. Cadastre o fornecedor antes de abrir o pedido —
          comprar de quem nao esta no cadastro deixaria o historico sem dono.
          <span className="mt-3 block">
            <Link href="/fornecedores/novo-fornecedor" className={linkButtonClass('primary', 'sm')}>
              Cadastrar fornecedor
            </Link>
          </span>
        </Alert>
      ) : (
        <NewPurchaseOrderForm
          action={createPurchaseOrderAction}
          unitId={context.activeUnitId}
          unitName={activeUnit.name}
          suppliers={suppliers}
        />
      )}
    </div>
  );
}

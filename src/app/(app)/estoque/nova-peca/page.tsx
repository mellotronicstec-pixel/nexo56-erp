import type { Metadata } from 'next';
import { PageHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { createPartAction } from '../actions';
import { PartForm } from '../part-form';

export const metadata: Metadata = { title: 'Nova peca' };

/**
 * Cadastro de peca (Prompt 10, itens 5 e 81).
 *
 * Exige `inventory.catalog_manage`, que e capacidade de TENANT: o catalogo
 * vale para todas as unidades, e quem so opera numa loja nao passa a mandar no
 * vocabulario da empresa por estar logado nela.
 */
export default async function NewPartPage() {
  await requireAccessForPage(FEATURES.OPERATIONS_INVENTORY, PERMISSIONS.INVENTORY_CATALOG_MANAGE);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Nova peca"
        description="A peca e da empresa e pode ser usada por qualquer unidade. O saldo entra depois, por unidade."
        breadcrumbs={[{ label: 'Estoque', href: '/estoque' }, { label: 'Nova peca' }]}
      />
      <PartForm action={createPartAction} submitLabel="Cadastrar peca" />
    </div>
  );
}

import type { Metadata } from 'next';
import { PageHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { createSupplierAction } from '../../compras/actions';
import { SupplierForm } from '../supplier-form';

export const metadata: Metadata = { title: 'Novo fornecedor' };

/**
 * Cadastro de fornecedor (Prompt 11, itens 4 e 44).
 *
 * Exige `suppliers.manage`, que e capacidade de TENANT: o fornecedor vale para
 * todas as unidades, e quem so opera numa loja nao passa a mandar no cadastro
 * comercial da empresa por estar logado nela.
 */
export default async function NewSupplierPage() {
  await requireAccessForPage(FEATURES.OPERATIONS_PURCHASING, PERMISSIONS.SUPPLIERS_MANAGE);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Novo fornecedor"
        description="O fornecedor e da empresa e pode ser usado por qualquer unidade. So o nome e obrigatorio."
        breadcrumbs={[
          { label: 'Fornecedores', href: '/fornecedores' },
          { label: 'Novo fornecedor' },
        ]}
      />
      <SupplierForm action={createSupplierAction} submitLabel="Cadastrar fornecedor" />
    </div>
  );
}

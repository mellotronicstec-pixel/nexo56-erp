import type { Metadata } from 'next';
import { PageHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { CustomerForm, EMPTY_FORM_VALUES } from '../customer-form';
import { createCustomerAction } from '../actions';

export const metadata: Metadata = { title: 'Novo cliente' };

/**
 * Cadastro de cliente (Prompt 05, item 29).
 *
 * PAGINA DEDICADA, e nao modal: o formulario tem contatos repetiveis, endereco
 * e observacoes. Isso nao cabe bem numa caixa pequena, e no celular um modal
 * desse tamanho vira uma tela dentro de outra. A pagina tambem da URL propria
 * ao cadastro — o atendente pode abrir em outra aba sem perder o que estava
 * fazendo.
 */
export default async function NewCustomerPage() {
  await requireAccessForPage(FEATURES.CORE_CUSTOMERS, PERMISSIONS.CUSTOMERS_MANAGE);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Novo cliente"
        description="Nome e uma forma de contato ja bastam. O restante pode ser completado depois."
        breadcrumbs={[{ label: 'Clientes', href: '/clientes' }, { label: 'Novo cliente' }]}
      />

      <CustomerForm
        action={createCustomerAction}
        initial={EMPTY_FORM_VALUES}
        submitLabel="Cadastrar cliente"
        cancelHref="/clientes"
      />
    </div>
  );
}

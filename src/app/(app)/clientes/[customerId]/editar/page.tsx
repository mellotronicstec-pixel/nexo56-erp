import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { findCustomerDetail } from '@/modules/customers/application/customer-queries';
import { displayName } from '@/modules/customers/domain/customer';
import { FEATURES } from '@/modules/features/domain/catalog';
import { CustomerForm, type CustomerFormValues } from '../../customer-form';
import { updateCustomerAction } from '../../actions';

export const metadata: Metadata = { title: 'Editar cliente' };

/**
 * Edicao (Prompt 05, item 33).
 *
 * O carregamento ja e escopado por tenant: um ID de outra empresa cai em 404,
 * indistinguivel de um ID inexistente.
 */
export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_CUSTOMERS,
    PERMISSIONS.CUSTOMERS_MANAGE,
  );

  const { customerId } = await params;
  const detail = await findCustomerDetail(context, customerId);
  if (!detail) notFound();

  const { customer, contacts, addresses } = detail;
  const address = addresses[0];

  const initial: CustomerFormValues = {
    customerId: customer.id,
    kind: customer.kind,
    name: customer.name,
    tradeName: customer.tradeName ?? '',
    document: customer.documentDigits ?? '',
    stateRegistration: customer.stateRegistration ?? '',
    birthDate: customer.birthDate ?? '',
    notes: customer.notes ?? '',
    contacts:
      contacts.length > 0
        ? contacts.map((contact) => ({
            type: contact.type,
            value: contact.value,
            label: contact.label ?? '',
            isWhatsapp: contact.isWhatsapp,
          }))
        : [{ type: 'phone' as const, value: '', label: '', isWhatsapp: false }],
    address: {
      zipCode: address?.zipCode ?? '',
      street: address?.street ?? '',
      number: address?.number ?? '',
      complement: address?.complement ?? '',
      district: address?.district ?? '',
      city: address?.city ?? '',
      state: address?.state ?? '',
    },
  };

  const name = displayName(customer);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Editar cliente"
        description={name}
        breadcrumbs={[
          { label: 'Clientes', href: '/clientes' },
          { label: name, href: `/clientes/${customer.id}` },
          { label: 'Editar' },
        ]}
      />

      <CustomerForm
        action={updateCustomerAction}
        initial={initial}
        submitLabel="Salvar alteracoes"
        cancelHref={`/clientes/${customer.id}`}
      />
    </div>
  );
}

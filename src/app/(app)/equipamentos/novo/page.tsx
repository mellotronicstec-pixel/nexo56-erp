import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader, Alert } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { findCustomerDetail } from '@/modules/customers/application/customer-queries';
import { displayName } from '@/modules/customers/domain/customer';
import { getLabelRecognitionProvider } from '@/modules/equipment/application/label-recognition';
import { FEATURES } from '@/modules/features/domain/catalog';
import { EquipmentForm } from '../equipment-form';
import { createEquipmentAction } from '../actions';

export const metadata: Metadata = { title: 'Novo equipamento' };

/**
 * Cadastro de equipamento (item 81).
 *
 * Sempre parte de um CLIENTE: equipamento sem dono nao existe no dominio. O
 * cliente chega pela query string (`?cliente=<id>`), vindo da ficha dele — o
 * formulario de Cliente nao e duplicado aqui.
 */
export default async function NewEquipmentPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_EQUIPMENT,
    PERMISSIONS.EQUIPMENT_MANAGE,
  );

  const { cliente } = await searchParams;
  if (!cliente) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Novo equipamento"
          breadcrumbs={[{ label: 'Equipamentos', href: '/equipamentos' }, { label: 'Novo' }]}
        />
        <Alert tone="info" title="Comece pelo cliente">
          Todo equipamento pertence a um cliente. Abra a ficha do cliente e use &quot;Novo
          equipamento&quot; por la.
        </Alert>
      </div>
    );
  }

  const customer = await findCustomerDetail(context, cliente);
  if (!customer) notFound();

  const name = displayName(customer.customer);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Novo equipamento"
        description={`Cadastro do aparelho de ${name}.`}
        breadcrumbs={[
          { label: 'Clientes', href: '/clientes' },
          { label: name, href: `/clientes/${customer.customer.id}` },
          { label: 'Novo equipamento' },
        ]}
      />

      <EquipmentForm
        action={createEquipmentAction}
        customerName={name}
        submitLabel="Cadastrar equipamento"
        cancelHref={`/clientes/${customer.customer.id}`}
        labelRecognitionAvailable={getLabelRecognitionProvider().isAvailable()}
        initial={{
          customerId: customer.customer.id,
          kind: '',
          brand: '',
          model: '',
          serial: '',
          voltage: 'unknown',
          notes: '',
        }}
      />
    </div>
  );
}

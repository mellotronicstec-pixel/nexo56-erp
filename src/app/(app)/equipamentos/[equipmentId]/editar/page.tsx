import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { findEquipmentDetail } from '@/modules/equipment/application/equipment-queries';
import { equipmentTitle } from '@/modules/equipment/domain/equipment';
import { getLabelRecognitionProvider } from '@/modules/equipment/application/label-recognition';
import { FEATURES } from '@/modules/features/domain/catalog';
import { EquipmentForm } from '../../equipment-form';
import { updateEquipmentAction } from '../../actions';

export const metadata: Metadata = { title: 'Editar equipamento' };

/** Correcao da identificacao (item 64). O cliente dono nao muda por aqui (item 65). */
export default async function EditEquipmentPage({
  params,
}: {
  params: Promise<{ equipmentId: string }>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_EQUIPMENT,
    PERMISSIONS.EQUIPMENT_MANAGE,
  );

  const { equipmentId } = await params;
  const detail = await findEquipmentDetail(context, equipmentId);
  if (!detail) notFound();

  const { equipment: item, customer } = detail;
  const title = equipmentTitle(item);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Editar equipamento"
        description={title}
        breadcrumbs={[
          { label: 'Equipamentos', href: '/equipamentos' },
          { label: title, href: `/equipamentos/${item.id}` },
          { label: 'Editar' },
        ]}
      />

      <EquipmentForm
        action={updateEquipmentAction}
        customerName={customer?.name ?? 'cliente'}
        submitLabel="Salvar alteracoes"
        cancelHref={`/equipamentos/${item.id}`}
        labelRecognitionAvailable={getLabelRecognitionProvider().isAvailable()}
        initial={{
          equipmentId: item.id,
          customerId: item.customerId,
          kind: item.kind,
          brand: item.brand ?? '',
          model: item.model ?? '',
          serial: item.serial ?? '',
          voltage: item.voltage,
          notes: item.notes ?? '',
        }}
      />
    </div>
  );
}

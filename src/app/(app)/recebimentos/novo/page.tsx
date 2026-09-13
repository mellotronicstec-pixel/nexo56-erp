import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, PageHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { findEquipmentDetail } from '@/modules/equipment/application/equipment-queries';
import { equipmentTitle } from '@/modules/equipment/domain/equipment';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listUnits } from '@/modules/tenancy/application/tenancy-queries';
import { IntakeForm } from '../intake-form';
import { createIntakeAction } from '../../equipamentos/actions';

export const metadata: Metadata = { title: 'Novo recebimento' };

/**
 * Registro de recebimento (item 82).
 *
 * Parte de um equipamento ja identificado — o fluxo do balcao e
 * cliente -> equipamento -> recebimento, e cada etapa tem a sua tela.
 */
export default async function NewIntakePage({
  searchParams,
}: {
  searchParams: Promise<{ equipamento?: string }>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_EQUIPMENT_INTAKE,
    PERMISSIONS.EQUIPMENT_INTAKE_CREATE,
  );

  const { equipamento } = await searchParams;
  if (!equipamento) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Novo recebimento"
          breadcrumbs={[{ label: 'Recebimentos', href: '/recebimentos' }, { label: 'Novo' }]}
        />
        <Alert tone="info" title="Comece pelo equipamento">
          Abra a ficha do equipamento e use &quot;Registrar recebimento&quot;. Se o aparelho ainda
          nao existe, cadastre-o a partir da ficha do cliente.
        </Alert>
      </div>
    );
  }

  const detail = await findEquipmentDetail(context, equipamento);
  if (!detail) notFound();

  /**
   * Sem unidade ativa nao ha onde registrar a entrada (item 67). A tela
   * explica em vez de falhar so no envio.
   */
  if (!context.activeUnitId) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Novo recebimento"
          breadcrumbs={[{ label: 'Recebimentos', href: '/recebimentos' }, { label: 'Novo' }]}
        />
        <Alert tone="warning" title="Selecione a unidade">
          O recebimento pertence a uma unidade. Escolha a unidade onde o equipamento esta sendo
          recebido, no seletor da barra superior.
        </Alert>
      </div>
    );
  }

  const units = await listUnits(context);
  const unitName = units.find((unit) => unit.id === context.activeUnitId)?.name ?? 'unidade atual';
  const title = equipmentTitle(detail.equipment);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Novo recebimento"
        description="Registre como o aparelho chegou. Leva menos de um minuto."
        breadcrumbs={[
          { label: 'Equipamentos', href: '/equipamentos' },
          { label: title, href: `/equipamentos/${detail.equipment.id}` },
          { label: 'Recebimento' },
        ]}
      />

      <IntakeForm
        action={createIntakeAction}
        equipmentId={detail.equipment.id}
        equipmentTitle={title}
        customerName={detail.customer?.name ?? 'cliente'}
        unitName={unitName}
        cancelHref={`/equipamentos/${detail.equipment.id}`}
      />
    </div>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert, PageHeader } from '@/design-system/components';
import { can } from '@/modules/access-control/application/authorization-service';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  findServiceOrderDetail,
  getServiceOrderNumberFormat,
} from '@/modules/service-orders/application/service-order-queries';
import { formatServiceOrderNumber } from '@/modules/service-orders/domain/service-order';
import { updateServiceOrderAction } from '../../actions';
import { ServiceOrderEditForm } from '../../service-order-form';

export const metadata: Metadata = { title: 'Corrigir abertura' };

/**
 * Correcao dos dados de abertura (Prompt 07, item 111).
 *
 * SO O QUE FAZ SENTIDO CORRIGIR NESTE ESTAGIO: o relato do cliente e as
 * observacoes internas. Cliente, equipamento e unidade nao aparecem como
 * campos — sao a identidade do atendimento, e troca-los aqui migraria o
 * historico de um aparelho para outro sem que nada registrasse a mudanca
 * (itens 41 a 43).
 */
export default async function EditServiceOrderPage({
  params,
}: {
  params: Promise<{ serviceOrderId: string }>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_SERVICE_ORDERS,
    PERMISSIONS.SERVICE_ORDERS_UPDATE,
  );

  const { serviceOrderId } = await params;

  const [detail, numberFormat] = await Promise.all([
    findServiceOrderDetail(context, serviceOrderId),
    getServiceOrderNumberFormat(context.tenantId),
  ]);

  if (!detail) notFound();

  const number = formatServiceOrderNumber(
    detail.order.number,
    numberFormat.prefix,
    numberFormat.padding,
  );

  /**
   * "Melhorar com Nexo56 AI" so aparece com a autorizacao COMPOSTA ja
   * satisfeita (item 29): feature `ai.writing` + `ai.use` + a permissao de
   * dominio ja garantida por `requireAccessForPage` acima. Sem isso, o
   * controle simplesmente nao existe na pagina (item 95) — o backend
   * (`generateAiDraft`) recusa de qualquer forma, mesmo que a UI tentasse.
   */
  const aiWritingAccess = await can(context, {
    permission: PERMISSIONS.AI_USE,
    unitId: detail.order.unitId,
    featureKey: FEATURES.AI_WRITING,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Corrigir abertura"
        eyebrow={number}
        breadcrumbs={[
          { label: 'Ordens de Servico', href: '/ordens-de-servico' },
          { label: number, href: `/ordens-de-servico/${detail.order.id}` },
          { label: 'Corrigir' },
        ]}
      />

      <Alert tone="info" title="O que nao muda por aqui">
        Cliente, equipamento e unidade permanecem como foram registrados na abertura. Uma correcao
        desse tipo exige um caminho proprio e auditado.
      </Alert>

      <ServiceOrderEditForm
        action={updateServiceOrderAction}
        serviceOrderId={detail.order.id}
        customerReport={detail.order.customerReport}
        internalNotes={detail.order.internalNotes ?? ''}
        cancelHref={`/ordens-de-servico/${detail.order.id}`}
        aiAvailable={aiWritingAccess.allowed}
      />
    </div>
  );
}

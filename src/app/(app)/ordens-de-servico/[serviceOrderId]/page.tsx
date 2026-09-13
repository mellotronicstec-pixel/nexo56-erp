import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  linkButtonClass,
  PageHeader,
  Section,
} from '@/design-system/components';
import { IconCamera, IconHistory } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import {
  POWER_CABLE_LABEL,
  VOLTAGE_LABEL,
  conditionLabel,
  equipmentTitle,
} from '@/modules/equipment/domain/equipment';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  findServiceOrderDetail,
  getServiceOrderNumberFormat,
} from '@/modules/service-orders/application/service-order-queries';
import {
  formatServiceOrderNumber,
  statusLabel,
  timelineLabel,
} from '@/modules/service-orders/domain/service-order';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';

export const metadata: Metadata = { title: 'Ordem de Servico' };

/**
 * Ficha da Ordem de Servico (Prompt 07, itens 51 a 60).
 *
 * Esta e a BASE do futuro workspace da OS. Hoje ela mostra exatamente o que
 * existe: identificacao, cliente, aparelho, o que o cliente relatou, o que veio
 * no recebimento e a linha do tempo real.
 *
 * NAO HA ABA VAZIA (item 58) nem botao sem backend (item 60). Diagnostico,
 * orcamento, pecas e garantia terao seu lugar aqui quando existirem — e aba
 * "em breve" e pior do que a ausencia dela, porque ensina a equipe a ignorar a
 * interface.
 */
export default async function ServiceOrderDetailPage({
  params,
}: {
  params: Promise<{ serviceOrderId: string }>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_SERVICE_ORDERS,
    PERMISSIONS.SERVICE_ORDERS_VIEW,
  );

  const { serviceOrderId } = await params;

  const [detail, numberFormat] = await Promise.all([
    findServiceOrderDetail(context, serviceOrderId),
    getServiceOrderNumberFormat(context.tenantId),
  ]);

  // Outra empresa, outra unidade e inexistente terminam no mesmo lugar.
  if (!detail) notFound();

  const { order, customer, equipmentItem, unitName, openedByName, intake, timeline } = detail;
  const number = formatServiceOrderNumber(order.number, numberFormat.prefix, numberFormat.padding);
  const title = equipmentTitle(equipmentItem);

  const canUpdate = hasPermission(context, PERMISSIONS.SERVICE_ORDERS_UPDATE);

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: context.tenantTimezone,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/*
        No celular o cabecalho e o que responde primeiro: qual OS, de quem,
        qual aparelho (itens 77 e 78). Nada de KPI inventado (item 52).
      */}
      <PageHeader
        title={number}
        eyebrow={title}
        breadcrumbs={[
          { label: 'Ordens de Servico', href: '/ordens-de-servico' },
          { label: number },
        ]}
        metadata={
          <>
            {/* `py-1` deixa o link tocavel no celular (24px minimo, item 78). */}
            <Link
              href={`/clientes/${customer.id}`}
              className="inline-flex items-center py-1 hover:underline"
            >
              {customer.name}
            </Link>
            <span>{unitName ?? 'Unidade removida'}</span>
            <span>Aberta em {formatter.format(order.openedAt)}</span>
          </>
        }
        actions={
          canUpdate ? (
            <Link
              href={`/ordens-de-servico/${order.id}/editar`}
              className={linkButtonClass('secondary')}
            >
              Corrigir abertura
            </Link>
          ) : null
        }
      />

      <Card>
        <CardBody>
          <dl className="grid gap-4 text-ui sm:grid-cols-2">
            <div>
              <dt className="text-small text-ink-500">Situacao</dt>
              <dd className="mt-1">
                <Badge>{statusLabel(order.status)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Aberta por</dt>
              <dd className="text-ink-900">{openedByName ?? 'Sistema'}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      {/*
        RELATO DO CLIENTE em bloco proprio, com rotulo explicito de que nao e
        diagnostico (item 22). `whitespace-pre-wrap` preserva as quebras de
        linha digitadas; React escapa o conteudo, entao nao ha caminho que
        interprete HTML aqui.
      */}
      <Section
        id="relato"
        title="Relato do cliente"
        description="O que a pessoa contou no balcao. Nao e diagnostico tecnico."
      >
        <Card>
          <CardBody>
            <p className="whitespace-pre-wrap text-ui text-ink-800">{order.customerReport}</p>
          </CardBody>
        </Card>
      </Section>

      {order.internalNotes ? (
        <Section
          id="observacoes"
          title="Observacoes internas"
          description="Recado da equipe. Nao e apresentado ao cliente."
        >
          <Card>
            <CardBody>
              <p className="whitespace-pre-wrap text-ui text-ink-800">{order.internalNotes}</p>
            </CardBody>
          </Card>
        </Section>
      ) : null}

      <Section
        id="equipamento"
        title="Equipamento"
        description="Identificacao do aparelho atendido nesta ordem."
      >
        <Card>
          <CardBody className="space-y-4">
            <dl className="grid gap-4 text-ui sm:grid-cols-2">
              <div>
                <dt className="text-small text-ink-500">Tipo</dt>
                <dd className="text-ink-900">{equipmentItem.kind}</dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Marca e modelo</dt>
                <dd className="text-ink-900">{title}</dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Numero de serie</dt>
                <dd className="text-ink-900">{equipmentItem.serial ?? 'Nao informado'}</dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Tensao</dt>
                <dd className="text-ink-900">
                  {VOLTAGE_LABEL[equipmentItem.voltage as keyof typeof VOLTAGE_LABEL] ??
                    'Nao identificada'}
                </dd>
              </div>
            </dl>
            <Link
              href={`/equipamentos/${equipmentItem.id}`}
              className="touch-target inline-flex items-center text-ui font-semibold text-brand-600 hover:underline md:min-h-0"
            >
              Abrir a ficha do equipamento
            </Link>
          </CardBody>
        </Card>
      </Section>

      {/*
        RECEBIMENTO: lido do modulo de Equipamentos, nunca copiado (itens 55 e
        56). A OS mostra a inspecao, os acessorios e as fotos de entrada; a
        fonte continua sendo o recebimento.
      */}
      {intake ? (
        <Section
          id="recebimento"
          title="Recebimento de origem"
          description="Como o aparelho chegou. Os dados pertencem ao recebimento, e sao apenas exibidos aqui."
        >
          <Card>
            <CardBody className="space-y-4">
              <dl className="grid gap-4 text-ui sm:grid-cols-2">
                <div>
                  <dt className="text-small text-ink-500">Entrada</dt>
                  <dd className="text-ink-900">{formatter.format(intake.receivedAt)}</dd>
                </div>
                <div>
                  <dt className="text-small text-ink-500">Cabo de forca</dt>
                  <dd className="text-ink-900">
                    {POWER_CABLE_LABEL[intake.powerCable as keyof typeof POWER_CABLE_LABEL] ?? '—'}
                  </dd>
                </div>
              </dl>

              {intake.accessories.length > 0 ? (
                <div>
                  <p className="text-small text-ink-500">Acessorios entregues</p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {intake.accessories.map((accessory) => (
                      <li key={accessory.id}>
                        <Badge>
                          {accessory.quantity > 1 ? `${accessory.quantity}x ` : ''}
                          {accessory.label}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {intake.conditions.length > 0 ? (
                <div>
                  <p className="text-small text-ink-500">Estado na entrada</p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {intake.conditions.map((condition) => (
                      <li key={condition.id}>
                        <Badge tone="warning">{conditionLabel(condition.conditionKey)}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {intake.inspectionNotes ? (
                <p className="whitespace-pre-wrap text-ui text-ink-700">{intake.inspectionNotes}</p>
              ) : null}
            </CardBody>
          </Card>
        </Section>
      ) : null}

      {/*
        FOTOS: a imagem continua no storage privado do equipamento e e servida
        pela rota autenticada (item 56). A OS aponta para ela — nao ha copia.
      */}
      <Section
        id="fotos"
        title="Fotos"
        description="Imagens do equipamento e da entrada, servidas pela rota autenticada."
      >
        <Card>
          {detail.equipmentMedia.length === 0 ? (
            <EmptyState
              icon={<IconCamera />}
              title="Nenhuma foto"
              description="Este aparelho ainda nao tem fotos registradas."
            />
          ) : (
            <CardBody>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {detail.equipmentMedia.map((media) => (
                  <li key={media.id} className="rounded-md border border-ink-200 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- rota autenticada, fora do otimizador */}
                    <img
                      src={`/api/midia/${media.id}`}
                      alt={media.caption ?? 'Foto do equipamento'}
                      className="h-32 w-full rounded-md object-cover"
                      loading="lazy"
                    />
                  </li>
                ))}
              </ul>
            </CardBody>
          )}
        </Card>
      </Section>

      {/*
        HISTORICO ESTRUTURAL (itens 38 e 59): somente fatos que aconteceram de
        verdade. Nada de "em breve" e nada de evento futuro inventado.
      */}
      <Section
        id="historico"
        title="Historico"
        description="Os fatos desta Ordem de Servico, do mais recente para o mais antigo."
      >
        <Card>
          {timeline.length === 0 ? (
            <EmptyState
              icon={<IconHistory />}
              title="Sem registros"
              description="Nenhum fato foi registrado nesta ordem ainda."
            />
          ) : (
            <CardBody>
              <ul className="divide-y divide-ink-200">
                {timeline.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                    <p className="font-medium text-ink-900">
                      {entry.summary ?? timelineLabel(entry.kind)}
                    </p>
                    <p className="text-small text-ink-500">
                      {formatter.format(entry.occurredAt)}
                      {entry.actorName ? ` · ${entry.actorName}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </CardBody>
          )}
        </Card>
      </Section>
    </div>
  );
}

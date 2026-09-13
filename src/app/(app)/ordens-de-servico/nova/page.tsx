import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { findEquipmentDetail } from '@/modules/equipment/application/equipment-queries';
import {
  POWER_CABLE_LABEL,
  VOLTAGE_LABEL,
  conditionLabel,
  equipmentTitle,
} from '@/modules/equipment/domain/equipment';
import { FEATURES } from '@/modules/features/domain/catalog';
import { mapServiceOrdersByIntake } from '@/modules/service-orders/application/service-order-queries';
import { formatServiceOrderNumber } from '@/modules/service-orders/domain/service-order';
import { createServiceOrderAction } from '../actions';
import { ServiceOrderForm } from '../service-order-form';

export const metadata: Metadata = { title: 'Abrir Ordem de Servico' };

/**
 * Abertura de Ordem de Servico (Prompt 07, itens 89 e 90).
 *
 * Chega-se aqui de duas formas:
 *
 *   /ordens-de-servico/nova?recebimento=<id>   caminho normal do balcao
 *   /ordens-de-servico/nova?equipamento=<id>   aparelho ja cadastrado
 *
 * Nos dois casos cliente, equipamento e unidade JA estao resolvidos e entram
 * como resumo — nada e redigitado (item 89). Nao ha assistente de varios
 * passos: quem esta com o cliente na frente preenche um campo e confirma.
 */
export default async function NewServiceOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ equipamento?: string; recebimento?: string }>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_SERVICE_ORDERS,
    PERMISSIONS.SERVICE_ORDERS_CREATE,
  );

  const { equipamento, recebimento } = await searchParams;

  if (!equipamento) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          title="Abrir Ordem de Servico"
          breadcrumbs={[
            { label: 'Ordens de Servico', href: '/ordens-de-servico' },
            { label: 'Nova' },
          ]}
        />
        <Alert tone="info" title="Escolha o equipamento">
          A Ordem de Servico nasce de um aparelho. Abra o recebimento ou a ficha do equipamento e
          use o atalho de la — assim o cliente e a unidade ja vem preenchidos.
        </Alert>
        <p className="text-ui text-ink-700">
          <Link href="/recebimentos" className="font-semibold text-brand-600 hover:underline">
            Ir para Recebimentos
          </Link>
          {' · '}
          <Link href="/equipamentos" className="font-semibold text-brand-600 hover:underline">
            Ir para Equipamentos
          </Link>
        </p>
      </div>
    );
  }

  const detail = await findEquipmentDetail(context, equipamento);
  // Equipamento de outra empresa e equipamento inexistente terminam igual.
  if (!detail) notFound();

  const { equipment: item, customer, intakes } = detail;
  const title = equipmentTitle(item);

  /** Recebimento indicado, se ele for mesmo deste aparelho. */
  const selected = recebimento
    ? (intakes.find((entry) => entry.intake.id === recebimento) ?? null)
    : null;

  if (recebimento && !selected) notFound();

  /** Uma OS por recebimento (item 33): se ja existe, levamos para ela. */
  const existing = selected
    ? (await mapServiceOrdersByIntake(context, [selected.intake.id])).get(selected.intake.id)
    : undefined;

  const unitName =
    selected?.unitName ??
    (context.activeUnitId ? (detail.intakes.find((i) => i.unitName)?.unitName ?? null) : null);

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: context.tenantTimezone,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Abrir Ordem de Servico"
        eyebrow={title}
        breadcrumbs={[
          { label: 'Ordens de Servico', href: '/ordens-de-servico' },
          { label: 'Nova' },
        ]}
      />

      {!context.activeUnitId ? (
        <Alert tone="warning" title="Nenhuma unidade selecionada">
          A Ordem de Servico pertence a unidade que vai executar o servico. Escolha a unidade no
          seletor da barra superior antes de continuar.
        </Alert>
      ) : null}

      {existing ? (
        <Alert tone="warning" title="Este recebimento ja tem Ordem de Servico">
          <Link
            href={`/ordens-de-servico/${existing.id}`}
            className="font-semibold text-brand-700 underline"
          >
            Abrir a {formatServiceOrderNumber(existing.number)}
          </Link>
        </Alert>
      ) : (
        <ServiceOrderForm
          action={createServiceOrderAction}
          equipmentId={item.id}
          intakeId={selected?.intake.id ?? null}
          cancelHref={`/equipamentos/${item.id}`}
          summary={
            <Card>
              <CardHeader
                title="Resumo da abertura"
                description="Confira antes de confirmar. Estes dados vem do cadastro, nao sao digitados aqui."
                headingLevel={2}
              />
              <CardBody>
                <dl className="grid gap-4 text-ui sm:grid-cols-2">
                  <div>
                    <dt className="text-small text-ink-500">Cliente</dt>
                    <dd className="text-ink-900">
                      {customer ? (
                        <Link href={`/clientes/${customer.id}`} className="hover:underline">
                          {customer.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-small text-ink-500">Equipamento</dt>
                    <dd className="text-ink-900">
                      {title}
                      <span className="block text-small text-ink-500">
                        {item.kind}
                        {item.serial ? ` · Serie ${item.serial}` : ' · Sem numero de serie'} ·{' '}
                        {VOLTAGE_LABEL[item.voltage]}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-small text-ink-500">Unidade responsavel</dt>
                    <dd className="text-ink-900">{unitName ?? 'Unidade ativa'}</dd>
                  </div>
                  <div>
                    <dt className="text-small text-ink-500">Recebimento</dt>
                    <dd className="text-ink-900">
                      {selected
                        ? formatter.format(selected.intake.receivedAt)
                        : 'Sem recebimento vinculado'}
                    </dd>
                  </div>
                </dl>

                {/*
                  O que veio do recebimento e MOSTRADO, nao copiado (item 10):
                  o atendente confere o estado de entrada sem que a OS duplique
                  acessorios e inspecao no proprio registro.
                */}
                {selected ? (
                  <div className="mt-4 space-y-3 border-t border-ink-200 pt-4">
                    <p className="text-small text-ink-500">
                      Cabo de forca: {POWER_CABLE_LABEL[selected.intake.powerCable]}
                    </p>
                    {selected.accessories.length > 0 ? (
                      <div>
                        <p className="text-small text-ink-500">Acessorios entregues</p>
                        <ul className="mt-1 flex flex-wrap gap-2">
                          {selected.accessories.map((accessory) => (
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
                    {selected.conditions.length > 0 ? (
                      <div>
                        <p className="text-small text-ink-500">Estado na entrada</p>
                        <ul className="mt-1 flex flex-wrap gap-2">
                          {selected.conditions.map((condition) => (
                            <li key={condition.id}>
                              <Badge tone="warning">{conditionLabel(condition.conditionKey)}</Badge>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardBody>
            </Card>
          }
        />
      )}
    </div>
  );
}

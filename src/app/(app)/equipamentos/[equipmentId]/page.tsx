import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  linkButtonClass,
  PageHeader,
  Section,
} from '@/design-system/components';
import { IconCamera, IconIntake, IconWarranty } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { findEquipmentDetail } from '@/modules/equipment/application/equipment-queries';
import {
  EQUIPMENT_STATUS_LABEL,
  POWER_CABLE_LABEL,
  VOLTAGE_LABEL,
  conditionLabel,
  equipmentTitle,
} from '@/modules/equipment/domain/equipment';
import { FEATURES } from '@/modules/features/domain/catalog';
import { checkAccess } from '@/modules/features/application/effective-access';
import { mapServiceOrdersByIntake } from '@/modules/service-orders/application/service-order-queries';
import { formatServiceOrderNumber } from '@/modules/service-orders/domain/service-order';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { listWarrantiesForEquipment } from '@/modules/warranties/application/warranty-queries';
import {
  formatWarrantyNumber,
  TEMPORAL_CLASS_LABEL,
  warrantyTypeLabel,
  WARRANTY_STATUS_LABEL,
  WARRANTY_STATUS_TONE,
  type WarrantyStatus,
} from '@/modules/warranties/domain/warranty';
import { MediaManager } from './media-manager';
import { removeMediaAction, uploadMediaAction } from '../actions';

export const metadata: Metadata = { title: 'Equipamento' };

/**
 * Data civil nao e instante (ADR-017): `AAAA-MM-DD` passado por `new Date()`
 * viraria meia-noite UTC e, em Sao Paulo, mostraria o dia anterior.
 */
function civilDate(value: string): string {
  const [ano, mes, dia] = value.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : value;
}

/**
 * Ficha do equipamento (Prompt 06, itens 52 e 80).
 *
 * Mostra o que EXISTE: identificacao, dono, fotos e o historico real de
 * recebimentos, e — quando o modulo de Garantias esta disponivel — a cobertura
 * viva do aparelho (Prompt 13, item 75). Nao ha aba de Ordens de Servico nem
 * de pecas: aba que nao leva a lugar nenhum e pior do que a ausencia dela
 * (item 52).
 */
export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ equipmentId: string }>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_EQUIPMENT,
    PERMISSIONS.EQUIPMENT_VIEW,
  );

  const { equipmentId } = await params;
  const detail = await findEquipmentDetail(context, equipmentId);
  // ID de outra empresa e ID inexistente terminam no mesmo lugar.
  if (!detail) notFound();

  const { equipment: item, customer, media, intakes } = detail;
  const title = equipmentTitle(item);

  const canManage = hasPermission(context, PERMISSIONS.EQUIPMENT_MANAGE);
  const canManageMedia = hasPermission(context, PERMISSIONS.EQUIPMENT_INTAKE_MANAGE_MEDIA);

  /** O botao de receber so aparece se a feature estiver disponivel de verdade. */
  const intakeAccess = await checkAccess(context, {
    featureKey: FEATURES.CORE_EQUIPMENT_INTAKE,
    permission: PERMISSIONS.EQUIPMENT_INTAKE_CREATE,
  });

  /**
   * Ordem de Servico (Prompt 07, item 31).
   *
   * O atalho so existe quando o modulo esta REALMENTE disponivel para esta
   * empresa e esta pessoa. E o mapa de ordens ja abertas vem em UMA consulta
   * para todos os recebimentos da ficha, nao uma por bloco.
   */
  const serviceOrderAccess = await checkAccess(context, {
    featureKey: FEATURES.CORE_SERVICE_ORDERS,
    permission: PERMISSIONS.SERVICE_ORDERS_CREATE,
  });

  const ordersByIntake = await mapServiceOrdersByIntake(
    context,
    intakes.map(({ intake }) => intake.id),
  );

  /**
   * GARANTIAS DO APARELHO (Prompt 13, itens 22 e 75).
   *
   * A pergunta do balcao e "este aparelho tem cobertura?", e ela e feita sobre
   * o APARELHO — nao sobre o cliente e nao sobre uma OS especifica. O mesmo
   * aparelho pode carregar tres garantias ao mesmo tempo: a interna do reparo,
   * a da peca trocada e a de fabrica, cada uma cobrindo coisa diferente.
   *
   * AS VENCIDAS APARECEM, MARCADAS COMO TAL. Esconde-las deixaria a ficha
   * limpa e o atendente sem resposta: "existiu uma garantia e ela terminou
   * semana passada" e informacao util; "nao encontrei nada" nao e.
   *
   * O MODULO E OPCIONAL: com Garantias desligado, nenhuma consulta acontece e
   * a ficha fica exatamente como era antes do Prompt 13.
   */
  const warrantyAccess = await checkAccess(context, {
    featureKey: FEATURES.OPERATIONS_WARRANTIES,
    permission: PERMISSIONS.WARRANTIES_VIEW,
  });

  const equipmentWarranties = warrantyAccess.allowed
    ? await listWarrantiesForEquipment(context, item.id)
    : [];

  const canRegisterReturn = await checkAccess(context, {
    featureKey: FEATURES.OPERATIONS_WARRANTIES,
    permission: PERMISSIONS.WARRANTIES_RETURN_CREATE,
  });

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: context.tenantTimezone,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={title}
        eyebrow={item.kind}
        breadcrumbs={[{ label: 'Equipamentos', href: '/equipamentos' }, { label: title }]}
        metadata={
          <>
            {customer ? (
              <Link href={`/clientes/${customer.id}`} className="hover:underline">
                {customer.name}
              </Link>
            ) : null}
            {item.serial ? <span>Serie {item.serial}</span> : <span>Sem numero de serie</span>}
            <span>{VOLTAGE_LABEL[item.voltage]}</span>
          </>
        }
        actions={
          <>
            {intakeAccess.allowed ? (
              <Link
                href={`/recebimentos/novo?equipamento=${item.id}`}
                className={linkButtonClass('primary')}
              >
                <IconIntake size={18} />
                Registrar recebimento
              </Link>
            ) : null}
            {canManage ? (
              <Link
                href={`/equipamentos/${item.id}/editar`}
                className={linkButtonClass('secondary')}
              >
                Editar
              </Link>
            ) : null}
          </>
        }
      />

      {item.status === 'inactive' ? (
        <Alert tone="warning" title="Equipamento inativo">
          Este aparelho esta fora da operacao do dia a dia. O cadastro e o historico continuam
          preservados.
        </Alert>
      ) : null}

      <Card>
        <CardHeader title="Identificacao" headingLevel={2} />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-small text-ink-500">Tipo</dt>
              <dd className="font-medium text-ink-900">{item.kind}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Marca</dt>
              <dd className="text-ink-800">{item.brand ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Modelo</dt>
              <dd className="text-ink-800">{item.model ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Numero de serie</dt>
              <dd className="text-ink-800">{item.serial ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Tensao</dt>
              <dd className="text-ink-800">{VOLTAGE_LABEL[item.voltage]}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Situacao</dt>
              <dd>
                <Badge tone={item.status === 'active' ? 'success' : 'neutral'}>
                  {EQUIPMENT_STATUS_LABEL[item.status]}
                </Badge>
              </dd>
            </div>
            {item.notes ? (
              <div className="sm:col-span-2">
                <dt className="text-small text-ink-500">Observacoes de identificacao</dt>
                <dd className="whitespace-pre-wrap text-ink-800">{item.notes}</dd>
              </div>
            ) : null}
          </dl>
        </CardBody>
      </Card>

      <Section
        id="fotos"
        title="Fotos"
        description="Imagens do aparelho e da etiqueta. Ficam restritas a esta empresa."
      >
        <Card>
          <CardBody>
            {canManageMedia ? (
              <MediaManager
                uploadAction={uploadMediaAction}
                removeAction={removeMediaAction}
                equipmentId={item.id}
                media={media.map((file) => ({
                  id: file.id,
                  kind: file.kind,
                  caption: file.caption,
                }))}
              />
            ) : media.length === 0 ? (
              <EmptyState
                icon={<IconCamera />}
                title="Nenhuma foto"
                description="Nenhuma imagem foi anexada a este equipamento."
              />
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {media.map((file) => (
                  <li key={file.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- rota autenticada */}
                    <img
                      src={`/api/midia/${file.id}`}
                      alt={file.caption ?? 'Foto do equipamento'}
                      className="h-32 w-full rounded-md border border-ink-200 object-cover"
                      loading="lazy"
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </Section>

      {warrantyAccess.allowed ? (
        <Section
          id="garantias"
          title="Garantias"
          description="O que ainda esta coberto neste aparelho — e o que ja terminou."
        >
          <Card>
            {equipmentWarranties.length === 0 ? (
              <EmptyState
                icon={<IconWarranty />}
                title="Nenhuma garantia"
                description="Este aparelho nao tem garantia registrada nas suas unidades."
              />
            ) : (
              <CardBody className="p-0">
                <ul className="divide-y divide-ink-100">
                  {equipmentWarranties.map((garantia) => (
                    <li
                      key={garantia.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/garantias/${garantia.id}`}
                          className="touch-target inline-flex items-center font-medium text-brand-600"
                        >
                          {formatWarrantyNumber(garantia.number)}
                        </Link>
                        <p className="text-small text-ink-500">
                          {warrantyTypeLabel(garantia.type)} · {civilDate(garantia.startsOn)} a{' '}
                          {civilDate(garantia.endsOn)}
                          {garantia.serviceOrderNumber !== null
                            ? ` · OS ${garantia.serviceOrderNumber}`
                            : ''}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            WARRANTY_STATUS_TONE[garantia.status as WarrantyStatus] ?? 'neutral'
                          }
                        >
                          {WARRANTY_STATUS_LABEL[garantia.status as WarrantyStatus] ??
                            garantia.status}
                        </Badge>
                        <Badge tone={garantia.enforceable ? 'success' : 'neutral'}>
                          {TEMPORAL_CLASS_LABEL[garantia.temporal]}
                        </Badge>
                        {garantia.coversWholeService === 0 ? (
                          <Badge tone="warning">Cobertura parcial</Badge>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>

                {canRegisterReturn.allowed ? (
                  <div className="border-t border-ink-100 px-4 py-3">
                    <Link
                      href={`/garantias/novo-retorno?aparelho=${item.id}`}
                      className={linkButtonClass('secondary', 'sm')}
                    >
                      Registrar retorno em garantia
                    </Link>
                  </div>
                ) : null}
              </CardBody>
            )}
          </Card>
        </Section>
      ) : null}

      <Section
        id="recebimentos"
        title="Recebimentos"
        description="Cada entrada deste aparelho na assistencia, com a unidade onde foi recebido."
      >
        <Card>
          {intakes.length === 0 ? (
            <EmptyState
              icon={<IconIntake />}
              title="Nenhum recebimento"
              description="Este equipamento ainda nao foi recebido na assistencia."
            />
          ) : (
            <CardBody className="space-y-3">
              {intakes.map(({ intake, unitName, accessories, conditions, mediaCount }) => (
                <div key={intake.id} className="rounded-md border border-ink-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-ink-900">
                      {formatter.format(intake.receivedAt)}
                    </p>
                    {/* A unidade do recebimento e historica: nao muda quando a
                        pessoa troca de unidade ativa depois. */}
                    <Badge tone="brand">{unitName ?? 'Unidade removida'}</Badge>
                  </div>

                  <dl className="mt-3 grid gap-3 text-ui sm:grid-cols-2">
                    <div>
                      <dt className="text-small text-ink-500">Cabo de forca</dt>
                      <dd className="text-ink-800">{POWER_CABLE_LABEL[intake.powerCable]}</dd>
                    </div>
                    <div>
                      <dt className="text-small text-ink-500">Fotos</dt>
                      <dd className="text-ink-800">{mediaCount}</dd>
                    </div>
                  </dl>

                  {accessories.length > 0 ? (
                    <div className="mt-3">
                      <p className="text-small text-ink-500">Acessorios entregues</p>
                      <ul className="mt-1 flex flex-wrap gap-2">
                        {accessories.map((accessory) => (
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

                  {conditions.length > 0 ? (
                    <div className="mt-3">
                      <p className="text-small text-ink-500">Estado na entrada</p>
                      <ul className="mt-1 flex flex-wrap gap-2">
                        {conditions.map((condition) => (
                          <li key={condition.id}>
                            <Badge tone="warning">{conditionLabel(condition.conditionKey)}</Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {intake.inspectionNotes ? (
                    <p className="mt-3 whitespace-pre-wrap text-ui text-ink-700">
                      {intake.inspectionNotes}
                    </p>
                  ) : null}

                  {/*
                    CRIAR ORDEM DE SERVICO (Prompt 07, item 31).
                    Quando ja existe uma ordem para este recebimento, o atalho
                    leva ate ela em vez de oferecer abrir outra — um recebimento
                    origina uma OS principal (item 33).
                  */}
                  {ordersByIntake.has(intake.id) ? (
                    <Link
                      href={`/ordens-de-servico/${ordersByIntake.get(intake.id)!.id}`}
                      className="touch-target mt-3 inline-flex items-center text-ui font-semibold text-brand-600 hover:underline md:min-h-0"
                    >
                      Abrir a {formatServiceOrderNumber(ordersByIntake.get(intake.id)!.number)}
                    </Link>
                  ) : serviceOrderAccess.allowed ? (
                    <Link
                      href={`/ordens-de-servico/nova?equipamento=${item.id}&recebimento=${intake.id}`}
                      className={`${linkButtonClass('secondary', 'sm')} mt-3`}
                    >
                      Criar Ordem de Servico
                    </Link>
                  ) : null}
                </div>
              ))}
            </CardBody>
          )}
        </Card>
      </Section>
    </div>
  );
}

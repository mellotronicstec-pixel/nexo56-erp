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
import { IconCamera, IconIntake } from '@/design-system/icons';
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
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { MediaManager } from './media-manager';
import { removeMediaAction, uploadMediaAction } from '../actions';

export const metadata: Metadata = { title: 'Equipamento' };

/**
 * Ficha do equipamento (Prompt 06, itens 52 e 80).
 *
 * Mostra o que EXISTE: identificacao, dono, fotos e o historico real de
 * recebimentos. Nao ha aba de Ordens de Servico, garantias ou pecas — esses
 * modulos ainda nao existem, e aba que nao leva a lugar nenhum e pior do que
 * a ausencia dela (item 52).
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
                </div>
              ))}
            </CardBody>
          )}
        </Card>
      </Section>
    </div>
  );
}

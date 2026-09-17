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
import { IconEquipment, IconPlus } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { listRecentAuditForEntity } from '@/modules/audit/application/audit-queries';
import { findCustomerDetail } from '@/modules/customers/application/customer-queries';
import {
  CONTACT_TYPE_LABEL,
  CUSTOMER_KIND_LABEL,
  CUSTOMER_STATUS_LABEL,
  displayDocument,
  displayName,
} from '@/modules/customers/domain/customer';
import { formatPhone } from '@/core/contact/phone';
import { listEquipmentByCustomer } from '@/modules/equipment/application/equipment-queries';
import { equipmentTitle, VOLTAGE_LABEL } from '@/modules/equipment/domain/equipment';
import { checkAccess } from '@/modules/features/application/effective-access';
import { FEATURES } from '@/modules/features/domain/catalog';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { summarizeCustomerFinance } from '@/modules/finance/application/finance-queries';
import { FinanceSummaryCard } from '../../financeiro/finance-summary';
import { CustomerStatusActions } from './status-actions';
import { setCustomerStatusAction } from '../actions';

export const metadata: Metadata = { title: 'Cliente' };

/**
 * Ficha do cliente (Prompt 05, item 34).
 *
 * Mostra o que EXISTE: identificacao, contatos, endereco, observacoes e a
 * trilha de auditoria real. Nao ha aba vazia de Ordens de Servico, Equipamentos
 * ou Financeiro — esses modulos ainda nao existem, e uma aba prometendo algo
 * que nao chega e pior do que a ausencia dela (item 34).
 */
export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_CUSTOMERS,
    PERMISSIONS.CUSTOMERS_VIEW,
  );

  const { customerId } = await params;
  const detail = await findCustomerDetail(context, customerId);
  // ID de outra empresa e ID inexistente terminam no mesmo lugar.
  if (!detail) notFound();

  const { customer, contacts, addresses } = detail;
  const canManage = hasPermission(context, PERMISSIONS.CUSTOMERS_MANAGE);
  const canChangeStatus = hasPermission(context, PERMISSIONS.CUSTOMERS_CHANGE_STATUS);

  const name = displayName(customer);
  const document = displayDocument(customer);
  const address = addresses[0];

  const history = await listRecentAuditForEntity(context, 'customer', customer.id, 10);

  /**
   * Equipamentos do cliente (Prompt 06, item 79).
   *
   * A secao so aparece quando o modulo esta REALMENTE disponivel para esta
   * empresa e esta pessoa — Effective Access, nao "existe no codigo".
   */
  const equipmentAccess = await checkAccess(context, {
    featureKey: FEATURES.CORE_EQUIPMENT,
    permission: PERMISSIONS.EQUIPMENT_VIEW,
  });

  const equipmentList = equipmentAccess.allowed
    ? await listEquipmentByCustomer(context, customer.id)
    : [];

  const canManageEquipment = hasPermission(context, PERMISSIONS.EQUIPMENT_MANAGE);

  /**
   * Situacao financeira do cliente (Prompt 12, item 70).
   *
   * MOSTRA, NAO JULGA: nao ha score, limite nem bloqueio automatico. O
   * Financeiro e OPCIONAL, entao a secao so existe quando a empresa tem o
   * modulo e a pessoa tem `finance.view` — sem isso o cadastro continua
   * inteiro, como sempre foi.
   */
  const financeAccess = await checkAccess(context, {
    featureKey: FEATURES.FINANCE_CORE,
    permission: PERMISSIONS.FINANCE_VIEW,
  });

  const financeSummary = financeAccess.allowed
    ? await summarizeCustomerFinance(context, customer.id)
    : null;

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: context.tenantTimezone,
  });

  const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={name}
        eyebrow={CUSTOMER_KIND_LABEL[customer.kind]}
        breadcrumbs={[{ label: 'Clientes', href: '/clientes' }, { label: name }]}
        metadata={
          <>
            {document ? <span>{document}</span> : <span>Sem documento informado</span>}
            <span>Atualizado em {formatter.format(customer.updatedAt)}</span>
          </>
        }
        actions={
          canManage ? (
            <Link href={`/clientes/${customer.id}/editar`} className={linkButtonClass('secondary')}>
              Editar
            </Link>
          ) : null
        }
      />

      {customer.status === 'inactive' ? (
        <Alert tone="warning" title="Cliente inativo">
          Este cliente esta fora da operacao do dia a dia. O cadastro e o historico continuam
          preservados.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Identificacao" headingLevel={2} />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-small text-ink-500">
                  {customer.kind === 'company' ? 'Razao social' : 'Nome completo'}
                </dt>
                <dd className="font-medium text-ink-900">{customer.name}</dd>
              </div>

              {customer.kind === 'company' ? (
                <div>
                  <dt className="text-small text-ink-500">Nome fantasia</dt>
                  <dd className="text-ink-800">{customer.tradeName ?? '—'}</dd>
                </div>
              ) : null}

              <div>
                <dt className="text-small text-ink-500">
                  {customer.kind === 'company' ? 'CNPJ' : 'CPF'}
                </dt>
                <dd className="text-ink-800">{document ?? '—'}</dd>
              </div>

              {customer.kind === 'company' ? (
                <div>
                  <dt className="text-small text-ink-500">Inscricao estadual</dt>
                  <dd className="text-ink-800">{customer.stateRegistration ?? '—'}</dd>
                </div>
              ) : (
                <div>
                  <dt className="text-small text-ink-500">Data de nascimento</dt>
                  <dd className="text-ink-800">
                    {customer.birthDate
                      ? dateOnly.format(new Date(`${customer.birthDate}T00:00:00Z`))
                      : '—'}
                  </dd>
                </div>
              )}

              <div>
                <dt className="text-small text-ink-500">Situacao</dt>
                <dd>
                  <Badge tone={customer.status === 'active' ? 'success' : 'neutral'}>
                    {CUSTOMER_STATUS_LABEL[customer.status]}
                  </Badge>
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Acoes" headingLevel={2} />
          <CardBody className="space-y-3">
            {canChangeStatus ? (
              <CustomerStatusActions
                action={setCustomerStatusAction}
                customerId={customer.id}
                customerName={name}
                status={customer.status}
              />
            ) : (
              <p className="text-ui text-ink-500">
                Voce pode consultar este cliente, mas nao alterar a situacao dele.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <Section id="contatos" title="Contatos">
        <Card>
          <CardBody>
            <ul className="divide-y divide-ink-200">
              {contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">
                      {contact.type === 'phone' ? formatPhone(contact.value) : contact.value}
                    </p>
                    <p className="text-small text-ink-500">
                      {contact.label ?? CONTACT_TYPE_LABEL[contact.type]}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {contact.isPrimary ? <Badge tone="brand">principal</Badge> : null}
                    {contact.isWhatsapp ? <Badge tone="success">WhatsApp</Badge> : null}
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </Section>

      {address ? (
        <Section id="endereco" title="Endereco">
          <Card>
            <CardBody className="text-ui text-ink-800">
              <p>
                {[address.street, address.number].filter(Boolean).join(', ') || '—'}
                {address.complement ? ` · ${address.complement}` : ''}
              </p>
              <p className="text-ink-600">
                {[address.district, address.city, address.state].filter(Boolean).join(' · ')}
              </p>
              {address.zipCode ? (
                <p className="text-small text-ink-500">CEP {address.zipCode}</p>
              ) : null}
            </CardBody>
          </Card>
        </Section>
      ) : null}

      {customer.notes ? (
        <Section id="observacoes" title="Observacoes internas">
          <Card>
            <CardHeader
              title="Uso interno"
              description="Este conteudo nunca e exibido ao cliente."
              headingLevel={3}
            />
            {/*
              `whitespace-pre-wrap` preserva as quebras de linha digitadas.
              O texto entra como TEXTO — React escapa o conteudo, entao nao ha
              caminho que interprete HTML aqui (item 17).
            */}
            <CardBody>
              <p className="whitespace-pre-wrap text-ui text-ink-800">{customer.notes}</p>
            </CardBody>
          </Card>
        </Section>
      ) : null}

      {equipmentAccess.allowed ? (
        <Section
          id="equipamentos"
          title="Equipamentos"
          description="Aparelhos deste cliente. O cadastro vale para todas as unidades."
          actions={
            canManageEquipment ? (
              <Link
                href={`/equipamentos/novo?cliente=${customer.id}`}
                className={linkButtonClass('secondary', 'sm')}
              >
                <IconPlus size={16} />
                Novo equipamento
              </Link>
            ) : null
          }
        >
          <Card>
            {equipmentList.length === 0 ? (
              <EmptyState
                icon={<IconEquipment />}
                title="Nenhum equipamento"
                description="Este cliente ainda nao tem aparelhos cadastrados."
              />
            ) : (
              <CardBody>
                <ul className="divide-y divide-ink-200">
                  {equipmentList.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900">{equipmentTitle(item)}</p>
                        <p className="text-small text-ink-500">
                          {item.kind}
                          {item.serial ? ` · Serie ${item.serial}` : ''} ·{' '}
                          {VOLTAGE_LABEL[item.voltage]}
                        </p>
                      </div>
                      <Link
                        href={`/equipamentos/${item.id}`}
                        className="touch-target inline-flex items-center text-ui font-semibold text-brand-600 hover:underline md:min-h-0"
                      >
                        Abrir
                        <span className="sr-only"> a ficha de {equipmentTitle(item)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            )}
          </Card>
        </Section>
      ) : null}

      {financeSummary ? (
        <Section
          id="financeiro"
          title="Financeiro"
          description="O que este cliente deve a loja, nas unidades que voce acessa."
        >
          <FinanceSummaryCard
            title="Situacao financeira"
            description="Cobrancas deste cliente. O sistema mostra a situacao; quem decide atender e voce."
            summary={financeSummary}
            emptyText="Nenhuma cobranca registrada para este cliente."
          />
        </Section>
      ) : null}

      <Section id="historico" title="Historico" description="Trilha de auditoria deste cadastro.">
        <Card>
          <CardBody>
            {history.length === 0 ? (
              <p className="text-ui text-ink-500">Nenhum registro ainda.</p>
            ) : (
              <ul className="divide-y divide-ink-200">
                {history.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap gap-x-3 py-2 first:pt-0 last:pb-0">
                    <span className="font-mono text-small text-ink-900">{entry.action}</span>
                    <span className="text-small text-ink-500">
                      {formatter.format(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

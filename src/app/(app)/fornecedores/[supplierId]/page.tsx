import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { IconSupplier } from '@/design-system/icons';
import { formatPhone } from '@/core/contact/phone';
import {
  formatDocument,
  inferDocumentType,
  type DocumentType,
} from '@/core/document/brazilian-document';
import { formatBRL } from '@/core/money/format';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { findSupplierDetail } from '@/modules/purchasing/application/purchasing-queries';
import {
  formatPurchaseOrderNumber,
  purchaseOrderStatusLabel,
  purchaseOrderStatusTone,
  SUPPLIER_KIND_LABEL,
  supplierStatusLabel,
  type SupplierKind,
} from '@/modules/purchasing/domain/purchasing';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { changeSupplierStatusAction, updateSupplierAction } from '../../compras/actions';
import { SupplierForm } from '../supplier-form';
import { SupplierStatusForm } from './supplier-status';

interface PageProps {
  params: Promise<{ supplierId: string }>;
}

export const metadata: Metadata = { title: 'Fornecedor' };

const CONTACT_ROLE_LABEL: Record<string, string> = {
  commercial: 'Comercial',
  financial: 'Financeiro',
  other: 'Outro',
};

function documento(type: string | null, digits: string | null): string | null {
  if (!digits) return null;
  const kind = (type as DocumentType | null) ?? inferDocumentType(digits);
  return kind ? formatDocument(kind, digits) : digits;
}

function enderecoEmUmaLinha(supplier: {
  street: string | null;
  addressNumber: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
}): string | null {
  const partes = [
    [supplier.street, supplier.addressNumber].filter(Boolean).join(', '),
    supplier.district,
    [supplier.city, supplier.state].filter(Boolean).join(' - '),
  ].filter((parte) => parte && parte.length > 0);

  return partes.length > 0 ? partes.join(' · ') : null;
}

const dataCurta = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

/**
 * Ficha do fornecedor (Prompt 11, itens 6, 7 e 65).
 *
 * A ficha responde tres perguntas de uma vez: quem e a empresa, o que ja se
 * comprou dela, e por quanto. O historico de precos vive na peca; aqui fica o
 * ULTIMO custo por peca — que e conveniencia de tela e nao autoridade de
 * preco, e a legenda da tabela diz isso.
 *
 * OS PEDIDOS LISTADOS SAO SO OS DAS UNIDADES QUE A PESSOA OPERA. O fornecedor
 * e da empresa, mas o pedido tem dono: a loja que vai receber a mercadoria.
 */
export default async function SupplierPage({ params }: PageProps) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_PURCHASING,
    PERMISSIONS.SUPPLIERS_VIEW,
  );

  const { supplierId } = await params;
  const detail = await findSupplierDetail(context, supplierId);
  if (!detail) notFound();

  const { supplier, contacts, catalog, orders } = detail;
  const canManage = hasPermission(context, PERMISSIONS.SUPPLIERS_MANAGE);
  const documentoFormatado = documento(supplier.documentType, supplier.documentDigits);
  const endereco = enderecoEmUmaLinha(supplier);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={supplier.name}
        description={supplier.tradeName ?? SUPPLIER_KIND_LABEL[supplier.kind as SupplierKind]}
        breadcrumbs={[{ label: 'Fornecedores', href: '/fornecedores' }, { label: supplier.name }]}
        metadata={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={supplier.status === 'active' ? 'success' : 'neutral'}>
              {supplierStatusLabel(supplier.status)}
            </Badge>
            {documentoFormatado ? <span>{documentoFormatado}</span> : null}
          </div>
        }
      />

      <Card>
        <CardHeader title="Dados comerciais" headingLevel={2} />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-small text-ink-500">Telefone</dt>
              <dd className="text-ui text-ink-900">
                {supplier.phone ? formatPhone(supplier.phone) : '—'}
                {supplier.phoneIsWhatsapp ? (
                  <span className="ml-2 text-small text-ink-500">(tem WhatsApp)</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">E-mail</dt>
              <dd className="text-ui text-ink-900">{supplier.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Site</dt>
              <dd className="text-ui text-ink-900">{supplier.website ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Prazo prometido</dt>
              <dd className="text-ui text-ink-900">
                {supplier.leadTimeDays === null
                  ? '—'
                  : `${supplier.leadTimeDays} dia(s) — informado pelo fornecedor`}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-small text-ink-500">Endereco</dt>
              <dd className="text-ui text-ink-900">{endereco ?? '—'}</dd>
            </div>
            {supplier.commercialTerms ? (
              <div className="sm:col-span-2">
                <dt className="text-small text-ink-500">Condicoes comerciais</dt>
                <dd className="text-ui whitespace-pre-line text-ink-900">
                  {supplier.commercialTerms}
                </dd>
              </div>
            ) : null}
          </dl>

          {canManage ? (
            <div className="mt-6 border-t border-ink-200 pt-4">
              <SupplierStatusForm
                supplierId={supplier.id}
                status={supplier.status}
                action={changeSupplierStatusAction}
              />
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Contatos"
          description="As pessoas com quem se fala nesta empresa."
          headingLevel={2}
        />
        {contacts.length === 0 ? (
          <EmptyState
            icon={<IconSupplier />}
            title="Nenhum contato cadastrado"
            description="Sem contato registrado, a compra depende de quem lembrar o telefone do vendedor."
          />
        ) : (
          <CardBody className="p-0">
            <Table caption="Contatos do fornecedor">
              <THead>
                <TR>
                  <TH>Nome</TH>
                  <TH>Papel</TH>
                  <TH>Telefone</TH>
                  <TH>E-mail</TH>
                </TR>
              </THead>
              <TBody>
                {contacts.map((contact) => (
                  <TR key={contact.id}>
                    <TD className="font-medium text-ink-900">{contact.name}</TD>
                    <TD>{CONTACT_ROLE_LABEL[contact.role] ?? contact.role}</TD>
                    <TD>{contact.phone ? formatPhone(contact.phone) : '—'}</TD>
                    <TD>{contact.email ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Pecas ja compradas deste fornecedor"
          description="O ultimo custo pago serve para acelerar o proximo pedido. Quem responde 'como o custo evoluiu' e o historico na ficha da peca."
          headingLevel={2}
        />
        {catalog.length === 0 ? (
          <EmptyState
            icon={<IconSupplier />}
            title="Nenhuma peca comprada ainda"
            description="Assim que o primeiro recebimento acontecer, as pecas aparecem aqui com o custo pago."
          />
        ) : (
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <Table caption="Pecas compradas deste fornecedor, com o ultimo custo pago">
                <THead>
                  <TR>
                    <TH>Peca</TH>
                    <TH>Codigo no fornecedor</TH>
                    <TH align="right">Ultimo custo</TH>
                    <TH>Ultima compra</TH>
                  </TR>
                </THead>
                <TBody>
                  {catalog.map((row) => (
                    <TR key={row.id}>
                      <TD className="font-medium text-ink-900">
                        <Link
                          href={`/estoque/${row.partId}`}
                          className="text-brand-600 hover:underline"
                        >
                          {row.partName}
                        </Link>
                        <span className="block text-small font-normal text-ink-500">
                          {row.partCode}
                        </span>
                      </TD>
                      <TD>{row.supplierCode ?? '—'}</TD>
                      <TD align="right">{row.lastUnitCost ? formatBRL(row.lastUnitCost) : '—'}</TD>
                      <TD>{row.lastPurchasedAt ? dataCurta.format(row.lastPurchasedAt) : '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Pedidos de compra"
          description="Apenas os pedidos das unidades que voce opera."
          headingLevel={2}
        />
        {orders.length === 0 ? (
          <EmptyState
            icon={<IconSupplier />}
            title="Nenhum pedido para este fornecedor"
            description="Os pedidos abertos para esta empresa aparecem aqui, com a situacao de cada um."
          />
        ) : (
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <Table caption="Pedidos de compra deste fornecedor">
                <THead>
                  <TR>
                    <TH>Pedido</TH>
                    <TH>Unidade</TH>
                    <TH>Situacao</TH>
                    <TH align="right">Total</TH>
                    <TH>Aberto em</TH>
                  </TR>
                </THead>
                <TBody>
                  {orders.map((order) => (
                    <TR key={order.id}>
                      <TD className="font-medium text-ink-900">
                        <Link
                          href={`/compras/${order.id}`}
                          className="text-brand-600 hover:underline"
                        >
                          {formatPurchaseOrderNumber(order.number)}
                        </Link>
                      </TD>
                      <TD>{order.unitName}</TD>
                      <TD>
                        <Badge tone={purchaseOrderStatusTone(order.status)}>
                          {purchaseOrderStatusLabel(order.status)}
                        </Badge>
                      </TD>
                      <TD align="right">{formatBRL(order.total)}</TD>
                      <TD>{dataCurta.format(order.createdAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </CardBody>
        )}
      </Card>

      {canManage ? (
        <section className="space-y-4">
          <h2 className="text-h3 font-semibold text-ink-900">Editar cadastro</h2>
          <SupplierForm
            action={updateSupplierAction}
            submitLabel="Salvar alteracoes"
            values={{
              id: supplier.id,
              kind: supplier.kind,
              name: supplier.name,
              tradeName: supplier.tradeName ?? '',
              document: documentoFormatado ?? '',
              stateRegistration: supplier.stateRegistration ?? '',
              email: supplier.email ?? '',
              phone: supplier.phone ?? '',
              phoneIsWhatsapp: supplier.phoneIsWhatsapp === 1,
              website: supplier.website ?? '',
              zipCode: supplier.zipCode ?? '',
              street: supplier.street ?? '',
              addressNumber: supplier.addressNumber ?? '',
              complement: supplier.complement ?? '',
              district: supplier.district ?? '',
              city: supplier.city ?? '',
              state: supplier.state ?? '',
              leadTimeDays: supplier.leadTimeDays === null ? '' : String(supplier.leadTimeDays),
              commercialTerms: supplier.commercialTerms ?? '',
              notes: supplier.notes ?? '',
              contacts: contacts.map((contact) => ({
                role: contact.role,
                name: contact.name,
                email: contact.email ?? '',
                phone: contact.phone ?? '',
              })),
            }}
          />
        </section>
      ) : null}
    </div>
  );
}

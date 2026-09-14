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
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { IconPurchase } from '@/design-system/icons';
import { formatBRL, formatQuantity } from '@/core/money/format';
import { Quantity } from '@/core/quantity/quantity';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { searchPartsForPicker } from '@/modules/inventory/application/inventory-queries';
import { unitOfMeasureAbbreviation } from '@/modules/inventory/domain/inventory';
import {
  findPurchaseOrderDetail,
  listLocationsForUnit,
  listOpenNeedsForUnit,
} from '@/modules/purchasing/application/purchasing-queries';
import {
  formatPurchaseOrderNumber,
  formatQuantityValue,
  isPurchaseOrderEditable,
  isPurchaseOrderReceivable,
  purchaseOrderStatusLabel,
  purchaseOrderStatusTone,
  purchaseOrderTransitionsFrom,
  purchaseTimelineLabel,
} from '@/modules/purchasing/domain/purchasing';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import {
  receivePurchaseAction,
  savePurchaseDraftAction,
  transitionPurchaseOrderAction,
} from '../actions';
import { PurchaseDraftEditor } from './draft-editor';
import { PurchaseOrderWorkflow } from './order-workflow';
import { ReceivePanel } from './receive-panel';

interface PageProps {
  params: Promise<{ purchaseOrderId: string }>;
}

export const metadata: Metadata = { title: 'Pedido de compra' };

/**
 * Ficha do pedido de compra (Prompt 11, itens 16 a 26, 57 e 67).
 *
 * A TELA CONTA A HISTORIA NA ORDEM EM QUE ELA ACONTECE: o que se esta
 * comprando, em que situacao o pedido esta, o que ja chegou, e o que foi
 * acontecendo. Uma pessoa que abre este pedido daqui a seis meses precisa
 * entender sem perguntar a ninguem.
 *
 * ENQUANTO E RASCUNHO, o editor esta aberto. A PARTIR DE APROVADO, os itens e
 * os valores estao congelados — e a tela mostra a tabela em leitura, nao um
 * formulario desabilitado, porque campo cinza convida a tentar.
 */

const dataHora = (timezone: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: timezone });

function dataCivil(value: string | null): string {
  if (!value) return '—';
  const [ano, mes, dia] = value.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : value;
}

export default async function PurchaseOrderPage({ params }: PageProps) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_PURCHASING,
    PERMISSIONS.PURCHASES_VIEW,
  );

  const { purchaseOrderId } = await params;
  const detail = await findPurchaseOrderDetail(context, purchaseOrderId);
  if (!detail) notFound();

  const { order, supplier, unitName, items, timeline, receipts } = detail;

  const editavel = isPurchaseOrderEditable(order.status);
  const recebivel = isPurchaseOrderReceivable(order.status);

  const can = {
    update: hasPermission(context, PERMISSIONS.PURCHASES_UPDATE),
    approve: hasPermission(context, PERMISSIONS.PURCHASES_APPROVE),
    receive: hasPermission(context, PERMISSIONS.PURCHASES_RECEIVE),
    cancel: hasPermission(context, PERMISSIONS.PURCHASES_CANCEL),
  };

  const [partOptions, openNeeds, locations] = await Promise.all([
    editavel && can.update ? searchPartsForPicker(context, '', 100) : Promise.resolve([]),
    editavel && can.update ? listOpenNeedsForUnit(context, order.unitId) : Promise.resolve([]),
    recebivel && can.receive ? listLocationsForUnit(context, order.unitId) : Promise.resolve([]),
  ]);

  /**
   * As transicoes vem da matriz do dominio e sao filtradas pela permissao que
   * cada uma exige. O servidor confere de novo: o que aparece aqui e apenas o
   * que a pessoa efetivamente consegue fazer.
   */
  const transitions = purchaseOrderTransitionsFrom(order.status)
    .filter((rule) => hasPermission(context, rule.permission))
    .map((rule) => ({
      to: rule.to,
      label: rule.label,
      description: rule.hint ?? '',
      requiresReason: rule.requiresReason ?? false,
    }));

  const formatador = dataHora(context.tenantTimezone);
  const numero = formatPurchaseOrderNumber(order.number);

  const linhasRecebiveis = items.map((item) => {
    const pending = Quantity.parse(item.quantity).subtract(Quantity.parse(item.receivedQuantity));
    return {
      itemId: item.id,
      description: item.description,
      unitOfMeasure: unitOfMeasureAbbreviation(item.unitOfMeasure),
      ordered: formatQuantityValue(Quantity.parse(item.quantity)),
      received: formatQuantityValue(Quantity.parse(item.receivedQuantity)),
      pending: formatQuantityValue(pending),
    };
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={`Pedido ${numero}`}
        description={`${supplier?.name ?? 'Fornecedor removido'} · unidade ${unitName ?? '—'}`}
        breadcrumbs={[{ label: 'Compras', href: '/compras' }, { label: numero }]}
        metadata={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={purchaseOrderStatusTone(order.status)}>
              {purchaseOrderStatusLabel(order.status)}
            </Badge>
            <span>Total {formatBRL(order.total)}</span>
            <span>Previsao {dataCivil(order.expectedAt)}</span>
          </div>
        }
        actions={
          supplier ? (
            <Link
              href={`/fornecedores/${supplier.id}`}
              className="text-ui font-semibold text-brand-600 hover:underline"
            >
              Ver fornecedor
            </Link>
          ) : null
        }
      />

      {order.status === 'draft' ? (
        <Alert tone="info">
          Este pedido e um rascunho. Nada foi enviado ao fornecedor e o estoque nao mudou. Aprovar
          registra a autorizacao da despesa; o estoque so sobe quando a mercadoria chegar.
        </Alert>
      ) : null}

      {order.status === 'cancelled' ? (
        <Alert tone="warning">
          Pedido cancelado{order.cancelReason ? `: ${order.cancelReason}` : '.'} O que ja havia sido
          recebido continua no estoque — cancelar um pedido nao devolve mercadoria.
        </Alert>
      ) : null}

      <PurchaseOrderWorkflow
        purchaseOrderId={order.id}
        transitions={transitions}
        action={transitionPurchaseOrderAction}
      />

      {editavel && can.update ? (
        <PurchaseDraftEditor
          purchaseOrderId={order.id}
          initialItems={items.map((item) => ({
            partId: item.partId,
            quantity: formatQuantity(item.quantity),
            unitCost: item.unitCost,
            supplierCode: item.supplierCode ?? '',
            purchaseNeedId: item.purchaseNeedId ?? '',
          }))}
          initialDiscount={order.discount}
          initialFreight={order.freight}
          initialOtherCosts={order.otherCosts}
          initialExpectedAt={order.expectedAt ?? ''}
          initialInternalNotes={order.internalNotes ?? ''}
          initialSupplierNotes={order.supplierNotes ?? ''}
          parts={partOptions.map((part) => ({
            id: part.id,
            code: part.code,
            name: part.name,
            unitOfMeasure: part.unitOfMeasure,
          }))}
          needs={openNeeds.map((need) => ({
            id: need.id,
            partId: need.partId,
            label: `${need.partCode} — falta ${formatQuantityValue(
              Quantity.parse(need.quantity).subtract(Quantity.parse(need.orderedQuantity)),
            )}`,
          }))}
          action={savePurchaseDraftAction}
        />
      ) : (
        <Card>
          <CardHeader
            title="Itens do pedido"
            description="Os itens e os valores estao congelados: eles registram o que foi combinado com o fornecedor."
            headingLevel={2}
          />
          {items.length === 0 ? (
            <EmptyState
              icon={<IconPurchase />}
              title="Pedido sem itens"
              description="Nenhum item foi incluido neste pedido."
            />
          ) : (
            <CardBody className="p-0">
              <Table caption="Itens deste pedido de compra">
                <THead>
                  <TR>
                    <TH>Peca</TH>
                    <TH align="right">Pedido</TH>
                    <TH align="right">Recebido</TH>
                    <TH align="right">Custo unitario</TH>
                    <TH align="right">Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((item) => (
                    <TR key={item.id}>
                      <TD className="font-medium text-ink-900">
                        <Link
                          href={`/estoque/${item.partId}`}
                          className="text-brand-600 hover:underline"
                        >
                          {item.description}
                        </Link>
                        {item.supplierCode ? (
                          <span className="block text-small font-normal text-ink-500">
                            Codigo no fornecedor: {item.supplierCode}
                          </span>
                        ) : null}
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {formatQuantityValue(Quantity.parse(item.quantity))}{' '}
                        {unitOfMeasureAbbreviation(item.unitOfMeasure)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {formatQuantityValue(Quantity.parse(item.receivedQuantity))}{' '}
                        {unitOfMeasureAbbreviation(item.unitOfMeasure)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {formatBRL(item.unitCost)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {formatBRL(item.total)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>

              <div className="border-t border-ink-200 p-4">
                {/*
                  LARGURA EM REM, e nao `max-w-xs`.

                  O tema do Nexo56 define `--spacing-xs: 0.5rem`, e no Tailwind
                  v4 isso faz `max-w-xs` valer 8px — a coluna de totais virava
                  uma tira de oito pixels que transbordava a pagina inteira no
                  tablet. A medida explicita nao depende da escala de espaco.
                */}
                <dl className="w-full space-y-1 text-ui sm:ml-auto sm:max-w-[20rem]">
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Subtotal</dt>
                    <dd className="text-ink-900">{formatBRL(order.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Desconto</dt>
                    <dd className="text-ink-900">- {formatBRL(order.discount)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Frete</dt>
                    <dd className="text-ink-900">{formatBRL(order.freight)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Outros custos</dt>
                    <dd className="text-ink-900">{formatBRL(order.otherCosts)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-ink-200 pt-1">
                    <dt className="font-semibold text-ink-900">Total</dt>
                    <dd className="font-semibold text-ink-900">{formatBRL(order.total)}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-right text-small text-ink-500">
                  Frete e outros custos entram no total do pedido, e nao no custo de cada peca.
                </p>
              </div>
            </CardBody>
          )}
        </Card>
      )}

      {recebivel && can.receive ? (
        <ReceivePanel
          purchaseOrderId={order.id}
          lines={linhasRecebiveis}
          locations={locations}
          action={receivePurchaseAction}
        />
      ) : null}

      <Card>
        <CardHeader
          title="Recebimentos"
          description="Cada chegada de mercadoria virou uma entrada de estoque nesta unidade. Nao existe apagar recebimento: a correcao e um ajuste de estoque, com motivo."
          headingLevel={2}
        />
        {receipts.length === 0 ? (
          <EmptyState
            icon={<IconPurchase />}
            title="Nada recebido ainda"
            description="Enquanto a mercadoria nao chega, o estoque nao muda. E assim que deve ser."
          />
        ) : (
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <Table caption="Recebimentos deste pedido">
                <THead>
                  <TR>
                    <TH>Quando</TH>
                    <TH>Nota</TH>
                    <TH>Quem registrou</TH>
                    <TH>Observacoes</TH>
                  </TR>
                </THead>
                <TBody>
                  {receipts.map((receipt) => (
                    <TR key={receipt.id}>
                      <TD className="whitespace-nowrap">{formatador.format(receipt.receivedAt)}</TD>
                      <TD>{receipt.documentNumber ?? '—'}</TD>
                      <TD>{receipt.actorName ?? '—'}</TD>
                      <TD>{receipt.notes ?? '—'}</TD>
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
          title="Historico"
          description="O que aconteceu com este pedido, na ordem em que aconteceu."
          headingLevel={2}
        />
        {timeline.length === 0 ? (
          <EmptyState
            icon={<IconPurchase />}
            title="Sem historico"
            description="Nenhum evento registrado para este pedido."
          />
        ) : (
          <CardBody>
            <ol className="space-y-4">
              {timeline.map((entry) => (
                <li key={entry.id} className="border-l-2 border-ink-200 pl-4">
                  <p className="text-ui font-medium text-ink-900">
                    {purchaseTimelineLabel(entry.kind)}
                  </p>
                  {entry.summary ? (
                    <p className="text-small text-ink-700">{entry.summary}</p>
                  ) : null}
                  {entry.reason ? (
                    <p className="text-small text-ink-700">Motivo: {entry.reason}</p>
                  ) : null}
                  <p className="text-small text-ink-500">
                    {formatador.format(entry.occurredAt)}
                    {entry.actorName ? ` · ${entry.actorName}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </CardBody>
        )}
      </Card>
    </div>
  );
}

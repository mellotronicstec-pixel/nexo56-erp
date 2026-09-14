import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  MetricCard,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { formatBRL } from '@/core/money/format';
import { Quantity } from '@/core/quantity/quantity';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  listLocations,
  listMovements,
  listReservationsForPart,
  listUnitBalances,
} from '@/modules/inventory/application/inventory-queries';
import { loadPart } from '@/modules/inventory/application/part-service';
import {
  formatQuantityValue,
  isBelowMinimum,
  movementOriginLabel,
  movementTypeLabel,
  PART_STATUS_LABEL,
  unitOfMeasureAbbreviation,
  unitOfMeasureLabel,
} from '@/modules/inventory/domain/inventory';
import { can as decide } from '@/modules/access-control/application/authorization-service';
import { listPriceHistoryForPart } from '@/modules/purchasing/application/purchasing-queries';
import { formatPurchaseOrderNumber } from '@/modules/purchasing/domain/purchasing';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import {
  adjustStockAction,
  issueStockAction,
  receiveStockAction,
  setMinimumQuantityAction,
  transferStockAction,
} from '../actions';
import { StockOperations } from './stock-operations';

interface PageProps {
  params: Promise<{ partId: string }>;
}

export const metadata: Metadata = { title: 'Peca' };

/**
 * Ficha da peca (Prompt 10, itens 68 e 100).
 *
 * A FICHA JUNTA O QUE E DA EMPRESA COM O QUE E DA UNIDADE: a identificacao vem
 * do catalogo (tenant); saldo, reservas, localizacao e movimentacoes vem da
 * unidade ativa. As demais unidades autorizadas aparecem em uma tabela a
 * parte — e a pergunta real do balcao: "tem essa peca em alguma loja nossa?".
 */
function q(value: string, unitOfMeasure: string): string {
  return `${formatQuantityValue(Quantity.parse(value))} ${unitOfMeasureAbbreviation(unitOfMeasure)}`;
}

export default async function PartPage({ params }: PageProps) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_INVENTORY,
    PERMISSIONS.INVENTORY_VIEW,
  );

  const { partId } = await params;

  const part = await loadPart(context, partId).catch(() => null);
  if (!part) notFound();

  const activeUnitId = context.activeUnitId;

  const [unitBalances, movements, reservations, locations] = await Promise.all([
    listUnitBalances(context, partId),
    activeUnitId
      ? listMovements(context, activeUnitId, partId, { limit: 25 })
      : Promise.resolve([]),
    activeUnitId ? listReservationsForPart(context, activeUnitId, partId) : Promise.resolve([]),
    activeUnitId ? listLocations(context, activeUnitId) : Promise.resolve([]),
  ]);

  const current = unitBalances.find((balance) => balance.unitId === activeUnitId) ?? null;
  const others = unitBalances.filter((balance) => balance.unitId !== activeUnitId);

  const zero = Quantity.zero();
  const onHand = current ? Quantity.parse(current.onHand) : zero;
  const reserved = current ? Quantity.parse(current.reserved) : zero;
  const minimum = current ? Quantity.parse(current.minimumQuantity) : zero;
  const belowMinimum = isBelowMinimum({ onHand, reserved }, minimum);

  /**
   * HISTORICO DE PRECO PAGO — so quando Compras existe (Prompt 11, itens 28 e
   * 80).
   *
   * Compras e modulo OPCIONAL: quando esta desligado, ou a pessoa nao tem
   * `purchases.view`, a secao simplesmente nao aparece e a ficha da peca
   * continua inteira. O Estoque nao depende de Compras para nada.
   */
  const podeVerCompras = await decide(context, {
    permission: PERMISSIONS.PURCHASES_VIEW,
    featureKey: FEATURES.OPERATIONS_PURCHASING,
  });

  const priceHistory = podeVerCompras.allowed
    ? await listPriceHistoryForPart(context, partId, 15)
    : [];

  const can = {
    receive: hasPermission(context, PERMISSIONS.INVENTORY_RECEIVE),
    issue: hasPermission(context, PERMISSIONS.INVENTORY_ISSUE),
    adjust: hasPermission(context, PERMISSIONS.INVENTORY_ADJUST),
    transfer: hasPermission(context, PERMISSIONS.INVENTORY_TRANSFER),
    minimum: hasPermission(context, PERMISSIONS.INVENTORY_CATALOG_MANAGE),
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={part.name}
        description={`${part.code}${part.brand ? ` · ${part.brand}` : ''}${
          part.partNumber ? ` · ref. ${part.partNumber}` : ''
        }`}
        breadcrumbs={[{ label: 'Estoque', href: '/estoque' }, { label: part.code }]}
        metadata={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={part.status === 'active' ? 'success' : 'neutral'}>
              {PART_STATUS_LABEL[part.status === 'active' ? 'active' : 'inactive']}
            </Badge>
            <span>{unitOfMeasureLabel(part.unitOfMeasure)}</span>
          </div>
        }
      />

      {part.status !== 'active' ? (
        <Alert tone="warning">
          Esta peca esta inativa. O historico e o saldo continuam registrados, mas ela nao aceita
          movimentacao nova nem aparece no seletor do orcamento.
        </Alert>
      ) : null}

      {!activeUnitId ? (
        <Alert tone="warning">Escolha uma unidade para ver o saldo e movimentar esta peca.</Alert>
      ) : null}

      {activeUnitId ? (
        <>
          <section aria-label="Saldo na unidade ativa" className="grid gap-4 sm:grid-cols-3">
            <MetricCard label="Saldo fisico" value={q(onHand.toString(), part.unitOfMeasure)} />
            <MetricCard label="Reservado" value={q(reserved.toString(), part.unitOfMeasure)} />
            <MetricCard
              label="Disponivel"
              value={q(onHand.subtract(reserved).toString(), part.unitOfMeasure)}
              hint={
                belowMinimum
                  ? `Abaixo do minimo de ${q(minimum.toString(), part.unitOfMeasure)}`
                  : minimum.isPositive()
                    ? `Minimo: ${q(minimum.toString(), part.unitOfMeasure)}`
                    : 'Sem estoque minimo definido'
              }
            />
          </section>

          {belowMinimum ? (
            <Alert tone="warning">
              O disponivel esta abaixo do estoque minimo desta unidade. Nenhum pedido de compra e
              criado automaticamente — o modulo de Compras ainda nao existe.
            </Alert>
          ) : null}

          <StockOperations
            partId={part.id}
            unitId={activeUnitId}
            unitName={
              unitBalances.find((balance) => balance.unitId === activeUnitId)?.unitName ??
              'esta unidade'
            }
            unitOfMeasureLabel={unitOfMeasureLabel(part.unitOfMeasure)}
            minimumQuantity={formatQuantityValue(minimum)}
            locations={locations.map((location) => ({ id: location.id, name: location.name }))}
            transferTargets={others.map((balance) => ({
              id: balance.unitId,
              name: balance.unitName,
            }))}
            can={can}
            actions={{
              receive: receiveStockAction,
              issue: issueStockAction,
              adjust: adjustStockAction,
              transfer: transferStockAction,
              minimum: setMinimumQuantityAction,
            }}
          />
        </>
      ) : null}

      {others.length > 0 ? (
        <Card>
          <CardHeader
            title="Outras unidades"
            description="Saldo desta peca nas unidades em que voce opera."
            headingLevel={2}
          />
          <CardBody className="p-0">
            <Table caption="Saldo por unidade">
              <THead>
                <TR>
                  <TH>Unidade</TH>
                  <TH align="right">Saldo</TH>
                  <TH align="right">Reservado</TH>
                  <TH align="right">Disponivel</TH>
                  <TH>Localizacao</TH>
                </TR>
              </THead>
              <TBody>
                {others.map((balance) => (
                  <TR key={balance.unitId}>
                    <TD className="font-medium text-ink-900">{balance.unitName}</TD>
                    <TD align="right">{q(balance.onHand, part.unitOfMeasure)}</TD>
                    <TD align="right">{q(balance.reserved, part.unitOfMeasure)}</TD>
                    <TD align="right">{q(balance.available, part.unitOfMeasure)}</TD>
                    <TD>{balance.locationName ?? <span className="text-ink-400">—</span>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      {reservations.length > 0 ? (
        <Card>
          <CardHeader
            title="Reservas abertas"
            description="Quantidade ja comprometida com Ordens de Servico desta unidade."
            headingLevel={2}
          />
          <CardBody className="p-0">
            <Table caption="Reservas abertas desta peca">
              <THead>
                <TR>
                  <TH>Ordem de Servico</TH>
                  <TH align="right">Reservado</TH>
                  <TH align="right">Consumido</TH>
                  <TH align="right">Em aberto</TH>
                </TR>
              </THead>
              <TBody>
                {reservations.map((reservation) => (
                  <TR key={reservation.id}>
                    <TD>
                      <Link
                        href={`/ordens-de-servico/${reservation.serviceOrderId}`}
                        className="font-semibold text-brand-600 hover:underline"
                      >
                        OS {String(reservation.serviceOrderNumber).padStart(6, '0')}
                      </Link>
                    </TD>
                    <TD align="right">{q(reservation.quantity, part.unitOfMeasure)}</TD>
                    <TD align="right">{q(reservation.consumedQuantity, part.unitOfMeasure)}</TD>
                    <TD align="right" className="font-medium text-ink-900">
                      {q(reservation.remaining, part.unitOfMeasure)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      {/*
        QUANTO SE PAGOU, DE QUEM, E QUANDO (Prompt 11, itens 7 e 28).
        Uma linha por recebimento, append-only: o preco anterior nunca e
        sobrescrito. E isto — e nao o "ultimo custo" do cadastro do
        fornecedor — que responde como o custo evoluiu.
      */}
      {podeVerCompras.allowed && priceHistory.length > 0 ? (
        <Card>
          <CardHeader
            title="Historico de precos de compra"
            description="Cada recebimento acrescenta uma linha. Nada aqui e reescrito quando o preco muda."
            headingLevel={2}
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <Table caption="Precos pagos nesta peca, por recebimento">
                <THead>
                  <TR>
                    <TH>Quando</TH>
                    <TH>Fornecedor</TH>
                    <TH>Pedido</TH>
                    <TH align="right">Quantidade</TH>
                    <TH align="right">Custo unitario</TH>
                    <TH align="right">Prazo real</TH>
                  </TR>
                </THead>
                <TBody>
                  {priceHistory.map((linha) => (
                    <TR key={linha.id}>
                      <TD className="whitespace-nowrap">
                        {linha.occurredAt.toLocaleDateString('pt-BR')}
                      </TD>
                      <TD>
                        <Link
                          href={`/fornecedores/${linha.supplierId}`}
                          className="font-semibold text-brand-600 hover:underline"
                        >
                          {linha.supplierName}
                        </Link>
                      </TD>
                      <TD className="whitespace-nowrap">
                        {formatPurchaseOrderNumber(linha.purchaseOrderNumber)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {q(linha.quantity, part.unitOfMeasure)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {formatBRL(linha.unitCost)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {linha.observedLeadTimeDays === null
                          ? '—'
                          : `${linha.observedLeadTimeDays} dia(s)`}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Movimentacoes"
          description="Historico real desta peca nesta unidade. Nenhum lancamento e editado ou apagado."
          headingLevel={2}
        />
        {movements.length === 0 ? (
          <EmptyState
            title="Nenhuma movimentacao"
            description="Assim que houver entrada, saida, ajuste ou transferencia, o historico aparece aqui."
          />
        ) : (
          <CardBody className="p-0">
            <div className="hidden md:block">
              <Table caption="Movimentacoes desta peca">
                <THead>
                  <TR>
                    <TH>Quando</TH>
                    <TH>Tipo</TH>
                    <TH align="right">Quantidade</TH>
                    <TH align="right">Saldo apos</TH>
                    <TH>Origem</TH>
                    <TH>Responsavel</TH>
                  </TR>
                </THead>
                <TBody>
                  {movements.map((movement) => (
                    <TR key={movement.id}>
                      <TD className="whitespace-nowrap">
                        {movement.occurredAt.toLocaleString('pt-BR')}
                      </TD>
                      <TD>{movementTypeLabel(movement.type)}</TD>
                      <TD align="right" className="whitespace-nowrap">
                        {q(movement.quantity, part.unitOfMeasure)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {q(movement.resultingOnHand, part.unitOfMeasure)}
                      </TD>
                      <TD>
                        {movement.serviceOrderNumber ? (
                          <Link
                            href={`/ordens-de-servico/${movement.serviceOrderId}`}
                            className="font-semibold text-brand-600 hover:underline"
                          >
                            OS {String(movement.serviceOrderNumber).padStart(6, '0')}
                          </Link>
                        ) : movement.originKind !== 'manual' && movement.reference ? (
                          /**
                           * "Compra PC 000037" sai do PROPRIO movimento, em
                           * texto (Prompt 11, item 50). O Estoque nao consulta
                           * tabela de Compras e nao tem FK para la: por isso a
                           * origem continua legivel mesmo com o modulo de
                           * Compras desligado.
                           */
                          <span>
                            {movementOriginLabel(movement.originKind)} {movement.reference}
                          </span>
                        ) : (
                          (movement.reference ??
                          movement.reason ?? <span className="text-ink-400">—</span>)
                        )}
                        {movement.totalCost ? (
                          <span className="block text-small text-ink-500">
                            {formatBRL(movement.totalCost)}
                          </span>
                        ) : null}
                      </TD>
                      <TD>{movement.actorName ?? <span className="text-ink-400">Sistema</span>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <CardList label="Movimentacoes desta peca" className="md:hidden">
              {movements.map((movement) => (
                <CardListItem key={movement.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">{movementTypeLabel(movement.type)}</p>
                      <p className="text-small text-ink-500">
                        {movement.occurredAt.toLocaleString('pt-BR')}
                      </p>
                      {movement.reason ? (
                        <p className="text-small text-ink-600">{movement.reason}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-medium text-ink-900">
                        {q(movement.quantity, part.unitOfMeasure)}
                      </p>
                      <p className="text-small text-ink-500">
                        saldo {q(movement.resultingOnHand, part.unitOfMeasure)}
                      </p>
                    </div>
                  </div>
                </CardListItem>
              ))}
            </CardList>
          </CardBody>
        )}
      </Card>
    </div>
  );
}

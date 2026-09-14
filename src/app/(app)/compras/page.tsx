import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardList,
  CardListItem,
  EmptyState,
  FilterBar,
  linkButtonClass,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { IconPlus, IconPurchase, IconSearch } from '@/design-system/icons';
import { formatBRL } from '@/core/money/format';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  listActiveSuppliers,
  listPurchaseOrders,
  type PurchaseOrderListFilters,
} from '@/modules/purchasing/application/purchasing-queries';
import {
  formatPurchaseOrderNumber,
  isKnownPurchaseOrderStatus,
  PURCHASE_ORDER_STATUSES,
  purchaseOrderStatusLabel,
  purchaseOrderStatusTone,
} from '@/modules/purchasing/domain/purchasing';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';

export const metadata: Metadata = { title: 'Compras' };

/**
 * Lista de pedidos de compra da UNIDADE ATIVA (Prompt 11, itens 3.2, 34 e 66).
 *
 * O PEDIDO TEM DONO: a unidade que vai receber a mercadoria. Somar os pedidos
 * de todas as lojas numa lista so responderia uma pergunta que ninguem faz —
 * quem esta no balcao quer saber o que chega AQUI.
 *
 * O ESTADO MORA NA URL: busca, situacao, fornecedor e pagina sao query string.
 */

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

const dataCurta = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

/** Data civil (AAAA-MM-DD) e dia de calendario, nao instante: nada de fuso. */
function dataCivil(value: string | null): string {
  if (!value) return '—';
  const [ano, mes, dia] = value.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : value;
}

export default async function PurchaseOrdersPage({ searchParams }: PageProps) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_PURCHASING,
    PERMISSIONS.PURCHASES_VIEW,
  );

  const params = await searchParams;
  const query = single(params.q);
  const status = single(params.situacao);
  const supplierId = single(params.fornecedor);
  const pageParam = Number(single(params.pagina) ?? '1');

  const filters: PurchaseOrderListFilters = {
    search: query,
    status: status && isKnownPurchaseOrderStatus(status) ? status : undefined,
    supplierId,
    page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
  };

  const [result, suppliers] = await Promise.all([
    listPurchaseOrders(context, filters),
    listActiveSuppliers(context),
  ]);

  const canCreate = hasPermission(context, PERMISSIONS.PURCHASES_CREATE);

  const hrefForPage = (page: number) => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (filters.status) next.set('situacao', filters.status);
    if (supplierId) next.set('fornecedor', supplierId);
    next.set('pagina', String(page));
    return `/compras?${next.toString()}`;
  };

  const appliedFilters = [
    query ? `busca: ${query}` : null,
    filters.status ? `situacao: ${purchaseOrderStatusLabel(filters.status)}` : null,
    supplierId ? `fornecedor: ${suppliers.find((s) => s.id === supplierId)?.name ?? '—'}` : null,
  ].filter((value): value is string => value !== null);

  const isFiltered = appliedFilters.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Compras"
        description="Pedidos de compra da unidade ativa. Comprar nao e receber: o estoque so muda quando a mercadoria chega."
        breadcrumbs={[{ label: 'Compras' }]}
        metadata={
          <span>
            {result.total} pedido(s){isFiltered ? ' encontrado(s)' : ' nesta unidade'}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/compras/necessidades" className={linkButtonClass('secondary')}>
              Necessidades
            </Link>
            {canCreate ? (
              <Link href="/compras/novo-pedido" className={linkButtonClass('primary')}>
                <IconPlus size={18} />
                Novo pedido
              </Link>
            ) : null}
          </div>
        }
      />

      {!context.activeUnitId ? (
        <Alert tone="warning">
          Escolha uma unidade para ver os pedidos. A mercadoria chega em um endereco, e o pedido
          pertence a loja que vai receber.
        </Alert>
      ) : null}

      <Card>
        <FilterBar
          action="/compras"
          applied={appliedFilters}
          onClearHref={isFiltered ? '/compras' : undefined}
        >
          <div className="sm:w-72">
            <SearchField
              id="busca-pedido"
              name="q"
              label="Buscar pedido"
              labelHidden={false}
              defaultValue={query ?? ''}
              placeholder="Numero do pedido, fornecedor ou nota"
            />
          </div>

          <div className="sm:w-52">
            <label
              htmlFor="filtro-situacao-pedido"
              className="mb-1.5 block text-ui font-medium text-ink-700"
            >
              Situacao
            </label>
            <Select id="filtro-situacao-pedido" name="situacao" defaultValue={filters.status ?? ''}>
              <option value="">Todas</option>
              {PURCHASE_ORDER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {purchaseOrderStatusLabel(value)}
                </option>
              ))}
            </Select>
          </div>

          {suppliers.length > 0 ? (
            <div className="sm:w-52">
              <label
                htmlFor="filtro-fornecedor"
                className="mb-1.5 block text-ui font-medium text-ink-700"
              >
                Fornecedor
              </label>
              <Select id="filtro-fornecedor" name="fornecedor" defaultValue={supplierId ?? ''}>
                <option value="">Todos</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <button type="submit" className={linkButtonClass('secondary', 'md', 'h-10')}>
            <IconSearch size={18} />
            Buscar
          </button>
        </FilterBar>

        {result.items.length === 0 ? (
          <EmptyState
            icon={isFiltered ? <IconSearch /> : <IconPurchase />}
            title={isFiltered ? 'Nenhum pedido encontrado' : 'Nenhum pedido nesta unidade'}
            description={
              isFiltered
                ? 'Nenhum pedido corresponde aos filtros aplicados. Limpe os filtros para ver todos.'
                : 'Abra o primeiro pedido de compra para esta unidade. Ele nasce como rascunho e nada acontece no estoque ate a mercadoria chegar.'
            }
            action={
              canCreate && !isFiltered ? (
                <Link href="/compras/novo-pedido" className={linkButtonClass('primary', 'sm')}>
                  Abrir pedido
                </Link>
              ) : null
            }
          />
        ) : (
          <CardBody className="p-0">
            <div className="hidden md:block">
              <Table caption="Pedidos de compra da unidade ativa">
                <THead>
                  <TR>
                    <TH>Pedido</TH>
                    <TH>Fornecedor</TH>
                    <TH align="right">Itens</TH>
                    <TH align="right">Total</TH>
                    <TH>Previsao</TH>
                    <TH>Situacao</TH>
                    <TH align="right" srOnly>
                      Acoes
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {result.items.map((item) => (
                    <TR key={item.id}>
                      <TD className="whitespace-nowrap font-medium text-ink-900">
                        {formatPurchaseOrderNumber(item.number)}
                        <span className="block text-small font-normal text-ink-500">
                          {dataCurta.format(item.createdAt)}
                        </span>
                      </TD>
                      <TD>{item.supplierName}</TD>
                      <TD align="right">{item.itemCount}</TD>
                      <TD align="right" className="whitespace-nowrap">
                        {formatBRL(item.total)}
                      </TD>
                      <TD className="whitespace-nowrap">{dataCivil(item.expectedAt)}</TD>
                      <TD>
                        <Badge tone={purchaseOrderStatusTone(item.status)}>
                          {purchaseOrderStatusLabel(item.status)}
                        </Badge>
                      </TD>
                      <TD align="right">
                        <Link
                          href={`/compras/${item.id}`}
                          className="text-ui font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          Abrir
                          <span className="sr-only">
                            {' '}
                            o pedido {formatPurchaseOrderNumber(item.number)}
                          </span>
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <CardList label="Pedidos de compra" className="md:hidden">
              {result.items.map((item) => (
                <CardListItem key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">
                        {formatPurchaseOrderNumber(item.number)}
                      </p>
                      <p className="truncate text-small text-ink-500">{item.supplierName}</p>
                    </div>
                    <Badge tone={purchaseOrderStatusTone(item.status)}>
                      {purchaseOrderStatusLabel(item.status)}
                    </Badge>
                  </div>

                  <dl className="mt-2 grid grid-cols-3 gap-2 text-small">
                    <div>
                      <dt className="text-ink-500">Itens</dt>
                      <dd className="font-medium text-ink-900">{item.itemCount}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Total</dt>
                      <dd className="font-medium text-ink-900">{formatBRL(item.total)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Previsao</dt>
                      <dd className="font-medium text-ink-900">{dataCivil(item.expectedAt)}</dd>
                    </div>
                  </dl>

                  <Link
                    href={`/compras/${item.id}`}
                    className="touch-target mt-2 inline-flex items-center text-ui font-semibold text-brand-600"
                  >
                    Abrir pedido
                    <span className="sr-only"> {formatPurchaseOrderNumber(item.number)}</span>
                  </Link>
                </CardListItem>
              ))}
            </CardList>

            <Pagination page={result.page} pageCount={result.totalPages} hrefFor={hrefForPage} />
          </CardBody>
        )}
      </Card>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
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
import { IconPurchase, IconSearch } from '@/design-system/icons';
import { Quantity } from '@/core/quantity/quantity';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { searchPartsForPicker } from '@/modules/inventory/application/inventory-queries';
import { findServiceOrderForNeed } from '@/modules/purchasing/application/purchasing-queries';
import { unitOfMeasureAbbreviation } from '@/modules/inventory/domain/inventory';
import {
  listLowStockSuggestions,
  listPurchaseNeeds,
  type NeedListFilters,
} from '@/modules/purchasing/application/purchasing-queries';
import {
  formatQuantityValue,
  NEED_STATUS_TONE,
  needOriginLabel,
  needStatusLabel,
  type NeedStatus,
} from '@/modules/purchasing/domain/purchasing';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { cancelPurchaseNeedAction, createPurchaseNeedAction } from '../actions';
import { CancelNeedForm, NewNeedForm } from './need-forms';

export const metadata: Metadata = { title: 'Necessidades de compra' };

/**
 * Necessidades de compra da UNIDADE ATIVA (Prompt 11, itens 8, 9, 32 e 33).
 *
 * NADA AQUI COMPRA SOZINHO. A tela SUGERE — mostra o que esta abaixo do minimo
 * na unidade — mas quem registra a necessidade e quem abre o pedido e uma
 * pessoa. O alerta de estoque baixo nao cria linha nenhuma; ele so aparece.
 *
 * "PEDIDO" NAO E "ATENDIDA": a necessidade so fecha quando a mercadoria chega.
 * E por isso que a tabela mostra as tres quantidades — precisa, pedido,
 * recebido — em vez de uma barra de progresso que esconde qual e qual.
 */

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

const STATUS_OPTIONS = ['open', 'ordered', 'fulfilled', 'cancelled'] as const;

function q(value: string, unitOfMeasure: string): string {
  return `${formatQuantityValue(Quantity.parse(value))} ${unitOfMeasureAbbreviation(unitOfMeasure)}`;
}

export default async function PurchaseNeedsPage({ searchParams }: PageProps) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_PURCHASING,
    PERMISSIONS.PURCHASES_VIEW,
  );

  const params = await searchParams;
  const query = single(params.q);
  const status = single(params.situacao);
  const pageParam = Number(single(params.pagina) ?? '1');
  const pecaSugerida = single(params.peca);
  const ordemOrigem = single(params.os);

  const filters: NeedListFilters = {
    search: query,
    status: status && (STATUS_OPTIONS as readonly string[]).includes(status) ? status : undefined,
    page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
  };

  const canCreate = hasPermission(context, PERMISSIONS.PURCHASES_CREATE);

  const [result, lowStock, partOptions, ordem] = await Promise.all([
    listPurchaseNeeds(context, filters),
    context.activeUnitId ? listLowStockSuggestions(context, 20) : Promise.resolve([]),
    canCreate ? searchPartsForPicker(context, '', 100) : Promise.resolve([]),
    /**
     * A OS so entra no formulario se ela existir E for da unidade ativa: a
     * necessidade e da unidade, e vincular a OS de outra loja seria mentira.
     * O servico recusa de qualquer forma — aqui a tela evita oferecer.
     */
    ordemOrigem ? findServiceOrderForNeed(context, ordemOrigem) : Promise.resolve(null),
  ]);

  const hrefForPage = (page: number) => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (filters.status) next.set('situacao', filters.status);
    next.set('pagina', String(page));
    return `/compras/necessidades?${next.toString()}`;
  };

  const appliedFilters = [
    query ? `busca: ${query}` : null,
    filters.status ? `situacao: ${needStatusLabel(filters.status)}` : null,
  ].filter((value): value is string => value !== null);

  const isFiltered = appliedFilters.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Necessidades de compra"
        description="O que falta nesta unidade. Registrar aqui nao compra nada: alguem precisa abrir o pedido."
        breadcrumbs={[{ label: 'Compras', href: '/compras' }, { label: 'Necessidades' }]}
        metadata={<span>{result.total} necessidade(s) nesta unidade</span>}
        actions={
          <Link href="/compras" className={linkButtonClass('secondary')}>
            Ver pedidos
          </Link>
        }
      />

      {!context.activeUnitId ? (
        <Alert tone="warning">
          Escolha uma unidade para ver as necessidades. O que falta na loja do centro nao e o que
          falta na loja norte.
        </Alert>
      ) : null}

      {lowStock.length > 0 ? (
        <Card>
          <CardHeader
            title="Sugestoes: pecas abaixo do minimo"
            description="O Nexo56 mostra o que esta faltando. Ele NAO registra necessidade nem abre pedido sozinho — quem decide comprar e voce."
            headingLevel={2}
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <Table caption="Pecas abaixo do estoque minimo nesta unidade">
                <THead>
                  <TR>
                    <TH>Peca</TH>
                    <TH align="right">Disponivel</TH>
                    <TH align="right">Minimo</TH>
                    <TH align="right" srOnly>
                      Acoes
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {lowStock.map((row) => {
                    const disponivel = Quantity.parse(row.onHand).subtract(
                      Quantity.parse(row.reserved),
                    );
                    return (
                      <TR key={row.partId}>
                        <TD className="font-medium text-ink-900">
                          {row.partName}
                          <span className="block text-small font-normal text-ink-500">
                            {row.partCode}
                          </span>
                        </TD>
                        <TD align="right" className="whitespace-nowrap">
                          {formatQuantityValue(disponivel)}{' '}
                          {unitOfMeasureAbbreviation(row.unitOfMeasure)}
                        </TD>
                        <TD align="right" className="whitespace-nowrap">
                          {q(row.minimumQuantity, row.unitOfMeasure)}
                        </TD>
                        <TD align="right">
                          {canCreate ? (
                            <Link
                              href={`/compras/necessidades?peca=${row.partId}#registrar`}
                              className="text-ui font-semibold text-brand-600 hover:underline"
                            >
                              Registrar
                              <span className="sr-only"> necessidade de {row.partName}</span>
                            </Link>
                          ) : null}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {canCreate && context.activeUnitId ? (
        <div id="registrar">
          <NewNeedForm
            action={createPurchaseNeedAction}
            unitId={context.activeUnitId}
            parts={partOptions.map((part) => ({
              id: part.id,
              code: part.code,
              name: part.name,
            }))}
            defaultPartId={pecaSugerida}
            serviceOrder={
              ordem && ordem.unitId === context.activeUnitId
                ? { id: ordem.id, label: `OS ${String(ordem.number).padStart(6, '0')}` }
                : undefined
            }
          />
        </div>
      ) : null}

      <Card>
        <FilterBar
          action="/compras/necessidades"
          applied={appliedFilters}
          onClearHref={isFiltered ? '/compras/necessidades' : undefined}
        >
          <div className="sm:w-72">
            <SearchField
              id="busca-necessidade"
              name="q"
              label="Buscar necessidade"
              labelHidden={false}
              defaultValue={query ?? ''}
              placeholder="Codigo ou nome da peca"
            />
          </div>

          <div className="sm:w-52">
            <label
              htmlFor="filtro-situacao-necessidade"
              className="mb-1.5 block text-ui font-medium text-ink-700"
            >
              Situacao
            </label>
            <Select
              id="filtro-situacao-necessidade"
              name="situacao"
              defaultValue={filters.status ?? ''}
            >
              <option value="">Todas</option>
              {STATUS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {needStatusLabel(value)}
                </option>
              ))}
            </Select>
          </div>

          <button type="submit" className={linkButtonClass('secondary', 'md', 'h-10')}>
            <IconSearch size={18} />
            Buscar
          </button>
        </FilterBar>

        {result.items.length === 0 ? (
          <EmptyState
            icon={isFiltered ? <IconSearch /> : <IconPurchase />}
            title={isFiltered ? 'Nenhuma necessidade encontrada' : 'Nenhuma necessidade registrada'}
            description={
              isFiltered
                ? 'Nenhuma necessidade corresponde aos filtros aplicados.'
                : 'Quando uma peca faltar, registre aqui. A lista alimenta o pedido de compra sem obrigar ninguem a comprar.'
            }
          />
        ) : (
          <CardBody className="p-0">
            <div className="hidden md:block">
              <Table caption="Necessidades de compra desta unidade">
                <THead>
                  <TR>
                    <TH>Peca</TH>
                    <TH align="right">Precisa</TH>
                    <TH align="right">Ja pedido</TH>
                    <TH align="right">Ja recebido</TH>
                    <TH>Origem</TH>
                    <TH>Situacao</TH>
                    <TH align="right" srOnly>
                      Acoes
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {result.items.map((item) => (
                    <TR key={item.id}>
                      <TD className="font-medium text-ink-900">
                        {item.partName}
                        <span className="block text-small font-normal text-ink-500">
                          {item.partCode}
                          {item.serviceOrderNumber
                            ? ` · OS ${String(item.serviceOrderNumber).padStart(6, '0')}`
                            : ''}
                        </span>
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {q(item.quantity, item.unitOfMeasure)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {q(item.orderedQuantity, item.unitOfMeasure)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {q(item.receivedQuantity, item.unitOfMeasure)}
                      </TD>
                      <TD>{needOriginLabel(item.origin)}</TD>
                      <TD>
                        <Badge tone={NEED_STATUS_TONE[item.status as NeedStatus] ?? 'neutral'}>
                          {needStatusLabel(item.status)}
                        </Badge>
                      </TD>
                      <TD align="right">
                        {canCreate &&
                        item.status !== 'cancelled' &&
                        Quantity.parse(item.receivedQuantity).isZero() ? (
                          <CancelNeedForm action={cancelPurchaseNeedAction} needId={item.id} />
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <CardList label="Necessidades de compra" className="md:hidden">
              {result.items.map((item) => (
                <CardListItem key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">{item.partName}</p>
                      <p className="truncate text-small text-ink-500">{item.partCode}</p>
                    </div>
                    <Badge tone={NEED_STATUS_TONE[item.status as NeedStatus] ?? 'neutral'}>
                      {needStatusLabel(item.status)}
                    </Badge>
                  </div>

                  <dl className="mt-2 grid grid-cols-3 gap-2 text-small">
                    <div>
                      <dt className="text-ink-500">Precisa</dt>
                      <dd className="font-medium text-ink-900">
                        {q(item.quantity, item.unitOfMeasure)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Pedido</dt>
                      <dd className="font-medium text-ink-900">
                        {q(item.orderedQuantity, item.unitOfMeasure)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Recebido</dt>
                      <dd className="font-medium text-ink-900">
                        {q(item.receivedQuantity, item.unitOfMeasure)}
                      </dd>
                    </div>
                  </dl>
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

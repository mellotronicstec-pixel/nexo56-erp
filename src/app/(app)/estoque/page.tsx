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
import { IconPlus, IconSearch, IconServiceOrder } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  listLocations,
  listParts,
  type PartListFilters,
} from '@/modules/inventory/application/inventory-queries';
import {
  formatQuantityValue,
  PART_STATUS_LABEL,
  unitOfMeasureAbbreviation,
} from '@/modules/inventory/domain/inventory';
import { Quantity } from '@/core/quantity/quantity';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';

export const metadata: Metadata = { title: 'Estoque e pecas' };

/**
 * Listagem de pecas com o saldo da UNIDADE ATIVA (Prompt 10, itens 92 a 99).
 *
 * O ESTADO MORA NA URL: busca, filtro e pagina sao query string. O botao
 * voltar funciona, recarregar nao perde nada, e o atendente manda o link
 * pronto para o colega.
 *
 * A PECA E DO TENANT, O SALDO E DA UNIDADE. Por isso a pagina exige unidade
 * ativa para mostrar numeros: somar o estoque de todas as lojas numa coluna so
 * responderia uma pergunta que ninguem faz no balcao.
 */

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

const FILTER_LABEL: Record<string, string> = {
  below_minimum: 'abaixo do minimo',
  without_stock: 'sem saldo',
  with_reservation: 'com reserva',
  active: 'ativas',
  inactive: 'inativas',
};

function quantidade(value: string, unitOfMeasure: string): string {
  return `${formatQuantityValue(Quantity.parse(value))} ${unitOfMeasureAbbreviation(unitOfMeasure)}`;
}

export default async function InventoryPage({ searchParams }: PageProps) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_INVENTORY,
    PERMISSIONS.INVENTORY_VIEW,
  );

  const params = await searchParams;
  const query = single(params.q);
  const filter = single(params.filtro);
  const locationId = single(params.localizacao);
  const pageParam = Number(single(params.pagina) ?? '1');

  const filters: PartListFilters = {
    search: query,
    filter: filter && filter in FILTER_LABEL ? filter : undefined,
    locationId,
    page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
  };

  const [result, locations] = await Promise.all([
    listParts(context, filters),
    context.activeUnitId ? listLocations(context, context.activeUnitId) : Promise.resolve([]),
  ]);

  const canManageCatalog = hasPermission(context, PERMISSIONS.INVENTORY_CATALOG_MANAGE);
  const canManageLocations = hasPermission(context, PERMISSIONS.INVENTORY_LOCATIONS_MANAGE);

  const hrefForPage = (page: number) => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (filters.filter) next.set('filtro', filters.filter);
    if (locationId) next.set('localizacao', locationId);
    next.set('pagina', String(page));
    return `/estoque?${next.toString()}`;
  };

  const appliedFilters = [
    query ? `busca: ${query}` : null,
    filters.filter ? `filtro: ${FILTER_LABEL[filters.filter]}` : null,
    locationId ? `localizacao: ${locations.find((l) => l.id === locationId)?.name ?? '—'}` : null,
  ].filter((value): value is string => value !== null);

  const isFiltered = appliedFilters.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Estoque e pecas"
        description="Catalogo da empresa com o saldo da unidade ativa. A peca e da empresa; a quantidade e de cada loja."
        breadcrumbs={[{ label: 'Estoque' }]}
        metadata={
          <span>
            {result.total} peca(s){isFiltered ? ' encontrada(s)' : ' no catalogo'}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {canManageLocations ? (
              <Link href="/estoque/localizacoes" className={linkButtonClass('secondary')}>
                Localizacoes
              </Link>
            ) : null}
            {canManageCatalog ? (
              <Link href="/estoque/nova-peca" className={linkButtonClass('primary')}>
                <IconPlus size={18} />
                Nova peca
              </Link>
            ) : null}
          </div>
        }
      />

      {!context.activeUnitId ? (
        <Alert tone="warning">
          Escolha uma unidade para ver o saldo. O catalogo de pecas e da empresa, mas a quantidade
          pertence a cada unidade.
        </Alert>
      ) : null}

      <Card>
        <FilterBar
          action="/estoque"
          applied={appliedFilters}
          onClearHref={isFiltered ? '/estoque' : undefined}
        >
          <div className="sm:w-80">
            <SearchField
              id="busca-peca"
              name="q"
              label="Buscar peca"
              labelHidden={false}
              defaultValue={query ?? ''}
              placeholder="Codigo, nome, fabricante, referencia ou codigo de barras"
            />
          </div>

          <div className="sm:w-52">
            <label
              htmlFor="filtro-estoque"
              className="mb-1.5 block text-ui font-medium text-ink-700"
            >
              Filtro
            </label>
            <Select id="filtro-estoque" name="filtro" defaultValue={filters.filter ?? ''}>
              <option value="">Todas</option>
              <option value="below_minimum">Abaixo do minimo</option>
              <option value="without_stock">Sem saldo</option>
              <option value="with_reservation">Com reserva</option>
              <option value="active">Ativas</option>
              <option value="inactive">Inativas</option>
            </Select>
          </div>

          {locations.length > 0 ? (
            <div className="sm:w-52">
              <label
                htmlFor="filtro-localizacao"
                className="mb-1.5 block text-ui font-medium text-ink-700"
              >
                Localizacao
              </label>
              <Select id="filtro-localizacao" name="localizacao" defaultValue={locationId ?? ''}>
                <option value="">Todas</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
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
            icon={isFiltered ? <IconSearch /> : <IconServiceOrder />}
            title={isFiltered ? 'Nenhuma peca encontrada' : 'Nenhuma peca cadastrada'}
            description={
              isFiltered
                ? 'Nenhuma peca corresponde aos filtros aplicados. Limpe os filtros para ver todas.'
                : 'Cadastre a primeira peca para comecar a controlar o estoque desta empresa.'
            }
            action={
              canManageCatalog && !isFiltered ? (
                <Link href="/estoque/nova-peca" className={linkButtonClass('primary', 'sm')}>
                  Cadastrar peca
                </Link>
              ) : null
            }
          />
        ) : (
          <CardBody className="p-0">
            <div className="hidden md:block">
              <Table caption="Pecas do catalogo com o saldo da unidade ativa">
                <THead>
                  <TR>
                    <TH>Peca</TH>
                    <TH align="right">Saldo</TH>
                    <TH align="right">Reservado</TH>
                    <TH align="right">Disponivel</TH>
                    <TH align="right">Minimo</TH>
                    <TH>Localizacao</TH>
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
                        {item.name}
                        <span className="block text-small font-normal text-ink-500">
                          {item.code}
                          {item.brand ? ` · ${item.brand}` : ''}
                          {item.partNumber ? ` · ref. ${item.partNumber}` : ''}
                        </span>
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {quantidade(item.onHand, item.unitOfMeasure)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {quantidade(item.reserved, item.unitOfMeasure)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap font-medium text-ink-900">
                        {quantidade(item.available, item.unitOfMeasure)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap">
                        {quantidade(item.minimumQuantity, item.unitOfMeasure)}
                      </TD>
                      <TD>{item.locationName ?? <span className="text-ink-400">—</span>}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={item.status === 'active' ? 'success' : 'neutral'}>
                            {PART_STATUS_LABEL[item.status === 'active' ? 'active' : 'inactive']}
                          </Badge>
                          {/* Cor NUNCA sozinha: o aviso vem escrito. */}
                          {item.belowMinimum ? (
                            <Badge tone="warning">Abaixo do minimo</Badge>
                          ) : null}
                        </div>
                      </TD>
                      <TD align="right">
                        <Link
                          href={`/estoque/${item.id}`}
                          className="text-ui font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          Abrir
                          <span className="sr-only"> a ficha de {item.name}</span>
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            {/* Mobile: cartoes com o que a bancada precisa ver (item 93). */}
            <CardList label="Pecas do catalogo" className="md:hidden">
              {result.items.map((item) => (
                <CardListItem key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">{item.name}</p>
                      <p className="truncate text-small text-ink-500">
                        {item.code}
                        {item.brand ? ` · ${item.brand}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={item.status === 'active' ? 'success' : 'neutral'}>
                        {PART_STATUS_LABEL[item.status === 'active' ? 'active' : 'inactive']}
                      </Badge>
                      {item.belowMinimum ? <Badge tone="warning">Abaixo do minimo</Badge> : null}
                    </div>
                  </div>

                  <dl className="mt-2 grid grid-cols-3 gap-2 text-small">
                    <div>
                      <dt className="text-ink-500">Saldo</dt>
                      <dd className="font-medium text-ink-900">
                        {quantidade(item.onHand, item.unitOfMeasure)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Reservado</dt>
                      <dd className="font-medium text-ink-900">
                        {quantidade(item.reserved, item.unitOfMeasure)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Disponivel</dt>
                      <dd className="font-medium text-ink-900">
                        {quantidade(item.available, item.unitOfMeasure)}
                      </dd>
                    </div>
                  </dl>

                  <Link
                    href={`/estoque/${item.id}`}
                    className="touch-target mt-2 inline-flex items-center text-ui font-semibold text-brand-600"
                  >
                    Abrir ficha
                    <span className="sr-only"> de {item.name}</span>
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

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
import { IconSearch, IconWarranty } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  listWarranties,
  type WarrantyListFilters,
} from '@/modules/warranties/application/warranty-queries';
import {
  formatWarrantyNumber,
  isKnownWarrantyStatus,
  isKnownWarrantyType,
  TEMPORAL_CLASS_LABEL,
  TEMPORAL_CLASSES,
  WARRANTY_STATUS_LABEL,
  WARRANTY_STATUS_TONE,
  WARRANTY_STATUSES,
  WARRANTY_TYPE_LABEL,
  WARRANTY_TYPES,
  warrantyTypeLabel,
  type TemporalClass,
  type WarrantyStatus,
} from '@/modules/warranties/domain/warranty';
import { dataCivil, single } from '../format';

export const metadata: Metadata = { title: 'Garantias' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Lista de garantias (Prompt 13, item 85).
 *
 * DUAS COLUNAS DE ESTADO, E ISSO E DE PROPOSITO (itens 12 e 14). "Situacao" e
 * o que a empresa decidiu — ativa, cancelada, revogada. "Vigencia" e o que o
 * calendario diz — vigente, expirada, ainda nao comecou. Uma garantia ativa
 * pode estar expirada, e uma garantia revogada pode estar dentro do prazo:
 * juntar as duas numa coluna so faria a tela mentir em ambos os casos.
 *
 * A VIGENCIA E CALCULADA NA CONSULTA, contra a data civil de hoje no fuso da
 * empresa. Nao existe coluna `expired` que um job noturno atualiza — no dia em
 * que ele falhasse, a tela mostraria "vigente" para garantia vencida sem
 * nenhum sinal de que algo deu errado.
 *
 * O ESTADO MORA NA URL: busca, tipo, situacao, vigencia e pagina sao query
 * string, entao a tela e compartilhavel, recarregavel e volta igual no botao
 * voltar do navegador.
 */
export default async function WarrantyListPage({ searchParams }: PageProps) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_WARRANTIES,
    PERMISSIONS.WARRANTIES_VIEW,
  );

  const params = await searchParams;
  const query = single(params.q);
  const tipo = single(params.tipo);
  const situacao = single(params.situacao);
  const vigencia = single(params.vigencia);
  const vencendo = single(params.vencendo);
  const pageParam = Number(single(params.pagina) ?? '1');

  const vencendoEmDias = vencendo && /^\d+$/.test(vencendo) ? Number(vencendo) : undefined;

  const filters: WarrantyListFilters = {
    search: query,
    type: tipo && isKnownWarrantyType(tipo) ? tipo : undefined,
    status: situacao && isKnownWarrantyStatus(situacao) ? situacao : undefined,
    temporal:
      vigencia && (TEMPORAL_CLASSES as readonly string[]).includes(vigencia) ? vigencia : undefined,
    expiringInDays: vencendoEmDias,
    page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
  };

  const result = await listWarranties(context, filters);

  const hrefForPage = (page: number) => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (filters.type) next.set('tipo', filters.type);
    if (filters.status) next.set('situacao', filters.status);
    if (filters.temporal) next.set('vigencia', filters.temporal);
    if (vencendoEmDias) next.set('vencendo', String(vencendoEmDias));
    next.set('pagina', String(page));
    return `/garantias/lista?${next.toString()}`;
  };

  const appliedFilters = [
    query ? `busca: ${query}` : null,
    filters.type ? `tipo: ${warrantyTypeLabel(filters.type)}` : null,
    filters.status ? `situacao: ${WARRANTY_STATUS_LABEL[filters.status as WarrantyStatus]}` : null,
    filters.temporal
      ? `vigencia: ${TEMPORAL_CLASS_LABEL[filters.temporal as TemporalClass]}`
      : null,
    vencendoEmDias ? `vence em ate ${vencendoEmDias} dia(s)` : null,
  ].filter((value): value is string => value !== null);

  const isFiltered = appliedFilters.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Garantias"
        description="Toda garantia concedida ou registrada nestas unidades, com o que a empresa decidiu e o que o calendario diz."
        breadcrumbs={[{ label: 'Garantias', href: '/garantias' }, { label: 'Lista' }]}
        metadata={
          <span>
            {result.total} garantia(s){isFiltered ? ' encontrada(s)' : ''}
          </span>
        }
        actions={
          <Link href="/garantias/retornos" className={linkButtonClass('secondary')}>
            Retornos
          </Link>
        }
      />

      {context.authorizedUnitIds.length === 0 ? (
        <Alert tone="warning">
          Voce nao tem nenhuma unidade autorizada, entao nao ha garantias para mostrar.
        </Alert>
      ) : null}

      <Card>
        <FilterBar
          action="/garantias/lista"
          applied={appliedFilters}
          onClearHref={isFiltered ? '/garantias/lista' : undefined}
        >
          <div className="sm:w-72">
            <SearchField
              id="busca-garantia"
              name="q"
              label="Buscar garantia"
              labelHidden={false}
              defaultValue={query ?? ''}
              placeholder="Numero, cliente ou aparelho"
            />
          </div>

          <div className="sm:w-52">
            <label
              htmlFor="filtro-tipo-garantia"
              className="mb-1.5 block text-ui font-medium text-ink-700"
            >
              Tipo
            </label>
            <Select id="filtro-tipo-garantia" name="tipo" defaultValue={filters.type ?? ''}>
              <option value="">Todos</option>
              {WARRANTY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {WARRANTY_TYPE_LABEL[value]}
                </option>
              ))}
            </Select>
          </div>

          <div className="sm:w-52">
            <label
              htmlFor="filtro-vigencia-garantia"
              className="mb-1.5 block text-ui font-medium text-ink-700"
            >
              Vigencia
            </label>
            <Select
              id="filtro-vigencia-garantia"
              name="vigencia"
              defaultValue={filters.temporal ?? ''}
            >
              <option value="">Todas</option>
              {TEMPORAL_CLASSES.map((value) => (
                <option key={value} value={value}>
                  {TEMPORAL_CLASS_LABEL[value]}
                </option>
              ))}
            </Select>
          </div>

          <div className="sm:w-52">
            <label
              htmlFor="filtro-situacao-garantia"
              className="mb-1.5 block text-ui font-medium text-ink-700"
            >
              Situacao
            </label>
            <Select
              id="filtro-situacao-garantia"
              name="situacao"
              defaultValue={filters.status ?? ''}
            >
              <option value="">Todas</option>
              {WARRANTY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {WARRANTY_STATUS_LABEL[value]}
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
            icon={isFiltered ? <IconSearch /> : <IconWarranty />}
            title={isFiltered ? 'Nenhuma garantia encontrada' : 'Nenhuma garantia registrada'}
            description={
              isFiltered
                ? 'Nenhuma garantia corresponde aos filtros aplicados. Limpe os filtros para ver todas.'
                : 'A garantia interna nasce na Ordem de Servico concluida; a de fabrica e a de peca sao registradas a partir do aparelho.'
            }
          />
        ) : (
          <CardBody className="p-0">
            <div className="hidden overflow-x-auto md:block">
              <Table caption="Garantias das unidades autorizadas">
                <THead>
                  <TR>
                    <TH>Garantia</TH>
                    <TH>Cliente</TH>
                    <TH>Aparelho</TH>
                    <TH>Vigencia</TH>
                    <TH>Situacao</TH>
                    <TH align="right">Retornos</TH>
                    <TH align="right" srOnly>
                      Acoes
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {result.items.map((item) => (
                    <TR key={item.id}>
                      <TD className="whitespace-nowrap font-medium text-ink-900">
                        {formatWarrantyNumber(item.number)}
                        <span className="block text-small font-normal text-ink-500">
                          {warrantyTypeLabel(item.type)}
                        </span>
                      </TD>
                      <TD>{item.customerName ?? '—'}</TD>
                      <TD>
                        {item.equipmentLabel ?? '—'}
                        {item.serviceOrderNumber !== null ? (
                          <span className="block text-small text-ink-500">
                            OS {item.serviceOrderNumber}
                          </span>
                        ) : null}
                      </TD>
                      <TD className="whitespace-nowrap">
                        {dataCivil(item.startsOn)} a {dataCivil(item.endsOn)}
                        <span className="block text-small text-ink-500">
                          {TEMPORAL_CLASS_LABEL[item.temporal]}
                        </span>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge
                            tone={WARRANTY_STATUS_TONE[item.status as WarrantyStatus] ?? 'neutral'}
                          >
                            {WARRANTY_STATUS_LABEL[item.status as WarrantyStatus] ?? item.status}
                          </Badge>
                          {/*
                            "Acionavel" e a conjuncao das duas colunas, dita de
                            uma vez: ativa E dentro do prazo. E o que o balcao
                            realmente precisa saber, e e calculado — nao e uma
                            terceira coluna guardada no banco.
                          */}
                          {item.enforceable ? (
                            <Badge tone="success">Acionavel</Badge>
                          ) : (
                            <Badge tone="neutral">Nao acionavel</Badge>
                          )}
                        </div>
                      </TD>
                      <TD align="right" className="tabular-nums">
                        {item.returnCount}
                      </TD>
                      <TD align="right">
                        <Link
                          href={`/garantias/${item.id}`}
                          className="text-ui font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          Abrir
                          <span className="sr-only">
                            {' '}
                            a garantia {formatWarrantyNumber(item.number)}
                          </span>
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <CardList label="Garantias" className="md:hidden">
              {result.items.map((item) => (
                <CardListItem key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">
                        {formatWarrantyNumber(item.number)}
                      </p>
                      <p className="truncate text-small text-ink-500">
                        {warrantyTypeLabel(item.type)}
                      </p>
                      <p className="truncate text-small text-ink-500">{item.customerName ?? '—'}</p>
                      <p className="truncate text-small text-ink-500">
                        {item.equipmentLabel ?? '—'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        tone={WARRANTY_STATUS_TONE[item.status as WarrantyStatus] ?? 'neutral'}
                      >
                        {WARRANTY_STATUS_LABEL[item.status as WarrantyStatus] ?? item.status}
                      </Badge>
                      <Badge tone={item.enforceable ? 'success' : 'neutral'}>
                        {item.enforceable ? 'Acionavel' : 'Nao acionavel'}
                      </Badge>
                    </div>
                  </div>

                  <dl className="mt-2 grid grid-cols-2 gap-2 text-small">
                    <div>
                      <dt className="text-ink-500">Vigencia</dt>
                      <dd className="font-medium text-ink-900">
                        {dataCivil(item.startsOn)} a {dataCivil(item.endsOn)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Retornos</dt>
                      <dd className="font-medium tabular-nums text-ink-900">{item.returnCount}</dd>
                    </div>
                  </dl>

                  <Link
                    href={`/garantias/${item.id}`}
                    className="touch-target mt-2 inline-flex items-center text-ui font-semibold text-brand-600"
                  >
                    Abrir garantia
                    <span className="sr-only"> {formatWarrantyNumber(item.number)}</span>
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

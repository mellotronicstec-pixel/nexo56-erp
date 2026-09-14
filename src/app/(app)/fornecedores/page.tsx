import type { Metadata } from 'next';
import Link from 'next/link';
import {
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
import { IconPlus, IconSearch, IconSupplier } from '@/design-system/icons';
import {
  formatDocument,
  inferDocumentType,
  type DocumentType,
} from '@/core/document/brazilian-document';
import { formatPhone } from '@/core/contact/phone';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  listSuppliers,
  type SupplierListFilters,
} from '@/modules/purchasing/application/purchasing-queries';
import { supplierStatusLabel } from '@/modules/purchasing/domain/purchasing';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';

export const metadata: Metadata = { title: 'Fornecedores' };

/**
 * Lista de fornecedores da EMPRESA (Prompt 11, itens 3.1 e 64).
 *
 * Nao ha filtro por unidade aqui, e a ausencia e o ponto: o distribuidor e
 * cadastrado uma vez e vale para todas as lojas. Duplicar por unidade criaria
 * tres cadastros que nenhum relatorio soma.
 *
 * O ESTADO MORA NA URL: busca, situacao e pagina sao query string. O botao
 * voltar funciona e o link pode ser mandado para o colega.
 */

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

const STATUS_LABEL: Record<string, string> = { active: 'ativos', inactive: 'inativos' };

/** CPF e CNPJ nao se escrevem igual, e o tipo esta gravado junto dos digitos. */
function documento(type: string | null, digits: string | null): string | null {
  if (!digits) return null;
  const kind = (type as DocumentType | null) ?? inferDocumentType(digits);
  return kind ? formatDocument(kind, digits) : digits;
}

export default async function SuppliersPage({ searchParams }: PageProps) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_PURCHASING,
    PERMISSIONS.SUPPLIERS_VIEW,
  );

  const params = await searchParams;
  const query = single(params.q);
  const status = single(params.situacao);
  const pageParam = Number(single(params.pagina) ?? '1');

  const filters: SupplierListFilters = {
    search: query,
    status: status && status in STATUS_LABEL ? status : undefined,
    page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
  };

  const result = await listSuppliers(context, filters);
  const canManage = hasPermission(context, PERMISSIONS.SUPPLIERS_MANAGE);

  const hrefForPage = (page: number) => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (filters.status) next.set('situacao', filters.status);
    next.set('pagina', String(page));
    return `/fornecedores?${next.toString()}`;
  };

  const appliedFilters = [
    query ? `busca: ${query}` : null,
    filters.status ? `situacao: ${STATUS_LABEL[filters.status]}` : null,
  ].filter((value): value is string => value !== null);

  const isFiltered = appliedFilters.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Fornecedores"
        description="Quem vende as pecas para a empresa. O cadastro e da empresa inteira e vale para todas as unidades."
        breadcrumbs={[{ label: 'Fornecedores' }]}
        metadata={
          <span>
            {result.total} fornecedor(es){isFiltered ? ' encontrado(s)' : ' cadastrado(s)'}
          </span>
        }
        actions={
          canManage ? (
            <Link href="/fornecedores/novo-fornecedor" className={linkButtonClass('primary')}>
              <IconPlus size={18} />
              Novo fornecedor
            </Link>
          ) : null
        }
      />

      <Card>
        <FilterBar
          action="/fornecedores"
          applied={appliedFilters}
          onClearHref={isFiltered ? '/fornecedores' : undefined}
        >
          <div className="sm:w-80">
            <SearchField
              id="busca-fornecedor"
              name="q"
              label="Buscar fornecedor"
              labelHidden={false}
              defaultValue={query ?? ''}
              placeholder="Razao social, nome fantasia, CNPJ, telefone ou e-mail"
            />
          </div>

          <div className="sm:w-52">
            <label
              htmlFor="filtro-situacao"
              className="mb-1.5 block text-ui font-medium text-ink-700"
            >
              Situacao
            </label>
            <Select id="filtro-situacao" name="situacao" defaultValue={filters.status ?? ''}>
              <option value="">Todos</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </Select>
          </div>

          <button type="submit" className={linkButtonClass('secondary', 'md', 'h-10')}>
            <IconSearch size={18} />
            Buscar
          </button>
        </FilterBar>

        {result.items.length === 0 ? (
          <EmptyState
            icon={isFiltered ? <IconSearch /> : <IconSupplier />}
            title={isFiltered ? 'Nenhum fornecedor encontrado' : 'Nenhum fornecedor cadastrado'}
            description={
              isFiltered
                ? 'Nenhum fornecedor corresponde aos filtros aplicados. Limpe os filtros para ver todos.'
                : 'Cadastre o primeiro fornecedor para comecar a registrar pedidos de compra.'
            }
            action={
              canManage && !isFiltered ? (
                <Link
                  href="/fornecedores/novo-fornecedor"
                  className={linkButtonClass('primary', 'sm')}
                >
                  Cadastrar fornecedor
                </Link>
              ) : null
            }
          />
        ) : (
          <CardBody className="p-0">
            <div className="hidden md:block">
              <Table caption="Fornecedores cadastrados na empresa">
                <THead>
                  <TR>
                    <TH>Fornecedor</TH>
                    <TH>Documento</TH>
                    <TH>Contato</TH>
                    <TH align="right">Pedidos</TH>
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
                        {item.tradeName ? (
                          <span className="block text-small font-normal text-ink-500">
                            {item.tradeName}
                          </span>
                        ) : null}
                      </TD>
                      <TD className="whitespace-nowrap">
                        {documento(item.documentType, item.documentDigits) ?? (
                          <span className="text-ink-400">—</span>
                        )}
                      </TD>
                      <TD>
                        {item.phone ? formatPhone(item.phone) : null}
                        {item.email ? (
                          <span className="block text-small text-ink-500">{item.email}</span>
                        ) : null}
                        {!item.phone && !item.email ? (
                          <span className="text-ink-400">—</span>
                        ) : null}
                      </TD>
                      <TD align="right">{item.orderCount}</TD>
                      <TD>
                        <Badge tone={item.status === 'active' ? 'success' : 'neutral'}>
                          {supplierStatusLabel(item.status)}
                        </Badge>
                      </TD>
                      <TD align="right">
                        <Link
                          href={`/fornecedores/${item.id}`}
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

            <CardList label="Fornecedores cadastrados" className="md:hidden">
              {result.items.map((item) => (
                <CardListItem key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">{item.name}</p>
                      <p className="truncate text-small text-ink-500">
                        {documento(item.documentType, item.documentDigits) ?? 'Sem documento'}
                      </p>
                    </div>
                    <Badge tone={item.status === 'active' ? 'success' : 'neutral'}>
                      {supplierStatusLabel(item.status)}
                    </Badge>
                  </div>

                  {item.phone ? (
                    <p className="mt-2 text-small text-ink-700">{formatPhone(item.phone)}</p>
                  ) : null}

                  <Link
                    href={`/fornecedores/${item.id}`}
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

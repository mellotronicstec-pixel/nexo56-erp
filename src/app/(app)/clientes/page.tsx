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
import { IconCustomers, IconPlus, IconSearch } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import {
  listCustomers,
  type CustomerListFilters,
  type CustomerListItem,
} from '@/modules/customers/application/customer-queries';
import {
  CUSTOMER_KIND_SHORT,
  CUSTOMER_STATUS_LABEL,
  displayDocument,
  displayName,
} from '@/modules/customers/domain/customer';
import { formatPhone } from '@/modules/customers/domain/phone';
import { FEATURES } from '@/modules/features/domain/catalog';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';

export const metadata: Metadata = { title: 'Clientes' };

/**
 * Listagem de clientes (Prompt 05, itens 23 a 28).
 *
 * O ESTADO MORA NA URL (item 27): busca, filtros e pagina sao query string.
 * Isso faz o botao voltar funcionar, permite recarregar sem perder o que
 * estava na tela e deixa o atendente mandar um link pronto para o colega.
 *
 * Tudo e resolvido no servidor — nenhuma lista completa desce para o
 * navegador filtrar (item 22).
 */

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/** Contato principal em uma linha, ja formatado para leitura. */
function contactLine(item: CustomerListItem): string | null {
  if (!item.primaryContactValue) return null;
  if (item.primaryContactType === 'phone') {
    const formatted = formatPhone(item.primaryContactValue);
    return item.primaryContactIsWhatsapp ? `${formatted} · WhatsApp` : formatted;
  }
  return item.primaryContactValue;
}

export default async function CustomersPage({ searchParams }: PageProps) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_CUSTOMERS,
    PERMISSIONS.CUSTOMERS_VIEW,
  );

  const params = await searchParams;
  const query = single(params.q);
  const kind = single(params.tipo);
  const status = single(params.situacao);
  const sort = single(params.ordem);
  const pageParam = Number(single(params.pagina) ?? '1');

  const filters: CustomerListFilters = {
    query,
    kind: kind === 'individual' || kind === 'company' ? kind : undefined,
    status: status === 'active' || status === 'inactive' ? status : undefined,
    sort: sort === 'name' ? 'name' : 'recent',
    page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
  };

  const result = await listCustomers(context, filters);
  const canManage = hasPermission(context, PERMISSIONS.CUSTOMERS_MANAGE);

  /** Preserva os filtros ao trocar de pagina; a busca nova volta para a 1. */
  const hrefForPage = (page: number) => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (filters.kind) next.set('tipo', filters.kind);
    if (filters.status) next.set('situacao', filters.status);
    if (sort === 'name') next.set('ordem', 'name');
    next.set('pagina', String(page));
    return `/clientes?${next.toString()}`;
  };

  const appliedFilters = [
    query ? `busca: ${query}` : null,
    filters.kind
      ? `tipo: ${filters.kind === 'individual' ? 'pessoa fisica' : 'pessoa juridica'}`
      : null,
    filters.status ? `situacao: ${CUSTOMER_STATUS_LABEL[filters.status].toLowerCase()}` : null,
  ].filter((value): value is string => value !== null);

  const isFiltered = appliedFilters.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Clientes"
        description="Pessoas e empresas atendidas por esta empresa. O cadastro vale para todas as unidades."
        breadcrumbs={[{ label: 'Clientes' }]}
        metadata={
          <span>
            {result.total} cliente(s)
            {isFiltered ? ' encontrado(s)' : ' cadastrado(s)'}
          </span>
        }
        actions={
          canManage ? (
            <Link href="/clientes/novo" className={linkButtonClass('primary')}>
              <IconPlus size={18} />
              Novo cliente
            </Link>
          ) : null
        }
      />

      <Card>
        {/*
          Filtros como formulario GET: a submissao vira query string, sem
          JavaScript obrigatorio. `pagina` nao e reenviado de proposito — uma
          busca nova sempre comeca na primeira pagina (item 28).
        */}
        <FilterBar
          action="/clientes"
          applied={appliedFilters}
          onClearHref={isFiltered ? '/clientes' : undefined}
        >
          <div className="sm:w-72">
            <SearchField
              id="busca-cliente"
              name="q"
              label="Buscar cliente"
              labelHidden={false}
              defaultValue={query ?? ''}
              placeholder="Nome, documento, telefone ou e-mail"
            />
          </div>

          <div className="sm:w-44">
            <label htmlFor="filtro-tipo" className="mb-1.5 block text-ui font-medium text-ink-700">
              Tipo
            </label>
            <Select id="filtro-tipo" name="tipo" defaultValue={filters.kind ?? ''}>
              <option value="">Todos</option>
              <option value="individual">Pessoa fisica</option>
              <option value="company">Pessoa juridica</option>
            </Select>
          </div>

          <div className="sm:w-44">
            <label
              htmlFor="filtro-situacao"
              className="mb-1.5 block text-ui font-medium text-ink-700"
            >
              Situacao
            </label>
            <Select id="filtro-situacao" name="situacao" defaultValue={filters.status ?? ''}>
              <option value="">Todas</option>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </Select>
          </div>

          <div className="sm:w-44">
            <label htmlFor="filtro-ordem" className="mb-1.5 block text-ui font-medium text-ink-700">
              Ordenar por
            </label>
            <Select
              id="filtro-ordem"
              name="ordem"
              defaultValue={sort === 'name' ? 'name' : 'recent'}
            >
              <option value="recent">Atualizado recentemente</option>
              <option value="name">Nome</option>
            </Select>
          </div>

          <button type="submit" className={linkButtonClass('secondary', 'md', 'h-10')}>
            <IconSearch size={18} />
            Buscar
          </button>
        </FilterBar>

        {result.items.length === 0 ? (
          <EmptyState
            icon={isFiltered ? <IconSearch /> : <IconCustomers />}
            title={isFiltered ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
            description={
              isFiltered
                ? 'Nenhum cliente corresponde aos filtros aplicados. Limpe os filtros para ver todos.'
                : 'Cadastre o primeiro cliente para comecar a registrar atendimentos.'
            }
            action={
              canManage && !isFiltered ? (
                <Link href="/clientes/novo" className={linkButtonClass('primary', 'sm')}>
                  Cadastrar cliente
                </Link>
              ) : null
            }
          />
        ) : (
          <CardBody className="p-0">
            {/* Tablet e desktop */}
            <div className="hidden md:block">
              <Table caption="Clientes desta empresa">
                <THead>
                  <TR>
                    <TH>Cliente</TH>
                    <TH>Documento</TH>
                    <TH>Contato principal</TH>
                    <TH>Tipo</TH>
                    <TH>Situacao</TH>
                    <TH align="right" srOnly>
                      Acoes
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {result.items.map((item) => {
                    const document = displayDocument(item);
                    const contact = contactLine(item);
                    return (
                      <TR key={item.id}>
                        <TD className="font-medium text-ink-900">
                          {displayName(item)}
                          {item.kind === 'company' && item.tradeName ? (
                            <span className="block text-small font-normal text-ink-500">
                              {item.name}
                            </span>
                          ) : null}
                        </TD>
                        <TD className="whitespace-nowrap">
                          {document ?? <span className="text-ink-400">—</span>}
                        </TD>
                        <TD className="whitespace-nowrap">
                          {contact ?? <span className="text-ink-400">—</span>}
                        </TD>
                        <TD>
                          <Badge>{CUSTOMER_KIND_SHORT[item.kind]}</Badge>
                        </TD>
                        <TD>
                          <Badge tone={item.status === 'active' ? 'success' : 'neutral'}>
                            {CUSTOMER_STATUS_LABEL[item.status]}
                          </Badge>
                        </TD>
                        <TD align="right">
                          <Link
                            href={`/clientes/${item.id}`}
                            className="text-ui font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                          >
                            Abrir
                            <span className="sr-only"> a ficha de {displayName(item)}</span>
                          </Link>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>

            {/* Mobile: cartoes com o essencial do balcao */}
            <CardList label="Clientes desta empresa" className="md:hidden">
              {result.items.map((item) => {
                const document = displayDocument(item);
                const contact = contactLine(item);
                return (
                  <CardListItem key={item.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink-900">{displayName(item)}</p>
                        {document ? (
                          <p className="truncate text-small text-ink-500">{document}</p>
                        ) : null}
                        {contact ? (
                          <p className="truncate text-small text-ink-500">{contact}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={item.status === 'active' ? 'success' : 'neutral'}>
                          {CUSTOMER_STATUS_LABEL[item.status]}
                        </Badge>
                        <Badge>{CUSTOMER_KIND_SHORT[item.kind]}</Badge>
                      </div>
                    </div>
                    <Link
                      href={`/clientes/${item.id}`}
                      className="touch-target mt-2 inline-flex items-center text-ui font-semibold text-brand-600"
                    >
                      Abrir ficha
                      <span className="sr-only"> de {displayName(item)}</span>
                    </Link>
                  </CardListItem>
                );
              })}
            </CardList>

            <Pagination page={result.page} pageCount={result.totalPages} hrefFor={hrefForPage} />
          </CardBody>
        )}
      </Card>
    </div>
  );
}

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
  Input,
  linkButtonClass,
  MetricCard,
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
import { IconFinance, IconPlus, IconSearch } from '@/design-system/icons';
import { formatBRL } from '@/core/money/format';
import { Money } from '@/core/money/money';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import {
  listFinancialTitles,
  type TitleListFilters,
} from '@/modules/finance/application/finance-queries';
import {
  formatTitleNumber,
  isKnownTitleStatus,
  SETTLEMENT_VERB,
  TITLE_STATUS_TONE,
  TITLE_STATUSES,
  titleManagePermission,
  titleStatusLabel,
  type TitleDirection,
} from '@/modules/finance/domain/finance';
import { hasPermission, type TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { dataCivil, single } from './format';

/**
 * Lista de titulos numa direcao (Prompt 12, itens 65 e 66).
 *
 * UMA TELA SO, PARAMETRIZADA PELA DIRECAO. Contas a receber e contas a pagar
 * respondem a mesma pergunta — quanto falta, de quem, para quando — e a unica
 * diferenca real e o vocabulario. Duplicar o arquivo duplicaria tambem cada
 * correcao futura de paginacao, filtro e acessibilidade.
 *
 * O ESTADO MORA NA URL: busca, situacao, vencido e pagina sao query string, e
 * por isso a tela e compartilhavel, recarregavel e volta igual no botao
 * voltar do navegador.
 *
 * "VENCIDO" NAO E UMA SITUACAO, e um recorte. Um titulo vencido esta `open` ou
 * `partially_settled` — vencer nao muda o que ele e, muda so a urgencia. Por
 * isso ele e um filtro proprio, e nao mais uma opcao na lista de situacoes.
 */

interface TitleListPageProps {
  context: TenantContext;
  direction: TitleDirection;
  params: Record<string, string | string[] | undefined>;
}

const COPY: Record<
  TitleDirection,
  {
    basePath: string;
    title: string;
    description: string;
    counterpartyHeading: string;
    emptyTitle: string;
    emptyDescription: string;
    newLabel: string;
    newHref: string;
    openLabel: string;
    overdueLabel: string;
  }
> = {
  receivable: {
    basePath: '/financeiro/contas-a-receber',
    title: 'Contas a receber',
    description:
      'O que os clientes ainda devem a esta unidade. Receber e um ato registrado, nao um numero que alguem edita.',
    counterpartyHeading: 'Cliente',
    emptyTitle: 'Nenhuma conta a receber',
    emptyDescription:
      'Nada em aberto nesta unidade. A cobranca de uma Ordem de Servico nasce na propria OS, com o valor do orcamento aprovado.',
    newLabel: 'Nova cobranca',
    newHref: '/financeiro/novo-lancamento?direcao=receivable',
    openLabel: 'Total em aberto',
    overdueLabel: 'Vencido a receber',
  },
  payable: {
    basePath: '/financeiro/contas-a-pagar',
    title: 'Contas a pagar',
    description:
      'O que esta unidade deve. A conta de uma compra nasce no recebimento da mercadoria, nao no pedido.',
    counterpartyHeading: 'Favorecido',
    emptyTitle: 'Nenhuma conta a pagar',
    emptyDescription:
      'Nada em aberto nesta unidade. Uma despesa avulsa pode ser lancada a mao; a conta de uma compra nasce quando a mercadoria chega.',
    newLabel: 'Nova despesa',
    newHref: '/financeiro/novo-lancamento?direcao=payable',
    openLabel: 'Total em aberto',
    overdueLabel: 'Vencido a pagar',
  },
};

export async function TitleListPage({ context, direction, params }: TitleListPageProps) {
  const copy = COPY[direction];

  const query = single(params.q);
  const status = single(params.situacao);
  const vencido = single(params.vencido) === 'sim';
  const dueFrom = single(params.de);
  const dueTo = single(params.ate);
  const pageParam = Number(single(params.pagina) ?? '1');

  const filters: TitleListFilters = {
    search: query,
    status: status && isKnownTitleStatus(status) ? status : undefined,
    filter: vencido ? 'overdue' : undefined,
    dueFrom,
    dueTo,
    page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
  };

  const result = await listFinancialTitles(context, direction, filters);

  const podeLancar = hasPermission(context, titleManagePermission(direction));

  /**
   * Os totais da PAGINA, ditos como totais da pagina.
   *
   * Somar so o que esta na tela e honesto desde que a tela diga isso. Chamar
   * de "total em aberto" a soma de 25 linhas de 300 seria mentira — e quem
   * confere o caixa somaria errado sem nunca desconfiar.
   */
  const emAberto = result.items.reduce(
    (total, item) => total.add(Money.parse(item.outstanding)),
    Money.zero(),
  );
  const vencidoTotal = result.items
    .filter((item) => item.overdue)
    .reduce((total, item) => total.add(Money.parse(item.outstanding)), Money.zero());

  const hrefForPage = (page: number) => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (filters.status) next.set('situacao', filters.status);
    if (vencido) next.set('vencido', 'sim');
    if (dueFrom) next.set('de', dueFrom);
    if (dueTo) next.set('ate', dueTo);
    next.set('pagina', String(page));
    return `${copy.basePath}?${next.toString()}`;
  };

  const appliedFilters = [
    query ? `busca: ${query}` : null,
    filters.status ? `situacao: ${titleStatusLabel(filters.status, direction)}` : null,
    vencido ? 'somente vencidos' : null,
    dueFrom ? `vence a partir de ${dataCivil(dueFrom)}` : null,
    dueTo ? `vence ate ${dataCivil(dueTo)}` : null,
  ].filter((value): value is string => value !== null);

  const isFiltered = appliedFilters.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.description}
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: copy.title }]}
        metadata={
          <span>
            {result.total} titulo(s){isFiltered ? ' encontrado(s)' : ' nesta unidade'}
          </span>
        }
        actions={
          podeLancar ? (
            <Link href={copy.newHref} className={linkButtonClass('primary')}>
              <IconPlus size={18} />
              {copy.newLabel}
            </Link>
          ) : null
        }
      />

      {!context.activeUnitId ? (
        <Alert tone="warning">
          Escolha uma unidade para ver os titulos. O financeiro de uma loja nao e o da outra.
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <MetricCard
          label={`${copy.openLabel} (nesta pagina)`}
          value={formatBRL(emAberto.toString())}
          hint="Soma do saldo dos titulos listados nesta pagina, nao da carteira inteira."
        />
        <MetricCard
          label={`${copy.overdueLabel} (nesta pagina)`}
          value={
            <span className={vencidoTotal.isZero() ? undefined : 'text-danger-700'}>
              {formatBRL(vencidoTotal.toString())}
            </span>
          }
          hint="Vencimento no passado, no fuso da empresa, com saldo ainda em aberto."
        />
      </div>

      <Card>
        <FilterBar
          action={copy.basePath}
          applied={appliedFilters}
          onClearHref={isFiltered ? copy.basePath : undefined}
        >
          <div className="sm:w-72">
            <SearchField
              id="busca-titulo"
              name="q"
              label="Buscar titulo"
              labelHidden={false}
              defaultValue={query ?? ''}
              placeholder="Numero, descricao ou nome"
            />
          </div>

          <div className="sm:w-52">
            <label
              htmlFor="filtro-situacao-titulo"
              className="mb-1.5 block text-ui font-medium text-ink-700"
            >
              Situacao
            </label>
            <Select id="filtro-situacao-titulo" name="situacao" defaultValue={filters.status ?? ''}>
              <option value="">Todas</option>
              {TITLE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {titleStatusLabel(value, direction)}
                </option>
              ))}
            </Select>
          </div>

          <div className="sm:w-44">
            <label
              htmlFor="filtro-vencimento-de"
              className="mb-1.5 block text-ui font-medium text-ink-700"
            >
              Vence de
            </label>
            <Input id="filtro-vencimento-de" name="de" type="date" defaultValue={dueFrom ?? ''} />
          </div>

          <div className="sm:w-44">
            <label
              htmlFor="filtro-vencimento-ate"
              className="mb-1.5 block text-ui font-medium text-ink-700"
            >
              Vence ate
            </label>
            <Input id="filtro-vencimento-ate" name="ate" type="date" defaultValue={dueTo ?? ''} />
          </div>

          <label className="flex h-10 items-center gap-2 self-end text-ui text-ink-700">
            <input
              type="checkbox"
              name="vencido"
              value="sim"
              defaultChecked={vencido}
              className="size-4 rounded border-ink-300 text-brand-600"
            />
            Somente vencidos
          </label>

          <button type="submit" className={linkButtonClass('secondary', 'md', 'h-10')}>
            <IconSearch size={18} />
            Buscar
          </button>
        </FilterBar>

        {result.items.length === 0 ? (
          <EmptyState
            icon={isFiltered ? <IconSearch /> : <IconFinance />}
            title={isFiltered ? 'Nenhum titulo encontrado' : copy.emptyTitle}
            description={
              isFiltered
                ? 'Nenhum titulo corresponde aos filtros aplicados. Limpe os filtros para ver todos.'
                : copy.emptyDescription
            }
            action={
              podeLancar && !isFiltered ? (
                <Link href={copy.newHref} className={linkButtonClass('primary', 'sm')}>
                  {copy.newLabel}
                </Link>
              ) : null
            }
          />
        ) : (
          <CardBody className="p-0">
            <div className="hidden md:block">
              <Table caption={`${copy.title} da unidade ativa`}>
                <THead>
                  <TR>
                    <TH>Titulo</TH>
                    <TH>{copy.counterpartyHeading}</TH>
                    <TH>Vencimento</TH>
                    <TH align="right">Valor</TH>
                    <TH align="right">Saldo</TH>
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
                        {formatTitleNumber(item.direction, item.number)}
                        <span className="block max-w-[22rem] truncate text-small font-normal text-ink-500">
                          {item.description}
                        </span>
                      </TD>
                      <TD>{item.counterpartyName ?? '—'}</TD>
                      <TD className="whitespace-nowrap">
                        {dataCivil(item.dueDate)}
                        {item.installmentCount > 1 ? (
                          <span className="block text-small text-ink-500">
                            {item.installmentCount}x
                          </span>
                        ) : null}
                      </TD>
                      <TD align="right" className="whitespace-nowrap tabular-nums">
                        {formatBRL(item.amount)}
                      </TD>
                      <TD align="right" className="whitespace-nowrap tabular-nums">
                        {formatBRL(item.outstanding)}
                      </TD>
                      <TD>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge tone={TITLE_STATUS_TONE[item.status as never] ?? 'neutral'}>
                            {titleStatusLabel(item.status, item.direction)}
                          </Badge>
                          {item.overdue ? <Badge tone="danger">Vencido</Badge> : null}
                        </div>
                      </TD>
                      <TD align="right">
                        <Link
                          href={`/financeiro/titulos/${item.id}`}
                          className="text-ui font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          Abrir
                          <span className="sr-only">
                            {' '}
                            o titulo {formatTitleNumber(item.direction, item.number)}
                          </span>
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <CardList label={copy.title} className="md:hidden">
              {result.items.map((item) => (
                <CardListItem key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">
                        {formatTitleNumber(item.direction, item.number)}
                      </p>
                      <p className="truncate text-small text-ink-500">{item.description}</p>
                      <p className="truncate text-small text-ink-500">
                        {item.counterpartyName ?? '—'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone={TITLE_STATUS_TONE[item.status as never] ?? 'neutral'}>
                        {titleStatusLabel(item.status, item.direction)}
                      </Badge>
                      {item.overdue ? <Badge tone="danger">Vencido</Badge> : null}
                    </div>
                  </div>

                  <dl className="mt-2 grid grid-cols-3 gap-2 text-small">
                    <div>
                      <dt className="text-ink-500">Vencimento</dt>
                      <dd className="font-medium text-ink-900">{dataCivil(item.dueDate)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Valor</dt>
                      <dd className="font-medium tabular-nums text-ink-900">
                        {formatBRL(item.amount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">Saldo</dt>
                      <dd className="font-medium tabular-nums text-ink-900">
                        {formatBRL(item.outstanding)}
                      </dd>
                    </div>
                  </dl>

                  <Link
                    href={`/financeiro/titulos/${item.id}`}
                    className="touch-target mt-2 inline-flex items-center text-ui font-semibold text-brand-600"
                  >
                    Abrir titulo
                    <span className="sr-only">
                      {' '}
                      {formatTitleNumber(item.direction, item.number)}
                    </span>
                  </Link>
                </CardListItem>
              ))}
            </CardList>

            <Pagination page={result.page} pageCount={result.totalPages} hrefFor={hrefForPage} />
          </CardBody>
        )}
      </Card>

      <p className="text-small text-ink-500">
        {SETTLEMENT_VERB[direction]} um titulo exige a permissao{' '}
        <code className="rounded bg-ink-100 px-1">
          {direction === 'receivable' ? PERMISSIONS.FINANCE_RECEIVE : PERMISSIONS.FINANCE_PAY}
        </code>
        , concedida separadamente de quem apenas consulta.
      </p>
    </div>
  );
}

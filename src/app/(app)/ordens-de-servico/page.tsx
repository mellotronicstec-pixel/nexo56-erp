import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardList,
  CardListItem,
  EmptyState,
  FilterBar,
  Input,
  PageHeader,
  Pagination,
  SearchField,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { IconServiceOrder } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { equipmentTitle } from '@/modules/equipment/domain/equipment';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  getServiceOrderNumberFormat,
  listServiceOrders,
} from '@/modules/service-orders/application/service-order-queries';
import {
  formatServiceOrderNumber,
  statusLabel,
} from '@/modules/service-orders/domain/service-order';

export const metadata: Metadata = { title: 'Ordens de Servico' };

/**
 * Ordens de Servico da UNIDADE ATIVA (Prompt 07, itens 63 e 74).
 *
 * A lista muda quando a pessoa troca de unidade, do mesmo jeito que a de
 * recebimentos: a OS pertence a quem assumiu o trabalho, e a bancada da loja
 * Centro nao e assunto de quem opera a Norte.
 *
 * Esta e uma LISTAGEM OPERACIONAL, nao a Central de Trabalho (item 74). Ela
 * responde "quais ordens estao abertas aqui e qual e cada uma"; priorizacao,
 * carga por tecnico e filtros de workflow chegam quando o workflow existir.
 */
export default async function ServiceOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    de?: string;
    ate?: string;
    cliente?: string;
    pagina?: string;
  }>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_SERVICE_ORDERS,
    PERMISSIONS.SERVICE_ORDERS_VIEW,
  );

  const { q, de, ate, cliente, pagina } = await searchParams;
  const pageParam = Number(pagina ?? '1');

  const [result, numberFormat] = await Promise.all([
    listServiceOrders(context, {
      query: q?.trim() || undefined,
      from: de || undefined,
      to: ate || undefined,
      customerId: cliente || undefined,
      page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
    }),
    getServiceOrderNumberFormat(context.tenantId),
  ]);

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: context.tenantTimezone,
  });

  /** Etiquetas do que esta filtrado agora — lista curta filtrada nao e lista vazia. */
  const applied = [
    q ? `Busca: ${q}` : null,
    de ? `A partir de ${de}` : null,
    ate ? `Ate ${ate}` : null,
    cliente ? 'Cliente especifico' : null,
  ].filter((item): item is string => item !== null);

  /** Mantem os filtros vigentes ao trocar de pagina. */
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (de) params.set('de', de);
    if (ate) params.set('ate', ate);
    if (cliente) params.set('cliente', cliente);
    params.set('pagina', String(page));
    return `/ordens-de-servico?${params.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Ordens de Servico"
        description="Atendimentos abertos nesta unidade."
        breadcrumbs={[{ label: 'Ordens de Servico' }]}
        metadata={<span>{result.total} ordem(ns)</span>}
      />

      {!context.activeUnitId ? (
        <Alert tone="warning" title="Nenhuma unidade selecionada">
          Escolha uma unidade no seletor da barra superior para ver as Ordens de Servico dela.
        </Alert>
      ) : null}

      <Card>
        {/*
          Busca e filtros viajam na URL (GET), nao em estado de componente: o
          endereco resultante pode ser guardado, compartilhado com um colega e
          reaberto — e o botao voltar do navegador funciona.
        */}
        <FilterBar
          action="/ordens-de-servico"
          applied={applied}
          onClearHref={applied.length > 0 ? '/ordens-de-servico' : undefined}
        >
          <SearchField
            id="busca-os"
            name="q"
            defaultValue={q ?? ''}
            label="Buscar Ordem de Servico"
            placeholder="Numero, cliente, marca, modelo ou serie"
            className="sm:max-w-sm"
          />
          <label className="flex flex-col gap-1.5 text-ui font-medium text-ink-700">
            Aberta de
            <Input type="date" name="de" defaultValue={de ?? ''} />
          </label>
          <label className="flex flex-col gap-1.5 text-ui font-medium text-ink-700">
            Ate
            <Input type="date" name="ate" defaultValue={ate ?? ''} />
          </label>
          {cliente ? <input type="hidden" name="cliente" value={cliente} /> : null}
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
        </FilterBar>

        {result.items.length === 0 ? (
          <EmptyState
            icon={<IconServiceOrder />}
            title="Nenhuma Ordem de Servico"
            description={
              q || de || ate
                ? 'Nenhuma ordem corresponde ao que voce procurou.'
                : 'As Ordens de Servico abertas nesta unidade aparecem aqui. Comece por um recebimento.'
            }
          />
        ) : (
          <CardBody className="p-0">
            <div className="hidden md:block">
              <Table caption="Ordens de Servico desta unidade">
                <THead>
                  <TR>
                    <TH>Numero</TH>
                    <TH>Cliente</TH>
                    <TH>Equipamento</TH>
                    <TH>Abertura</TH>
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
                        {formatServiceOrderNumber(
                          item.number,
                          numberFormat.prefix,
                          numberFormat.padding,
                        )}
                      </TD>
                      <TD>{item.customerName}</TD>
                      <TD>
                        {equipmentTitle({
                          kind: item.equipmentKind,
                          brand: item.equipmentBrand,
                          model: item.equipmentModel,
                        })}
                        {item.equipmentSerial ? (
                          <span className="block text-small text-ink-500">
                            Serie {item.equipmentSerial}
                          </span>
                        ) : null}
                      </TD>
                      <TD className="whitespace-nowrap">{formatter.format(item.openedAt)}</TD>
                      <TD>
                        <Badge>{statusLabel(item.status)}</Badge>
                      </TD>
                      <TD align="right">
                        <Link
                          href={`/ordens-de-servico/${item.id}`}
                          className="text-ui font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          Abrir
                          <span className="sr-only">
                            {' '}
                            a Ordem de Servico{' '}
                            {formatServiceOrderNumber(
                              item.number,
                              numberFormat.prefix,
                              numberFormat.padding,
                            )}
                          </span>
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            {/*
              No celular, cartoes (item 76). Cada um responde de imediato as
              quatro perguntas do balcao: qual OS, de quem, qual aparelho e
              quando entrou.
            */}
            <CardList label="Ordens de Servico desta unidade" className="md:hidden">
              {result.items.map((item) => (
                <CardListItem key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-ink-900">
                      {formatServiceOrderNumber(
                        item.number,
                        numberFormat.prefix,
                        numberFormat.padding,
                      )}
                    </p>
                    <Badge>{statusLabel(item.status)}</Badge>
                  </div>
                  <p className="text-ui text-ink-800">{item.customerName}</p>
                  <p className="text-small text-ink-500">
                    {equipmentTitle({
                      kind: item.equipmentKind,
                      brand: item.equipmentBrand,
                      model: item.equipmentModel,
                    })}
                    {' · '}
                    {formatter.format(item.openedAt)}
                  </p>
                  <Link
                    href={`/ordens-de-servico/${item.id}`}
                    className="touch-target mt-2 inline-flex items-center text-ui font-semibold text-brand-600"
                  >
                    Abrir Ordem de Servico
                  </Link>
                </CardListItem>
              ))}
            </CardList>

            <Pagination page={result.page} pageCount={result.totalPages} hrefFor={pageHref} />
          </CardBody>
        )}
      </Card>
    </div>
  );
}

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
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { IconServiceOrder } from '@/design-system/icons';
import { formatCivilDateBR, isOverdue } from '@/core/time/civil-date';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { equipmentTitle } from '@/modules/equipment/domain/equipment';
import { FEATURES } from '@/modules/features/domain/catalog';
import { loadPendingWork } from '@/modules/service-orders/application/service-order-actions';
import {
  getServiceOrderNumberFormat,
  listServiceOrders,
  listUnitMembers,
} from '@/modules/service-orders/application/service-order-queries';
import { formatServiceOrderNumber } from '@/modules/service-orders/domain/service-order';
import {
  SERVICE_ORDER_STATUSES,
  SERVICE_ORDER_STATUS_LABEL,
  isKnownStatus,
  statusLabel,
  statusTone,
} from '@/modules/service-orders/domain/workflow';

export const metadata: Metadata = { title: 'Ordens de Servico' };

/** Rotulos dos filtros de acompanhamento (Prompt 08, item 89). */
const FOLLOW_UP_FILTERS = {
  overdue: 'Acompanhamento vencido',
  today: 'Acompanhamento vence hoje',
  upcoming: 'Acompanhamento futuro',
} as const;

type FollowUpFilter = keyof typeof FOLLOW_UP_FILTERS;

function parseFollowUp(raw: string | undefined): FollowUpFilter | undefined {
  return raw && raw in FOLLOW_UP_FILTERS ? (raw as FollowUpFilter) : undefined;
}

/**
 * Ordens de Servico da UNIDADE ATIVA (Prompt 07, itens 63 e 74; Prompt 08,
 * itens 87 a 91).
 *
 * A lista muda quando a pessoa troca de unidade, do mesmo jeito que a de
 * recebimentos: a OS pertence a quem assumiu o trabalho, e a bancada da loja
 * Centro nao e assunto de quem opera a Norte.
 *
 * Esta CONTINUA sendo uma listagem operacional, e nao a Central de Trabalho
 * (Prompt 08, item 43). O painel de pendencias responde apenas "o que venceu e
 * o que vence hoje AQUI"; priorizacao, carga por tecnico e visao multiunidade
 * sao do Prompt 15.
 */
export default async function ServiceOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    de?: string;
    ate?: string;
    cliente?: string;
    situacao?: string;
    acompanhamento?: string;
    tecnico?: string;
    pagina?: string;
  }>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_SERVICE_ORDERS,
    PERMISSIONS.SERVICE_ORDERS_VIEW,
  );

  const { q, de, ate, cliente, situacao, acompanhamento, tecnico, pagina } = await searchParams;
  const pageParam = Number(pagina ?? '1');

  /** Situacao desconhecida na URL nao vira consulta: e ignorada. */
  const status = situacao && isKnownStatus(situacao) ? situacao : undefined;
  const followUp = parseFollowUp(acompanhamento);

  const [result, numberFormat, members, pending] = await Promise.all([
    listServiceOrders(context, {
      query: q?.trim() || undefined,
      from: de || undefined,
      to: ate || undefined,
      customerId: cliente || undefined,
      status,
      followUp,
      technicianId: tecnico || undefined,
      page: Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1,
    }),
    getServiceOrderNumberFormat(context.tenantId),
    context.activeUnitId ? listUnitMembers(context, context.activeUnitId) : Promise.resolve([]),
    loadPendingWork(context),
  ]);

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: context.tenantTimezone,
  });

  const technicianName = members.find((member) => member.id === tecnico)?.name;

  /** Etiquetas do que esta filtrado agora — lista curta filtrada nao e lista vazia. */
  const applied = [
    q ? `Busca: ${q}` : null,
    de ? `A partir de ${de}` : null,
    ate ? `Ate ${ate}` : null,
    cliente ? 'Cliente especifico' : null,
    status ? `Situacao: ${statusLabel(status)}` : null,
    followUp ? FOLLOW_UP_FILTERS[followUp] : null,
    technicianName ? `Tecnico: ${technicianName}` : null,
  ].filter((item): item is string => item !== null);

  /** Mantem os filtros vigentes ao trocar de pagina. */
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (de) params.set('de', de);
    if (ate) params.set('ate', ate);
    if (cliente) params.set('cliente', cliente);
    if (status) params.set('situacao', status);
    if (followUp) params.set('acompanhamento', followUp);
    if (tecnico) params.set('tecnico', tecnico);
    params.set('pagina', String(page));
    return `/ordens-de-servico?${params.toString()}`;
  };

  const pendingCount =
    pending.overdueOrders.length + pending.dueTodayOrders.length + pending.overdueTasks.length;

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

      {/*
        PENDENCIAS (itens 40 a 43). Painel, nunca modal bloqueante: quem abre
        esta tela costuma ter um cliente na frente, e obrigar a fechar um aviso
        antes de buscar a OS dele atrapalha o atendimento.

        A contagem vem de CONSULTA ao banco, nao de uma tabela de alertas: se o
        job de varredura atrasar, o que a tela mostra continua correto — o que
        o job faz e publicar o evento de vencimento, nao alimentar esta lista.
      */}
      {pendingCount > 0 ? (
        <Alert tone="warning" title={`${pendingCount} pendencia(s) nesta unidade`}>
          <ul className="mt-1 space-y-1">
            {pending.overdueOrders.slice(0, 5).map((item) => (
              <li key={item.id}>
                <Link
                  href={`/ordens-de-servico/${item.id}`}
                  className="inline-flex items-center py-1 font-semibold hover:underline"
                >
                  {formatServiceOrderNumber(item.number, numberFormat.prefix, numberFormat.padding)}
                </Link>{' '}
                — {item.customerName}: acompanhamento vencido em{' '}
                {formatCivilDateBR(item.followUpAt)}.
              </li>
            ))}
            {pending.dueTodayOrders.slice(0, 5).map((item) => (
              <li key={item.id}>
                <Link
                  href={`/ordens-de-servico/${item.id}`}
                  className="inline-flex items-center py-1 font-semibold hover:underline"
                >
                  {formatServiceOrderNumber(item.number, numberFormat.prefix, numberFormat.padding)}
                </Link>{' '}
                — {item.customerName}: acompanhamento vence hoje.
              </li>
            ))}
            {pending.overdueTasks.slice(0, 5).map((task) => (
              <li key={task.id}>
                <Link
                  href={`/ordens-de-servico/${task.serviceOrderId}`}
                  className="inline-flex items-center py-1 font-semibold hover:underline"
                >
                  {formatServiceOrderNumber(
                    task.serviceOrderNumber,
                    numberFormat.prefix,
                    numberFormat.padding,
                  )}
                </Link>{' '}
                — tarefa atrasada: {task.title}.
              </li>
            ))}
          </ul>
          <p className="mt-2">
            <Link
              href="/ordens-de-servico?acompanhamento=overdue"
              className="inline-flex items-center py-1 font-semibold hover:underline"
            >
              Ver todas as ordens com acompanhamento vencido
            </Link>
          </p>
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
            className="sm:max-w-[24rem]"
          />
          <label className="flex flex-col gap-1.5 text-ui font-medium text-ink-700">
            Situacao
            <Select name="situacao" defaultValue={status ?? ''}>
              <option value="">Todas</option>
              {SERVICE_ORDER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {SERVICE_ORDER_STATUS_LABEL[value]}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-ui font-medium text-ink-700">
            Acompanhamento
            <Select name="acompanhamento" defaultValue={followUp ?? ''}>
              <option value="">Qualquer</option>
              {Object.entries(FOLLOW_UP_FILTERS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          {members.length > 0 ? (
            <label className="flex flex-col gap-1.5 text-ui font-medium text-ink-700">
              Tecnico responsavel
              <Select name="tecnico" defaultValue={tecnico ?? ''}>
                <option value="">Qualquer</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
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
              applied.length > 0
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
                    <TH>Acompanhamento</TH>
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
                        {item.openTaskCount > 0 ? (
                          <span className="block text-small text-ink-500">
                            {item.openTaskCount} tarefa(s) aberta(s)
                          </span>
                        ) : null}
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
                        {/* Cor NUNCA sozinha: o rotulo acompanha o tom (item 86). */}
                        <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
                        {item.technicianName ? (
                          <span className="block text-small text-ink-500">
                            {item.technicianName}
                          </span>
                        ) : null}
                      </TD>
                      <TD className="whitespace-nowrap">
                        {item.followUpAt ? (
                          <>
                            {formatCivilDateBR(item.followUpAt)}
                            {isOverdue(item.followUpAt, context.tenantTimezone) ? (
                              <Badge tone="danger" className="ml-2">
                                Vencido
                              </Badge>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-ink-500">—</span>
                        )}
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
              perguntas do balcao: qual OS, de quem, qual aparelho, quando
              entrou e em que situacao esta.
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
                    <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
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
                  {item.followUpAt || item.technicianName || item.openTaskCount > 0 ? (
                    <p className="text-small text-ink-500">
                      {item.technicianName ? `${item.technicianName}` : 'Sem responsavel'}
                      {item.followUpAt
                        ? ` · Acompanhar em ${formatCivilDateBR(item.followUpAt)}`
                        : ''}
                      {item.openTaskCount > 0 ? ` · ${item.openTaskCount} tarefa(s)` : ''}
                    </p>
                  ) : null}
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

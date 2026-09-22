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
  linkButtonClass,
  PageHeader,
  Pagination,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { formatCivilDateBR } from '@/core/time/civil-date';
import { statusLabel } from '@/modules/service-orders/domain/workflow';
import { loadWorkCenter } from '@/modules/work-center/application/work-center-queries';
import {
  ATTENTION_FLAG_LABEL,
  ATTENTION_FLAG_TONE,
  isAttentionFlag,
  isWorkQueue,
  WORK_QUEUE_EMPTY,
  WORK_VIEW_LABEL,
  WORK_VIEWS,
  type AttentionFlag,
  type WorkCenterItem,
} from '@/modules/work-center/domain/work-center';

export const metadata: Metadata = { title: 'Central de Trabalho' };

/**
 * A CENTRAL DE TRABALHO (Prompt 15).
 *
 * Um cockpit operacional, nao uma planilha: a pessoa abre, entende o que exige
 * atencao, acha o item e entra no contexto certo. Tudo aqui e LEITURA — a
 * acao acontece na ficha da OS, onde a maquina de estados mora.
 *
 * OS CARTOES SAO FILTROS, nao paineis (item 110): clicar em "Aguardando Peca"
 * filtra a lista abaixo em vez de abrir mais uma tela.
 *
 * O ESTADO DOS FILTROS VIVE NA URL, entao recarregar preserva e o link pode
 * ser mandado para outra pessoa. E tudo revalidado no servidor: fila ou
 * filtro desconhecido e recusado, visao desconhecida volta ao padrao.
 *
 * A UNIDADE E A ATIVA, escolhida pelo seletor que ja existe no cabecalho. A
 * Central nao aceita unidade pela URL — um caminho a menos para errar.
 */

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * FILTRO DESCONHECIDO NA URL VOLTA AO PADRAO SEGURO, nao derruba a tela.
 *
 * O caso real e banal: um link antigo, um filtro renomeado, alguem editando a
 * barra de enderecos. Responder com erro de servidor transformaria isso numa
 * tela quebrada, e "falhar com seguranca" nao e o mesmo que falhar com ruido.
 *
 * O SERVICO CONTINUA ESTRITO de proposito: ele recusa valor invalido, porque
 * uma futura API nao deve adivinhar o que o chamador quis dizer. Quem
 * perdoa e a INTERFACE, que conhece o proprio usuario — e a interface so
 * repassa o que ela mesma reconhece.
 */
function conhecido<T extends string>(
  value: string | undefined,
  aceita: (v: string) => v is T,
): T | undefined {
  return value && aceita(value) ? value : undefined;
}

/** Monta o link preservando os demais filtros. */
function hrefCom(
  atual: { view: string; queue: string | null; attention: string | null; query: string },
  mudanca: Partial<{ view: string; queue: string | null; attention: string | null; page: number }>,
): string {
  const params = new URLSearchParams();
  const view = mudanca.view ?? atual.view;
  if (view !== 'unit') params.set('visao', view);

  const queue = mudanca.queue === undefined ? atual.queue : mudanca.queue;
  if (queue) params.set('fila', queue);

  const attention = mudanca.attention === undefined ? atual.attention : mudanca.attention;
  if (attention) params.set('atencao', attention);

  if (atual.query) params.set('busca', atual.query);
  if (mudanca.page && mudanca.page > 1) params.set('pagina', String(mudanca.page));

  const texto = params.toString();
  return texto ? `/central-de-trabalho?${texto}` : '/central-de-trabalho';
}

/** O acompanhamento e data civil: nunca passa por `new Date()` (ADR-017). */
function prazo(item: WorkCenterItem): string {
  return item.followUpAt ? formatCivilDateBR(item.followUpAt) : 'Sem acompanhamento';
}

function Sinais({ item }: { item: WorkCenterItem }) {
  if (item.flags.length === 0) return null;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {item.flags.map((flag) => (
        <Badge key={flag} tone={ATTENTION_FLAG_TONE[flag]}>
          {ATTENTION_FLAG_LABEL[flag]}
        </Badge>
      ))}
    </span>
  );
}

/** Garantia interna e classificacao OFICIAL da OS, nunca inferida de texto. */
function Classificacao({ item }: { item: WorkCenterItem }) {
  if (!item.classification || item.classification === 'standard') return null;
  return <Badge tone="brand">Garantia</Badge>;
}

export default async function WorkCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_WORK_CENTER,
    PERMISSIONS.WORK_CENTER_VIEW,
  );

  const params = await searchParams;
  const pagina = Number(single(params.pagina) ?? '1');

  const central = await loadWorkCenter(context, {
    view: single(params.visao),
    queue: conhecido(single(params.fila), isWorkQueue),
    attention: conhecido(single(params.atencao), isAttentionFlag),
    query: single(params.busca),
    page: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
  });

  const atual = {
    view: central.view,
    queue: central.queue,
    attention: central.attention,
    query: central.query,
  };

  const totalAtivo = central.summary.reduce((soma, s) => soma + s.total, 0);

  const sinais: Array<{ flag: AttentionFlag; total: number }> = [
    { flag: 'overdue_follow_up', total: central.attentionSummary.overdueFollowUp },
    { flag: 'overdue_task', total: central.attentionSummary.overdueTask },
    { flag: 'follow_up_today', total: central.attentionSummary.followUpToday },
    { flag: 'unassigned', total: central.attentionSummary.unassigned },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Central de Trabalho"
        description="O que precisa acontecer nesta unidade, na ordem em que precisa acontecer."
        breadcrumbs={[{ label: 'Central de Trabalho' }]}
        metadata={
          <span>
            {central.unitName ? `${central.unitName} · ` : ''}
            {totalAtivo === 1 ? '1 OS em aberto' : `${totalAtivo} OS em aberto`}
          </span>
        }
      />

      {!central.canSeeOrders ? (
        <Alert tone="warning">
          Voce tem acesso a Central, mas nao a visualizacao de Ordens de Servico desta unidade.
        </Alert>
      ) : null}

      {/* Visoes. Duas, e a diferenca entre elas e vinculo real com a pessoa. */}
      <nav aria-label="Visao da Central" className="flex flex-wrap gap-2">
        {WORK_VIEWS.map((view) => (
          <Link
            key={view}
            href={hrefCom(atual, { view, page: 1 })}
            aria-current={central.view === view ? 'page' : undefined}
            className={linkButtonClass(central.view === view ? 'primary' : 'secondary')}
          >
            {WORK_VIEW_LABEL[view]}
          </Link>
        ))}
      </nav>

      {/*
        RESUMO OPERACIONAL. Sao duas consultas agregadas para o bloco inteiro,
        nao uma por cartao (item 53). Cada cartao e um LINK que filtra a lista
        abaixo, e o cartao ativo se anuncia por `aria-current`, nao so por cor.
      */}
      <section aria-labelledby="filas" className="space-y-3">
        <h2 id="filas" className="text-h3 text-ink-900">
          Filas
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {central.summary.map((fila) => {
            const ativo = central.queue === fila.queue;
            return (
              <Link
                key={fila.queue}
                href={hrefCom(atual, {
                  queue: ativo ? null : fila.queue,
                  attention: null,
                  page: 1,
                })}
                aria-current={ativo ? 'true' : undefined}
                className={[
                  'min-w-0 rounded-lg border p-3 transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
                  ativo
                    ? 'border-brand-600 bg-brand-50 text-brand-900'
                    : 'border-ink-200 bg-surface hover:border-ink-300',
                ].join(' ')}
              >
                <span className="block text-h3 font-semibold">{fila.total}</span>
                <span className="block truncate text-small text-ink-600">{fila.label}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Sinais de atencao: fatos derivados, nunca estado da OS. */}
      <section aria-labelledby="atencao" className="space-y-3">
        <h2 id="atencao" className="text-h3 text-ink-900">
          Precisa de atencao
        </h2>
        <div className="flex flex-wrap gap-2">
          {sinais.map(({ flag, total }) => {
            const ativo = central.attention === flag;
            return (
              <Link
                key={flag}
                href={hrefCom(atual, { attention: ativo ? null : flag, queue: null, page: 1 })}
                aria-current={ativo ? 'true' : undefined}
                className={linkButtonClass(ativo ? 'primary' : 'secondary', 'sm', 'touch-target')}
              >
                {ATTENTION_FLAG_LABEL[flag]}: {total}
              </Link>
            );
          })}
        </div>
      </section>

      {/* Busca por numero da OS ou nome do cliente, via GET. */}
      <form method="get" className="flex flex-wrap items-end gap-2">
        {central.view !== 'unit' ? <input type="hidden" name="visao" value={central.view} /> : null}
        {central.queue ? <input type="hidden" name="fila" value={central.queue} /> : null}
        {central.attention ? (
          <input type="hidden" name="atencao" value={central.attention} />
        ) : null}

        <div className="min-w-0 flex-1">
          <label htmlFor="busca" className="mb-1.5 block text-small font-medium text-ink-700">
            Buscar por numero da OS ou cliente
          </label>
          <input
            id="busca"
            name="busca"
            type="search"
            maxLength={60}
            defaultValue={central.query}
            className="touch-target w-full rounded-md border border-ink-200 bg-surface px-3 text-body"
          />
        </div>
        <button type="submit" className={linkButtonClass('secondary', 'md')}>
          Buscar
        </button>
        {central.query || central.queue || central.attention ? (
          <Link
            href={hrefCom({ ...atual, query: '' }, { queue: null, attention: null, page: 1 })}
            className={linkButtonClass('ghost', 'md', 'touch-target')}
          >
            Limpar filtros
          </Link>
        ) : null}
      </form>

      {central.items.items.length === 0 ? (
        <EmptyState
          title="Nada nesta selecao"
          description={
            central.queue
              ? WORK_QUEUE_EMPTY[central.queue]
              : central.view === 'mine'
                ? 'Nenhuma Ordem de Servico atribuida a voce nesta unidade.'
                : 'Nenhuma Ordem de Servico em aberto nesta unidade.'
          }
        />
      ) : (
        <>
          {/* Tabela no desktop. */}
          <Card className="hidden md:block">
            <CardBody>
              <Table caption="Ordens de Servico em aberto, da mais urgente para a menos urgente">
                <THead>
                  <TR>
                    <TH>OS</TH>
                    <TH>Cliente e aparelho</TH>
                    <TH>Situacao</TH>
                    <TH>Responsavel</TH>
                    <TH>Acompanhamento</TH>
                    <TH>Acao</TH>
                  </TR>
                </THead>
                <TBody>
                  {central.items.items.map((item) => (
                    <TR key={item.serviceOrderId}>
                      <TD>
                        <span className="font-semibold text-ink-900">{item.number}</span>
                      </TD>
                      <TD>
                        <span className="block truncate font-medium text-ink-900">
                          {item.customerName}
                        </span>
                        <span className="block truncate text-small text-ink-500">
                          {item.equipmentSummary}
                        </span>
                      </TD>
                      <TD>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone="neutral">{statusLabel(item.status)}</Badge>
                          <Classificacao item={item} />
                          <Sinais item={item} />
                        </span>
                      </TD>
                      <TD>{item.assigneeName ?? 'Sem responsavel'}</TD>
                      <TD>{prazo(item)}</TD>
                      <TD>
                        <Link
                          href={`/ordens-de-servico/${item.serviceOrderId}`}
                          className={linkButtonClass('secondary', 'sm', 'touch-target')}
                        >
                          Abrir OS
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>

          {/* Cartoes no celular: tabela de seis colunas em 360px nao se le. */}
          <CardList label="Ordens de Servico em aberto" className="md:hidden">
            {central.items.items.map((item) => (
              <CardListItem key={item.serviceOrderId}>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral">{statusLabel(item.status)}</Badge>
                    <Classificacao item={item} />
                    <Sinais item={item} />
                  </div>

                  <p className="font-semibold text-ink-900">
                    OS {item.number} · {item.customerName}
                  </p>
                  <p className="truncate text-small text-ink-500">{item.equipmentSummary}</p>
                  <p className="text-small text-ink-500">
                    {item.assigneeName ?? 'Sem responsavel'} · {prazo(item)}
                  </p>

                  <Link
                    href={`/ordens-de-servico/${item.serviceOrderId}`}
                    className={linkButtonClass('secondary', 'sm', 'touch-target')}
                  >
                    Abrir OS
                  </Link>
                </div>
              </CardListItem>
            ))}
          </CardList>

          <Pagination
            page={central.items.page}
            pageCount={Math.max(1, Math.ceil(central.items.total / central.items.pageSize))}
            hrefFor={(page: number) => hrefCom(atual, { page })}
          />
        </>
      )}

      {/*
        O atalho para a Agenda so existe quando a Agenda existe. Link morto e
        pior do que ausencia: promete uma tela que vai recusar (item 50).
      */}
      {central.agendaAvailable ? (
        <nav aria-label="Atalhos" className="flex flex-wrap gap-2">
          <Link href="/minhas-tarefas" className={linkButtonClass('secondary')}>
            Minhas tarefas
          </Link>
          <Link href="/agenda" className={linkButtonClass('secondary')}>
            Agenda
          </Link>
        </nav>
      ) : null}
    </div>
  );
}

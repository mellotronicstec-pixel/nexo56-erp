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
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { listTasks, type TaskListRow } from '@/modules/agenda/application/agenda-queries';
import { listUnitMembers } from '@/modules/users/application/user-queries';
import {
  daysLate,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUSES,
  type AgendaTaskStatus,
  type TaskPriority,
} from '@/modules/agenda/domain/agenda';
import { NewTaskForm, TaskActions } from '../agenda/agenda-forms';
import { dataCivil, single } from '../agenda/format';

export const metadata: Metadata = { title: 'Tarefas da unidade' };

/**
 * TAREFAS DA UNIDADE (Prompt 14, itens 110 a 114).
 *
 * SO `agenda_tasks`, de proposito. Esta e a tela que EDITA, ATRIBUI e CANCELA,
 * e nenhuma dessas acoes se aplica a um registro de outro modulo: oferecer
 * "cancelar" para um acompanhamento de OS seria oferecer um botao que nao tem
 * o que fazer. Quem quer ver tudo junto abre a Agenda, que e leitura.
 *
 * A LISTA VIRA CARTOES NO CELULAR. Uma tabela de seis colunas em 360px ou rola
 * na horizontal — e a coluna de acoes fica fora da tela, que e justamente a
 * que a pessoa foi usar — ou espreme o titulo a ponto de ninguem ler.
 */

function Situacao({ row, hoje }: { row: TaskListRow; hoje: string }) {
  const atraso = row.overdue && row.dueDate ? daysLate(row.dueDate, hoje) : 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={row.status === 'open' ? 'brand' : 'neutral'}>
        {TASK_STATUS_LABEL[row.status as AgendaTaskStatus] ?? row.status}
      </Badge>
      {row.priority !== 'normal' ? (
        <Badge tone={row.priority === 'urgent' ? 'danger' : 'warning'}>
          {TASK_PRIORITY_LABEL[row.priority as TaskPriority]}
        </Badge>
      ) : null}
      {row.overdue ? (
        <Badge tone="danger">
          {atraso === 1 ? 'Atrasada ha 1 dia' : `Atrasada ha ${atraso} dias`}
        </Badge>
      ) : null}
    </div>
  );
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_AGENDA,
    PERMISSIONS.AGENDA_VIEW,
  );

  const params = await searchParams;
  const situacao = single(params.situacao) ?? 'open';
  const prioridade = single(params.prioridade) ?? null;
  const pagina = Number(single(params.pagina) ?? '1');

  const lista = await listTasks(context, {
    status: situacao === 'todas' ? null : situacao,
    priority: prioridade,
    page: Number.isFinite(pagina) ? pagina : 1,
  });

  const unidadeAtiva = context.activeUnitId;
  const membros = unidadeAtiva ? await listUnitMembers(context, unidadeAtiva) : [];

  const podeCriar = hasPermission(context, PERMISSIONS.AGENDA_TASKS_CREATE);
  const podeGerenciar = hasPermission(context, PERMISSIONS.AGENDA_TASKS_MANAGE);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Tarefas da unidade"
        description="O que a unidade tem em aberto, de quem e, e para quando."
        breadcrumbs={[{ label: 'Agenda', href: '/agenda' }, { label: 'Tarefas' }]}
        metadata={<span>{lista.total === 1 ? '1 tarefa' : `${lista.total} tarefas`}</span>}
        actions={
          <Link href="/agenda" className={linkButtonClass('primary')}>
            Ver a agenda
          </Link>
        }
      />

      <nav aria-label="Secoes da Agenda" className="flex flex-wrap gap-2">
        <Link href="/agenda" className={linkButtonClass('secondary')}>
          Agenda
        </Link>
        <Link href="/minhas-tarefas" className={linkButtonClass('secondary')}>
          Minhas tarefas
        </Link>
      </nav>

      {/*
        Filtro por GET, sem JavaScript: a URL carrega o estado, o botao Voltar
        funciona e o link pode ser mandado para outra pessoa.
      */}
      <FilterBar>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <label htmlFor="situacao" className="mb-1.5 block text-small font-medium text-ink-700">
              Situacao
            </label>
            <select
              id="situacao"
              name="situacao"
              defaultValue={situacao}
              className="touch-target rounded-md border border-ink-200 bg-surface px-3 text-body"
            >
              <option value="open">Abertas</option>
              {TASK_STATUSES.filter((s) => s !== 'open').map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
              <option value="todas">Todas</option>
            </select>
          </div>

          <div className="min-w-0">
            <label
              htmlFor="prioridade"
              className="mb-1.5 block text-small font-medium text-ink-700"
            >
              Prioridade
            </label>
            <select
              id="prioridade"
              name="prioridade"
              defaultValue={prioridade ?? ''}
              className="touch-target rounded-md border border-ink-200 bg-surface px-3 text-body"
            >
              <option value="">Todas</option>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className={linkButtonClass('secondary', 'md')}>
            Filtrar
          </button>
        </form>
      </FilterBar>

      {lista.rows.length === 0 ? (
        <EmptyState
          title="Nenhuma tarefa com esses filtros"
          description="Tarefas criadas por pessoas desta unidade aparecem aqui. As tarefas de fluxo das Ordens de Servico ficam na propria OS e na Agenda."
        />
      ) : (
        <>
          {/* Tabela no desktop. */}
          <Card className="hidden md:block">
            <CardBody>
              <Table caption="Tarefas da unidade, com prazo, responsavel e situacao">
                <THead>
                  <TR>
                    <TH>Tarefa</TH>
                    <TH>Prazo</TH>
                    <TH>Responsavel</TH>
                    <TH>Situacao</TH>
                    <TH>Acoes</TH>
                  </TR>
                </THead>
                <TBody>
                  {lista.rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link
                          href={`/tarefas/${row.id}`}
                          className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-2"
                        >
                          {row.title}
                        </Link>
                        {row.serviceOrderId ? (
                          <Link
                            href={`/ordens-de-servico/${row.serviceOrderId}`}
                            className="ml-2 text-small text-brand-700 underline"
                          >
                            OS {row.serviceOrderNumber}
                          </Link>
                        ) : null}
                      </TD>
                      <TD>{dataCivil(row.dueDate)}</TD>
                      <TD>{row.assigneeName ?? 'Sem responsavel'}</TD>
                      <TD>
                        <Situacao row={row} hoje={lista.today} />
                      </TD>
                      <TD>
                        <TaskActions
                          taskId={row.id}
                          version={row.version}
                          status={row.status}
                          assigneeId={row.assigneeId}
                          members={membros}
                          canManage={podeGerenciar}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>

          {/* Cartoes no celular. */}
          <CardList label="Tarefas da unidade" className="md:hidden">
            {lista.rows.map((row) => (
              <CardListItem key={row.id}>
                <div className="min-w-0 space-y-2">
                  <Situacao row={row} hoje={lista.today} />
                  <Link
                    href={`/tarefas/${row.id}`}
                    className="block font-medium text-ink-900 underline decoration-ink-300 underline-offset-2"
                  >
                    {row.title}
                  </Link>
                  <p className="text-small text-ink-500">
                    {dataCivil(row.dueDate)} · {row.assigneeName ?? 'Sem responsavel'}
                  </p>
                  {row.serviceOrderId ? (
                    <Link
                      href={`/ordens-de-servico/${row.serviceOrderId}`}
                      className={linkButtonClass('ghost', 'sm', 'touch-target')}
                    >
                      OS {row.serviceOrderNumber}
                    </Link>
                  ) : null}
                  <TaskActions
                    taskId={row.id}
                    version={row.version}
                    status={row.status}
                    assigneeId={row.assigneeId}
                    members={membros}
                    canManage={podeGerenciar}
                  />
                </div>
              </CardListItem>
            ))}
          </CardList>

          <Pagination
            page={lista.page}
            pageCount={Math.max(1, Math.ceil(lista.total / lista.pageSize))}
            hrefFor={(page: number) =>
              `/tarefas?situacao=${situacao}${prioridade ? `&prioridade=${prioridade}` : ''}&pagina=${page}`
            }
          />
        </>
      )}

      {podeCriar && unidadeAtiva ? (
        <section aria-labelledby="nova-tarefa" className="space-y-3">
          <h2 id="nova-tarefa" className="text-h3 text-ink-900">
            Nova tarefa
          </h2>
          <NewTaskForm
            unitId={unidadeAtiva}
            members={membros}
            currentUserId={context.userId}
            today={lista.today}
          />
        </section>
      ) : null}
    </div>
  );
}

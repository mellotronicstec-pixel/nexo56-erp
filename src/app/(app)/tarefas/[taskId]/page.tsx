import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  linkButtonClass,
  PageHeader,
} from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { findTask } from '@/modules/agenda/application/agenda-queries';
import { listUnitMembers } from '@/modules/users/application/user-queries';
import {
  daysLate,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type AgendaTaskStatus,
  type TaskPriority,
} from '@/modules/agenda/domain/agenda';
import { EditTaskForm, TaskActions } from '../../agenda/agenda-forms';
import { dataCivil } from '../../agenda/format';

export const metadata: Metadata = { title: 'Tarefa' };

/**
 * FICHA DA TAREFA (item 38).
 *
 * O QUE E EDITAVEL, e a lista curta e o ponto: titulo, prazo, prioridade e
 * observacoes. Origem (`created_by`, `idempotency_key`, empresa, unidade) e
 * metadados de conclusao NAO tem campo em lugar nenhum — sao fatos, nao
 * preferencias, e permitir edita-los transformaria o historico em rascunho.
 *
 * So a tarefa ABERTA e editavel. Depois de concluida ou cancelada, esta tela
 * vira consulta: mostrar o formulario e recusar a gravacao seria pior do que
 * nao mostrar.
 */
export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_AGENDA,
    PERMISSIONS.AGENDA_VIEW,
  );

  const { taskId } = await params;
  const task = await findTask(context, taskId);

  /** Tarefa de outra empresa e tarefa inexistente terminam no mesmo lugar. */
  if (!task) notFound();

  const membros = await listUnitMembers(context, task.unitId);
  const podeGerenciar = hasPermission(context, PERMISSIONS.AGENDA_TASKS_MANAGE);
  const atraso = task.overdue && task.dueDate ? daysLate(task.dueDate, task.today) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={task.title}
        description="Tarefa operacional. Concluir nao muda a situacao de nenhuma Ordem de Servico."
        breadcrumbs={[
          { label: 'Agenda', href: '/agenda' },
          { label: 'Tarefas', href: '/tarefas' },
          { label: 'Tarefa' },
        ]}
        actions={
          <Link href="/tarefas" className={linkButtonClass('secondary')}>
            Voltar para as tarefas
          </Link>
        }
      />

      <Card>
        <CardHeader title="Situacao" />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={task.status === 'open' ? 'brand' : 'neutral'}>
              {TASK_STATUS_LABEL[task.status as AgendaTaskStatus] ?? task.status}
            </Badge>
            <Badge tone={task.priority === 'urgent' ? 'danger' : 'neutral'}>
              {TASK_PRIORITY_LABEL[task.priority as TaskPriority]}
            </Badge>
            {task.overdue ? (
              <Badge tone="danger">
                {atraso === 1 ? 'Atrasada ha 1 dia' : `Atrasada ha ${atraso} dias`}
              </Badge>
            ) : null}
          </div>

          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-small text-ink-500">Prazo</dt>
              <dd className="text-ui text-ink-900">{dataCivil(task.dueDate)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-small text-ink-500">Responsavel</dt>
              <dd className="text-ui text-ink-900">{task.assigneeName ?? 'Sem responsavel'}</dd>
            </div>
            {task.serviceOrderId ? (
              <div className="min-w-0">
                <dt className="text-small text-ink-500">Ordem de Servico</dt>
                <dd className="text-ui text-ink-900">
                  <Link
                    href={`/ordens-de-servico/${task.serviceOrderId}`}
                    className="text-brand-700 underline"
                  >
                    OS {task.serviceOrderNumber}
                  </Link>
                </dd>
              </div>
            ) : null}
            {task.customerName ? (
              <div className="min-w-0">
                <dt className="text-small text-ink-500">Cliente</dt>
                <dd className="text-ui text-ink-900">{task.customerName}</dd>
              </div>
            ) : null}
          </dl>

          <TaskActions
            taskId={task.id}
            version={task.version}
            status={task.status}
            assigneeId={task.assigneeId}
            members={membros}
            canManage={podeGerenciar}
          />
        </CardBody>
      </Card>

      {task.status === 'open' ? (
        <Card>
          <CardHeader
            title="Editar"
            description="Origem e metadados de conclusao nao sao editaveis: sao fatos, nao preferencias."
          />
          <CardBody>
            <EditTaskForm
              taskId={task.id}
              version={task.version}
              title={task.title}
              notes={task.notes}
              priority={task.priority}
              dueDate={task.dueDate}
            />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

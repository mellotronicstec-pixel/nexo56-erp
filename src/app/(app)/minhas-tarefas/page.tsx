import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  linkButtonClass,
  PageHeader,
} from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { loadMyTasks } from '@/modules/agenda/application/agenda-queries';
import {
  AGENDA_ITEM_TYPE_LABEL,
  type AgendaItem,
  daysLate,
  TASK_BUCKET_LABEL,
  TASK_PRIORITY_LABEL,
  type TaskPriority,
} from '@/modules/agenda/domain/agenda';
import { CompleteAgendaItemButton } from '../agenda/agenda-forms';
import { dataCivil } from '../agenda/format';

export const metadata: Metadata = { title: 'Minhas tarefas' };

/**
 * MINHAS TAREFAS (Prompt 14, itens 33, 106 e 107).
 *
 * A Agenda responde "o que tem para esta semana?"; esta tela responde "o que
 * eu devo?". Por isso NAO HA RECORTE DE PERIODO aqui: o que venceu ha um mes e
 * o que nao tem prazo nenhum aparecem, porque sao exatamente os que ninguem
 * lembra sozinho.
 *
 * COMPROMISSO NAO ENTRA. Ele nao e divida — e hora reservada; o lugar dele e a
 * agenda. Misturar os dois faria a fila parecer maior do que o trabalho que
 * realmente falta fazer.
 *
 * A TELA E MOBILE-FIRST de verdade: e a que o tecnico abre no celular, em pe,
 * na frente da bancada. Cartoes empilhados, alvos de toque de 44px, e o balde
 * "Atrasadas" no topo — nao porque e o mais bonito, porque e o que nao pode
 * esperar a rolagem.
 */

function CartaoDaTarefa({ item, hoje }: { item: AgendaItem; hoje: string }) {
  const atraso = item.overdue && item.dueDate ? daysLate(item.dueDate, hoje) : 0;

  return (
    <li className="flex flex-col gap-3 border-b border-ink-100 py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={item.type === 'follow_up' ? 'warning' : 'brand'}>
            {AGENDA_ITEM_TYPE_LABEL[item.type]}
          </Badge>
          {item.priority && item.priority !== 'normal' ? (
            <Badge tone={item.priority === 'urgent' ? 'danger' : 'warning'}>
              {TASK_PRIORITY_LABEL[item.priority as TaskPriority]}
            </Badge>
          ) : null}
          {item.overdue ? (
            <Badge tone="danger">
              {atraso === 1 ? 'Atrasada ha 1 dia' : `Atrasada ha ${atraso} dias`}
            </Badge>
          ) : null}
        </div>

        <p className="font-medium text-ink-900">{item.title}</p>
        <p className="text-small text-ink-500">
          {dataCivil(item.dueDate)}
          {item.customerName ? ` · ${item.customerName}` : ''}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {item.serviceOrderId ? (
          <Link
            href={`/ordens-de-servico/${item.serviceOrderId}`}
            className={linkButtonClass('ghost', 'sm', 'touch-target')}
          >
            OS {item.serviceOrderNumber}
          </Link>
        ) : null}
        {item.type === 'task' || item.type === 'service_order_task' ? (
          <CompleteAgendaItemButton itemType={item.type} itemId={item.id} />
        ) : null}
      </div>
    </li>
  );
}

export default async function MyTasksPage() {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_AGENDA,
    PERMISSIONS.AGENDA_VIEW,
  );

  const minhas = await loadMyTasks(context);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Minhas tarefas"
        description="O que esta na sua mao, incluindo o que passou do prazo."
        breadcrumbs={[{ label: 'Agenda', href: '/agenda' }, { label: 'Minhas tarefas' }]}
        metadata={
          <span>
            {minhas.total === 1 ? '1 item em aberto' : `${minhas.total} itens em aberto`}
            {minhas.overdueCount > 0 ? ` · ${minhas.overdueCount} atrasados` : ''}
          </span>
        }
        actions={
          <Link href="/agenda" className={linkButtonClass('primary')}>
            Ver a agenda
          </Link>
        }
      />

      {minhas.buckets.length === 0 ? (
        <EmptyState
          title="Nada pendente com voce"
          description="Tarefas atribuidas a voce, tarefas de fluxo das suas OS e os acompanhamentos das ordens em que voce e o tecnico aparecem aqui."
        />
      ) : (
        <div className="space-y-4">
          {minhas.buckets.map((balde) => (
            <Card key={balde.bucket}>
              <CardHeader
                title={TASK_BUCKET_LABEL[balde.bucket]}
                description={balde.items.length === 1 ? '1 item' : `${balde.items.length} itens`}
              />
              <CardBody>
                <ul>
                  {balde.items.map((item) => (
                    <CartaoDaTarefa
                      key={`${item.type}:${item.id}`}
                      item={item}
                      hoje={minhas.today}
                    />
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  linkButtonClass,
  MetricCard,
  PageHeader,
} from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { loadAgenda } from '@/modules/agenda/application/agenda-queries';
import { listUnitMembers } from '@/modules/users/application/user-queries';
import {
  AGENDA_ITEM_TYPE_HINT,
  AGENDA_ITEM_TYPE_LABEL,
  type AgendaItem,
  daysLate,
  TASK_PRIORITY_LABEL,
  type TaskPriority,
} from '@/modules/agenda/domain/agenda';
import {
  AppointmentActions,
  CompleteAgendaItemButton,
  NewAppointmentForm,
  NewTaskForm,
} from './agenda-forms';
import { dataCivil, hora, single, tituloDoDia } from './format';

export const metadata: Metadata = { title: 'Agenda' };

/**
 * A AGENDA (Prompt 14, itens 102 a 109).
 *
 * Uma pergunta so: o que precisa acontecer, e quando. Quatro origens chegam
 * aqui — tarefa da Agenda, compromisso, tarefa de fluxo da OS e o proximo
 * ponto de atencao da OS — e cada uma continua identificavel, porque esconder
 * a procedencia faria alguem tentar concluir um acompanhamento como se fosse
 * tarefa (ADR-073).
 *
 * NADA E COPIADO. Esta tela LE as quatro tabelas; nenhum registro e projetado
 * em dois lugares, entao nao ha o que deduplicar (item 57).
 *
 * "HOJE" E DA EMPRESA, nao do navegador: a data civil vem pronta do servidor,
 * no fuso da loja. O dono viajando nao pode ver como atrasado o que na loja
 * ainda vence hoje.
 */

function tomDaOrigem(type: AgendaItem['type']): 'brand' | 'neutral' | 'warning' {
  if (type === 'follow_up') return 'warning';
  if (type === 'service_order_task') return 'neutral';
  return 'brand';
}

function LinhaDaAgenda({
  item,
  hoje,
  timeZone,
}: {
  item: AgendaItem;
  hoje: string;
  timeZone: string;
}) {
  const atraso = item.overdue && item.dueDate ? daysLate(item.dueDate, hoje) : 0;

  return (
    <li className="flex flex-col gap-2 border-b border-ink-100 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      {/* `min-w-0` permite o texto truncar em vez de empurrar a linha inteira. */}
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tomDaOrigem(item.type)}>{AGENDA_ITEM_TYPE_LABEL[item.type]}</Badge>

          {item.priority && item.priority !== 'normal' ? (
            <Badge tone={item.priority === 'urgent' ? 'danger' : 'warning'}>
              {TASK_PRIORITY_LABEL[item.priority as TaskPriority]}
            </Badge>
          ) : null}

          {/*
            "Atrasada" NUNCA e so a cor (item 122): vem com texto, para quem
            nao distingue vermelho saber igual.
          */}
          {item.overdue ? (
            <Badge tone="danger">
              {atraso === 1 ? 'Atrasada ha 1 dia' : `Atrasada ha ${atraso} dias`}
            </Badge>
          ) : null}
        </div>

        <p className="font-medium text-ink-900">{item.title}</p>

        <p className="text-small text-ink-500">
          {item.allDay
            ? 'Dia inteiro'
            : item.startAt
              ? `${hora(item.startAt, timeZone)}${item.endAt ? ` as ${hora(item.endAt, timeZone)}` : ''}`
              : `Prazo: ${dataCivil(item.dueDate)}`}
          {item.customerName ? ` · ${item.customerName}` : ''}
        </p>

        <p className="text-small text-ink-500">{AGENDA_ITEM_TYPE_HINT[item.type]}</p>
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

        {/*
          Compromisso e acompanhamento NAO tem "concluir" (itens 35 e 47): o
          tempo passar nao prova que a visita aconteceu, e um acompanhamento se
          reagenda, nao se conclui.
        */}
        {item.type === 'task' || item.type === 'service_order_task' ? (
          <CompleteAgendaItemButton itemType={item.type} itemId={item.id} />
        ) : null}

        {item.type === 'appointment' ? (
          <AppointmentActions appointmentId={item.id} today={hoje} />
        ) : null}
      </div>
    </li>
  );
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_AGENDA,
    PERMISSIONS.AGENDA_VIEW,
  );

  const params = await searchParams;

  const agenda = await loadAgenda(context, {
    from: single(params.de) ?? null,
    to: single(params.ate) ?? null,
    unitId: single(params.unidade) ?? null,
  });

  const unidadeAtiva = context.activeUnitId ?? agenda.unitIds[0] ?? null;
  const membros = unidadeAtiva ? await listUnitMembers(context, unidadeAtiva) : [];

  const podeCriarTarefa = hasPermission(context, PERMISSIONS.AGENDA_TASKS_CREATE);
  const podeCriarCompromisso = hasPermission(context, PERMISSIONS.AGENDA_APPOINTMENTS_MANAGE);

  const total = agenda.days.reduce((soma, dia) => soma + dia.items.length, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Agenda"
        description="O que precisa acontecer nesta unidade, e quando."
        breadcrumbs={[{ label: 'Agenda' }]}
        metadata={
          <span>
            {dataCivil(agenda.from)} a {dataCivil(agenda.to)}
          </span>
        }
        actions={
          <Link href="/minhas-tarefas" className={linkButtonClass('primary')}>
            Minhas tarefas
          </Link>
        }
      />

      {/*
        A NAVEGACAO DO MODULO FICA NO CORPO, nao no slot de acoes do
        PageHeader — que e `shrink-0` e faria a pagina rolar na horizontal em
        768px com tres botoes dentro.
      */}
      <nav aria-label="Secoes da Agenda" className="flex flex-wrap gap-2">
        <Link href="/tarefas" className={linkButtonClass('secondary')}>
          Tarefas da unidade
        </Link>
        <Link href="/minhas-tarefas" className={linkButtonClass('secondary')}>
          Minhas tarefas
        </Link>
      </nav>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <MetricCard label="Itens no periodo" value={String(total)} />
        </div>
        <div className="min-w-0">
          <MetricCard
            label="Atrasados"
            value={String(agenda.overdueCount)}
            hint={
              agenda.overdueCount > 0 ? 'Venceram e continuam abertos.' : 'Nada vencido em aberto.'
            }
          />
        </div>
      </div>

      {agenda.unitIds.length === 0 ? (
        <Alert tone="warning">
          Voce ainda nao tem acesso a nenhuma unidade com a Agenda disponivel.
        </Alert>
      ) : null}

      {agenda.days.length === 0 ? (
        <EmptyState
          title="Nada marcado para este periodo"
          description="Quando houver tarefa, compromisso ou acompanhamento de OS com prazo aqui dentro, eles aparecem nesta lista."
        />
      ) : (
        <div className="space-y-4">
          {agenda.days.map((dia) => (
            <Card key={dia.date ?? 'sem-dia'}>
              <CardHeader title={tituloDoDia(dia.date, agenda.today)} />
              <CardBody>
                <ul className="divide-y-0">
                  {dia.items.map((item) => (
                    <LinhaDaAgenda
                      key={`${item.type}:${item.id}`}
                      item={item}
                      hoje={agenda.today}
                      timeZone={agenda.timeZones[item.unitId] ?? context.tenantTimezone}
                    />
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {podeCriarTarefa && unidadeAtiva ? (
        <section aria-labelledby="nova-tarefa" className="space-y-3">
          <h2 id="nova-tarefa" className="text-h3 text-ink-900">
            Nova tarefa
          </h2>
          <NewTaskForm
            unitId={unidadeAtiva}
            members={membros}
            currentUserId={context.userId}
            today={agenda.today}
          />
        </section>
      ) : null}

      {podeCriarCompromisso && unidadeAtiva ? (
        <section aria-labelledby="novo-compromisso" className="space-y-3">
          <h2 id="novo-compromisso" className="text-h3 text-ink-900">
            Novo compromisso
          </h2>
          <NewAppointmentForm unitId={unidadeAtiva} members={membros} today={agenda.today} />
        </section>
      ) : null}
    </div>
  );
}

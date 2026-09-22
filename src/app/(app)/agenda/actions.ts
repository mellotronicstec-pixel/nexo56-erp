'use server';

import { revalidatePath } from 'next/cache';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { requireContext } from '@/modules/auth/application/current-context';
import { completeAgendaItem } from '@/modules/agenda/application/agenda-actions';
import {
  cancelAppointment,
  createAppointment,
  updateAppointment,
} from '@/modules/agenda/application/appointment-service';
import {
  assignTask,
  cancelTask,
  completeTask,
  createTask,
  updateTask,
} from '@/modules/agenda/application/task-service';
import { EMPTY_AGENDA_STATE, type AgendaActionState } from './action-state';
import { assertSameOrigin } from '../actions';

/**
 * Server Actions da Agenda (Prompt 14).
 *
 * CAMADA FINA DE PROPOSITO: le o formulario, chama o caso de uso, devolve
 * mensagem. Nenhuma regra mora aqui — nem a de quem pode concluir, nem a de
 * qual unidade, nem a de coerencia dos vinculos. Tudo isso o caso de uso
 * recalcula, porque a mesma regra tera de valer quando a chamada vier do
 * aplicativo ou da API.
 *
 * O NAVEGADOR NAO E AUTORIDADE sobre unidade, responsavel, empresa nem sobre
 * qual OS uma tarefa pode apontar. Ele manda o que o usuario digitou; o
 * backend confere tudo (itens 32, 43 e 44).
 */

async function run(
  operation: string,
  work: () => Promise<AgendaActionState>,
): Promise<AgendaActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      return await work();
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha em acao da agenda', {
          module: 'agenda',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...EMPTY_AGENDA_STATE, error: toUserMessage(error) };
    }
  });
}

function text(formData: FormData, field: string): string {
  return String(formData.get(field) ?? '').trim();
}

function optional(formData: FormData, field: string): string | undefined {
  const value = text(formData, field);
  return value === '' ? undefined : value;
}

function version(formData: FormData): number | undefined {
  const raw = optional(formData, 'expectedVersion');
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** As tres telas mostram os mesmos registros por angulos diferentes. */
function refresh(): void {
  revalidatePath('/agenda');
  revalidatePath('/tarefas');
  revalidatePath('/minhas-tarefas');
}

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

export async function createTaskAction(
  _previous: AgendaActionState,
  formData: FormData,
): Promise<AgendaActionState> {
  return run('createTask', async () => {
    const context = await requireContext();
    const { reused } = await createTask(context, {
      title: text(formData, 'title'),
      notes: optional(formData, 'notes'),
      unitId: optional(formData, 'unitId'),
      assigneeId: optional(formData, 'assigneeId'),
      priority: optional(formData, 'priority'),
      dueDate: optional(formData, 'dueDate'),
      serviceOrderId: optional(formData, 'serviceOrderId'),
      customerId: optional(formData, 'customerId'),
      equipmentId: optional(formData, 'equipmentId'),
      warrantyId: optional(formData, 'warrantyId'),
      /** Chave de intencao gerada pelo formulario: duplo clique reencontra. */
      idempotencyKey: optional(formData, 'commandKey'),
    });

    refresh();
    return {
      ...EMPTY_AGENDA_STATE,
      success: reused ? 'Esta tarefa ja tinha sido criada.' : 'Tarefa criada.',
    };
  });
}

export async function updateTaskAction(
  _previous: AgendaActionState,
  formData: FormData,
): Promise<AgendaActionState> {
  return run('updateTask', async () => {
    const context = await requireContext();
    await updateTask(context, text(formData, 'taskId'), {
      title: optional(formData, 'title'),
      notes: optional(formData, 'notes') ?? '',
      priority: optional(formData, 'priority'),
      dueDate: optional(formData, 'dueDate') ?? '',
      expectedVersion: version(formData),
    });

    refresh();
    return { ...EMPTY_AGENDA_STATE, success: 'Tarefa atualizada.' };
  });
}

export async function assignTaskAction(
  _previous: AgendaActionState,
  formData: FormData,
): Promise<AgendaActionState> {
  return run('assignTask', async () => {
    const context = await requireContext();
    await assignTask(
      context,
      text(formData, 'taskId'),
      optional(formData, 'assigneeId') ?? null,
      version(formData),
    );

    refresh();
    return { ...EMPTY_AGENDA_STATE, success: 'Responsavel atualizado.' };
  });
}

export async function completeTaskAction(
  _previous: AgendaActionState,
  formData: FormData,
): Promise<AgendaActionState> {
  return run('completeTask', async () => {
    const context = await requireContext();
    await completeTask(context, text(formData, 'taskId'), version(formData));

    refresh();
    return { ...EMPTY_AGENDA_STATE, success: 'Tarefa concluida.' };
  });
}

export async function cancelTaskAction(
  _previous: AgendaActionState,
  formData: FormData,
): Promise<AgendaActionState> {
  return run('cancelTask', async () => {
    const context = await requireContext();
    await cancelTask(
      context,
      text(formData, 'taskId'),
      text(formData, 'reason'),
      version(formData),
    );

    refresh();
    return { ...EMPTY_AGENDA_STATE, success: 'Tarefa cancelada.' };
  });
}

/**
 * Concluir o que esta na AGENDA, seja qual for a origem.
 *
 * A pessoa clica em "concluir" numa lista que mistura quatro procedencias. O
 * despacho por origem mora no modulo de agenda, e tarefa de fluxo da OS e
 * DELEGADA ao Prompt 08 — esta acao nao escreve em `service_order_tasks`.
 */
export async function completeAgendaItemAction(
  _previous: AgendaActionState,
  formData: FormData,
): Promise<AgendaActionState> {
  return run('completeAgendaItem', async () => {
    const context = await requireContext();
    await completeAgendaItem(
      context,
      text(formData, 'itemType'),
      text(formData, 'itemId'),
      version(formData),
    );

    refresh();
    revalidatePath('/ordens-de-servico');
    return { ...EMPTY_AGENDA_STATE, success: 'Item concluido.' };
  });
}

// ---------------------------------------------------------------------------
// Compromissos
// ---------------------------------------------------------------------------

/**
 * O formulario manda `allDay` mais um par de campos; o caso de uso exige a
 * uniao discriminada. A conversao e aqui porque e forma de entrada, nao regra.
 */
function whenFrom(formData: FormData) {
  const diaInteiro = text(formData, 'allDay') === 'on' || text(formData, 'allDay') === 'true';

  if (diaInteiro) {
    return {
      allDay: true as const,
      startDate: text(formData, 'startDate'),
      endDate: text(formData, 'endDate') || text(formData, 'startDate'),
    };
  }

  /**
   * HORARIO CIVIL, cru. A Server Action nao converte para instante: ela nao
   * sabe o fuso da unidade, e adivinhar aqui repetiria — no servidor — o
   * mesmo erro de deixar o navegador decidir (ADR-076).
   */
  return {
    allDay: false as const,
    startAtLocal: text(formData, 'startAtLocal'),
    endAtLocal: text(formData, 'endAtLocal'),
  };
}

export async function createAppointmentAction(
  _previous: AgendaActionState,
  formData: FormData,
): Promise<AgendaActionState> {
  return run('createAppointment', async () => {
    const context = await requireContext();
    const { reused } = await createAppointment(context, {
      title: text(formData, 'title'),
      notes: optional(formData, 'notes'),
      unitId: optional(formData, 'unitId'),
      assigneeId: optional(formData, 'assigneeId'),
      serviceOrderId: optional(formData, 'serviceOrderId'),
      customerId: optional(formData, 'customerId'),
      equipmentId: optional(formData, 'equipmentId'),
      warrantyId: optional(formData, 'warrantyId'),
      idempotencyKey: optional(formData, 'commandKey'),
      ...whenFrom(formData),
    });

    refresh();
    return {
      ...EMPTY_AGENDA_STATE,
      success: reused ? 'Este compromisso ja tinha sido criado.' : 'Compromisso criado.',
    };
  });
}

export async function updateAppointmentAction(
  _previous: AgendaActionState,
  formData: FormData,
): Promise<AgendaActionState> {
  return run('updateAppointment', async () => {
    const context = await requireContext();
    const reagendar = text(formData, 'reschedule') === 'true';

    await updateAppointment(context, text(formData, 'appointmentId'), {
      title: optional(formData, 'title'),
      notes: optional(formData, 'notes') ?? '',
      assigneeId: optional(formData, 'assigneeId'),
      clearAssignee: text(formData, 'clearAssignee') === 'true',
      expectedVersion: version(formData),
      ...(reagendar ? whenFrom(formData) : {}),
    });

    refresh();
    return {
      ...EMPTY_AGENDA_STATE,
      success: reagendar ? 'Compromisso reagendado.' : 'Compromisso atualizado.',
    };
  });
}

export async function cancelAppointmentAction(
  _previous: AgendaActionState,
  formData: FormData,
): Promise<AgendaActionState> {
  return run('cancelAppointment', async () => {
    const context = await requireContext();
    await cancelAppointment(
      context,
      text(formData, 'appointmentId'),
      text(formData, 'reason'),
      version(formData),
    );

    refresh();
    return { ...EMPTY_AGENDA_STATE, success: 'Compromisso cancelado.' };
  });
}

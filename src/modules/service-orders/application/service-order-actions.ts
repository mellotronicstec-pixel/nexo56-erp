import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { BusinessRuleError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { civilDaysFromNow, todayIn } from '@/core/time/civil-date';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  PART_PICKUP_TASK_TITLE,
  REASON_MAX,
  TASK_KINDS,
  statusLabel,
} from '@/modules/service-orders/domain/workflow';
import {
  createWorkflowTask,
  isDeliveryPreparationDone,
  loadOrderForWorkflow,
  transitionServiceOrder,
} from '@/modules/service-orders/application/workflow-service';
import {
  serviceOrderTasks,
  serviceOrderTimeline,
  serviceOrders,
} from '@/modules/service-orders/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * ACOES de negocio da Ordem de Servico (Prompt 08).
 *
 * A DIFERENCA QUE ESTE ARQUIVO EXISTE PARA PRESERVAR (itens 3, 13 e 16):
 *
 *   ESTADO  e onde a ordem esta.        -> `domain/workflow.ts`
 *   ACAO    e o que uma pessoa faz.     -> aqui
 *   EVENTO  e o que aconteceu.          -> outbox
 *
 * "Buscar Peca" e "Informar Ordem Disponivel" sao ACOES. Nenhuma das duas e
 * status, e a diferenca nao e semantica: transformar "buscar peca" em estado
 * significaria que uma ordem so pode estar buscando UMA peca por vez, que
 * buscar duas vezes apaga o registro da primeira, e que a lista de estados
 * cresce toda vez que alguem inventa um verbo novo.
 *
 * Uma acao pode causar transicao (informar disponivel leva a Aguardando
 * Cliente Retirar) ou nao causar nenhuma (buscar peca cria tarefa e a ordem
 * continua em Aguardando Peca).
 */

// ---------------------------------------------------------------------------
// Tecnico responsavel (itens 26 a 29)
// ---------------------------------------------------------------------------

export async function assignTechnician(
  context: TenantContext,
  serviceOrderId: string,
  technicianId: string | null,
): Promise<void> {
  const order = await loadOrderForWorkflow(context, serviceOrderId);

  await authorize(context, {
    permission: PERMISSIONS.SERVICE_ORDERS_ASSIGN_TECHNICIAN,
    featureKey: FEATURES.CORE_SERVICE_ORDERS,
    unitId: order.unitId,
  });

  if (technicianId) {
    /**
     * O CANDIDATO PRECISA PODER OPERAR NESTA UNIDADE (item 27).
     *
     * Tres condicoes, todas verificadas no banco: mesmo tenant, situacao ativa
     * e vinculo com a unidade da ordem. A FK composta ja impede outro tenant;
     * vinculo e situacao mudam com o tempo, entao sao consultados na hora.
     *
     * NAO se confia no NOME do papel (item 28): "Tecnico" e um rotulo que cada
     * empresa escreve como quiser. Quem pode ser responsavel e quem tem acesso
     * a unidade — a capacidade tecnica e decidida por quem atribui.
     */
    const [candidate] = await getDb()
      .select({ id: sql<string>`u.id`, name: sql<string>`u.name` })
      .from(sql`users u`)
      .innerJoin(sql`user_units uu`, sql`uu.user_id = u.id AND uu.unit_id = ${order.unitId}`)
      .where(
        sql`u.id = ${technicianId} AND u.tenant_id = ${context.tenantId} AND u.status = 'active'`,
      )
      .limit(1);

    if (!candidate) {
      throw new BusinessRuleError(
        'Esta pessoa nao esta ativa nem tem acesso a unidade desta Ordem de Servico.',
      );
    }
  }

  if (order.assignedTechnicianId === technicianId) return;

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx
      .update(serviceOrders)
      .set({ assignedTechnicianId: technicianId, updatedBy: context.userId, updatedAt: now })
      .where(
        and(eq(serviceOrders.tenantId, context.tenantId), eq(serviceOrders.id, serviceOrderId)),
      );

    await tx.insert(serviceOrderTimeline).values({
      id: newId(),
      tenantId: context.tenantId,
      serviceOrderId,
      kind: 'technician_assigned',
      summary: technicianId ? 'Tecnico responsavel definido' : 'Tecnico responsavel removido',
      metadata: { assigned: technicianId !== null },
      actorId: context.userId,
      occurredAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.SERVICE_ORDER_TECHNICIAN_ASSIGNED,
        entityType: 'service_order',
        entityId: serviceOrderId,
        tenantId: context.tenantId,
        unitId: order.unitId,
        userId: context.userId,
        before: { assignedTechnicianId: order.assignedTechnicianId },
        after: { assignedTechnicianId: technicianId },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.SERVICE_ORDER_TECHNICIAN_ASSIGNED,
      tenantId: context.tenantId,
      payload: {
        serviceOrderId,
        unitId: order.unitId,
        technicianId,
        actorId: context.userId,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Follow-up (itens 39 e 122)
// ---------------------------------------------------------------------------

export const rescheduleFollowUpSchema = z.object({
  /** Data civil ISO. String vazia encerra o acompanhamento. */
  followUpAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data valida.')
    .or(z.literal('')),
});

export async function rescheduleFollowUp(
  context: TenantContext,
  serviceOrderId: string,
  rawInput: unknown,
): Promise<void> {
  const parsed = rescheduleFollowUpSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Data invalida.');
  }

  const order = await loadOrderForWorkflow(context, serviceOrderId);

  await authorize(context, {
    permission: PERMISSIONS.SERVICE_ORDERS_MANAGE_FOLLOW_UP,
    featureKey: FEATURES.CORE_SERVICE_ORDERS,
    unitId: order.unitId,
  });

  const next = parsed.data.followUpAt || null;
  if (next === order.followUpAt) return;

  const now = new Date();

  await runInTransaction(async (tx) => {
    await tx
      .update(serviceOrders)
      .set({
        followUpAt: next,
        // Prazo novo volta a permitir alerta.
        followUpAlertedFor: null,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(
        and(eq(serviceOrders.tenantId, context.tenantId), eq(serviceOrders.id, serviceOrderId)),
      );

    await tx.insert(serviceOrderTimeline).values({
      id: newId(),
      tenantId: context.tenantId,
      serviceOrderId,
      kind: 'follow_up_rescheduled',
      summary: next ? `Acompanhamento reagendado para ${next}` : 'Acompanhamento encerrado',
      metadata: { from: order.followUpAt, to: next },
      actorId: context.userId,
      occurredAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.SERVICE_ORDER_FOLLOW_UP_RESCHEDULED,
        entityType: 'service_order',
        entityId: serviceOrderId,
        tenantId: context.tenantId,
        unitId: order.unitId,
        userId: context.userId,
        before: { followUpAt: order.followUpAt },
        after: { followUpAt: next },
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Acao: Buscar Peca (itens 13, 16 e 67)
// ---------------------------------------------------------------------------

export const requestPartPickupSchema = z.object({
  /** Observacao livre: qual peca, onde buscar. Curta e opcional. */
  note: z.string().trim().max(REASON_MAX).optional().or(z.literal('')),
});

/**
 * Registra a busca de uma peca.
 *
 * NAO MUDA O ESTADO: a ordem continua em Aguardando Peca, porque buscar a peca
 * nao e o mesmo que te-la. O que esta acao produz e uma TAREFA operacional e um
 * registro na linha do tempo.
 *
 * A regra original prevê mostrar locais de retirada. Estoque e Compras sao dos
 * Prompts 10 e 11 — inventar uma lista de fornecedores aqui criaria dado falso
 * que alguem usaria. Por ora a observacao e texto livre, e a estrutura aceita
 * um catalogo quando ele existir.
 */
export async function requestPartPickup(
  context: TenantContext,
  serviceOrderId: string,
  rawInput: unknown = {},
): Promise<void> {
  const parsed = requestPartPickupSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }

  const order = await loadOrderForWorkflow(context, serviceOrderId);

  await authorize(context, {
    permission: PERMISSIONS.SERVICE_ORDERS_MANAGE_TASKS,
    featureKey: FEATURES.CORE_SERVICE_ORDERS,
    unitId: order.unitId,
  });

  if (order.status !== 'awaiting_part') {
    throw new BusinessRuleError(
      `Buscar peca so faz sentido enquanto a Ordem de Servico esta ${statusLabel('awaiting_part')}.`,
    );
  }

  const note = (parsed.data.note ?? '').trim() || null;
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    const taskId = await createWorkflowTask(tx, context, {
      order,
      kind: TASK_KINDS.PART_PICKUP,
      title: PART_PICKUP_TASK_TITLE,
      description: note,
      assigneeId: order.assignedTechnicianId,
      dueDate: civilDaysFromNow(context.tenantTimezone, 1, now),
      now,
    });

    await tx.insert(serviceOrderTimeline).values({
      id: newId(),
      tenantId: context.tenantId,
      serviceOrderId,
      kind: 'part_pickup_requested',
      summary: 'Busca de peca registrada',
      metadata: { taskCreated: taskId !== null },
      reason: note,
      actorId: context.userId,
      occurredAt: now,
    });

    if (taskId) {
      await emit({
        type: EVENT_TYPES.SERVICE_ORDER_TASK_CREATED,
        tenantId: context.tenantId,
        payload: {
          serviceOrderId,
          unitId: order.unitId,
          taskId,
          kind: TASK_KINDS.PART_PICKUP,
        },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Tarefas (itens 31, 32, 121 e 131)
// ---------------------------------------------------------------------------

export async function completeTask(
  context: TenantContext,
  taskId: string,
): Promise<{ serviceOrderId: string; kind: string }> {
  const db = getDb();

  const [task] = await db
    .select()
    .from(serviceOrderTasks)
    .where(and(eq(serviceOrderTasks.tenantId, context.tenantId), eq(serviceOrderTasks.id, taskId)))
    .limit(1);

  if (!task) throw new NotFoundError('Tarefa nao encontrada.');
  if (!context.authorizedUnitIds.includes(task.unitId)) {
    throw new NotFoundError('Tarefa nao encontrada.');
  }

  await authorize(context, {
    permission: PERMISSIONS.SERVICE_ORDERS_MANAGE_TASKS,
    featureKey: FEATURES.CORE_SERVICE_ORDERS,
    unitId: task.unitId,
  });

  if (task.status !== 'open') {
    throw new BusinessRuleError('Esta tarefa ja foi encerrada.');
  }

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    /**
     * `WHERE status = 'open'` no proprio UPDATE: dois cliques simultaneos em
     * "Concluir" nao produzem dois registros de conclusao.
     */
    const updated = await tx
      .update(serviceOrderTasks)
      .set({
        status: 'done',
        openMarker: null,
        completedAt: now,
        completedBy: context.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(serviceOrderTasks.tenantId, context.tenantId),
          eq(serviceOrderTasks.id, taskId),
          eq(serviceOrderTasks.status, 'open'),
        ),
      );

    if (affectedRows(updated) === 0) throw new BusinessRuleError('Esta tarefa ja foi encerrada.');

    await tx.insert(serviceOrderTimeline).values({
      id: newId(),
      tenantId: context.tenantId,
      serviceOrderId: task.serviceOrderId,
      kind: 'task_completed',
      summary: `Tarefa concluida: ${task.title}`,
      metadata: { taskId, kind: task.kind },
      actorId: context.userId,
      occurredAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.SERVICE_ORDER_TASK_COMPLETED,
        entityType: 'service_order_task',
        entityId: taskId,
        tenantId: context.tenantId,
        unitId: task.unitId,
        userId: context.userId,
        after: { serviceOrderId: task.serviceOrderId, kind: task.kind },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.SERVICE_ORDER_TASK_COMPLETED,
      tenantId: context.tenantId,
      payload: {
        serviceOrderId: task.serviceOrderId,
        unitId: task.unitId,
        taskId,
        kind: task.kind,
        actorId: context.userId,
      },
    });
  });

  return { serviceOrderId: task.serviceOrderId, kind: task.kind };
}

// ---------------------------------------------------------------------------
// Acao: Informar Ordem Disponivel (itens 14, 17, 62 a 64 e 132 a 135)
// ---------------------------------------------------------------------------

/**
 * Avisa que o aparelho esta pronto para retirada.
 *
 * O QUE ESTA ACAO FAZ HOJE: valida a condicao, registra a intencao na linha do
 * tempo, publica o evento e leva a ordem para Aguardando Cliente Retirar.
 *
 * O QUE ELA NAO FAZ: enviar WhatsApp ou e-mail. Nao ha integracao de
 * comunicacao no sistema — isso e o Prompt 16. A interface diz exatamente isso,
 * porque escrever "mensagem enviada" quando nada saiu faria o atendente parar
 * de ligar para o cliente (item 64).
 */
export async function notifyCustomerReady(
  context: TenantContext,
  serviceOrderId: string,
  expectedVersion?: number,
): Promise<void> {
  const order = await loadOrderForWorkflow(context, serviceOrderId);

  if (order.status !== 'awaiting_delivery_preparation') {
    throw new BusinessRuleError(
      `Esta acao so esta disponivel quando a Ordem de Servico esta ${statusLabel('awaiting_delivery_preparation')}.`,
    );
  }

  const prepared = await isDeliveryPreparationDone(context, serviceOrderId);
  if (!prepared) {
    throw new BusinessRuleError('Conclua a preparacao para entrega antes de informar o cliente.');
  }

  await transitionServiceOrder(context, {
    serviceOrderId,
    to: 'awaiting_customer_pickup',
    expectedVersion,
    via: 'notify_customer_ready',
  });

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx.insert(serviceOrderTimeline).values({
      id: newId(),
      tenantId: context.tenantId,
      serviceOrderId,
      kind: 'customer_notification_requested',
      // Texto verdadeiro: o registro existe, o envio nao.
      summary: 'Cliente marcado como avisado. O envio automatico ainda nao esta disponivel.',
      metadata: { channel: null, delivered: false },
      actorId: context.userId,
      occurredAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.SERVICE_ORDER_CUSTOMER_NOTIFIED,
        entityType: 'service_order',
        entityId: serviceOrderId,
        tenantId: context.tenantId,
        unitId: order.unitId,
        userId: context.userId,
        after: { requested: true, delivered: false },
      },
      tx,
    );

    /**
     * O evento carrega a INTENCAO. Quando o Prompt 16 existir, e ele quem vai
     * consumir isto e mandar a mensagem de verdade — sem que este modulo
     * precise saber qual canal foi escolhido.
     */
    await emit({
      type: EVENT_TYPES.SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED,
      tenantId: context.tenantId,
      payload: {
        serviceOrderId,
        number: order.number,
        unitId: order.unitId,
        reason: 'ready_for_pickup',
        requestedBy: context.userId,
        delivered: false,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Acao: cancelar (item 53)
// ---------------------------------------------------------------------------

export const cancelSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Descreva o motivo do cancelamento.')
    .max(REASON_MAX, 'Motivo muito longo.'),
});

export async function cancelServiceOrder(
  context: TenantContext,
  serviceOrderId: string,
  rawInput: unknown,
  expectedVersion?: number,
): Promise<void> {
  const parsed = cancelSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Informe o motivo.');
  }

  await transitionServiceOrder(context, {
    serviceOrderId,
    to: 'cancelled',
    reason: parsed.data.reason,
    expectedVersion,
    via: 'cancel',
  });
}

// ---------------------------------------------------------------------------
// Pendencias (itens 40, 41 e 43)
// ---------------------------------------------------------------------------

export interface PendingWork {
  overdueOrders: {
    id: string;
    number: number;
    followUpAt: string;
    status: string;
    customerName: string;
  }[];
  dueTodayOrders: {
    id: string;
    number: number;
    followUpAt: string;
    status: string;
    customerName: string;
  }[];
  overdueTasks: {
    id: string;
    title: string;
    dueDate: string | null;
    serviceOrderId: string;
    serviceOrderNumber: number;
  }[];
}

/**
 * O que esta esperando atencao NESTA unidade.
 *
 * Nenhuma Ordem de Servico importante deve ser esquecida (item 41). Isto e uma
 * CONSULTA, nao uma tabela de alertas materializada: alerta materializado sai
 * do ar quando o job atrasa, e a resposta certa aqui e sempre a que o banco
 * tem agora.
 *
 * Nao e a Central de Trabalho (item 43): responde so "o que venceu e o que
 * vence hoje", sem priorizacao, carga por tecnico nem visao multiunidade.
 */
export async function loadPendingWork(context: TenantContext): Promise<PendingWork> {
  const empty: PendingWork = { overdueOrders: [], dueTodayOrders: [], overdueTasks: [] };
  if (!context.activeUnitId) return empty;

  const today = todayIn(context.tenantTimezone);
  const db = getDb();

  const [orders, tasks] = await Promise.all([
    db.execute(sql`
      SELECT so.id, so.number, so.follow_up_at AS followUpAt, so.status, c.name AS customerName
        FROM service_orders so
        JOIN customers c ON c.id = so.customer_id AND c.tenant_id = so.tenant_id
       WHERE so.tenant_id = ${context.tenantId}
         AND so.unit_id = ${context.activeUnitId}
         AND so.follow_up_at IS NOT NULL
         AND so.follow_up_at <= ${today}
         AND so.status NOT IN ('completed', 'cancelled')
       ORDER BY so.follow_up_at ASC, so.number ASC
       LIMIT 50
    `),
    db.execute(sql`
      SELECT t.id, t.title, t.due_date AS dueDate, t.service_order_id AS serviceOrderId,
             so.number AS serviceOrderNumber
        FROM service_order_tasks t
        JOIN service_orders so ON so.id = t.service_order_id AND so.tenant_id = t.tenant_id
       WHERE t.tenant_id = ${context.tenantId}
         AND t.unit_id = ${context.activeUnitId}
         AND t.status = 'open'
         AND t.due_date IS NOT NULL
         AND t.due_date < ${today}
       ORDER BY t.due_date ASC
       LIMIT 50
    `),
  ]);

  type OrderRow = PendingWork['overdueOrders'][number];
  const orderRows = ((orders as unknown as OrderRow[][])[0] ?? []) as OrderRow[];
  const taskRows = ((tasks as unknown as PendingWork['overdueTasks'][])[0] ??
    []) as PendingWork['overdueTasks'];

  return {
    overdueOrders: orderRows.filter((row) => row.followUpAt < today),
    dueTodayOrders: orderRows.filter((row) => row.followUpAt === today),
    overdueTasks: taskRows,
  };
}

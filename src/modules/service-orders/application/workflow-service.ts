import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { civilDaysFromNow } from '@/core/time/civil-date';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  DELIVERY_PREPARATION_DUE_DAYS,
  DELIVERY_PREPARATION_TASK_DESCRIPTION,
  DELIVERY_PREPARATION_TASK_TITLE,
  REASON_MAX,
  TASK_KINDS,
  explainRefusal,
  findTransition,
  followUpPolicyFor,
  isKnownStatus,
  statusLabel,
  type ServiceOrderStatus,
} from '@/modules/service-orders/domain/workflow';
import {
  serviceOrderTasks,
  serviceOrderTimeline,
  serviceOrders,
} from '@/modules/service-orders/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Execucao das transicoes da Ordem de Servico (Prompt 08).
 *
 * ESTA E A UNICA PORTA POR ONDE `status` MUDA (itens 7 e 9).
 *
 * Nao existe, em lugar nenhum do sistema, um `update(serviceOrders).set({
 * status })` fora deste arquivo. A maquina de estados (`domain/workflow.ts`)
 * diz o que e permitido; este servico executa, e faz isso sempre com o mesmo
 * pacote: valida, autoriza, grava com trava de versao, escreve a linha do
 * tempo, audita, ajusta follow-up, cria ou cancela tarefas e publica o evento.
 *
 * Se qualquer parte falhar, nada acontece — e uma transacao so.
 */

export interface TransitionInput {
  serviceOrderId: string;
  to: ServiceOrderStatus;
  /** Justificativa. Obrigatoria nas transicoes que a exigem. */
  reason?: string;
  /**
   * Versao que a pessoa viu na tela.
   *
   * Quando informada, a gravacao so acontece se a ordem continuar nessa versao
   * (item 11). Omitir e aceitar o estado atual, o que serve para chamadas do
   * proprio sistema.
   */
  expectedVersion?: number;
  /**
   * Nome da ACAO que originou a transicao, quando houver.
   *
   * Transicoes marcadas `actionOnly` na matriz so passam por aqui com este
   * campo preenchido — e o que impede "Informar Ordem Disponivel" de virar uma
   * opcao do seletor generico de situacao.
   */
  via?: string;
}

export interface TransitionResult {
  from: ServiceOrderStatus;
  to: ServiceOrderStatus;
  version: number;
}

interface OrderRow {
  id: string;
  unitId: string;
  number: number;
  status: string;
  version: number;
  followUpAt: string | null;
  createdBy: string | null;
  assignedTechnicianId: string | null;
}

/** Carrega a ordem dentro do tenant. Sem escopo nao ha leitura. */
export async function loadOrderForWorkflow(
  context: TenantContext,
  serviceOrderId: string,
): Promise<OrderRow> {
  const [row] = await getDb()
    .select({
      id: serviceOrders.id,
      unitId: serviceOrders.unitId,
      number: serviceOrders.number,
      status: serviceOrders.status,
      version: serviceOrders.version,
      followUpAt: serviceOrders.followUpAt,
      createdBy: serviceOrders.createdBy,
      assignedTechnicianId: serviceOrders.assignedTechnicianId,
    })
    .from(serviceOrders)
    .where(and(eq(serviceOrders.tenantId, context.tenantId), eq(serviceOrders.id, serviceOrderId)))
    .limit(1);

  if (!row) throw new NotFoundError('Ordem de Servico nao encontrada.');

  /**
   * A ordem e da UNIDADE (Prompt 07, ADR-033). Quem nao opera nela recebe
   * "nao encontrada" — nunca "sem permissao", que confirmaria a existencia.
   */
  if (!context.authorizedUnitIds.includes(row.unitId)) {
    throw new NotFoundError('Ordem de Servico nao encontrada.');
  }

  return row;
}

function normalizeReason(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  return value.slice(0, REASON_MAX);
}

/**
 * Executa uma transicao.
 *
 * A ordem das verificacoes importa: primeiro a existencia e o escopo, depois a
 * regra de workflow, depois a autorizacao. Autorizar antes de saber se a
 * transicao existe faria o sistema responder "sem permissao" para algo que
 * simplesmente nao e possivel.
 */
export async function transitionServiceOrder(
  context: TenantContext,
  input: TransitionInput,
): Promise<TransitionResult> {
  if (!isKnownStatus(input.to)) {
    throw new ValidationError('Situacao de destino desconhecida.');
  }

  const order = await loadOrderForWorkflow(context, input.serviceOrderId);
  const from = order.status;

  const rule = findTransition(from, input.to);
  if (!rule) throw new BusinessRuleError(explainRefusal(from, input.to));

  if (rule.actionOnly && !input.via) {
    throw new BusinessRuleError(
      `A situacao ${statusLabel(input.to)} so pode ser alcancada pela acao correspondente.`,
    );
  }

  const reason = normalizeReason(input.reason);
  if (rule.requiresReason && !reason) {
    throw new ValidationError('Informe o motivo para continuar.');
  }

  /**
   * AUTORIZACAO NO ESCOPO DA UNIDADE DA ORDEM (item 72).
   *
   * Nao e a unidade ativa da sessao: e a unidade da ORDEM. Alguem com acesso a
   * duas lojas nao deve conseguir mover o trabalho da loja B por estar com a
   * loja A selecionada no seletor.
   */
  await authorize(context, {
    permission: rule.permission,
    featureKey: FEATURES.CORE_SERVICE_ORDERS,
    unitId: order.unitId,
  });

  const policy = followUpPolicyFor(input.to);
  const now = new Date();

  const nextFollowUp =
    policy.kind === 'set'
      ? civilDaysFromNow(context.tenantTimezone, policy.days, now)
      : policy.kind === 'clear'
        ? null
        : order.followUpAt;

  const nextVersion = order.version + 1;

  await runInTransaction(async (tx, emit) => {
    /**
     * COMPARE-AND-SWAP (item 11).
     *
     * O `WHERE` carrega o estado E a versao que foram lidos. Se outra pessoa
     * gravou no intervalo, nenhuma linha e afetada e a transicao inteira volta
     * atras — ninguem sobrescreve a decisao de ninguem em silencio.
     */
    const updated = await tx
      .update(serviceOrders)
      .set({
        status: input.to,
        statusChangedAt: now,
        version: nextVersion,
        followUpAt: nextFollowUp,
        // Prazo novo merece alerta novo.
        followUpAlertedFor: policy.kind === 'keep' ? undefined : null,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(serviceOrders.tenantId, context.tenantId),
          eq(serviceOrders.id, order.id),
          eq(serviceOrders.status, from),
          input.expectedVersion === undefined
            ? eq(serviceOrders.version, order.version)
            : eq(serviceOrders.version, input.expectedVersion),
        ),
      );

    if (affectedRows(updated) === 0) {
      throw new ConflictError(
        'Esta Ordem de Servico foi alterada por outra pessoa enquanto voce trabalhava nela. Recarregue a pagina e tente de novo.',
      );
    }

    await tx.insert(serviceOrderTimeline).values({
      id: newId(),
      tenantId: context.tenantId,
      serviceOrderId: order.id,
      kind: 'status_changed',
      summary: `${statusLabel(from)} para ${statusLabel(input.to)}`,
      // Sem PII: so as chaves tecnicas do fato.
      metadata: { from, to: input.to, via: input.via ?? null },
      reason,
      actorId: context.userId,
      occurredAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.SERVICE_ORDER_STATUS_CHANGED,
        entityType: 'service_order',
        entityId: order.id,
        tenantId: context.tenantId,
        unitId: order.unitId,
        userId: context.userId,
        before: { status: from, version: order.version },
        after: { status: input.to, version: nextVersion, via: input.via ?? null },
      },
      tx,
    );

    await applyStateSideEffects(tx, context, {
      order,
      to: input.to,
      now,
    });

    /**
     * EVENTO DE TRANSICAO (item 49).
     *
     * Payload minimo e sem PII. E o gancho de que o Prompt 16 (comunicacao) e o
     * Prompt 19 (automacoes) vao precisar — inclusive para a notificacao ao
     * administrador prevista no item 48, que hoje NAO existe como canal.
     */
    await emit({
      type: EVENT_TYPES.SERVICE_ORDER_STATUS_CHANGED,
      tenantId: context.tenantId,
      payload: {
        serviceOrderId: order.id,
        number: order.number,
        unitId: order.unitId,
        from,
        to: input.to,
        via: input.via ?? null,
        actorId: context.userId,
        occurredAt: now.toISOString(),
        hasReason: reason !== null,
      },
    });
  });

  return { from: from as ServiceOrderStatus, to: input.to, version: nextVersion };
}

/**
 * Efeitos colaterais de ENTRAR num estado.
 *
 * Ficam aqui, dentro da transacao da transicao, e nao num handler de evento:
 * a tarefa de preparacao precisa existir no instante em que a ordem chega ao
 * estado que a exige (item 98). Se dependesse de entrega de evento, haveria uma
 * janela em que a bancada teria trabalho a fazer e nenhuma tarefa dizendo isso.
 */
async function applyStateSideEffects(
  tx: TransactionExecutor,
  context: TenantContext,
  args: { order: OrderRow; to: ServiceOrderStatus; now: Date },
): Promise<void> {
  const { order, to, now } = args;

  if (to === 'awaiting_delivery_preparation') {
    await createWorkflowTask(tx, context, {
      order,
      kind: TASK_KINDS.DELIVERY_PREPARATION,
      title: DELIVERY_PREPARATION_TASK_TITLE,
      description: DELIVERY_PREPARATION_TASK_DESCRIPTION,
      /**
       * Responsavel: QUEM ABRIU A ORDEM (itens 24 e 25).
       *
       * A regra oficial atribui a preparacao a quem criou a OS. Quando esse
       * usuario nao existe mais ou perdeu acesso a unidade, a tarefa fica SEM
       * responsavel e aparece nas pendencias da unidade — melhor do que
       * atribuir a alguem escolhido pelo sistema, que ninguem saberia que
       * recebeu.
       */
      assigneeId: await resolveAssignee(tx, context, order),
      dueDate: civilDaysFromNow(context.tenantTimezone, DELIVERY_PREPARATION_DUE_DAYS, now),
      now,
    });
  }

  /** Ordem encerrada nao deixa trabalho aberto atras de si (itens 53 e 127). */
  if (to === 'completed' || to === 'cancelled') {
    await cancelOpenTasks(tx, context, order, now);
  }
}

/** Devolve o criador da ordem se ele ainda puder operar na unidade dela. */
async function resolveAssignee(
  tx: TransactionExecutor,
  context: TenantContext,
  order: OrderRow,
): Promise<string | null> {
  if (!order.createdBy) return null;

  const rows = await tx.execute(sql`
    SELECT u.id
      FROM users u
      JOIN user_units uu ON uu.user_id = u.id AND uu.unit_id = ${order.unitId}
     WHERE u.id = ${order.createdBy}
       AND u.tenant_id = ${context.tenantId}
       AND u.status = 'active'
     LIMIT 1
  `);

  const found = (rows as unknown as Array<Array<{ id: string }>>)[0]?.[0]?.id;
  return found ?? null;
}

export interface CreateTaskArgs {
  order: Pick<OrderRow, 'id' | 'unitId'>;
  kind: string;
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  now: Date;
}

/**
 * Cria uma tarefa de workflow, uma vez.
 *
 * A UNIQUE `(service_order_id, kind, open_marker)` garante que reprocessar um
 * evento ou clicar duas vezes nao encha a bancada de tarefas identicas (itens
 * 101 e 130). Quando a tarefa aberta ja existe, esta funcao nao faz nada — e
 * nao e erro: o estado desejado ja e o estado atual.
 */
export async function createWorkflowTask(
  tx: TransactionExecutor,
  context: TenantContext,
  args: CreateTaskArgs,
): Promise<string | null> {
  const existing = await tx
    .select({ id: serviceOrderTasks.id })
    .from(serviceOrderTasks)
    .where(
      and(
        eq(serviceOrderTasks.tenantId, context.tenantId),
        eq(serviceOrderTasks.serviceOrderId, args.order.id),
        eq(serviceOrderTasks.kind, args.kind),
        eq(serviceOrderTasks.status, 'open'),
      ),
    )
    .limit(1);

  if (existing.length > 0) return null;

  const taskId = newId();

  await tx.insert(serviceOrderTasks).values({
    id: taskId,
    tenantId: context.tenantId,
    unitId: args.order.unitId,
    serviceOrderId: args.order.id,
    kind: args.kind,
    title: args.title,
    description: args.description ?? null,
    assigneeId: args.assigneeId ?? null,
    dueDate: args.dueDate ?? null,
    status: 'open',
    openMarker: 1,
    createdBy: context.userId,
    createdAt: args.now,
    updatedAt: args.now,
  });

  await recordAudit(
    {
      action: AUDIT_ACTIONS.SERVICE_ORDER_TASK_CREATED,
      entityType: 'service_order_task',
      entityId: taskId,
      tenantId: context.tenantId,
      unitId: args.order.unitId,
      userId: context.userId,
      after: {
        serviceOrderId: args.order.id,
        kind: args.kind,
        hasAssignee: Boolean(args.assigneeId),
      },
    },
    tx,
  );

  return taskId;
}

/**
 * Encerra as tarefas abertas de uma ordem. Usado ao finalizar e ao cancelar.
 *
 * Cada tarefa encerrada gera seu proprio registro de auditoria: "a ordem foi
 * cancelada" nao explica, meses depois, por que a tarefa de preparacao que
 * estava na bancada de alguem sumiu.
 */
async function cancelOpenTasks(
  tx: TransactionExecutor,
  context: TenantContext,
  order: OrderRow,
  now: Date,
): Promise<void> {
  const open = await tx
    .select({ id: serviceOrderTasks.id, kind: serviceOrderTasks.kind })
    .from(serviceOrderTasks)
    .where(
      and(
        eq(serviceOrderTasks.tenantId, context.tenantId),
        eq(serviceOrderTasks.serviceOrderId, order.id),
        eq(serviceOrderTasks.status, 'open'),
      ),
    );

  if (open.length === 0) return;

  await tx
    .update(serviceOrderTasks)
    .set({ status: 'cancelled', openMarker: null, updatedAt: now })
    .where(
      and(
        eq(serviceOrderTasks.tenantId, context.tenantId),
        eq(serviceOrderTasks.serviceOrderId, order.id),
        eq(serviceOrderTasks.status, 'open'),
      ),
    );

  for (const task of open) {
    await recordAudit(
      {
        action: AUDIT_ACTIONS.SERVICE_ORDER_TASK_CANCELLED,
        entityType: 'service_order_task',
        entityId: task.id,
        tenantId: context.tenantId,
        unitId: order.unitId,
        userId: context.userId,
        before: { status: 'open' },
        after: { status: 'cancelled', reason: 'service_order_closed', kind: task.kind },
      },
      tx,
    );
  }
}

/**
 * `true` quando a preparacao para entrega ja foi concluida.
 *
 * E a condicao da acao "Informar Ordem Disponivel" (itens 62 e 132): avisar o
 * cliente antes da limpeza e da conferencia significa o aparelho chegar ao
 * balcao sujo, com o cliente ja na porta.
 */
export async function isDeliveryPreparationDone(
  context: TenantContext,
  serviceOrderId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: serviceOrderTasks.id })
    .from(serviceOrderTasks)
    .where(
      and(
        eq(serviceOrderTasks.tenantId, context.tenantId),
        eq(serviceOrderTasks.serviceOrderId, serviceOrderId),
        eq(serviceOrderTasks.kind, TASK_KINDS.DELIVERY_PREPARATION),
        eq(serviceOrderTasks.status, 'done'),
      ),
    )
    .limit(1);

  return Boolean(row);
}

/** Tarefas abertas de uma ordem, para a ficha e para as pendencias. */
export async function listOpenTasks(context: TenantContext, serviceOrderId: string) {
  return getDb()
    .select()
    .from(serviceOrderTasks)
    .where(
      and(
        eq(serviceOrderTasks.tenantId, context.tenantId),
        eq(serviceOrderTasks.serviceOrderId, serviceOrderId),
        isNull(serviceOrderTasks.completedAt),
        eq(serviceOrderTasks.status, 'open'),
      ),
    );
}

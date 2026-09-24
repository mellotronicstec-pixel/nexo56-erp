import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { affectedRows } from '@/core/db/affected-rows';
import { isDuplicateKeyError } from '@/core/db/duplicate-key';
import { runInTransaction } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import { checkFeatureEnabledForTenant } from '@/modules/features/application/effective-access';
import { tenants } from '@/modules/tenancy/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  CANCEL_REASON_MAX,
  CANCEL_REASON_MIN,
  canCancel,
  canComplete,
  canEdit,
  explainNotOpen,
  TASK_NOTES_MAX,
  TASK_PRIORITIES,
  TASK_TITLE_MAX,
} from '@/modules/agenda/domain/agenda';
import { agendaTasks } from '@/modules/agenda/infrastructure/schema';
import { addDays, todayIn } from '@/core/time/civil-date';
import { assertContextLinks } from './agenda-links';
import { assertAssignee, blank, parse, resolveUnit } from './agenda-guards';

/**
 * TAREFAS OPERACIONAIS (Prompt 14).
 *
 * O QUE UMA TAREFA E: algo que uma pessoa precisa fazer, nesta unidade, com
 * prazo e responsavel opcionais. Pode apontar para uma Ordem de Servico, um
 * cliente, um aparelho ou uma garantia — ou para nada, porque "conferir a
 * documentacao do fornecedor" e trabalho real sem OS nenhuma.
 *
 * O QUE ELA NAO E, e o modulo inteiro depende disso:
 *
 * NAO E ESTADO DA OS. Nada aqui escreve `service_orders.status`. Concluir a
 * tarefa de preparacao nao move a ordem; quem move e a transicao oficial do
 * Prompt 08, por decisao de uma pessoa (item 8).
 *
 * NAO E TAREFA DE FLUXO DA OS. Aquelas vivem em `service_order_tasks` desde o
 * Prompt 08, com uma aberta por tipo por ordem, e a Agenda as LE sem copiar.
 * Criar aqui uma segunda copia da preparacao para entrega produziria duas
 * verdades sobre o mesmo trabalho (ADR-073).
 *
 * NAO E NOTIFICACAO. Criar "ligar para o cliente" nao liga para ninguem.
 */

const linkSchema = z.string().trim().optional().or(z.literal(''));

const createSchema = z.object({
  title: z.string().trim().min(1, 'Descreva o que precisa ser feito.').max(TASK_TITLE_MAX),
  notes: z.string().trim().max(TASK_NOTES_MAX).optional().or(z.literal('')),
  unitId: linkSchema,
  assigneeId: linkSchema,
  priority: z.enum(TASK_PRIORITIES).optional(),
  /** Data civil `AAAA-MM-DD`. Prazo e dia, nao instante (ADR-074). */
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe um prazo valido.')
    .optional()
    .or(z.literal('')),
  serviceOrderId: linkSchema,
  customerId: linkSchema,
  equipmentId: linkSchema,
  warrantyId: linkSchema,
  idempotencyKey: z.string().trim().max(120).optional().or(z.literal('')),
});

export type CreateTaskInput = z.infer<typeof createSchema>;

export interface CreatedTask {
  taskId: string;
  /** `true` quando a chave de intencao reencontrou uma tarefa ja criada. */
  reused: boolean;
}

/**
 * Cria uma tarefa operacional.
 *
 * IDEMPOTENTE POR CHAVE DE INTENCAO (itens 40, 41 e 148). O formulario gera
 * uma chave por montagem; duplo clique reencontra a tarefa em vez de criar a
 * segunda. A trava e do BANCO — `UNIQUE (tenant_id, idempotency_key)` —, nao
 * um `SELECT` antes do `INSERT`, que perderia a corrida entre dois pedidos
 * simultaneos.
 */
export async function createTask(context: TenantContext, rawInput: unknown): Promise<CreatedTask> {
  const input = parse(createSchema, rawInput);
  const unitId = resolveUnit(context, blank(input.unitId));

  await authorize(context, {
    permission: PERMISSIONS.AGENDA_TASKS_CREATE,
    featureKey: FEATURES.OPERATIONS_AGENDA,
    unitId,
  });

  const assigneeId = blank(input.assigneeId);
  if (assigneeId) {
    /**
     * Atribuir a OUTRA pessoa exige chave propria (item 82); pegar a tarefa
     * para si nao exige — quem cria trabalho pode assumi-lo.
     */
    if (assigneeId !== context.userId) {
      await authorize(context, {
        permission: PERMISSIONS.AGENDA_TASKS_ASSIGN,
        featureKey: FEATURES.OPERATIONS_AGENDA,
        unitId,
      });
    }
    await assertAssignee(context, assigneeId, unitId);
  }

  const links = await assertContextLinks(context, {
    unitId,
    serviceOrderId: blank(input.serviceOrderId),
    customerId: blank(input.customerId),
    equipmentId: blank(input.equipmentId),
    warrantyId: blank(input.warrantyId),
  });

  const idempotencyKey = blank(input.idempotencyKey);
  if (idempotencyKey) {
    const [existing] = await getDb()
      .select({ id: agendaTasks.id })
      .from(agendaTasks)
      .where(
        and(
          eq(agendaTasks.tenantId, context.tenantId),
          eq(agendaTasks.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    if (existing) return { taskId: existing.id, reused: true };
  }

  const taskId = newId();
  const now = new Date();

  try {
    await runInTransaction(async (tx, emit) => {
      await tx.insert(agendaTasks).values({
        id: taskId,
        tenantId: context.tenantId,
        unitId,
        title: input.title,
        notes: blank(input.notes),
        status: 'open',
        priority: input.priority ?? 'normal',
        dueDate: blank(input.dueDate),
        assigneeId,
        createdBy: context.userId,
        idempotencyKey,
        serviceOrderId: links.serviceOrderId,
        customerId: links.customerId,
        equipmentId: links.equipmentId,
        warrantyId: links.warrantyId,
        createdAt: now,
        updatedAt: now,
      });

      await recordAudit(
        {
          action: AUDIT_ACTIONS.TASK_CREATED,
          entityType: 'agenda_task',
          entityId: taskId,
          tenantId: context.tenantId,
          unitId,
          userId: context.userId,
          /** Identificadores e metadados; o texto da tarefa fica na tabela. */
          after: {
            priority: input.priority ?? 'normal',
            hasDueDate: Boolean(blank(input.dueDate)),
            hasAssignee: Boolean(assigneeId),
            serviceOrderId: links.serviceOrderId,
          },
        },
        tx,
      );

      await emit({
        type: EVENT_TYPES.TASK_CREATED,
        tenantId: context.tenantId,
        payload: {
          taskId,
          unitId,
          assigneeId,
          serviceOrderId: links.serviceOrderId,
        },
      });
    });
  } catch (error) {
    /**
     * Outra requisicao gravou a mesma chave entre a consulta e o `INSERT`.
     * Quem clicou duas vezes recebe a tarefa, nao um erro.
     */
    if (idempotencyKey && isDuplicateKeyError(error)) {
      const [winner] = await getDb()
        .select({ id: agendaTasks.id })
        .from(agendaTasks)
        .where(
          and(
            eq(agendaTasks.tenantId, context.tenantId),
            eq(agendaTasks.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);

      if (winner) return { taskId: winner.id, reused: true };
    }
    throw error;
  }

  return { taskId, reused: false };
}

// ---------------------------------------------------------------------------
// Acao de automacao (Prompt 19)
// ---------------------------------------------------------------------------

export interface AutomationTaskInput {
  tenantId: string;
  unitId: string;
  /** Texto estatico da regra (item 37) — nunca interpretado, nunca eval. */
  title: string;
  notes?: string | null;
  /** Dias corridos a partir de hoje, no fuso do tenant (item 38). Sem hora:
   *  `agenda_tasks.due_date` e data civil, nunca instante (ADR-074). */
  dueOffsetDays?: number;
  serviceOrderId?: string | null;
  customerId?: string | null;
  equipmentId?: string | null;
  warrantyId?: string | null;
  /** `automation:{executionId}:action:{actionIndex}` (item 33). */
  idempotencyKey: string;
}

export interface AutomationTaskResult {
  outcome: 'created' | 'reused' | 'skipped';
  taskId?: string;
  errorCode?: string;
  errorDetail?: string;
}

/**
 * CRIA UMA TAREFA A PARTIR DE UMA REGRA DE AUTOMACAO — SEM `TenantContext`.
 *
 * Mesma justificativa de `createMessageFromAutomation` (item 65 a 68): a
 * permissao de configurar esta acao ja foi checada quando uma pessoa criou
 * ou habilitou a regra; em runtime o Motor so revalida a FEATURE do tenant
 * e os invariantes do proprio dominio (vinculos existem? sao coerentes
 * entre si?) — nunca finge ser um usuario.
 *
 * SEM RESPONSAVEL (item 35 e 36 do dominio): a tarefa nasce sem
 * `assigneeId`, na mesma fila "sem dono" que qualquer tarefa manual sem
 * atribuicao — o Motor nao decide QUEM faz o trabalho, so QUE o trabalho
 * precisa existir.
 */
export async function createTaskFromAutomation(
  input: AutomationTaskInput,
): Promise<AutomationTaskResult> {
  const [tenant] = await getDb()
    .select({ planId: tenants.planId, timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  if (!tenant) {
    return {
      outcome: 'skipped',
      errorCode: 'TENANT_NOT_FOUND',
      errorDetail: 'Tenant nao encontrado.',
    };
  }

  const acesso = await checkFeatureEnabledForTenant(
    { tenantId: input.tenantId, planId: tenant.planId },
    FEATURES.OPERATIONS_AGENDA,
  );
  if (!acesso.allowed) {
    return {
      outcome: 'skipped',
      errorCode: 'ACTION_FEATURE_DISABLED',
      errorDetail: acesso.message,
    };
  }

  const existing = await getDb()
    .select({ id: agendaTasks.id })
    .from(agendaTasks)
    .where(
      and(
        eq(agendaTasks.tenantId, input.tenantId),
        eq(agendaTasks.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing[0]) return { outcome: 'reused', taskId: existing[0].id };

  let links: Awaited<ReturnType<typeof assertContextLinks>>;
  try {
    links = await assertContextLinks(
      { tenantId: input.tenantId },
      {
        unitId: input.unitId,
        serviceOrderId: input.serviceOrderId ?? null,
        customerId: input.customerId ?? null,
        equipmentId: input.equipmentId ?? null,
        warrantyId: input.warrantyId ?? null,
      },
    );
  } catch (error) {
    return {
      outcome: 'skipped',
      errorCode: 'ACTION_VALIDATION_FAILED',
      errorDetail: error instanceof Error ? error.message : String(error),
    };
  }

  const dueDate =
    input.dueOffsetDays === undefined
      ? null
      : addDays(todayIn(tenant.timezone), input.dueOffsetDays);

  const taskId = newId();
  const now = new Date();

  try {
    await runInTransaction(async (tx, emit) => {
      await tx.insert(agendaTasks).values({
        id: taskId,
        tenantId: input.tenantId,
        unitId: input.unitId,
        title: input.title,
        notes: blank(input.notes ?? undefined),
        status: 'open',
        priority: 'normal',
        dueDate,
        assigneeId: null,
        /** Nulo de proposito: quem criou foi o Motor, nao uma pessoa. */
        createdBy: null,
        idempotencyKey: input.idempotencyKey,
        serviceOrderId: links.serviceOrderId,
        customerId: links.customerId,
        equipmentId: links.equipmentId,
        warrantyId: links.warrantyId,
        createdAt: now,
        updatedAt: now,
      });

      await recordAudit(
        {
          action: AUDIT_ACTIONS.TASK_CREATED,
          entityType: 'agenda_task',
          entityId: taskId,
          tenantId: input.tenantId,
          unitId: input.unitId,
          userId: null,
          after: {
            priority: 'normal',
            hasDueDate: Boolean(dueDate),
            hasAssignee: false,
            serviceOrderId: links.serviceOrderId,
          },
        },
        tx,
      );

      await emit({
        type: EVENT_TYPES.TASK_CREATED,
        tenantId: input.tenantId,
        payload: {
          taskId,
          unitId: input.unitId,
          assigneeId: null,
          serviceOrderId: links.serviceOrderId,
        },
      });
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const [winner] = await getDb()
        .select({ id: agendaTasks.id })
        .from(agendaTasks)
        .where(
          and(
            eq(agendaTasks.tenantId, input.tenantId),
            eq(agendaTasks.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (winner) return { outcome: 'reused', taskId: winner.id };
    }
    throw error;
  }

  return { outcome: 'created', taskId };
}

interface TaskRow {
  id: string;
  unitId: string;
  status: string;
  assigneeId: string | null;
  createdBy: string | null;
  version: number;
}

async function loadTask(context: TenantContext, taskId: string): Promise<TaskRow> {
  const [row] = await getDb()
    .select({
      id: agendaTasks.id,
      unitId: agendaTasks.unitId,
      status: agendaTasks.status,
      assigneeId: agendaTasks.assigneeId,
      createdBy: agendaTasks.createdBy,
      version: agendaTasks.version,
    })
    .from(agendaTasks)
    .where(and(eq(agendaTasks.tenantId, context.tenantId), eq(agendaTasks.id, taskId)))
    .limit(1);

  /** Tarefa de outra empresa e tarefa inexistente terminam no mesmo lugar. */
  if (!row) throw new NotFoundError('Tarefa nao encontrada.');
  if (!context.authorizedUnitIds.includes(row.unitId)) {
    throw new NotFoundError('Tarefa nao encontrada.');
  }
  return row;
}

/**
 * QUEM PODE MEXER NUMA TAREFA (itens 82 a 84).
 *
 * A regra e uma so, e mora aqui: o RESPONSAVEL e quem CRIOU mexem na propria
 * tarefa; qualquer outra pessoa precisa de `agenda.tasks.manage`. Espalhar
 * isso por cada caso de uso garantiria que um deles esquecesse.
 */
async function assertCanOperate(context: TenantContext, task: TaskRow): Promise<void> {
  await authorize(context, {
    permission: PERMISSIONS.AGENDA_VIEW,
    featureKey: FEATURES.OPERATIONS_AGENDA,
    unitId: task.unitId,
  });

  const propria = task.assigneeId === context.userId || task.createdBy === context.userId;
  if (propria) return;

  await authorize(context, {
    permission: PERMISSIONS.AGENDA_TASKS_MANAGE,
    featureKey: FEATURES.OPERATIONS_AGENDA,
    unitId: task.unitId,
  });
}

const updateSchema = z.object({
  title: z.string().trim().min(1).max(TASK_TITLE_MAX).optional(),
  notes: z.string().trim().max(TASK_NOTES_MAX).optional().or(z.literal('')),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe um prazo valido.')
    .optional()
    .or(z.literal('')),
  expectedVersion: z.coerce.number().int().optional(),
});

/**
 * Edita o que e editavel enquanto a tarefa esta ABERTA (item 38).
 *
 * O QUE NAO ENTRA AQUI, e a ausencia e o ponto: `idempotencyKey`, `createdBy`,
 * `tenantId`, `unitId`, `completedAt` e `cancelledAt` nao tem campo. Origem e
 * metadados de conclusao sao fatos, nao preferencias — e permitir edita-los
 * transformaria o historico em rascunho.
 */
export async function updateTask(
  context: TenantContext,
  taskId: string,
  rawInput: unknown,
): Promise<void> {
  const input = parse(updateSchema, rawInput);
  const task = await loadTask(context, taskId);
  await assertCanOperate(context, task);

  if (!canEdit(task.status)) {
    throw new BusinessRuleError(`${explainNotOpen(task.status)} Nao ha o que editar.`);
  }

  const now = new Date();
  const mudancas: Record<string, unknown> = { updatedAt: now };
  if (input.title !== undefined) mudancas.title = input.title;
  if (input.notes !== undefined) mudancas.notes = blank(input.notes);
  if (input.priority !== undefined) mudancas.priority = input.priority;
  if (input.dueDate !== undefined) mudancas.dueDate = blank(input.dueDate);

  await runInTransaction(async (tx) => {
    const resultado = await tx
      .update(agendaTasks)
      .set({ ...mudancas, version: sql`${agendaTasks.version} + 1` })
      .where(
        and(
          eq(agendaTasks.id, taskId),
          eq(agendaTasks.tenantId, context.tenantId),
          eq(agendaTasks.status, 'open'),
          input.expectedVersion === undefined
            ? undefined
            : eq(agendaTasks.version, input.expectedVersion),
        ),
      );

    if (affectedRows(resultado) === 0) {
      throw new ConflictError(
        'Esta tarefa mudou enquanto voce editava. Abra de novo para ver o estado atual.',
      );
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.TASK_UPDATED,
        entityType: 'agenda_task',
        entityId: taskId,
        tenantId: context.tenantId,
        unitId: task.unitId,
        userId: context.userId,
        after: {
          changed: Object.keys(mudancas).filter((k) => k !== 'updatedAt'),
        },
      },
      tx,
    );
  });
}

/** Atribui — ou tira o responsavel, quando `assigneeId` vem vazio. */
export async function assignTask(
  context: TenantContext,
  taskId: string,
  rawAssigneeId: string | null,
  expectedVersion?: number,
): Promise<void> {
  const task = await loadTask(context, taskId);
  const assigneeId = blank(rawAssigneeId ?? undefined);

  await authorize(context, {
    permission: PERMISSIONS.AGENDA_VIEW,
    featureKey: FEATURES.OPERATIONS_AGENDA,
    unitId: task.unitId,
  });

  /** Pegar a tarefa para si e ato do proprio; passar adiante mexe na fila alheia. */
  if (assigneeId !== context.userId) {
    await authorize(context, {
      permission: PERMISSIONS.AGENDA_TASKS_ASSIGN,
      featureKey: FEATURES.OPERATIONS_AGENDA,
      unitId: task.unitId,
    });
  }

  if (!canEdit(task.status)) {
    throw new BusinessRuleError(`${explainNotOpen(task.status)} Nao ha o que atribuir.`);
  }

  if (assigneeId) await assertAssignee(context, assigneeId, task.unitId);

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    const resultado = await tx
      .update(agendaTasks)
      .set({ assigneeId, updatedAt: now, version: sql`${agendaTasks.version} + 1` })
      .where(
        and(
          eq(agendaTasks.id, taskId),
          eq(agendaTasks.tenantId, context.tenantId),
          eq(agendaTasks.status, 'open'),
          expectedVersion === undefined ? undefined : eq(agendaTasks.version, expectedVersion),
        ),
      );

    if (affectedRows(resultado) === 0) {
      throw new ConflictError('Esta tarefa mudou enquanto voce a atribuia. Abra de novo.');
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.TASK_ASSIGNED,
        entityType: 'agenda_task',
        entityId: taskId,
        tenantId: context.tenantId,
        unitId: task.unitId,
        userId: context.userId,
        before: { assigneeId: task.assigneeId },
        after: { assigneeId },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.TASK_ASSIGNED,
      tenantId: context.tenantId,
      payload: { taskId, unitId: task.unitId, assigneeId },
    });
  });
}

/**
 * Conclui a tarefa.
 *
 * A CONDICAO VAI NO `WHERE` (ADR-044). Concluir e cancelar disputam a mesma
 * linha: se os dois chegarem juntos, um encontra `status = 'open'` e o outro
 * nao encontra linha nenhuma — e recebe conflito, em vez de sobrescrever o
 * fato que acabou de ser gravado (itens 39 e 150).
 */
export async function completeTask(
  context: TenantContext,
  taskId: string,
  expectedVersion?: number,
): Promise<void> {
  const task = await loadTask(context, taskId);
  await assertCanOperate(context, task);

  if (!canComplete(task.status)) {
    throw new BusinessRuleError(explainNotOpen(task.status));
  }

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    const resultado = await tx
      .update(agendaTasks)
      .set({
        status: 'done',
        completedAt: now,
        completedBy: context.userId,
        updatedAt: now,
        version: sql`${agendaTasks.version} + 1`,
      })
      .where(
        and(
          eq(agendaTasks.id, taskId),
          eq(agendaTasks.tenantId, context.tenantId),
          eq(agendaTasks.status, 'open'),
          expectedVersion === undefined ? undefined : eq(agendaTasks.version, expectedVersion),
        ),
      );

    if (affectedRows(resultado) === 0) {
      throw new ConflictError(
        'Esta tarefa ja foi encerrada por outra pessoa. Abra de novo para ver como ficou.',
      );
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.TASK_COMPLETED,
        entityType: 'agenda_task',
        entityId: taskId,
        tenantId: context.tenantId,
        unitId: task.unitId,
        userId: context.userId,
        after: { completedBy: context.userId },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.TASK_COMPLETED,
      tenantId: context.tenantId,
      payload: { taskId, unitId: task.unitId },
    });
  });
}

/**
 * Cancela a tarefa. NAO e o mesmo que concluir (item 36).
 *
 * Concluir diz "o trabalho foi feito"; cancelar diz "o trabalho deixou de
 * fazer sentido". Guardar os dois no mesmo estado apagaria a diferenca entre
 * uma bancada produtiva e uma fila que ninguem executou.
 *
 * Cancelar exige `agenda.tasks.manage` mesmo na propria tarefa (item 84):
 * concluir registra trabalho, cancelar faz trabalho desaparecer da fila.
 */
export async function cancelTask(
  context: TenantContext,
  taskId: string,
  rawReason: string,
  expectedVersion?: number,
): Promise<void> {
  const task = await loadTask(context, taskId);

  await authorize(context, {
    permission: PERMISSIONS.AGENDA_TASKS_MANAGE,
    featureKey: FEATURES.OPERATIONS_AGENDA,
    unitId: task.unitId,
  });

  if (!canCancel(task.status)) {
    throw new BusinessRuleError(explainNotOpen(task.status));
  }

  const reason = rawReason.trim();
  if (reason.length < CANCEL_REASON_MIN) {
    throw new ValidationError(
      `Explique por que a tarefa foi cancelada (ao menos ${CANCEL_REASON_MIN} caracteres).`,
    );
  }
  if (reason.length > CANCEL_REASON_MAX) {
    throw new ValidationError(`O motivo nao pode passar de ${CANCEL_REASON_MAX} caracteres.`);
  }

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    const resultado = await tx
      .update(agendaTasks)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: context.userId,
        cancelReason: reason,
        updatedAt: now,
        version: sql`${agendaTasks.version} + 1`,
      })
      .where(
        and(
          eq(agendaTasks.id, taskId),
          eq(agendaTasks.tenantId, context.tenantId),
          eq(agendaTasks.status, 'open'),
          expectedVersion === undefined ? undefined : eq(agendaTasks.version, expectedVersion),
        ),
      );

    if (affectedRows(resultado) === 0) {
      throw new ConflictError(
        'Esta tarefa ja foi encerrada por outra pessoa. Abra de novo para ver como ficou.',
      );
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.TASK_CANCELLED,
        entityType: 'agenda_task',
        entityId: taskId,
        tenantId: context.tenantId,
        unitId: task.unitId,
        userId: context.userId,
        after: { cancelledBy: context.userId, reason },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.TASK_CANCELLED,
      tenantId: context.tenantId,
      payload: { taskId, unitId: task.unitId },
    });
  });
}

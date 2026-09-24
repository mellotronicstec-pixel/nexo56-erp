import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { isDuplicateKeyError } from '@/core/db/duplicate-key';
import { newId } from '@/core/ids/id';
import { logger } from '@/core/logging/logger';
import {
  createMessageFromAutomation,
  type AutomationMessageResult,
} from '@/modules/communications/application/message-service';
import {
  createTaskFromAutomation,
  type AutomationTaskResult,
} from '@/modules/agenda/application/task-service';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import {
  communicationSendTemplateConfigSchema,
  agendaCreateTaskConfigSchema,
  AUTOMATION_ACTION_KEYS,
} from '@/modules/automations/domain/action-catalog';
import {
  parseRuleDefinition,
  type RuleDefinition,
} from '@/modules/automations/domain/rule-definition';
import {
  AUTOMATION_ERROR_CODES,
  isPermanentError,
  type AutomationErrorCode,
} from '@/modules/automations/domain/error-codes';
import {
  automationActionAttempts,
  automationExecutions,
  automationRuleVersions,
} from '@/modules/automations/infrastructure/schema';

/**
 * O LACO DE EXECUCAO DAS ACOES (Prompt 19, itens 42 a 46, 89 e 154).
 *
 * SEQUENCIAL, SEMPRE (item 43): a acao N so roda depois que a acao N-1
 * terminou com sucesso. Uma falha PARA a sequencia — nao pula para a
 * proxima (item 44).
 *
 * RESUMIVEL POR CONSTRUCAO (item 89 e 155): a chave de idempotencia que
 * chega ao servico de dominio (`automation:{executionId}:action:{index}`)
 * NUNCA muda entre tentativas — so o numero da TENTATIVA (`attempt_number`,
 * append-only, item 45) incrementa. Se o worker morrer depois do efeito
 * colateral mas antes de marcar sucesso, o proximo processamento desta
 * MESMA execucao encontra a acao "sem tentativa bem-sucedida", tenta de
 * novo, e o servico de dominio devolve `reused: true` — nunca uma segunda
 * mensagem, nunca uma segunda tarefa.
 */

export function deriveActionIdempotencyKey(executionId: string, actionIndex: number): string {
  return `automation:${executionId}:action:${actionIndex}`;
}

interface RunOutcome {
  status: 'succeeded' | 'failed';
  errorSummary?: string;
}

/**
 * Roda (ou retoma) as acoes de UMA execucao ja criada. Idempotente: chamar
 * duas vezes para a mesma execucao nunca produz efeito colateral duplicado.
 */
export async function runExecutionActions(
  executionId: string,
  tenantId: string,
): Promise<RunOutcome> {
  const db = getDb();

  const [execution] = await db
    .select()
    .from(automationExecutions)
    .where(
      and(eq(automationExecutions.id, executionId), eq(automationExecutions.tenantId, tenantId)),
    )
    .limit(1);
  if (!execution) {
    throw new Error(`Execucao de automacao nao encontrada: ${executionId}`);
  }
  if (execution.status === 'succeeded' || execution.status === 'skipped') {
    return { status: 'succeeded' };
  }

  const [version] = await db
    .select({ definition: automationRuleVersions.definition })
    .from(automationRuleVersions)
    .where(
      and(
        eq(automationRuleVersions.id, execution.ruleVersionId),
        eq(automationRuleVersions.tenantId, tenantId),
      ),
    )
    .limit(1);
  const validated = version ? parseRuleDefinition(version.definition) : null;
  if (!validated?.ok) {
    return finishExecution(executionId, tenantId, 'failed', 'A versao desta regra ficou invalida.');
  }

  const fact = execution.inputSnapshot as Record<string, unknown>;

  for (let actionIndex = 0; actionIndex < validated.definition.actions.length; actionIndex += 1) {
    const alreadySucceeded = await hasSucceededAttempt(executionId, actionIndex);
    if (alreadySucceeded) continue;

    const action = validated.definition.actions[actionIndex]!;
    const attemptNumber = await nextAttemptNumber(executionId, actionIndex);
    const startedAt = new Date();
    const attemptId = newId();

    try {
      await db.insert(automationActionAttempts).values({
        id: attemptId,
        executionId,
        tenantId,
        actionIndex,
        attemptNumber,
        status: 'running',
        startedAt,
        createdAt: startedAt,
      });
    } catch (error) {
      /**
       * CLAIM ATOMICO DA ACAO (item 81 e 126). Dois processadores concorrentes
       * desta MESMA execucao podem chegar aqui ao mesmo tempo; o UNIQUE
       * `(execution_id, action_index, attempt_number)` deixa so um vencer o
       * INSERT. Quem perde nao tenta de novo aqui — devolve a execucao como
       * "ainda em andamento" e sai: o vencedor e quem decide o resultado
       * desta acao e quem chama `finishExecution` no final do laco.
       */
      if (isDuplicateKeyError(error)) {
        return { status: 'failed', errorSummary: 'Outro processo ja esta executando esta acao.' };
      }
      throw error;
    }

    const result = await runOneAction(tenantId, executionId, actionIndex, action, fact);
    const finishedAt = new Date();

    await db
      .update(automationActionAttempts)
      .set({
        status: result.ok ? 'succeeded' : 'failed',
        finishedAt,
        errorCode: result.ok ? null : result.errorCode,
        errorSummary: result.ok ? null : result.errorDetail,
        domainResultRef: result.ok ? result.resultId : null,
      })
      .where(eq(automationActionAttempts.id, attemptId));

    if (!result.ok) {
      logger.warn('Acao de automacao falhou', {
        module: 'automations',
        operation: 'runExecutionActions',
        executionId,
        actionIndex,
        actionKey: action.key,
        errorCode: result.errorCode,
        retryable: !isPermanentError(result.errorCode),
      });
      return finishExecution(executionId, tenantId, 'failed', result.errorDetail);
    }
  }

  return finishExecution(executionId, tenantId, 'succeeded');
}

async function hasSucceededAttempt(executionId: string, actionIndex: number): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: automationActionAttempts.id })
    .from(automationActionAttempts)
    .where(
      and(
        eq(automationActionAttempts.executionId, executionId),
        eq(automationActionAttempts.actionIndex, actionIndex),
        eq(automationActionAttempts.status, 'succeeded'),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function nextAttemptNumber(executionId: string, actionIndex: number): Promise<number> {
  const rows = await getDb()
    .select({ attemptNumber: automationActionAttempts.attemptNumber })
    .from(automationActionAttempts)
    .where(
      and(
        eq(automationActionAttempts.executionId, executionId),
        eq(automationActionAttempts.actionIndex, actionIndex),
      ),
    )
    .orderBy(asc(automationActionAttempts.attemptNumber));
  return (rows.at(-1)?.attemptNumber ?? 0) + 1;
}

type ActionRunResult =
  | { ok: true; resultId: string | null }
  | { ok: false; errorCode: AutomationErrorCode; errorDetail: string };

/**
 * DESPACHO PARA O SERVICO OFICIAL (item 143). Cada `case` chama exatamente
 * um servico de aplicacao de outro modulo — nunca escreve tabela alheia.
 */
async function runOneAction(
  tenantId: string,
  executionId: string,
  actionIndex: number,
  action: RuleDefinition['actions'][number],
  fact: Readonly<Record<string, unknown>>,
): Promise<ActionRunResult> {
  const idempotencyKey = deriveActionIdempotencyKey(executionId, actionIndex);
  const serviceOrderId = typeof fact.serviceOrderId === 'string' ? fact.serviceOrderId : null;
  const unitId = typeof fact.unitId === 'string' ? fact.unitId : null;

  if (action.key === AUTOMATION_ACTION_KEYS.COMMUNICATION_SEND_TEMPLATE) {
    const config = communicationSendTemplateConfigSchema.parse(action.config);
    if (!unitId) {
      return {
        ok: false,
        errorCode: AUTOMATION_ERROR_CODES.ACTION_VALIDATION_FAILED,
        errorDetail: 'Sem unidade no fato que disparou a regra.',
      };
    }
    const customerId = serviceOrderId
      ? await resolveCustomerIdFromServiceOrder(tenantId, serviceOrderId)
      : null;
    if (!customerId) {
      return {
        ok: false,
        errorCode: AUTOMATION_ERROR_CODES.INVALID_RECIPIENT,
        errorDetail: 'Nao foi possivel identificar o cliente para esta acao.',
      };
    }

    const result: AutomationMessageResult = await createMessageFromAutomation({
      tenantId,
      unitId,
      customerId,
      channel: config.channel,
      templateId: config.templateId,
      serviceOrderId,
      idempotencyKey,
      sourceEventId: typeof fact.__eventId === 'string' ? fact.__eventId : null,
    });
    return toActionResult(
      result.outcome,
      result.messageId ?? null,
      result.errorCode,
      result.errorDetail,
    );
  }

  if (action.key === AUTOMATION_ACTION_KEYS.AGENDA_CREATE_TASK) {
    const config = agendaCreateTaskConfigSchema.parse(action.config);
    if (!unitId) {
      return {
        ok: false,
        errorCode: AUTOMATION_ERROR_CODES.ACTION_VALIDATION_FAILED,
        errorDetail: 'Sem unidade no fato que disparou a regra.',
      };
    }

    const result: AutomationTaskResult = await createTaskFromAutomation({
      tenantId,
      unitId,
      title: config.title,
      notes: config.notes ?? null,
      dueOffsetDays: config.dueOffsetDays,
      serviceOrderId,
      idempotencyKey,
    });
    return toActionResult(
      result.outcome,
      result.taskId ?? null,
      result.errorCode,
      result.errorDetail,
    );
  }

  return {
    ok: false,
    errorCode: AUTOMATION_ERROR_CODES.ACTION_VALIDATION_FAILED,
    errorDetail: `Acao desconhecida: ${action.key}.`,
  };
}

function toActionResult(
  outcome: 'created' | 'reused' | 'skipped',
  resultId: string | null,
  errorCode: string | undefined,
  errorDetail: string | undefined,
): ActionRunResult {
  if (outcome === 'created' || outcome === 'reused') return { ok: true, resultId };
  return {
    ok: false,
    errorCode: (errorCode as AutomationErrorCode) ?? AUTOMATION_ERROR_CODES.UNKNOWN,
    errorDetail: errorDetail ?? 'Falha desconhecida.',
  };
}

async function resolveCustomerIdFromServiceOrder(
  tenantId: string,
  serviceOrderId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ customerId: serviceOrders.customerId })
    .from(serviceOrders)
    .where(and(eq(serviceOrders.id, serviceOrderId), eq(serviceOrders.tenantId, tenantId)))
    .limit(1);
  return row?.customerId ?? null;
}

async function finishExecution(
  executionId: string,
  tenantId: string,
  status: 'succeeded' | 'failed',
  errorSummary?: string,
): Promise<RunOutcome> {
  await getDb()
    .update(automationExecutions)
    .set({
      status,
      completedAt: new Date(),
      errorSummary:
        status === 'failed' ? (errorSummary ?? 'Falha nao especificada.').slice(0, 500) : null,
    })
    .where(
      and(eq(automationExecutions.id, executionId), eq(automationExecutions.tenantId, tenantId)),
    );
  return { status, errorSummary };
}

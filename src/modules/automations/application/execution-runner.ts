import 'server-only';
import { and, asc, eq, isNull, lt, or } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { affectedRows } from '@/core/db/affected-rows';
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
 * SINGLE-CLAIM DA EXECUCAO (fechamento do Prompt 19, migration 0017):
 * `nextAttemptNumber` (SELECT MAX+1) por si so NAO impede dois
 * processadores concorrentes de avancarem para NUMEROS DE TENTATIVA
 * diferentes — um deles pode legitimamente ver a tentativa anterior ja
 * commitada e "retomar" com o numero seguinte, mesmo que a tentativa
 * anterior tenha tido SUCESSO (nao falhado). Isso produzia mais de uma
 * `automation_action_attempt` `succeeded` para a MESMA acao sob concorrencia
 * genuina — medido, nao suposto. A correcao mora ANTES do laco de acoes:
 * `claimExecution` e um `UPDATE` condicional (`WHERE status='running' AND
 * (locked_at IS NULL OR locked_at < stale)`), mesmo idioma de
 * `jobs.locked_by`/`jobs.locked_at`, que so deixa UM processo entrar no laco
 * por vez. Os perdedores nunca inserem tentativa nem chamam o servico
 * oficial — reconhecem o estado real (ja terminou / outro processo ainda
 * dentro do prazo) sem registrar sucesso algum.
 *
 * RESUMIVEL POR CONSTRUCAO (item 89 e 155): a chave de idempotencia que
 * chega ao servico de dominio (`automation:{executionId}:action:{index}`)
 * NUNCA muda entre tentativas — so o numero da TENTATIVA (`attempt_number`,
 * append-only, item 45) incrementa. Se o worker vencedor do claim morrer
 * DEPOIS do efeito colateral mas ANTES de marcar sucesso, o claim fica
 * obsoleto (`locked_at` mais velho que `LOCK_STALE_MS`) e um processamento
 * seguinte pode reclama-lo: encontra a acao "ja com tentativa bem-sucedida"
 * (`hasSucceededAttempt`) e converge para `succeeded` sem chamar o servico
 * oficial de novo — e, mesmo se chamasse, a chave de idempotencia do
 * servico de dominio (camada 3) ainda impediria uma segunda mensagem/tarefa.
 * As duas camadas continuam existindo: single-claim aqui, idempotencia de
 * destino em Communications/Agenda — uma nao substitui a outra (item 5 do
 * fechamento).
 */

export function deriveActionIdempotencyKey(executionId: string, actionIndex: number): string {
  return `automation:${executionId}:action:${actionIndex}`;
}

/** Claim obsoleto apos este intervalo sem atualizacao — permite retomada
 *  apos queda de worker sem exigir heartbeat. */
const LOCK_STALE_MS = 5 * 60 * 1000;

interface RunOutcome {
  /** `claim_not_acquired`: este processo NAO era o unico a tentar processar
   *  esta execucao agora e perdeu a disputa — nao rodou nenhuma acao, nao
   *  registrou nenhuma tentativa. Nunca confundir com `failed`, que sempre
   *  significa "uma acao rodou e falhou permanentemente". */
  status: 'succeeded' | 'failed' | 'claim_not_acquired';
  errorSummary?: string;
}

type ClaimResult = { claimed: true } | { claimed: false; currentStatus: string };

/**
 * SINGLE-CLAIM ATOMICO (Secao 3 do fechamento do Prompt 19).
 *
 * `UPDATE ... WHERE id=? AND tenant_id=? AND status='running' AND
 * (locked_at IS NULL OR locked_at < stale)` — o mesmo idioma de
 * `claimNextJob`/`processMessage` (CAS por `UPDATE` condicional, nunca
 * `SELECT`-then-decide, nunca mutex em memoria, nunca dependencia de
 * processo unico). `affectedRows === 1` e a UNICA prova de vitoria: o
 * proprio MariaDB serializa a decisao entre conexoes concorrentes.
 */
async function claimExecution(executionId: string, tenantId: string): Promise<ClaimResult> {
  const db = getDb();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LOCK_STALE_MS);

  const result = await db
    .update(automationExecutions)
    .set({ lockedBy: newId(), lockedAt: now })
    .where(
      and(
        eq(automationExecutions.id, executionId),
        eq(automationExecutions.tenantId, tenantId),
        eq(automationExecutions.status, 'running'),
        or(isNull(automationExecutions.lockedAt), lt(automationExecutions.lockedAt, staleBefore)),
      ),
    );

  if (affectedRows(result) === 1) return { claimed: true };

  const [current] = await db
    .select({ status: automationExecutions.status })
    .from(automationExecutions)
    .where(
      and(eq(automationExecutions.id, executionId), eq(automationExecutions.tenantId, tenantId)),
    )
    .limit(1);
  if (!current) throw new Error(`Execucao de automacao nao encontrada: ${executionId}`);
  return { claimed: false, currentStatus: current.status };
}

/**
 * Roda (ou retoma) as acoes de UMA execucao ja criada. Idempotente: chamar
 * duas vezes para a mesma execucao nunca produz efeito colateral duplicado
 * — e, sob concorrencia genuina, exatamente UM processo chega a rodar
 * qualquer acao (ver `claimExecution`).
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
  if (execution.status === 'failed') {
    return { status: 'failed', errorSummary: execution.errorSummary ?? undefined };
  }

  const claim = await claimExecution(executionId, tenantId);
  if (!claim.claimed) {
    if (claim.currentStatus === 'succeeded' || claim.currentStatus === 'skipped') {
      return { status: 'succeeded' };
    }
    if (claim.currentStatus === 'failed') {
      return { status: 'failed' };
    }
    /** Ainda `running`, mas o claim pertence a outro processo dentro do
     *  prazo (`locked_at` recente) — nem `succeeded` nem `failed`: este
     *  processo simplesmente nao processou nada agora. */
    return { status: 'claim_not_acquired' };
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
       * DEFESA EM PROFUNDIDADE (item 81 e 126) — nao a trava principal.
       * `claimExecution`, acima, ja garante que so UM processo entra neste
       * laco por execucao; isto so dispara no caso raro de um claim ficar
       * obsoleto (`LOCK_STALE_MS`) enquanto o dono original ainda esta
       * genuinamente processando (sem renovar o lease). O UNIQUE
       * `(execution_id, action_index, attempt_number)` decide o empate; quem
       * perde nao inventa sucesso nenhum — `claim_not_acquired`, igual ao
       * caso de nao vencer o claim da execucao.
       */
      if (isDuplicateKeyError(error)) {
        return { status: 'claim_not_acquired' };
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
  outcome: 'created' | 'reused' | 'skipped' | 'failed',
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
      /** Libera o claim na MESMA escrita que fecha a execucao — nenhum
       *  processo futuro precisa esperar `LOCK_STALE_MS` para reconhecer que
       *  ela ja terminou (o proprio `status` terminal ja basta, mas limpar o
       *  lock evita um `locked_at` antigo e enganoso no registro). */
      lockedBy: null,
      lockedAt: null,
    })
    .where(
      and(eq(automationExecutions.id, executionId), eq(automationExecutions.tenantId, tenantId)),
    );
  return { status, errorSummary };
}

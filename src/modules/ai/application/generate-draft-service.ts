import 'server-only';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { isAppError, NotFoundError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { logger } from '@/core/logging/logger';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { findServiceOrderDetail } from '@/modules/service-orders/application/service-order-queries';
import { loadQuote } from '@/modules/quotes/application/quote-service';
import { aiError, type AiErrorCode } from '../domain/ai-request';
import {
  findAiSurface,
  isTaskAllowedOnSurface,
  type AiSurfaceDefinition,
} from '../domain/surface-catalog';
import { findAiTask, type AiTaskDefinition } from '../domain/task-catalog';
import { buildAiPrompt, type StructuredTechnicalContext } from './prompt-builder';
import {
  unicodeSafeLength,
  validateAiOutput,
  type OutputRejectionReason,
} from './output-validator';
import { getAiProvider } from '../infrastructure/provider-registry';
import { insertAiRequest, completeAiRequest } from '../infrastructure/ai-request-repository';
import type { AiGenerationResult } from './ai-provider';

/**
 * ORQUESTRADOR DO NEXO56 AI (Prompt 20, itens 4, 29, 41 a 45, 136 a 139).
 *
 * FLUXO OFICIAL, cada etapa nesta ordem:
 *
 *   1. Catalogo (superficie e task existem e sao compativeis) — sem tocar
 *      no banco (item 32).
 *   2. Carrega a ENTIDADE, escopada a tenant + unidade autorizada — o
 *      cliente manda so o id, nunca "dados da OS" (item 43).
 *   3. Autorizacao COMPOSTA: `ai.use` + feature `ai.writing` + permissao do
 *      DOMINIO do campo, ambas na unidade da entidade (item 29).
 *   4. Monta o texto/contexto de entrada, valida tamanho.
 *   5. Registra `ai_requests` como `requested` (SEM conteudo).
 *   6. Chama o provedor, com timeout finito.
 *   7. Valida o resultado (tipo, tamanho, ancoras tecnicas).
 *   8. Fecha `ai_requests` como `succeeded`/`failed` e devolve o rascunho.
 *
 * NENHUMA ESCRITA DE DOMINIO ACONTECE AQUI (item 88): as unicas tabelas
 * tocadas por este arquivo sao de LEITURA (service_orders, quotes) e
 * `ai_requests` (metadados). `service_orders`/`quotes` nunca sao
 * atualizadas — "Usar texto" e decisao do usuario, no formulario, pelo
 * fluxo de salvar normal do modulo (item 18).
 */

export interface GenerateAiDraftInput {
  surfaceKey: string;
  taskKey: string;
  entityId: string;
  /**
   * Texto ATUAL do campo no formulario, ainda nao salvo (item 135) —
   * obrigatorio para as quatro tasks de reescrita. Para
   * `GERAR_PARECER_TECNICO` e OPCIONAL: quando presente, substitui o valor
   * do banco como "observacoes tecnicas" no contexto (item 136) — nunca um
   * contexto arbitrario, sempre o mesmo campo da mesma superficie.
   */
  currentText?: string;
}

export interface GenerateAiDraftResult {
  text: string;
  taskKey: string;
  surfaceKey: string;
}

interface LoadedEntity {
  unitId: string;
  /** Usado apenas para checagem de tamanho quando a task exige texto de entrada. */
  fieldValue: string | null;
  structuredContext: StructuredTechnicalContext | null;
}

async function loadEntity(
  context: TenantContext,
  surface: AiSurfaceDefinition,
  entityId: string,
  currentText: string | undefined,
): Promise<LoadedEntity> {
  if (surface.entityType === 'service_order') {
    const detail = await findServiceOrderDetail(context, entityId);
    if (!detail) throw new NotFoundError('Registro nao encontrado.');

    const internalNotes = currentText ?? detail.order.internalNotes ?? '';
    return {
      unitId: detail.order.unitId,
      fieldValue: detail.order.internalNotes,
      structuredContext: {
        equipmentKind: detail.equipmentItem.kind,
        equipmentBrand: detail.equipmentItem.brand,
        equipmentModel: detail.equipmentItem.model,
        customerReport: detail.order.customerReport,
        internalNotes: internalNotes.trim() || null,
      },
    };
  }

  // entityType === 'quote'
  const quote = await loadQuote(context, entityId);
  return {
    unitId: quote.unitId,
    fieldValue: quote.customerNotes,
    structuredContext: null,
  };
}

/** Decora `AuthorizationError` de `ai.use`/`ai.writing` com o codigo estavel do item 74. */
async function authorizeAiUse(context: TenantContext, unitId: string): Promise<void> {
  try {
    await authorize(context, {
      permission: PERMISSIONS.AI_USE,
      unitId,
      featureKey: FEATURES.AI_WRITING,
    });
  } catch (error) {
    if (isAppError(error) && error.code === 'AUTHORIZATION_ERROR') {
      const reason = (error.details as { reason?: string } | undefined)?.reason;
      throw aiError(
        reason === 'FEATURE_UNAVAILABLE' ? 'AI_FEATURE_DISABLED' : 'AI_PERMISSION_DENIED',
      );
    }
    throw error;
  }
}

async function authorizeDomainAccess(
  context: TenantContext,
  surface: AiSurfaceDefinition,
  unitId: string,
): Promise<void> {
  await authorize(context, {
    permission: surface.domainPermission,
    unitId,
    featureKey: surface.domainFeatureKey,
    resource: { tenantId: context.tenantId, unitId },
  });
}

const VALIDATION_REASON_TO_ERROR_CODE: Record<OutputRejectionReason, AiErrorCode> = {
  invalid_output: 'AI_INVALID_OUTPUT',
  technical_meaning_risk: 'AI_TECHNICAL_MEANING_RISK',
  insufficient_context: 'AI_INSUFFICIENT_CONTEXT',
};

/** Timeout finito no CHAMADOR (item 73), independente do adaptador respeitar `options.timeoutMs`. */
const DEFAULT_PROVIDER_TIMEOUT_MS = 20_000;
let providerTimeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS;

/** So para teste (item 113 exige provar o caminho de timeout sem esperar 20s de verdade). */
export function setAiProviderTimeoutMsForTesting(ms: number | null): void {
  providerTimeoutMs = ms ?? DEFAULT_PROVIDER_TIMEOUT_MS;
}

async function callProviderWithTimeout(
  generate: () => Promise<AiGenerationResult>,
  timeoutMs: number,
): Promise<AiGenerationResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AiGenerationResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ outcome: 'error', kind: 'timeout', detail: null }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([generate(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function generateAiDraft(
  context: TenantContext,
  input: GenerateAiDraftInput,
): Promise<GenerateAiDraftResult> {
  const surface = findAiSurface(input.surfaceKey);
  if (!surface) throw aiError('AI_SURFACE_NOT_ALLOWED');

  const task = findAiTask(input.taskKey);
  if (!task || !isTaskAllowedOnSurface(surface, task.key)) throw aiError('AI_TASK_NOT_ALLOWED');

  const entity = await loadEntity(context, surface, input.entityId, input.currentText);

  await authorizeAiUse(context, entity.unitId);
  await authorizeDomainAccess(context, surface, entity.unitId);

  const prompt = buildInputForTask(task, surface, entity, input.currentText);

  const requestId = newId();
  const startedAt = Date.now();
  await insertAiRequest({
    id: requestId,
    tenantId: context.tenantId,
    unitId: entity.unitId,
    requestedBy: context.userId,
    taskKey: task.key,
    surfaceKey: surface.key,
    entityType: surface.entityType,
    entityId: input.entityId,
    promptVersion: task.promptVersion,
    inputCharCount: unicodeSafeLength(prompt.userContent),
  });

  const provider = getAiProvider();
  if (!provider) {
    await completeAiRequest({
      id: requestId,
      status: 'failed',
      errorCode: 'AI_PROVIDER_NOT_CONFIGURED',
      providerKey: null,
      modelKey: null,
      outputCharCount: null,
      inputTokens: null,
      outputTokens: null,
      latencyMs: Date.now() - startedAt,
    });
    throw aiError('AI_PROVIDER_NOT_CONFIGURED');
  }

  const result = await callProviderWithTimeout(
    () =>
      provider.generate(
        {
          taskKey: task.key,
          promptVersion: task.promptVersion,
          systemPrompt: prompt.systemPrompt,
          userContent: prompt.userContent,
          language: 'pt-BR',
          maxOutputChars: Math.min(task.maxOutputChars, surface.maxLength),
        },
        { timeoutMs: providerTimeoutMs },
      ),
    providerTimeoutMs,
  );

  const latencyMs = Date.now() - startedAt;

  if (result.outcome === 'error') {
    const errorCode: AiErrorCode =
      result.kind === 'timeout' ? 'AI_PROVIDER_TIMEOUT' : 'AI_PROVIDER_ERROR';
    await completeAiRequest({
      id: requestId,
      status: 'failed',
      errorCode,
      providerKey: provider.name,
      modelKey: provider.modelKey,
      outputCharCount: null,
      inputTokens: null,
      outputTokens: null,
      latencyMs,
    });
    // Detalhe do provedor fica so no log estruturado, nunca no erro exposto (item 103).
    logger.warn('Nexo56 AI: provedor devolveu erro', {
      module: 'ai',
      operation: 'generateAiDraft',
      requestId,
      kind: result.kind,
    });
    throw aiError(errorCode, result.detail);
  }

  const validation = validateAiOutput({
    rawText: result.text,
    task,
    surfaceMaxLength: surface.maxLength,
    sourceTextForAnchors: prompt.sourceTextForAnchors,
  });

  if (!validation.ok) {
    const errorCode = VALIDATION_REASON_TO_ERROR_CODE[validation.reason];
    await completeAiRequest({
      id: requestId,
      status: 'failed',
      errorCode,
      providerKey: provider.name,
      modelKey: provider.modelKey,
      outputCharCount: unicodeSafeLength(result.text),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs,
    });
    throw aiError(errorCode);
  }

  await completeAiRequest({
    id: requestId,
    status: 'succeeded',
    errorCode: null,
    providerKey: provider.name,
    modelKey: provider.modelKey,
    outputCharCount: unicodeSafeLength(validation.text),
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs,
  });

  return { text: validation.text, taskKey: task.key, surfaceKey: surface.key };
}

function buildInputForTask(
  task: AiTaskDefinition,
  surface: AiSurfaceDefinition,
  entity: LoadedEntity,
  currentText: string | undefined,
) {
  if (task.acceptsStructuredContext) {
    if (!entity.structuredContext) throw aiError('AI_SURFACE_NOT_ALLOWED');
    return buildAiPrompt(task, { structuredContext: entity.structuredContext });
  }

  const text = (currentText ?? entity.fieldValue ?? '').trim();
  if (text.length === 0) throw aiError('AI_INPUT_EMPTY');

  const maxAllowed = Math.min(task.maxInputChars, surface.maxLength);
  if (unicodeSafeLength(text) > maxAllowed) throw aiError('AI_INPUT_TOO_LARGE');

  return buildAiPrompt(task, { text });
}

import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { aiRequests } from './schema';
import type { AiRequestStatus } from '../domain/ai-request';

/**
 * REPOSITORIO DE METADADOS DO NEXO56 AI (Prompt 20, item 139).
 *
 * Dois metodos, o fluxo inteiro: `insertAiRequest` no inicio
 * (`status = 'requested'`), `completeAiRequest` no fim
 * (`succeeded`/`failed`). Nenhum dos dois aceita texto — a assinatura em si
 * impede alguem de, no futuro, "so acrescentar um campinho de conteudo".
 */

export interface InsertAiRequestInput {
  id: string;
  tenantId: string;
  unitId: string | null;
  requestedBy: string;
  taskKey: string;
  surfaceKey: string;
  entityType: string;
  entityId: string;
  promptVersion: string;
  inputCharCount: number;
}

export async function insertAiRequest(input: InsertAiRequestInput): Promise<void> {
  const now = new Date();
  await getDb().insert(aiRequests).values({
    id: input.id,
    tenantId: input.tenantId,
    unitId: input.unitId,
    requestedBy: input.requestedBy,
    taskKey: input.taskKey,
    surfaceKey: input.surfaceKey,
    entityType: input.entityType,
    entityId: input.entityId,
    promptVersion: input.promptVersion,
    providerKey: null,
    modelKey: null,
    status: 'requested',
    errorCode: null,
    inputCharCount: input.inputCharCount,
    outputCharCount: null,
    inputTokens: null,
    outputTokens: null,
    latencyMs: null,
    createdAt: now,
    completedAt: null,
  });
}

export interface CompleteAiRequestInput {
  id: string;
  status: Exclude<AiRequestStatus, 'requested'>;
  errorCode: string | null;
  providerKey: string | null;
  modelKey: string | null;
  outputCharCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export async function completeAiRequest(input: CompleteAiRequestInput): Promise<void> {
  await getDb()
    .update(aiRequests)
    .set({
      status: input.status,
      errorCode: input.errorCode,
      providerKey: input.providerKey,
      modelKey: input.modelKey,
      outputCharCount: input.outputCharCount,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      latencyMs: input.latencyMs,
      completedAt: new Date(),
    })
    .where(eq(aiRequests.id, input.id));
}

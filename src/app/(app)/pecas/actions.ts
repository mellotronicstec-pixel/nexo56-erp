'use server';

import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { requireContext } from '@/modules/auth/application/current-context';
import {
  performPartSearch,
  type PerformPartSearchResult,
} from '@/modules/part-search/application/search-service';
import {
  createPurchaseNeedFromSelection,
  selectCandidate,
} from '@/modules/part-search/application/selection-service';
import { assertSameOrigin } from '../actions';

/**
 * SERVER ACTIONS DA BUSCA DE PECAS (Prompt 21 — mesmo desenho do Nexo56 AI,
 * `src/app/(app)/ai/actions.ts`).
 *
 * Camada fina: le a entrada, revalida origem/sessao, delega a regra inteira
 * para a camada de aplicacao. Nenhum campo de dominio de outro modulo e
 * escrito aqui.
 */

function errorCodeOf(error: unknown, key: string): string | null {
  if (!isAppError(error)) return null;
  return (
    ((error.details as Record<string, unknown> | undefined)?.[key] as string | undefined) ?? null
  );
}

export interface PartSearchActionInput {
  term: string;
  partNumberHint?: string;
  serviceOrderId?: string;
  unitId?: string;
  includeExternal?: boolean;
}

export type PartSearchActionResult =
  | { ok: true; result: PerformPartSearchResult }
  | { ok: false; message: string; errorCode: string | null };

export async function performPartSearchAction(
  input: PartSearchActionInput,
): Promise<PartSearchActionResult> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      const context = await requireContext();
      const result = await performPartSearch(context, input);
      return { ok: true, result };
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha na Busca de Pecas', {
          module: 'part-search',
          operation: 'performPartSearchAction',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return {
        ok: false,
        message: toUserMessage(error),
        errorCode: errorCodeOf(error, 'partSearchErrorCode'),
      };
    }
  });
}

export interface SelectCandidateActionInput {
  sessionId: string;
  candidateId: string;
  offerId?: string;
  unverifiedAcknowledged?: boolean;
}

export type SelectCandidateActionResult =
  { ok: true; selectionId: string } | { ok: false; message: string; errorCode: string | null };

export async function selectPartCandidateAction(
  input: SelectCandidateActionInput,
): Promise<SelectCandidateActionResult> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      const context = await requireContext();
      const result = await selectCandidate(context, input);
      return { ok: true, selectionId: result.selectionId };
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha ao selecionar resultado da Busca de Pecas', {
          module: 'part-search',
          operation: 'selectPartCandidateAction',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return {
        ok: false,
        message: toUserMessage(error),
        errorCode: errorCodeOf(error, 'partSearchErrorCode'),
      };
    }
  });
}

export interface CreateNeedFromSelectionActionInput {
  selectionId: string;
  quantity: string;
  justification?: string;
}

export type CreateNeedFromSelectionActionResult =
  | { ok: true; purchaseNeedId: string; reused: boolean }
  | { ok: false; message: string; errorCode: string | null };

export async function createPurchaseNeedFromSelectionAction(
  input: CreateNeedFromSelectionActionInput,
): Promise<CreateNeedFromSelectionActionResult> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      const context = await requireContext();
      const result = await createPurchaseNeedFromSelection(context, input);
      return { ok: true, purchaseNeedId: result.purchaseNeedId, reused: result.reused };
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha ao criar necessidade de compra a partir da Busca de Pecas', {
          module: 'part-search',
          operation: 'createPurchaseNeedFromSelectionAction',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return {
        ok: false,
        message: toUserMessage(error),
        errorCode: errorCodeOf(error, 'partSearchErrorCode'),
      };
    }
  });
}

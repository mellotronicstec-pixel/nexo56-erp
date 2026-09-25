'use server';

import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { requireContext } from '@/modules/auth/application/current-context';
import { generateAiDraft } from '@/modules/ai/application/generate-draft-service';
import { assertSameOrigin } from '../actions';

/**
 * SERVER ACTION UNICA DO NEXO56 AI (Prompt 20, itens 4 e 63).
 *
 * Camada fina de proposito, igual a toda Server Action do projeto: le a
 * entrada, revalida `assertSameOrigin` e a sessao no servidor, delega a
 * regra inteira para `generateAiDraft`. Nenhum campo de dominio e escrito
 * aqui — o resultado volta para a UI como RASCUNHO em memoria (item 17).
 *
 * Reutilizavel por qualquer superficie do catalogo (OS, Orcamento, e as que
 * vierem): o componente de UI so precisa saber `surfaceKey`/`taskKey`/
 * `entityId`, nunca uma action por modulo.
 */

export interface AiDraftActionInput {
  surfaceKey: string;
  taskKey: string;
  entityId: string;
  /** Texto atual do campo no formulario, ainda nao salvo (item 135). */
  currentText?: string;
}

export type AiDraftActionResult =
  { ok: true; text: string } | { ok: false; message: string; errorCode: string | null };

export async function generateAiDraftAction(
  input: AiDraftActionInput,
): Promise<AiDraftActionResult> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      const context = await requireContext();

      const result = await generateAiDraft(context, {
        surfaceKey: input.surfaceKey,
        taskKey: input.taskKey,
        entityId: input.entityId,
        currentText: input.currentText,
      });

      return { ok: true, text: result.text };
    } catch (error) {
      if (!isAppError(error)) {
        // Sem conteudo no log (item 78): so a operacao e a mensagem tecnica.
        logger.error('Falha no Nexo56 AI', {
          module: 'ai',
          operation: 'generateAiDraftAction',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const errorCode = isAppError(error)
        ? ((error.details as { aiErrorCode?: string } | undefined)?.aiErrorCode ?? null)
        : null;

      return { ok: false, message: toUserMessage(error), errorCode };
    }
  });
}

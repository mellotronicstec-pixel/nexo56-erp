'use server';

import { revalidatePath } from 'next/cache';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { requireContext } from '@/modules/auth/application/current-context';
import {
  cancelMessage,
  createMessage,
  retryMessage,
} from '@/modules/communications/application/message-service';
import {
  archiveTemplate,
  createTemplate,
  updateTemplate,
} from '@/modules/communications/application/template-service';
import { EMPTY_COMMUNICATION_STATE, type CommunicationActionState } from './action-state';
import { assertSameOrigin } from '../actions';

/**
 * Server Actions de Comunicação (Prompt 16).
 *
 * CAMADA FINA: lê o formulário, chama o caso de uso, devolve mensagem.
 * Nenhuma regra mora aqui — nem a de quem pode enviar, nem a de qual unidade,
 * nem a de qual contato é válido. Tudo é recalculado no caso de uso, porque a
 * mesma regra terá de valer quando a chamada vier do aplicativo ou da API.
 *
 * E UMA REGRA ESPECÍFICA DESTE MÓDULO (item 67): NENHUMA ACTION DEVOLVE
 * SEGREDO, TOKEN, CREDENCIAL OU RESPOSTA CRUA DE FORNECEDOR. O que volta para
 * o navegador é uma frase em português sobre o que aconteceu.
 */

async function run(
  operation: string,
  work: () => Promise<CommunicationActionState>,
): Promise<CommunicationActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      return await work();
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha em acao de comunicacao', {
          module: 'communications',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...EMPTY_COMMUNICATION_STATE, error: toUserMessage(error) };
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

function refresh(serviceOrderId?: string): void {
  revalidatePath('/comunicacao');
  if (serviceOrderId) revalidatePath(`/ordens-de-servico/${serviceOrderId}`);
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

export async function sendMessageAction(
  _previous: CommunicationActionState,
  formData: FormData,
): Promise<CommunicationActionState> {
  return run('createMessage', async () => {
    const context = await requireContext();
    const serviceOrderId = optional(formData, 'serviceOrderId');

    const { messageId, reused } = await createMessage(context, {
      customerId: text(formData, 'customerId'),
      channel: text(formData, 'channel'),
      contactValue: text(formData, 'contactValue'),
      unitId: optional(formData, 'unitId'),
      serviceOrderId,
      templateId: optional(formData, 'templateId'),
      subject: optional(formData, 'subject'),
      body: optional(formData, 'body'),
      purpose: optional(formData, 'purpose'),
      attachWarrantyId: optional(formData, 'attachWarrantyId'),
      /** Chave de intenção do formulário: duplo clique reencontra a mensagem. */
      idempotencyKey: optional(formData, 'commandKey'),
    });

    refresh(serviceOrderId);
    revalidatePath(`/comunicacao/${messageId}`);

    /**
     * A frase NÃO diz "mensagem enviada" (item 250). Quem confirma entrega é o
     * provedor, e o que acabou de acontecer é o registro da intenção mais uma
     * tentativa cujo resultado aparece na ficha. Dizer "enviada" aqui seria
     * afirmar, na tela, um fato que esta função não observou.
     */
    return {
      ...EMPTY_COMMUNICATION_STATE,
      success: reused
        ? 'Esta mensagem ja tinha sido registrada.'
        : 'Mensagem registrada. Acompanhe o resultado da tentativa na ficha.',
    };
  });
}

export async function retryMessageAction(
  _previous: CommunicationActionState,
  formData: FormData,
): Promise<CommunicationActionState> {
  return run('retryMessage', async () => {
    const context = await requireContext();
    const messageId = text(formData, 'messageId');
    await retryMessage(context, messageId);

    refresh(optional(formData, 'serviceOrderId'));
    revalidatePath(`/comunicacao/${messageId}`);
    return { ...EMPTY_COMMUNICATION_STATE, success: 'Nova tentativa registrada.' };
  });
}

export async function cancelMessageAction(
  _previous: CommunicationActionState,
  formData: FormData,
): Promise<CommunicationActionState> {
  return run('cancelMessage', async () => {
    const context = await requireContext();
    const messageId = text(formData, 'messageId');
    await cancelMessage(context, { messageId, reason: optional(formData, 'reason') });

    refresh(optional(formData, 'serviceOrderId'));
    revalidatePath(`/comunicacao/${messageId}`);
    return { ...EMPTY_COMMUNICATION_STATE, success: 'Mensagem cancelada.' };
  });
}

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------

export async function createTemplateAction(
  _previous: CommunicationActionState,
  formData: FormData,
): Promise<CommunicationActionState> {
  return run('createTemplate', async () => {
    const context = await requireContext();
    await createTemplate(context, {
      name: text(formData, 'name'),
      channel: text(formData, 'channel'),
      purpose: optional(formData, 'purpose'),
      subject: optional(formData, 'subject'),
      body: text(formData, 'body'),
    });

    revalidatePath('/comunicacao/modelos');
    return { ...EMPTY_COMMUNICATION_STATE, success: 'Modelo criado.' };
  });
}

export async function updateTemplateAction(
  _previous: CommunicationActionState,
  formData: FormData,
): Promise<CommunicationActionState> {
  return run('updateTemplate', async () => {
    const context = await requireContext();
    await updateTemplate(context, {
      templateId: text(formData, 'templateId'),
      name: text(formData, 'name'),
      channel: text(formData, 'channel'),
      purpose: optional(formData, 'purpose'),
      subject: optional(formData, 'subject'),
      body: text(formData, 'body'),
      expectedVersion: optional(formData, 'expectedVersion'),
    });

    revalidatePath('/comunicacao/modelos');
    return { ...EMPTY_COMMUNICATION_STATE, success: 'Modelo atualizado.' };
  });
}

export async function archiveTemplateAction(
  _previous: CommunicationActionState,
  formData: FormData,
): Promise<CommunicationActionState> {
  return run('archiveTemplate', async () => {
    const context = await requireContext();
    await archiveTemplate(context, text(formData, 'templateId'));

    revalidatePath('/comunicacao/modelos');
    return { ...EMPTY_COMMUNICATION_STATE, success: 'Modelo arquivado.' };
  });
}

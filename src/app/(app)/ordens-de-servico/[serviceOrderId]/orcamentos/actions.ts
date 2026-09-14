'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { normalizeAmountInput, normalizeQuantityInput } from '@/core/money/format';
import { requireContext } from '@/modules/auth/application/current-context';
import {
  approveQuote,
  cancelQuote,
  createQuote,
  rejectQuote,
  reviseQuote,
  saveQuoteDraft,
  sendQuote,
} from '@/modules/quotes/application/quote-service';
import { EMPTY_QUOTE_STATE, type QuoteActionState } from './action-state';
import { assertSameOrigin } from '../../../actions';

/**
 * Server Actions de Orcamentos (Prompt 09).
 *
 * Camada fina de propósito: le o formulario, converte o que a pessoa digitou
 * em pt-BR para decimal tecnico e chama o caso de uso. Nenhuma regra de
 * negocio mora aqui — a mesma regra tem de valer quando a chamada vier da
 * futura API ou do Nexo56 Mobile.
 *
 * A AUTORIZACAO NAO E REVALIDADA AQUI: cada caso de uso autoriza na UNIDADE DA
 * ORDEM, que nem sempre e a unidade ativa da sessao. Duplicar a checagem nesta
 * camada criaria duas respostas possiveis para a mesma pergunta, e a errada
 * seria a que usa a unidade ativa.
 */

async function run(
  operation: string,
  work: () => Promise<QuoteActionState>,
): Promise<QuoteActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      return await work();
    } catch (error) {
      if (!isAppError(error)) {
        // Sem PII no log: operacao e mensagem tecnica, nunca valores digitados.
        logger.error('Falha em acao de orcamento', {
          module: 'quotes',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...EMPTY_QUOTE_STATE, error: toUserMessage(error) };
    }
  });
}

function optionalVersion(formData: FormData): number | undefined {
  const value = Number(String(formData.get('expectedVersion') ?? ''));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function refresh(serviceOrderId: string, quoteId?: string): void {
  revalidatePath(`/ordens-de-servico/${serviceOrderId}`);
  if (quoteId) {
    revalidatePath(`/ordens-de-servico/${serviceOrderId}/orcamentos/${quoteId}`);
  }
}

/**
 * Le as linhas do editor.
 *
 * A CONVERSAO DE PT-BR ACONTECE AQUI (item 90): "1.234,56" vira "1234.56"
 * antes de chegar ao dominio. Mandar a string crua faria `Money.parse` ler
 * "1.234" como um real e vinte e tres centavos — o orcamento sairia mil vezes
 * menor e ninguem perceberia ate o cliente chegar para pagar.
 */
function readItems(formData: FormData) {
  const kinds = formData.getAll('itemKind').map(String);
  const descriptions = formData.getAll('itemDescription').map(String);
  const quantities = formData.getAll('itemQuantity').map(String);
  const prices = formData.getAll('itemUnitPrice').map(String);
  const discounts = formData.getAll('itemDiscount').map(String);
  /**
   * Vinculo opcional com o catalogo de pecas (Prompt 10, itens 39 e 108).
   *
   * O id chega OPACO: este modulo nao conhece estoque, e a coerencia de
   * empresa e garantida pela FK composta `(part_id, tenant_id)` no banco. Vazio
   * e o normal — linha escrita a mao continua valida para sempre (item 40).
   */
  const partIds = formData.getAll('itemPartId').map(String);

  return (
    kinds
      .map((kind, index) => ({
        kind: kind as 'service' | 'part' | 'other',
        description: descriptions[index] ?? '',
        quantity: normalizeQuantityInput(quantities[index] ?? '') ?? '',
        unitPrice: normalizeAmountInput(prices[index] ?? '') ?? '0',
        discount: normalizeAmountInput(discounts[index] ?? '') ?? '0',
        partId: (partIds[index] ?? '').trim(),
      }))
      // Linha em branco deixada pelo editor nao e erro: e linha que a pessoa
      // abriu e nao usou.
      .filter((item) => item.description.trim() !== '' || item.quantity !== '')
  );
}

export async function createQuoteAction(
  _previous: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  let created: { serviceOrderId: string; quoteId: string } | null = null;

  const result = await run('createQuote', async () => {
    const context = await requireContext();
    const serviceOrderId = String(formData.get('serviceOrderId') ?? '');

    const quote = await createQuote(context, {
      serviceOrderId,
      idempotencyKey: String(formData.get('idempotencyKey') ?? ''),
    });

    created = { serviceOrderId, quoteId: quote.quoteId };
    refresh(serviceOrderId, quote.quoteId);
    return {
      ...EMPTY_QUOTE_STATE,
      success: quote.reused ? 'Este orcamento ja havia sido criado.' : 'Orcamento criado.',
    };
  });

  // `redirect` lanca por design: fica fora do try.
  if (created) {
    const { serviceOrderId, quoteId } = created;
    redirect(`/ordens-de-servico/${serviceOrderId}/orcamentos/${quoteId}`);
  }
  return result;
}

export async function saveQuoteDraftAction(
  _previous: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  return run('saveQuoteDraft', async () => {
    const context = await requireContext();
    const quoteId = String(formData.get('quoteId') ?? '');
    const serviceOrderId = String(formData.get('serviceOrderId') ?? '');

    const totals = await saveQuoteDraft(
      context,
      quoteId,
      {
        items: readItems(formData),
        discount: normalizeAmountInput(String(formData.get('discount') ?? '')) ?? '0',
        validUntil: String(formData.get('validUntil') ?? ''),
        customerNotes: String(formData.get('customerNotes') ?? ''),
        internalNotes: String(formData.get('internalNotes') ?? ''),
      },
      optionalVersion(formData),
    );

    refresh(serviceOrderId, quoteId);
    return { ...EMPTY_QUOTE_STATE, success: `Rascunho salvo. Total ${totals.total}.` };
  });
}

export async function sendQuoteAction(
  _previous: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  return run('sendQuote', async () => {
    const context = await requireContext();
    const quoteId = String(formData.get('quoteId') ?? '');
    const serviceOrderId = String(formData.get('serviceOrderId') ?? '');

    await sendQuote(context, quoteId, optionalVersion(formData));

    refresh(serviceOrderId, quoteId);
    return {
      ...EMPTY_QUOTE_STATE,
      // Texto VERDADEIRO: o registro existe, o envio automatico nao (item 53).
      success:
        'Orcamento formalizado e Ordem de Servico em Aguardando Aprovacao. O envio automatico da mensagem ainda nao esta disponivel.',
    };
  });
}

export async function approveQuoteAction(
  _previous: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  return run('approveQuote', async () => {
    const context = await requireContext();
    const quoteId = String(formData.get('quoteId') ?? '');
    const serviceOrderId = String(formData.get('serviceOrderId') ?? '');

    await approveQuote(context, quoteId, optionalVersion(formData));

    refresh(serviceOrderId, quoteId);
    return {
      ...EMPTY_QUOTE_STATE,
      success: 'Aprovacao registrada. A Ordem de Servico foi para Aguardando Conserto.',
    };
  });
}

export async function rejectQuoteAction(
  _previous: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  return run('rejectQuote', async () => {
    const context = await requireContext();
    const quoteId = String(formData.get('quoteId') ?? '');
    const serviceOrderId = String(formData.get('serviceOrderId') ?? '');

    await rejectQuote(
      context,
      quoteId,
      { reason: String(formData.get('reason') ?? '') },
      optionalVersion(formData),
    );

    refresh(serviceOrderId, quoteId);
    return {
      ...EMPTY_QUOTE_STATE,
      success: 'Recusa registrada. A Ordem de Servico continua aguardando uma decisao.',
    };
  });
}

export async function cancelQuoteAction(
  _previous: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  return run('cancelQuote', async () => {
    const context = await requireContext();
    const quoteId = String(formData.get('quoteId') ?? '');
    const serviceOrderId = String(formData.get('serviceOrderId') ?? '');

    await cancelQuote(
      context,
      quoteId,
      { reason: String(formData.get('reason') ?? '') },
      optionalVersion(formData),
    );

    refresh(serviceOrderId, quoteId);
    return { ...EMPTY_QUOTE_STATE, success: 'Orcamento cancelado.' };
  });
}

export async function reviseQuoteAction(
  _previous: QuoteActionState,
  formData: FormData,
): Promise<QuoteActionState> {
  let created: { serviceOrderId: string; quoteId: string } | null = null;

  const result = await run('reviseQuote', async () => {
    const context = await requireContext();
    const quoteId = String(formData.get('quoteId') ?? '');
    const serviceOrderId = String(formData.get('serviceOrderId') ?? '');

    const revision = await reviseQuote(context, quoteId);

    created = { serviceOrderId, quoteId: revision.quoteId };
    refresh(serviceOrderId, revision.quoteId);
    return { ...EMPTY_QUOTE_STATE, success: `Revisao ${revision.revision} criada.` };
  });

  if (created) {
    const { serviceOrderId, quoteId } = created;
    redirect(`/ordens-de-servico/${serviceOrderId}/orcamentos/${quoteId}`);
  }
  return result;
}

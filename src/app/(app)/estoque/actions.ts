'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { normalizeAmountInput, normalizeQuantityInput } from '@/core/money/format';
import { requireContext } from '@/modules/auth/application/current-context';
import {
  changePartStatus,
  createPart,
  updatePart,
} from '@/modules/inventory/application/part-service';
import { createLocation, updateLocation } from '@/modules/inventory/application/location-service';
import {
  adjustStock,
  consumeReservation,
  issueStock,
  receiveStock,
  releaseReservation,
  reservePart,
  setMinimumQuantity,
  transferStock,
} from '@/modules/inventory/application/stock-service';
import { EMPTY_INVENTORY_STATE, type InventoryActionState } from './action-state';
import { assertSameOrigin } from '../actions';

/**
 * Server Actions de Estoque (Prompt 10, item 115).
 *
 * CAMADA FINA DE PROPOSITO. Ela le o formulario, converte o que a pessoa
 * digitou em pt-BR para decimal tecnico e chama o caso de uso. Nenhuma regra
 * de negocio mora aqui — a mesma regra tem de valer quando a chamada vier da
 * futura API ou do Nexo56 Mobile.
 *
 * A AUTORIZACAO NAO E REVALIDADA AQUI: cada caso de uso autoriza NA UNIDADE da
 * operacao, que nem sempre e a unidade ativa da sessao (uma reserva autoriza na
 * unidade da OS; uma transferencia autoriza nas duas pontas). Duplicar a
 * checagem aqui criaria duas respostas possiveis para a mesma pergunta, e a
 * errada seria a que usa a unidade ativa.
 */

async function run(
  operation: string,
  work: () => Promise<InventoryActionState>,
): Promise<InventoryActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      return await work();
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha em acao de estoque', {
          module: 'inventory',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...EMPTY_INVENTORY_STATE, error: toUserMessage(error) };
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

/** Quantidade digitada em pt-BR ("2,5") vira decimal tecnico ("2.5"). */
function quantityField(formData: FormData, field: string): string {
  return normalizeQuantityInput(text(formData, field)) ?? '';
}

function amountField(formData: FormData, field: string): string | undefined {
  const raw = text(formData, field);
  if (!raw) return undefined;
  return normalizeAmountInput(raw) ?? undefined;
}

function refreshPart(partId?: string): void {
  revalidatePath('/estoque');
  if (partId) revalidatePath(`/estoque/${partId}`);
}

// ---------------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------------

function partInput(formData: FormData) {
  return {
    code: text(formData, 'code'),
    name: text(formData, 'name'),
    description: optional(formData, 'description'),
    brand: optional(formData, 'brand'),
    partNumber: optional(formData, 'partNumber'),
    barcode: optional(formData, 'barcode'),
    unitOfMeasure: text(formData, 'unitOfMeasure') || 'unit',
    suggestedPrice: amountField(formData, 'suggestedPrice'),
    notes: optional(formData, 'notes'),
  };
}

export async function createPartAction(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  let createdId: string | null = null;

  const result = await run('createPart', async () => {
    const context = await requireContext();
    createdId = await createPart(context, partInput(formData));
    refreshPart(createdId);
    return { ...EMPTY_INVENTORY_STATE, success: 'Peca cadastrada.' };
  });

  // `redirect` lanca por design: fica fora do try.
  if (createdId) redirect(`/estoque/${createdId}`);
  return result;
}

export async function updatePartAction(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  return run('updatePart', async () => {
    const context = await requireContext();
    const partId = text(formData, 'partId');
    await updatePart(context, partId, partInput(formData));
    refreshPart(partId);
    return { ...EMPTY_INVENTORY_STATE, success: 'Cadastro da peca atualizado.' };
  });
}

export async function changePartStatusAction(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  return run('changePartStatus', async () => {
    const context = await requireContext();
    const partId = text(formData, 'partId');
    const status = text(formData, 'status') === 'inactive' ? 'inactive' : 'active';

    await changePartStatus(context, partId, status);
    refreshPart(partId);
    return {
      ...EMPTY_INVENTORY_STATE,
      success:
        status === 'inactive'
          ? 'Peca inativada. O historico e o saldo continuam registrados.'
          : 'Peca reativada.',
    };
  });
}

// ---------------------------------------------------------------------------
// Localizacoes
// ---------------------------------------------------------------------------

export async function createLocationAction(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  return run('createLocation', async () => {
    const context = await requireContext();
    await createLocation(context, text(formData, 'unitId'), {
      name: text(formData, 'name'),
      code: optional(formData, 'code'),
      description: optional(formData, 'description'),
    });
    revalidatePath('/estoque/localizacoes');
    return { ...EMPTY_INVENTORY_STATE, success: 'Localizacao criada.' };
  });
}

export async function updateLocationAction(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  return run('updateLocation', async () => {
    const context = await requireContext();
    const status = text(formData, 'status') === 'inactive' ? 'inactive' : 'active';

    await updateLocation(
      context,
      text(formData, 'locationId'),
      {
        name: text(formData, 'name'),
        code: optional(formData, 'code'),
        description: optional(formData, 'description'),
      },
      status,
    );
    revalidatePath('/estoque/localizacoes');
    return { ...EMPTY_INVENTORY_STATE, success: 'Localizacao atualizada.' };
  });
}

// ---------------------------------------------------------------------------
// Movimentacao
// ---------------------------------------------------------------------------

export async function receiveStockAction(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  return run('receiveStock', async () => {
    const context = await requireContext();
    const partId = text(formData, 'partId');

    const result = await receiveStock(context, {
      unitId: text(formData, 'unitId'),
      partId,
      quantity: quantityField(formData, 'quantity'),
      locationId: optional(formData, 'locationId'),
      unitCost: amountField(formData, 'unitCost'),
      reference: optional(formData, 'reference'),
      /** Chave do formulario: duplo clique nao lanca a entrada duas vezes. */
      idempotencyKey: optional(formData, 'idempotencyKey'),
    });

    refreshPart(partId);
    return {
      ...EMPTY_INVENTORY_STATE,
      success: result.reused
        ? 'Esta entrada ja havia sido registrada.'
        : 'Entrada registrada no estoque.',
    };
  });
}

export async function issueStockAction(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  return run('issueStock', async () => {
    const context = await requireContext();
    const partId = text(formData, 'partId');
    const serviceOrderId = optional(formData, 'serviceOrderId');

    const result = await issueStock(context, {
      unitId: text(formData, 'unitId'),
      partId,
      quantity: quantityField(formData, 'quantity'),
      locationId: optional(formData, 'locationId'),
      serviceOrderId,
      reference: optional(formData, 'reference'),
      idempotencyKey: optional(formData, 'idempotencyKey'),
    });

    refreshPart(partId);
    if (serviceOrderId) revalidatePath(`/ordens-de-servico/${serviceOrderId}`);

    return {
      ...EMPTY_INVENTORY_STATE,
      success: result.reused ? 'Esta saida ja havia sido registrada.' : 'Saida registrada.',
    };
  });
}

export async function adjustStockAction(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  return run('adjustStock', async () => {
    const context = await requireContext();
    const partId = text(formData, 'partId');

    await adjustStock(context, {
      unitId: text(formData, 'unitId'),
      partId,
      direction: text(formData, 'direction') === 'out' ? 'out' : 'in',
      quantity: quantityField(formData, 'quantity'),
      locationId: optional(formData, 'locationId'),
      reason: text(formData, 'reason'),
    });

    refreshPart(partId);
    return { ...EMPTY_INVENTORY_STATE, success: 'Ajuste registrado com o motivo informado.' };
  });
}

export async function transferStockAction(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  return run('transferStock', async () => {
    const context = await requireContext();
    const partId = text(formData, 'partId');

    const result = await transferStock(context, {
      fromUnitId: text(formData, 'fromUnitId'),
      toUnitId: text(formData, 'toUnitId'),
      partId,
      quantity: quantityField(formData, 'quantity'),
      fromLocationId: optional(formData, 'fromLocationId'),
      toLocationId: optional(formData, 'toLocationId'),
      notes: optional(formData, 'notes'),
      idempotencyKey: optional(formData, 'idempotencyKey'),
    });

    refreshPart(partId);
    return {
      ...EMPTY_INVENTORY_STATE,
      success: result.reused
        ? `A transferencia ${result.formattedNumber} ja havia sido registrada.`
        : `Transferencia ${result.formattedNumber} concluida.`,
    };
  });
}

export async function setMinimumQuantityAction(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  return run('setMinimumQuantity', async () => {
    const context = await requireContext();
    const partId = text(formData, 'partId');

    await setMinimumQuantity(
      context,
      text(formData, 'unitId'),
      partId,
      quantityField(formData, 'minimumQuantity') || '0',
    );

    refreshPart(partId);
    return { ...EMPTY_INVENTORY_STATE, success: 'Estoque minimo atualizado para esta unidade.' };
  });
}

// ---------------------------------------------------------------------------
// Reservas
// ---------------------------------------------------------------------------

export async function reservePartAction(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  return run('reservePart', async () => {
    const context = await requireContext();
    const serviceOrderId = text(formData, 'serviceOrderId');
    const partId = text(formData, 'partId');

    await reservePart(context, {
      serviceOrderId,
      partId,
      quantity: quantityField(formData, 'quantity'),
      notes: optional(formData, 'notes'),
    });

    refreshPart(partId);
    revalidatePath(`/ordens-de-servico/${serviceOrderId}`);
    return { ...EMPTY_INVENTORY_STATE, success: 'Peca reservada para esta Ordem de Servico.' };
  });
}

export async function releaseReservationAction(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  return run('releaseReservation', async () => {
    const context = await requireContext();
    const serviceOrderId = text(formData, 'serviceOrderId');

    await releaseReservation(
      context,
      text(formData, 'reservationId'),
      quantityField(formData, 'quantity'),
    );

    refreshPart(optional(formData, 'partId'));
    if (serviceOrderId) revalidatePath(`/ordens-de-servico/${serviceOrderId}`);
    return { ...EMPTY_INVENTORY_STATE, success: 'Reserva liberada. A peca voltou ao disponivel.' };
  });
}

export async function consumeReservationAction(
  _previous: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  return run('consumeReservation', async () => {
    const context = await requireContext();
    const serviceOrderId = text(formData, 'serviceOrderId');

    const result = await consumeReservation(context, text(formData, 'reservationId'), {
      quantity: quantityField(formData, 'quantity'),
      locationId: optional(formData, 'locationId'),
      idempotencyKey: optional(formData, 'idempotencyKey'),
    });

    refreshPart(optional(formData, 'partId'));
    if (serviceOrderId) revalidatePath(`/ordens-de-servico/${serviceOrderId}`);

    return {
      ...EMPTY_INVENTORY_STATE,
      success: result.reused
        ? 'Este consumo ja havia sido registrado.'
        : 'Peca consumida. A Ordem de Servico nao mudou de situacao — use o painel de workflow para isso.',
    };
  });
}

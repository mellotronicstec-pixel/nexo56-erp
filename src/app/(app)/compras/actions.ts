'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { normalizeAmountInput, normalizeQuantityInput } from '@/core/money/format';
import { requireContext } from '@/modules/auth/application/current-context';
import {
  cancelPurchaseNeed,
  createPurchaseNeed,
} from '@/modules/purchasing/application/purchase-need-service';
import {
  createPurchaseOrder,
  savePurchaseOrderDraft,
  transitionPurchaseOrder,
} from '@/modules/purchasing/application/purchase-order-service';
import { receivePurchase } from '@/modules/purchasing/application/purchase-receipt-service';
import {
  changeSupplierStatus,
  createSupplier,
  updateSupplier,
} from '@/modules/purchasing/application/supplier-service';
import {
  isKnownPurchaseOrderStatus,
  type PurchaseOrderStatus,
} from '@/modules/purchasing/domain/purchasing';
import { EMPTY_PURCHASING_STATE, type PurchasingActionState } from './action-state';
import { assertSameOrigin } from '../actions';

/**
 * Server Actions de Fornecedores e Compras (Prompt 11, item 61).
 *
 * CAMADA FINA DE PROPOSITO. Ela le o formulario, converte o que a pessoa
 * digitou em pt-BR para decimal tecnico e chama o caso de uso. Nenhuma regra
 * de negocio mora aqui — a mesma regra tem de valer quando a chamada vier da
 * futura API ou do aplicativo.
 *
 * A AUTORIZACAO NAO E REVALIDADA AQUI: cada caso de uso autoriza NA UNIDADE da
 * operacao, que nem sempre e a unidade ativa da sessao — receber mercadoria
 * autoriza na unidade DO PEDIDO (item 47). Duplicar a checagem aqui criaria
 * duas respostas possiveis para a mesma pergunta, e a errada seria a que usa a
 * unidade ativa.
 */

async function run(
  operation: string,
  work: () => Promise<PurchasingActionState>,
): Promise<PurchasingActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      return await work();
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha em acao de compras', {
          module: 'purchasing',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...EMPTY_PURCHASING_STATE, error: toUserMessage(error) };
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

function refreshSupplier(supplierId?: string): void {
  revalidatePath('/fornecedores');
  if (supplierId) revalidatePath(`/fornecedores/${supplierId}`);
}

function refreshOrder(purchaseOrderId?: string): void {
  revalidatePath('/compras');
  revalidatePath('/compras/necessidades');
  if (purchaseOrderId) revalidatePath(`/compras/${purchaseOrderId}`);
}

// ---------------------------------------------------------------------------
// Fornecedores
// ---------------------------------------------------------------------------

/**
 * Contatos chegam como listas paralelas (`contactName[]`, `contactRole[]`...).
 *
 * E o formato que um `<form>` sem JavaScript produz, e e de proposito: a
 * ficha do fornecedor continua editavel quando o script nao carrega.
 */
function contactsInput(formData: FormData) {
  const names = formData.getAll('contactName').map((value) => String(value).trim());
  const roles = formData.getAll('contactRole').map((value) => String(value).trim());
  const emails = formData.getAll('contactEmail').map((value) => String(value).trim());
  const phones = formData.getAll('contactPhone').map((value) => String(value).trim());

  return names
    .map((name, index) => ({
      name,
      role: roles[index] === 'financial' || roles[index] === 'other' ? roles[index] : 'commercial',
      email: emails[index] || undefined,
      phone: phones[index] || undefined,
    }))
    .filter((contact) => contact.name !== '');
}

function supplierInput(formData: FormData) {
  return {
    kind: text(formData, 'kind') === 'individual' ? 'individual' : 'company',
    name: text(formData, 'name'),
    tradeName: optional(formData, 'tradeName'),
    document: optional(formData, 'document'),
    stateRegistration: optional(formData, 'stateRegistration'),
    email: optional(formData, 'email'),
    phone: optional(formData, 'phone'),
    phoneIsWhatsapp: text(formData, 'phoneIsWhatsapp') === 'on',
    website: optional(formData, 'website'),
    zipCode: optional(formData, 'zipCode'),
    street: optional(formData, 'street'),
    addressNumber: optional(formData, 'addressNumber'),
    complement: optional(formData, 'complement'),
    district: optional(formData, 'district'),
    city: optional(formData, 'city'),
    state: optional(formData, 'state'),
    leadTimeDays: optional(formData, 'leadTimeDays'),
    commercialTerms: optional(formData, 'commercialTerms'),
    notes: optional(formData, 'notes'),
    contacts: contactsInput(formData),
  };
}

export async function createSupplierAction(
  _previous: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  let createdId: string | null = null;

  const result = await run('createSupplier', async () => {
    const context = await requireContext();
    createdId = await createSupplier(context, supplierInput(formData));
    refreshSupplier(createdId);
    return { ...EMPTY_PURCHASING_STATE, success: 'Fornecedor cadastrado.' };
  });

  // `redirect` lanca por design: fica fora do try.
  if (createdId) redirect(`/fornecedores/${createdId}`);
  return result;
}

export async function updateSupplierAction(
  _previous: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  return run('updateSupplier', async () => {
    const context = await requireContext();
    const supplierId = text(formData, 'supplierId');
    await updateSupplier(context, supplierId, supplierInput(formData));
    refreshSupplier(supplierId);
    return { ...EMPTY_PURCHASING_STATE, success: 'Cadastro do fornecedor atualizado.' };
  });
}

export async function changeSupplierStatusAction(
  _previous: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  return run('changeSupplierStatus', async () => {
    const context = await requireContext();
    const supplierId = text(formData, 'supplierId');
    const status = text(formData, 'status') === 'inactive' ? 'inactive' : 'active';

    await changeSupplierStatus(context, supplierId, status);
    refreshSupplier(supplierId);
    return {
      ...EMPTY_PURCHASING_STATE,
      success:
        status === 'inactive'
          ? 'Fornecedor inativado. Os pedidos e o historico de precos continuam registrados.'
          : 'Fornecedor reativado.',
    };
  });
}

// ---------------------------------------------------------------------------
// Necessidades
// ---------------------------------------------------------------------------

export async function createPurchaseNeedAction(
  _previous: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  return run('createPurchaseNeed', async () => {
    const context = await requireContext();
    await createPurchaseNeed(context, {
      unitId: text(formData, 'unitId'),
      partId: text(formData, 'partId'),
      quantity: quantityField(formData, 'quantity'),
      serviceOrderId: optional(formData, 'serviceOrderId'),
      justification: optional(formData, 'justification'),
    });
    revalidatePath('/compras/necessidades');
    return { ...EMPTY_PURCHASING_STATE, success: 'Necessidade registrada.' };
  });
}

export async function cancelPurchaseNeedAction(
  _previous: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  return run('cancelPurchaseNeed', async () => {
    const context = await requireContext();
    await cancelPurchaseNeed(context, text(formData, 'needId'));
    revalidatePath('/compras/necessidades');
    return { ...EMPTY_PURCHASING_STATE, success: 'Necessidade cancelada.' };
  });
}

// ---------------------------------------------------------------------------
// Pedido de compra
// ---------------------------------------------------------------------------

export async function createPurchaseOrderAction(
  _previous: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  let createdId: string | null = null;

  const result = await run('createPurchaseOrder', async () => {
    const context = await requireContext();
    const created = await createPurchaseOrder(context, {
      unitId: text(formData, 'unitId'),
      supplierId: text(formData, 'supplierId'),
      expectedAt: optional(formData, 'expectedAt'),
      internalNotes: optional(formData, 'internalNotes'),
      /** Duplo clique no botao reencontra o mesmo pedido (item 55). */
      idempotencyKey: optional(formData, 'commandKey'),
    });
    createdId = created.purchaseOrderId;
    refreshOrder(createdId);
    return { ...EMPTY_PURCHASING_STATE, success: 'Pedido aberto em rascunho.' };
  });

  if (createdId) redirect(`/compras/${createdId}`);
  return result;
}

/**
 * Grava o rascunho inteiro de uma vez: itens, custos e observacoes.
 *
 * A lista de itens chega em campos paralelos, e a ordem dos indices e o que
 * mantem peca, quantidade e custo na mesma linha.
 */
function draftItems(formData: FormData) {
  const partIds = formData.getAll('itemPartId').map((value) => String(value).trim());
  const quantities = formData.getAll('itemQuantity').map((value) => String(value).trim());
  const costs = formData.getAll('itemUnitCost').map((value) => String(value).trim());
  const supplierCodes = formData.getAll('itemSupplierCode').map((value) => String(value).trim());
  const needIds = formData.getAll('itemNeedId').map((value) => String(value).trim());

  return partIds
    .map((partId, index) => ({
      partId,
      quantity: normalizeQuantityInput(quantities[index] ?? '') ?? '',
      unitCost: normalizeAmountInput(costs[index] ?? '') ?? '',
      supplierCode: supplierCodes[index] || undefined,
      purchaseNeedId: needIds[index] || undefined,
    }))
    .filter((item) => item.partId !== '');
}

export async function savePurchaseDraftAction(
  _previous: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  return run('savePurchaseDraft', async () => {
    const context = await requireContext();
    const purchaseOrderId = text(formData, 'purchaseOrderId');

    await savePurchaseOrderDraft(context, purchaseOrderId, {
      items: draftItems(formData),
      discount: amountField(formData, 'discount'),
      freight: amountField(formData, 'freight'),
      otherCosts: amountField(formData, 'otherCosts'),
      expectedAt: optional(formData, 'expectedAt'),
      internalNotes: optional(formData, 'internalNotes'),
      supplierNotes: optional(formData, 'supplierNotes'),
    });

    refreshOrder(purchaseOrderId);
    return { ...EMPTY_PURCHASING_STATE, success: 'Rascunho salvo.' };
  });
}

const TRANSITION_MESSAGE: Record<string, string> = {
  approved: 'Compra aprovada.',
  /** O Nexo56 NAO envia nada ao fornecedor: ele registra que voce enviou. */
  placed: 'Pedido registrado como realizado. O Nexo56 nao enviou nada ao fornecedor.',
  cancelled: 'Pedido cancelado. O que ja foi recebido continua no estoque.',
};

export async function transitionPurchaseOrderAction(
  _previous: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  return run('transitionPurchaseOrder', async () => {
    const context = await requireContext();
    const purchaseOrderId = text(formData, 'purchaseOrderId');
    const to = text(formData, 'to');

    if (!isKnownPurchaseOrderStatus(to)) {
      return { ...EMPTY_PURCHASING_STATE, error: 'Situacao desconhecida.' };
    }

    await transitionPurchaseOrder(context, purchaseOrderId, to as PurchaseOrderStatus, {
      reason: optional(formData, 'reason'),
    });

    refreshOrder(purchaseOrderId);
    return {
      ...EMPTY_PURCHASING_STATE,
      success: TRANSITION_MESSAGE[to] ?? 'Situacao do pedido atualizada.',
    };
  });
}

/**
 * Registra a chegada da mercadoria.
 *
 * SO AS LINHAS COM QUANTIDADE preenchida entram: o formulario mostra o pedido
 * inteiro, e a pessoa digita o que efetivamente chegou naquela caixa.
 */
export async function receivePurchaseAction(
  _previous: PurchasingActionState,
  formData: FormData,
): Promise<PurchasingActionState> {
  return run('receivePurchase', async () => {
    const context = await requireContext();
    const purchaseOrderId = text(formData, 'purchaseOrderId');

    const itemIds = formData.getAll('receiveItemId').map((value) => String(value).trim());
    const quantities = formData.getAll('receiveQuantity').map((value) => String(value).trim());
    const locations = formData.getAll('receiveLocationId').map((value) => String(value).trim());

    const lines = itemIds
      .map((purchaseOrderItemId, index) => ({
        purchaseOrderItemId,
        quantity: normalizeQuantityInput(quantities[index] ?? '') ?? '',
        locationId: locations[index] || undefined,
      }))
      .filter((line) => line.quantity !== '' && Number(line.quantity) > 0);

    if (lines.length === 0) {
      return {
        ...EMPTY_PURCHASING_STATE,
        error: 'Informe a quantidade que chegou em ao menos um item.',
      };
    }

    const result = await receivePurchase(context, purchaseOrderId, {
      lines,
      documentNumber: optional(formData, 'documentNumber'),
      documentDate: optional(formData, 'documentDate'),
      notes: optional(formData, 'notes'),
      idempotencyKey: optional(formData, 'commandKey'),
    });

    refreshOrder(purchaseOrderId);
    revalidatePath('/estoque');

    if (result.reused) {
      return {
        ...EMPTY_PURCHASING_STATE,
        success: 'Este recebimento ja havia sido registrado. Nada foi lancado em duplicidade.',
      };
    }

    return {
      ...EMPTY_PURCHASING_STATE,
      success:
        result.status === 'received'
          ? 'Recebimento registrado. O pedido foi concluido e o estoque ja subiu.'
          : 'Recebimento parcial registrado. O estoque subiu e o pedido continua aguardando o restante.',
    };
  });
}

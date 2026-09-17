'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { normalizeAmountInput } from '@/core/money/format';
import { requireContext } from '@/modules/auth/application/current-context';
import {
  closeCashSession,
  openCashSession,
  recordCashAdjustment,
} from '@/modules/finance/application/cash-service';
import {
  changeFinancialAccountStatus,
  changeFinancialCategoryStatus,
  changePaymentMethodStatus,
  createFinancialAccount,
  createFinancialCategory,
  createPaymentMethod,
  ensureFinanceDefaults,
  updateFinancialAccount,
} from '@/modules/finance/application/finance-settings-service';
import {
  createExpense,
  ensurePurchaseReceiptPayable,
  ensureServiceOrderCharge,
} from '@/modules/finance/application/finance-integration-service';
import {
  reverseSettlement,
  settleFinancialTitle,
} from '@/modules/finance/application/settlement-service';
import {
  cancelFinancialTitle,
  createFinancialTitle,
  updateFinancialTitle,
} from '@/modules/finance/application/title-service';
import { EMPTY_FINANCE_STATE, type FinanceActionState } from './action-state';
import { assertSameOrigin } from '../actions';

/**
 * Server Actions do Financeiro (Prompt 12, item 85).
 *
 * CAMADA FINA DE PROPOSITO. Ela le o formulario, converte o que a pessoa
 * digitou em pt-BR para decimal tecnico e chama o caso de uso. Nenhuma regra
 * de negocio mora aqui — a mesma regra tem de valer quando a chamada vier da
 * futura API, do Nexo56 Mobile ou do Portal.
 *
 * O FRONTEND NUNCA E AUTORIDADE (item 103) sobre total, saldo, situacao,
 * permissao, empresa ou unidade. Tudo isso o caso de uso recalcula e confere.
 *
 * A AUTORIZACAO NAO E REVALIDADA AQUI: cada caso de uso autoriza NA UNIDADE do
 * titulo, que nem sempre e a unidade ativa da sessao.
 */

async function run(
  operation: string,
  work: () => Promise<FinanceActionState>,
): Promise<FinanceActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      return await work();
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha em acao financeira', {
          module: 'finance',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...EMPTY_FINANCE_STATE, error: toUserMessage(error) };
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

/** Valor em pt-BR ("1.234,56") vira decimal tecnico ("1234.56"). */
function amountField(formData: FormData, field: string): string | undefined {
  const raw = text(formData, field);
  if (!raw) return undefined;
  return normalizeAmountInput(raw) ?? undefined;
}

function refreshFinance(titleId?: string): void {
  revalidatePath('/financeiro');
  revalidatePath('/financeiro/contas-a-receber');
  revalidatePath('/financeiro/contas-a-pagar');
  revalidatePath('/financeiro/caixa');
  if (titleId) revalidatePath(`/financeiro/titulos/${titleId}`);
}

// ---------------------------------------------------------------------------
// Titulos
// ---------------------------------------------------------------------------

export async function createTitleAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  let createdId: string | null = null;

  const result = await run('createTitle', async () => {
    const context = await requireContext();
    const created = await createFinancialTitle(context, {
      unitId: text(formData, 'unitId'),
      direction: text(formData, 'direction'),
      customerId: optional(formData, 'customerId'),
      supplierId: optional(formData, 'supplierId'),
      payeeName: optional(formData, 'payeeName'),
      description: text(formData, 'description'),
      categoryId: optional(formData, 'categoryId'),
      amount: amountField(formData, 'amount') ?? '',
      dueDate: text(formData, 'dueDate'),
      installmentCount: optional(formData, 'installmentCount') ?? '1',
      notes: optional(formData, 'notes'),
    });
    createdId = created.titleId;
    refreshFinance(createdId);
    return { ...EMPTY_FINANCE_STATE, success: `Titulo ${created.formattedNumber} criado.` };
  });

  // `redirect` lanca por design: fica fora do try.
  if (createdId) redirect(`/financeiro/titulos/${createdId}`);
  return result;
}

export async function createExpenseAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  let createdId: string | null = null;

  const result = await run('createExpense', async () => {
    const context = await requireContext();
    const created = await createExpense(context, {
      unitId: text(formData, 'unitId'),
      supplierId: optional(formData, 'supplierId'),
      payeeName: optional(formData, 'payeeName'),
      description: text(formData, 'description'),
      categoryId: optional(formData, 'categoryId'),
      amount: amountField(formData, 'amount') ?? '',
      dueDate: text(formData, 'dueDate'),
      installmentCount: optional(formData, 'installmentCount') ?? '1',
      notes: optional(formData, 'notes'),
    });
    createdId = created.titleId;
    refreshFinance(createdId);
    return { ...EMPTY_FINANCE_STATE, success: `Despesa ${created.formattedNumber} registrada.` };
  });

  if (createdId) redirect(`/financeiro/titulos/${createdId}`);
  return result;
}

export async function updateTitleAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('updateTitle', async () => {
    const context = await requireContext();
    const titleId = text(formData, 'titleId');
    await updateFinancialTitle(context, titleId, {
      description: text(formData, 'description'),
      categoryId: optional(formData, 'categoryId'),
      notes: optional(formData, 'notes'),
    });
    refreshFinance(titleId);
    return { ...EMPTY_FINANCE_STATE, success: 'Titulo atualizado.' };
  });
}

export async function cancelTitleAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('cancelTitle', async () => {
    const context = await requireContext();
    const titleId = text(formData, 'titleId');
    await cancelFinancialTitle(context, titleId, text(formData, 'reason'));
    refreshFinance(titleId);
    return {
      ...EMPTY_FINANCE_STATE,
      success: 'Titulo cancelado. As liquidacoes ja registradas continuam no historico.',
    };
  });
}

// ---------------------------------------------------------------------------
// Liquidacao
// ---------------------------------------------------------------------------

export async function settleTitleAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('settleTitle', async () => {
    const context = await requireContext();
    const titleId = text(formData, 'titleId');

    const resultado = await settleFinancialTitle(context, titleId, {
      installmentId: text(formData, 'installmentId'),
      amount: amountField(formData, 'amount') ?? '',
      financialAccountId: text(formData, 'financialAccountId'),
      paymentMethodId: text(formData, 'paymentMethodId'),
      effectiveDate: optional(formData, 'effectiveDate'),
      cardInstallments: optional(formData, 'cardInstallments'),
      reference: optional(formData, 'reference'),
      notes: optional(formData, 'notes'),
      /** Duplo clique reencontra a liquidacao (item 42). */
      idempotencyKey: optional(formData, 'commandKey'),
    });

    refreshFinance(titleId);

    if (resultado.reused) {
      return {
        ...EMPTY_FINANCE_STATE,
        success: 'Esta liquidacao ja havia sido registrada. Nada foi lancado em duplicidade.',
      };
    }

    const direcao = text(formData, 'direction');
    const verbo = direcao === 'payable' ? 'Pagamento' : 'Recebimento';

    return {
      ...EMPTY_FINANCE_STATE,
      success:
        resultado.titleStatus === 'settled'
          ? `${verbo} registrado. O titulo foi liquidado por completo.`
          : `${verbo} parcial registrado. Ainda faltam ${resultado.outstanding}.`,
    };
  });
}

export async function reverseSettlementAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('reverseSettlement', async () => {
    const context = await requireContext();
    const titleId = text(formData, 'titleId');

    await reverseSettlement(context, text(formData, 'settlementId'), text(formData, 'reason'));

    refreshFinance(titleId);
    return {
      ...EMPTY_FINANCE_STATE,
      success:
        'Estorno registrado. A liquidacao original continua no historico, e o saldo voltou a ficar em aberto.',
    };
  });
}

// ---------------------------------------------------------------------------
// Integracoes
// ---------------------------------------------------------------------------

export async function createServiceOrderChargeAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  let createdId: string | null = null;

  const result = await run('createServiceOrderCharge', async () => {
    const context = await requireContext();
    const serviceOrderId = text(formData, 'serviceOrderId');

    const created = await ensureServiceOrderCharge(context, serviceOrderId, {
      amount: amountField(formData, 'amount'),
      description: optional(formData, 'description'),
      installmentCount: optional(formData, 'installmentCount') ?? '1',
      dueDate: optional(formData, 'dueDate'),
    });

    createdId = created.titleId;
    revalidatePath(`/ordens-de-servico/${serviceOrderId}`);
    refreshFinance(createdId);

    return {
      ...EMPTY_FINANCE_STATE,
      success: created.reused
        ? 'Esta Ordem de Servico ja tinha cobranca. Nada foi duplicado.'
        : `Cobranca ${created.formattedNumber} criada.`,
    };
  });

  if (createdId) redirect(`/financeiro/titulos/${createdId}`);
  return result;
}

export async function createPurchasePayableAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  let createdId: string | null = null;

  const result = await run('createPurchasePayable', async () => {
    const context = await requireContext();
    const purchaseOrderId = text(formData, 'purchaseOrderId');

    const created = await ensurePurchaseReceiptPayable(context, text(formData, 'receiptId'), {
      dueDate: optional(formData, 'dueDate'),
      installmentCount: optional(formData, 'installmentCount') ?? '1',
      categoryId: optional(formData, 'categoryId'),
    });

    createdId = created.titleId;
    if (purchaseOrderId) revalidatePath(`/compras/${purchaseOrderId}`);
    refreshFinance(createdId);

    return {
      ...EMPTY_FINANCE_STATE,
      success: created.reused
        ? 'Este recebimento ja tinha conta a pagar. Nada foi duplicado.'
        : `Conta a pagar ${created.formattedNumber} criada.`,
    };
  });

  if (createdId) redirect(`/financeiro/titulos/${createdId}`);
  return result;
}

// ---------------------------------------------------------------------------
// Caixa
// ---------------------------------------------------------------------------

export async function openCashSessionAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('openCashSession', async () => {
    const context = await requireContext();
    await openCashSession(context, {
      financialAccountId: text(formData, 'financialAccountId'),
      openingAmount: amountField(formData, 'openingAmount'),
      notes: optional(formData, 'notes'),
    });
    refreshFinance();
    return { ...EMPTY_FINANCE_STATE, success: 'Caixa aberto.' };
  });
}

export async function closeCashSessionAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('closeCashSession', async () => {
    const context = await requireContext();
    const resultado = await closeCashSession(context, text(formData, 'sessionId'), {
      countedAmount: amountField(formData, 'countedAmount') ?? '',
      notes: optional(formData, 'notes'),
    });

    refreshFinance();

    const diferenca = Number(resultado.differenceAmount);
    if (diferenca === 0) {
      return { ...EMPTY_FINANCE_STATE, success: 'Caixa fechado. A contagem bateu com o esperado.' };
    }

    /** A diferenca NAO desaparece: ela e dita em voz alta (item 25). */
    return {
      ...EMPTY_FINANCE_STATE,
      success:
        diferenca > 0
          ? `Caixa fechado com SOBRA de ${resultado.differenceAmount}. A diferenca foi registrada.`
          : `Caixa fechado com FALTA de ${resultado.differenceAmount.replace('-', '')}. A diferenca foi registrada.`,
    };
  });
}

export async function recordCashAdjustmentAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('recordCashAdjustment', async () => {
    const context = await requireContext();
    const kind = text(formData, 'kind') === 'withdrawal' ? 'withdrawal' : 'supply';

    await recordCashAdjustment(context, text(formData, 'sessionId'), {
      kind,
      amount: amountField(formData, 'amount') ?? '',
      reason: text(formData, 'reason'),
    });

    refreshFinance();
    return {
      ...EMPTY_FINANCE_STATE,
      success: kind === 'supply' ? 'Suprimento registrado.' : 'Sangria registrada.',
    };
  });
}

// ---------------------------------------------------------------------------
// Configuracao
// ---------------------------------------------------------------------------

export async function ensureFinanceDefaultsAction(
  _previous: FinanceActionState,
): Promise<FinanceActionState> {
  return run('ensureFinanceDefaults', async () => {
    const context = await requireContext();
    await ensureFinanceDefaults(context);
    revalidatePath('/financeiro/configuracoes');
    return { ...EMPTY_FINANCE_STATE, success: 'Formas de pagamento e categorias padrao criadas.' };
  });
}

export async function createAccountAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('createAccount', async () => {
    const context = await requireContext();
    await createFinancialAccount(context, {
      name: text(formData, 'name'),
      kind: text(formData, 'kind'),
      unitId: optional(formData, 'unitId'),
      description: optional(formData, 'description'),
    });
    revalidatePath('/financeiro/configuracoes');
    refreshFinance();
    return { ...EMPTY_FINANCE_STATE, success: 'Conta financeira criada.' };
  });
}

export async function updateAccountAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('updateAccount', async () => {
    const context = await requireContext();
    await updateFinancialAccount(context, text(formData, 'accountId'), {
      name: text(formData, 'name'),
      kind: text(formData, 'kind'),
      unitId: optional(formData, 'unitId'),
      description: optional(formData, 'description'),
    });
    revalidatePath('/financeiro/configuracoes');
    return { ...EMPTY_FINANCE_STATE, success: 'Conta financeira atualizada.' };
  });
}

export async function changeAccountStatusAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('changeAccountStatus', async () => {
    const context = await requireContext();
    const status = text(formData, 'status') === 'inactive' ? 'inactive' : 'active';
    await changeFinancialAccountStatus(context, text(formData, 'accountId'), status);
    revalidatePath('/financeiro/configuracoes');
    return {
      ...EMPTY_FINANCE_STATE,
      success:
        status === 'inactive'
          ? 'Conta inativada. O extrato e o saldo continuam registrados.'
          : 'Conta reativada.',
    };
  });
}

export async function createPaymentMethodAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('createPaymentMethod', async () => {
    const context = await requireContext();
    await createPaymentMethod(context, {
      kind: text(formData, 'kind'),
      name: text(formData, 'name'),
    });
    revalidatePath('/financeiro/configuracoes');
    return { ...EMPTY_FINANCE_STATE, success: 'Forma de pagamento criada.' };
  });
}

export async function changePaymentMethodStatusAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('changePaymentMethodStatus', async () => {
    const context = await requireContext();
    const status = text(formData, 'status') === 'inactive' ? 'inactive' : 'active';
    await changePaymentMethodStatus(context, text(formData, 'methodId'), status);
    revalidatePath('/financeiro/configuracoes');
    return {
      ...EMPTY_FINANCE_STATE,
      success: status === 'inactive' ? 'Forma de pagamento desativada.' : 'Forma reativada.',
    };
  });
}

export async function createCategoryAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('createCategory', async () => {
    const context = await requireContext();
    await createFinancialCategory(context, {
      kind: text(formData, 'kind'),
      name: text(formData, 'name'),
    });
    revalidatePath('/financeiro/configuracoes');
    return { ...EMPTY_FINANCE_STATE, success: 'Categoria criada.' };
  });
}

export async function changeCategoryStatusAction(
  _previous: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  return run('changeCategoryStatus', async () => {
    const context = await requireContext();
    const status = text(formData, 'status') === 'inactive' ? 'inactive' : 'active';
    await changeFinancialCategoryStatus(context, text(formData, 'categoryId'), status);
    revalidatePath('/financeiro/configuracoes');
    return {
      ...EMPTY_FINANCE_STATE,
      success: status === 'inactive' ? 'Categoria desativada.' : 'Categoria reativada.',
    };
  });
}

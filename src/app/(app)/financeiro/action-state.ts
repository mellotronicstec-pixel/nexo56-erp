/** Estado das Server Actions do Financeiro. */
export interface FinanceActionState {
  error: string | null;
  success: string | null;
}

export const EMPTY_FINANCE_STATE: FinanceActionState = { error: null, success: null };

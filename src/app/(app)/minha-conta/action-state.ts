/** Estado compartilhado das Server Actions da conta. Ver usuarios/action-state.ts. */
export interface AccountActionState {
  error: string | null;
  success: string | null;
}

export const EMPTY_ACCOUNT_STATE: AccountActionState = { error: null, success: null };

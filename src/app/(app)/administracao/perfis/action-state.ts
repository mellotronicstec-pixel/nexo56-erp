/** Estado compartilhado das Server Actions de perfis. Ver usuarios/action-state.ts. */
export interface RoleActionState {
  error: string | null;
  success: string | null;
}

export const EMPTY_ROLE_STATE: RoleActionState = { error: null, success: null };

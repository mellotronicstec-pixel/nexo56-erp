/**
 * Estado compartilhado das Server Actions de usuarios.
 *
 * Vive fora do arquivo `'use server'` porque um modulo de server actions so
 * pode exportar funcoes async — constantes e tipos precisam morar aqui.
 */
export interface ActionState {
  error: string | null;
  success: string | null;
  /** Segredo de exibicao unica (senha inicial ou codigo de redefinicao). */
  secret?: { label: string; value: string; hint: string } | null;
}

export const EMPTY_STATE: ActionState = { error: null, success: null, secret: null };

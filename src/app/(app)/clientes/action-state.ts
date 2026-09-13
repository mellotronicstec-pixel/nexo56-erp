/**
 * Estado das Server Actions de Clientes.
 *
 * Arquivo separado porque um modulo `'use server'` so pode exportar funcoes
 * assincronas — constante e tipo precisam morar fora (aprendizado do Prompt 03).
 */

export interface CustomerActionState {
  error: string | null;
  success: string | null;
  /** Cliente existente com o mesmo documento, para oferecer o atalho (item 20). */
  duplicate: { id: string; name: string } | null;
}

export const EMPTY_CUSTOMER_STATE: CustomerActionState = {
  error: null,
  success: null,
  duplicate: null,
};

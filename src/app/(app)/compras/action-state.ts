/** Estado das Server Actions de Fornecedores e Compras. */
export interface PurchasingActionState {
  error: string | null;
  success: string | null;
}

export const EMPTY_PURCHASING_STATE: PurchasingActionState = { error: null, success: null };

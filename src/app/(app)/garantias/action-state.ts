/** Estado das Server Actions de Garantias. */
export interface WarrantyActionState {
  error: string | null;
  success: string | null;
}

export const EMPTY_WARRANTY_STATE: WarrantyActionState = { error: null, success: null };

/** Estado das Server Actions de Estoque. */
export interface InventoryActionState {
  error: string | null;
  success: string | null;
}

export const EMPTY_INVENTORY_STATE: InventoryActionState = { error: null, success: null };

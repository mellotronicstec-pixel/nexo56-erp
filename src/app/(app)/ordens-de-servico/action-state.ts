/** Estado das Server Actions de Ordens de Servico. */
export interface ServiceOrderActionState {
  error: string | null;
  success: string | null;
}

export const EMPTY_SERVICE_ORDER_STATE: ServiceOrderActionState = {
  error: null,
  success: null,
};

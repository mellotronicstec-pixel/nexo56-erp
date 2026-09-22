/** Estado das Server Actions de Comunicação. */
export interface CommunicationActionState {
  error: string | null;
  success: string | null;
}

export const EMPTY_COMMUNICATION_STATE: CommunicationActionState = {
  error: null,
  success: null,
};

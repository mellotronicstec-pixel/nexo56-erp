/** Estado das Server Actions da Agenda. */
export interface AgendaActionState {
  error: string | null;
  success: string | null;
}

export const EMPTY_AGENDA_STATE: AgendaActionState = { error: null, success: null };

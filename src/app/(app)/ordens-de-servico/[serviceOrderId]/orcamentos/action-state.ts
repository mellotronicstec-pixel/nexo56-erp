/** Estado das Server Actions de Orcamentos. */
export interface QuoteActionState {
  error: string | null;
  success: string | null;
}

export const EMPTY_QUOTE_STATE: QuoteActionState = { error: null, success: null };

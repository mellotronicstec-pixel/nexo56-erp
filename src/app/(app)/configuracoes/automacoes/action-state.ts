/** Estado das Server Actions de Automacoes (mesmo padrao dos demais modulos). */
export interface AutomationActionState {
  error: string | null;
  success: string | null;
  /** Preenchido quando a acao cria/atualiza uma regra, para o cliente navegar. */
  ruleId: string | null;
}

export const EMPTY_AUTOMATION_STATE: AutomationActionState = {
  error: null,
  success: null,
  ruleId: null,
};

/**
 * CODIGOS DE ERRO ESTAVEIS DE UMA TENTATIVA DE ACAO (Prompt 19, item 150).
 *
 * `automation_action_attempts.error_code` grava um destes, nunca uma string
 * livre — e o que permite a UI mostrar "Nao foi possivel enviar a
 * comunicacao porque nenhum provedor esta configurado" em vez de vazar
 * `ECONNREFUSED provider=xyz` (item 108).
 *
 * PERMANENTE VS RETRYABLE (item 86): os quatro primeiros nunca melhoram
 * sozinhos — configuracao ausente, feature desligada, dado invalido,
 * destinatario invalido. `PROVIDER_UNAVAILABLE` e a UNICA categoria em que
 * um retry futuro poderia ter resultado diferente (o job-queue ja cuida
 * disso com seu proprio backoff — item 85).
 */
export const AUTOMATION_ERROR_CODES = {
  ACTION_FEATURE_DISABLED: 'ACTION_FEATURE_DISABLED',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  INVALID_RECIPIENT: 'INVALID_RECIPIENT',
  ACTION_VALIDATION_FAILED: 'ACTION_VALIDATION_FAILED',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  UNKNOWN: 'UNKNOWN',
} as const;

export type AutomationErrorCode =
  (typeof AUTOMATION_ERROR_CODES)[keyof typeof AUTOMATION_ERROR_CODES];

/** Nunca melhora sozinho: um retry automatico da fila e desperdicio. */
export const PERMANENT_ERROR_CODES: readonly AutomationErrorCode[] = [
  AUTOMATION_ERROR_CODES.ACTION_FEATURE_DISABLED,
  AUTOMATION_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
  AUTOMATION_ERROR_CODES.INVALID_RECIPIENT,
  AUTOMATION_ERROR_CODES.ACTION_VALIDATION_FAILED,
  AUTOMATION_ERROR_CODES.TENANT_NOT_FOUND,
];

export function isPermanentError(code: string): boolean {
  return (PERMANENT_ERROR_CODES as readonly string[]).includes(code);
}

/** Mensagem pt-BR segura para a tela (item 108) — nunca o detalhe tecnico cru. */
export const AUTOMATION_ERROR_MESSAGES: Record<AutomationErrorCode, string> = {
  ACTION_FEATURE_DISABLED: 'A funcionalidade que esta acao usa esta desativada para a sua empresa.',
  PROVIDER_NOT_CONFIGURED:
    'Nao foi possivel enviar a comunicacao porque nenhum provedor esta configurado.',
  INVALID_RECIPIENT: 'O cliente nao tem um contato elegivel para esta acao.',
  ACTION_VALIDATION_FAILED: 'A configuracao desta acao ficou invalida (ex.: modelo arquivado).',
  TENANT_NOT_FOUND: 'Nao foi possivel identificar a empresa desta execucao.',
  PROVIDER_UNAVAILABLE: 'O servico usado por esta acao esta indisponivel no momento.',
  UNKNOWN: 'Ocorreu um erro inesperado ao executar esta acao.',
};

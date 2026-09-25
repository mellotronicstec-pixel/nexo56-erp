import { AppError, AuthorizationError, BusinessRuleError, IntegrationError } from '@/core/errors';

/**
 * VOCABULARIO E TAXONOMIA DE ERRO DO NEXO56 AI (Prompt 20, itens 74 e 81).
 *
 * `AiRequest` e telemetria operacional da geracao — nunca o conteudo gerado
 * (ADR-085). Os tres estados cobrem o ciclo inteiro sem estado demais:
 * `requested` no inicio, `succeeded`/`failed` no fim. `rejected` cobre o caso
 * em que nem chegamos a chamar o provedor (feature/permissao/superficie
 * invalida) — ainda assim vale registrar a tentativa para observabilidade.
 */
export const AI_REQUEST_STATUSES = ['requested', 'succeeded', 'failed', 'rejected'] as const;
export type AiRequestStatus = (typeof AI_REQUEST_STATUSES)[number];

/**
 * Codigos estaveis (item 74). Cada um mapeia para UMA mensagem em pt-BR fixa
 * — nunca o texto cru do provedor (itens 71, 103 e 180).
 */
export const AI_ERROR_CODES = [
  'AI_FEATURE_DISABLED',
  'AI_PERMISSION_DENIED',
  'AI_SURFACE_NOT_ALLOWED',
  'AI_TASK_NOT_ALLOWED',
  'AI_INPUT_EMPTY',
  'AI_INPUT_TOO_LARGE',
  'AI_PROVIDER_NOT_CONFIGURED',
  'AI_PROVIDER_TIMEOUT',
  'AI_PROVIDER_ERROR',
  'AI_INVALID_OUTPUT',
  'AI_TECHNICAL_MEANING_RISK',
  'AI_INSUFFICIENT_CONTEXT',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  AI_FEATURE_DISABLED: 'O Nexo56 AI nao esta disponivel para a sua empresa.',
  AI_PERMISSION_DENIED: 'Voce nao tem permissao para usar o Nexo56 AI.',
  AI_SURFACE_NOT_ALLOWED: 'Este campo nao aceita sugestoes do Nexo56 AI.',
  AI_TASK_NOT_ALLOWED: 'Esta acao nao esta disponivel para este campo.',
  AI_INPUT_EMPTY: 'Nao ha texto para melhorar.',
  AI_INPUT_TOO_LARGE: 'O texto e longo demais para o Nexo56 AI processar.',
  AI_PROVIDER_NOT_CONFIGURED: 'Nexo56 AI nao esta configurada para uso neste ambiente.',
  AI_PROVIDER_TIMEOUT: 'O Nexo56 AI demorou demais para responder. Tente novamente.',
  AI_PROVIDER_ERROR: 'Nao foi possivel gerar a sugestao agora. Tente novamente.',
  AI_INVALID_OUTPUT: 'A sugestao da Nexo56 AI nao pode ser usada. Tente novamente.',
  AI_TECHNICAL_MEANING_RISK:
    'A sugestao pode ter alterado um dado tecnico. O texto original foi preservado.',
  AI_INSUFFICIENT_CONTEXT: 'Nao ha informacao suficiente registrada para gerar um parecer.',
};

/**
 * Traduz um `AiErrorCode` para o `AppError` correto do restante do sistema —
 * o mesmo pipeline de `isAppError`/`toUserMessage` que toda Server Action ja
 * usa (nenhuma rota nova de erro so para IA).
 *
 * `AI_PROVIDER_TIMEOUT`/`AI_PROVIDER_ERROR` viram `IntegrationError`
 * (`expose = false` por padrao dessa classe): o detalhe real do provedor
 * pode conter corpo de resposta ou cabecalho — nunca alcanca o usuario nem o
 * log estruturado (itens 71, 78 e 103). O texto acima e sempre a mensagem
 * exposta, nunca o `cause`.
 */
export function aiError(code: AiErrorCode, cause?: unknown): AppError {
  const message = AI_ERROR_MESSAGES[code];
  const details = { aiErrorCode: code };

  switch (code) {
    case 'AI_FEATURE_DISABLED':
    case 'AI_PERMISSION_DENIED':
      return new AuthorizationError(message, details);
    case 'AI_PROVIDER_TIMEOUT':
    case 'AI_PROVIDER_ERROR': {
      const error = new IntegrationError(message, details);
      if (cause instanceof Error) {
        // Preservado apenas em memoria do processo para o log sanitizado do
        // chamador decidir o que registrar — nunca serializado ao cliente.
        (error as { cause?: unknown }).cause = cause;
      }
      return error;
    }
    default:
      return new BusinessRuleError(message, details);
  }
}

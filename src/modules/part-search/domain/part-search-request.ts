import { AppError, AuthorizationError, BusinessRuleError, IntegrationError } from '@/core/errors';

/**
 * VOCABULARIO E TAXONOMIA DE ERRO DA BUSCA DE PECAS (Prompt 21, item 127).
 *
 * Mesmo padrao de `ai/domain/ai-request.ts` (ADR-085): codigos ESTAVEIS,
 * cada um com UMA mensagem pt-BR fixa (nunca o texto cru do provedor —
 * item 126), e uma unica funcao que traduz o codigo para o `AppError`
 * correto do resto do sistema.
 */
export const PART_SEARCH_SESSION_STATUSES = [
  'requested',
  'running',
  'completed',
  'partial',
  'failed',
] as const;
export type PartSearchSessionStatus = (typeof PART_SEARCH_SESSION_STATUSES)[number];

export const PART_SEARCH_ERROR_CODES = [
  'PART_SEARCH_FEATURE_DISABLED',
  'PART_SEARCH_PERMISSION_DENIED',
  'PART_SEARCH_CONTEXT_NOT_FOUND',
  'PART_SEARCH_QUERY_INVALID',
  'PART_SEARCH_PROVIDER_NOT_CONFIGURED',
  'PART_SEARCH_PROVIDER_TIMEOUT',
  'PART_SEARCH_PROVIDER_ERROR',
  'PART_SEARCH_INVALID_RESPONSE',
  'PART_SEARCH_CANDIDATE_NOT_FOUND',
  'PART_SEARCH_INCOMPATIBLE_SELECTION',
  'PART_SEARCH_EXTERNAL_URL_INVALID',
  'PART_SEARCH_UNVERIFIED_CONFIRMATION_REQUIRED',
] as const;
export type PartSearchErrorCode = (typeof PART_SEARCH_ERROR_CODES)[number];

const MESSAGES: Record<PartSearchErrorCode, string> = {
  PART_SEARCH_FEATURE_DISABLED: 'A Busca de Pecas nao esta disponivel para a sua empresa.',
  PART_SEARCH_PERMISSION_DENIED: 'Voce nao tem permissao para buscar pecas.',
  PART_SEARCH_CONTEXT_NOT_FOUND: 'Registro nao encontrado.',
  PART_SEARCH_QUERY_INVALID: 'Informe um termo ou codigo de peca valido.',
  PART_SEARCH_PROVIDER_NOT_CONFIGURED: 'Busca externa indisponivel neste ambiente.',
  PART_SEARCH_PROVIDER_TIMEOUT: 'A busca externa demorou demais. Tente novamente.',
  PART_SEARCH_PROVIDER_ERROR: 'Nao foi possivel consultar fontes externas agora.',
  PART_SEARCH_INVALID_RESPONSE: 'A fonte externa devolveu dados invalidos e foi ignorada.',
  PART_SEARCH_CANDIDATE_NOT_FOUND: 'Resultado nao encontrado nesta busca.',
  PART_SEARCH_INCOMPATIBLE_SELECTION:
    'Este resultado foi marcado como incompativel e nao pode ser selecionado.',
  PART_SEARCH_EXTERNAL_URL_INVALID: 'Este link nao e um endereco valido.',
  PART_SEARCH_UNVERIFIED_CONFIRMATION_REQUIRED:
    'Este resultado ainda nao foi verificado. Confirme que deseja usa-lo mesmo assim.',
};

export function partSearchError(code: PartSearchErrorCode, cause?: unknown): AppError {
  const message = MESSAGES[code];
  const details = { partSearchErrorCode: code };

  switch (code) {
    case 'PART_SEARCH_FEATURE_DISABLED':
    case 'PART_SEARCH_PERMISSION_DENIED':
      return new AuthorizationError(message, details);
    case 'PART_SEARCH_PROVIDER_TIMEOUT':
    case 'PART_SEARCH_PROVIDER_ERROR': {
      const error = new IntegrationError(message, details);
      if (cause instanceof Error) {
        (error as { cause?: unknown }).cause = cause;
      }
      return error;
    }
    default:
      return new BusinessRuleError(message, details);
  }
}

/**
 * Hierarquia central de erros (Prompt 01, item 39).
 *
 * Regras:
 *  - toda camada lanca AppError, nunca string solta;
 *  - `expose` indica se a mensagem pode chegar ao usuario final;
 *  - stack trace nunca e serializado para o cliente.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE'
  | 'RATE_LIMITED'
  | 'INTEGRATION_ERROR'
  | 'INTERNAL_ERROR';

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;
  /** Se false, a mensagem e substituida por texto generico na borda HTTP. */
  readonly expose: boolean = true;
  readonly details?: Record<string, unknown>;

  protected constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR' as const;
  readonly httpStatus = 422;
  constructor(message = 'Dados invalidos.', details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class AuthenticationError extends AppError {
  readonly code = 'AUTHENTICATION_ERROR' as const;
  readonly httpStatus = 401;
  constructor(message = 'Credenciais invalidas.', details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class AuthorizationError extends AppError {
  readonly code = 'AUTHORIZATION_ERROR' as const;
  readonly httpStatus = 403;
  constructor(
    message = 'Voce nao tem permissao para executar esta acao.',
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const;
  readonly httpStatus = 404;
  constructor(message = 'Registro nao encontrado.', details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class ConflictError extends AppError {
  readonly code = 'CONFLICT' as const;
  readonly httpStatus = 409;
  constructor(
    message = 'Este registro conflita com um registro existente.',
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}

export class BusinessRuleError extends AppError {
  readonly code = 'BUSINESS_RULE' as const;
  readonly httpStatus = 422;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMITED' as const;
  readonly httpStatus = 429;
  readonly retryAfterSeconds: number;
  constructor(
    retryAfterSeconds: number,
    message = 'Muitas tentativas. Aguarde e tente novamente.',
  ) {
    super(message, { retryAfterSeconds });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class IntegrationError extends AppError {
  readonly code = 'INTEGRATION_ERROR' as const;
  readonly httpStatus = 502;
  override readonly expose = false;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class InternalError extends AppError {
  readonly code = 'INTERNAL_ERROR' as const;
  readonly httpStatus = 500;
  override readonly expose = false;
  constructor(message = 'Erro interno.', details?: Record<string, unknown>) {
    super(message, details);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Mensagem segura para o usuario final. */
export function toUserMessage(error: unknown): string {
  if (isAppError(error) && error.expose) return error.message;
  return 'Ocorreu um erro inesperado. Tente novamente em instantes.';
}

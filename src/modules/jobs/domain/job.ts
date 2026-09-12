/**
 * Contratos da camada de jobs (Prompt 01, item 33).
 *
 * O dominio NAO conhece cron. Ele apenas enfileira um job com nome, payload e
 * (quando a operacao exige) chave de idempotencia:
 *
 *   Regra de negocio -> enqueue() -> fila em banco -> JobExecutor
 *                                                     (cron hoje, worker depois)
 */

export interface JobContext {
  jobId: string;
  attempt: number;
  correlationId: string;
  tenantId: string | null;
}

export interface JobHandler<TPayload = Record<string, unknown>> {
  /** Nome estavel, usado como chave de registro e no banco. */
  name: string;
  /** Tentativas antes de marcar como `failed`. */
  maxAttempts?: number;
  handle(payload: TPayload, context: JobContext): Promise<JobResult | void>;
}

export interface JobResult {
  /** Resumo curto para o log de execucao. Nunca dados pessoais. */
  summary?: string;
  affected?: number;
}

export class JobRetryableError extends Error {
  constructor(
    message: string,
    readonly retryInSeconds = 60,
  ) {
    super(message);
    this.name = 'JobRetryableError';
  }
}

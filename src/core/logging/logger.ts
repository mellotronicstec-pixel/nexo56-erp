import { getContext } from '../context/request-context';

/**
 * Logging estruturado (Prompt 01, item 37).
 *
 * Saida em JSON por linha — adequado tanto para o log da Hostinger quanto para
 * um coletor futuro. Campos sensiveis sao removidos antes da serializacao.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Chaves que nunca podem ser gravadas em log (Prompt 00, item 98). */
const REDACTED_KEYS = new Set([
  'password',
  'senha',
  'passwordhash',
  'password_hash',
  'token',
  'tokenhash',
  'token_hash',
  'secret',
  'sessionsecret',
  'session_secret',
  'jobsecret',
  'job_secret',
  'authorization',
  'cookie',
  'setcookie',
  'set-cookie',
  'cpf',
  'creditcard',
]);

const REDACTED_MARK = '[REDACTED]';

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.has(key.toLowerCase().replace(/[-_]/g, ''))
        ? REDACTED_MARK
        : redact(inner, depth + 1);
    }
    return out;
  }
  return value;
}

function resolveLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return 'info';
}

export interface LogFields {
  module?: string;
  operation?: string;
  durationMs?: number;
  errorCode?: string;
  [key: string]: unknown;
}

function write(level: LogLevel, message: string, fields: LogFields = {}): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[resolveLevel()]) return;
  if (process.env.NODE_ENV === 'test' && !process.env.NEXO56_LOG_IN_TESTS) return;

  const context = getContext();
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    correlationId: context?.correlationId,
    origin: context?.origin,
    tenantId: context?.tenantId,
    userId: context?.userId,
    ...(redact(fields) as Record<string, unknown>),
  };

  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write('debug', message, fields),
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};

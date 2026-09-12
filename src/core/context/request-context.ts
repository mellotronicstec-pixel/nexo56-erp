import { AsyncLocalStorage } from 'node:async_hooks';
import { newCorrelationId } from '../ids/id';

/**
 * Contexto de execucao propagado por request e por job (Prompt 01, item 38).
 *
 * Serve para que logs, auditoria e eventos compartilhem o mesmo correlation ID
 * sem que cada camada precise receber esse dado por parametro.
 */
export interface RequestContext {
  correlationId: string;
  origin: 'web' | 'api' | 'job' | 'cli' | 'test';
  tenantId?: string;
  userId?: string;
  unitId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: Partial<RequestContext>, fn: () => T): T {
  const resolved: RequestContext = {
    correlationId: context.correlationId ?? newCorrelationId(),
    origin: context.origin ?? 'web',
    ...context,
  };
  return storage.run(resolved, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string {
  return storage.getStore()?.correlationId ?? 'no-correlation-id';
}

/** Enriquece o contexto corrente (por exemplo apos autenticar o usuario). */
export function enrichContext(patch: Partial<RequestContext>): void {
  const current = storage.getStore();
  if (!current) return;
  Object.assign(current, patch);
}

import 'server-only';
import { getDb, type Database } from './client';
import {
  dispatch,
  recordEvent,
  type RecordEventInput,
} from '@/modules/events/application/event-bus';
import type { DomainEvent } from '@/modules/events/domain/event';

/**
 * Unidade de trabalho: transacao + eventos pos-commit (Prompt 01, item 32).
 *
 * Uso:
 *   await runInTransaction(async (tx, emit) => {
 *     await tx.insert(...)
 *     await emit({ type: 'USER_CREATED', tenantId, payload })
 *   })
 *
 * Os handlers so rodam depois do COMMIT. Se a transacao lancar, nada e
 * despachado — nao existe evento de algo que nao foi confirmado.
 */

export type TransactionExecutor = Parameters<Parameters<Database['transaction']>[0]>[0];
export type EmitFn = (input: RecordEventInput) => Promise<void>;

export async function runInTransaction<T>(
  work: (tx: TransactionExecutor, emit: EmitFn) => Promise<T>,
): Promise<T> {
  const db = getDb();
  const pending: DomainEvent[] = [];

  const result = await db.transaction(async (tx) => {
    const emit: EmitFn = async (input) => {
      pending.push(await recordEvent(input, tx));
    };
    return work(tx, emit);
  });

  // Pos-commit: a partir daqui a operacao e um fato consumado.
  await dispatch(pending);

  return result;
}

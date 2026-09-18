import 'server-only';
import { and, eq, lte, or, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { isDuplicateKeyError } from '@/core/db/duplicate-key';
import { getContext } from '@/core/context/request-context';
import { newId } from '@/core/ids/id';
import { logger } from '@/core/logging/logger';
import { jobs } from '@/modules/jobs/infrastructure/schema';

/**
 * Fila de jobs em banco (Prompt 01, itens 33 e 34).
 *
 * IDEMPOTENCIA (item 34): quem enfileira pode informar `idempotencyKey`. A
 * garantia nao esta em um `if` da aplicacao — esta no indice UNIQUE da tabela.
 * Duas chamadas concorrentes com a mesma chave resultam em UMA linha; a
 * segunda recebe o job ja existente em vez de criar um duplicado. E por isso
 * que uma execucao repetida do cron nao pode duplicar pagamento, comunicacao,
 * movimentacao ou documento quando o job carrega chave.
 */

export interface EnqueueInput {
  name: string;
  payload?: Record<string, unknown>;
  tenantId?: string | null;
  idempotencyKey?: string;
  runAfter?: Date;
  maxAttempts?: number;
}

export interface EnqueueResult {
  jobId: string;
  /** true quando a chave de idempotencia ja existia e nada foi criado. */
  deduplicated: boolean;
}

export async function enqueue(input: EnqueueInput): Promise<EnqueueResult> {
  const db = getDb();
  const now = new Date();
  const jobId = newId();

  try {
    await db.insert(jobs).values({
      id: jobId,
      name: input.name,
      tenantId: input.tenantId ?? null,
      payload: input.payload ?? {},
      idempotencyKey: input.idempotencyKey ?? null,
      status: 'pending',
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      runAfter: input.runAfter ?? now,
      correlationId: getContext()?.correlationId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return { jobId, deduplicated: false };
  } catch (error) {
    if (input.idempotencyKey && isDuplicateKeyError(error)) {
      const existing = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.idempotencyKey, input.idempotencyKey))
        .limit(1);

      logger.info('Job deduplicado por chave de idempotencia', {
        module: 'jobs',
        operation: 'enqueue',
        jobName: input.name,
      });

      return { jobId: existing[0]?.id ?? jobId, deduplicated: true };
    }
    throw error;
  }
}

export interface ClaimedJob {
  id: string;
  name: string;
  tenantId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
}

/**
 * Reivindica um job pendente para este processo.
 *
 * O UPDATE condicional (`status = 'pending'` na clausula WHERE) e o que impede
 * dois executores concorrentes de rodarem o mesmo job: apenas um UPDATE
 * encontra a linha ainda pendente. Nao depende de lock de aplicacao.
 */
export async function claimNextJob(workerId: string, now = new Date()): Promise<ClaimedJob | null> {
  const db = getDb();

  const candidates = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, 'pending'), lte(jobs.runAfter, now)))
    .orderBy(jobs.runAfter)
    .limit(1);

  const candidateId = candidates[0]?.id;
  if (!candidateId) return null;

  const updateResult = await db
    .update(jobs)
    .set({
      status: 'running',
      lockedBy: workerId,
      lockedAt: now,
      startedAt: now,
      attempts: sql`${jobs.attempts} + 1`,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, candidateId), eq(jobs.status, 'pending')));

  const [header] = updateResult as unknown as [{ affectedRows?: number }];
  if (!header?.affectedRows) return null; // outro executor levou este job

  const rows = await db
    .select({
      id: jobs.id,
      name: jobs.name,
      tenantId: jobs.tenantId,
      payload: jobs.payload,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      correlationId: jobs.correlationId,
    })
    .from(jobs)
    .where(eq(jobs.id, candidateId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return { ...row, payload: (row.payload ?? {}) as Record<string, unknown> };
}

export async function markSucceeded(jobId: string, summary?: string): Promise<void> {
  const now = new Date();
  await getDb()
    .update(jobs)
    .set({ status: 'succeeded', finishedAt: now, updatedAt: now, lastError: null, lockedBy: null })
    .where(eq(jobs.id, jobId));
  logger.info('Job concluido', { module: 'jobs', operation: 'markSucceeded', jobId, summary });
}

export async function markFailed(
  jobId: string,
  message: string,
  retryInSeconds?: number,
): Promise<void> {
  const db = getDb();
  const now = new Date();

  const rows = await db
    .select({ attempts: jobs.attempts, maxAttempts: jobs.maxAttempts })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);

  const row = rows[0];
  const exhausted = !row || row.attempts >= row.maxAttempts;
  const truncated = message.slice(0, 1000);

  if (exhausted) {
    await db
      .update(jobs)
      .set({
        status: 'failed',
        finishedAt: now,
        lastError: truncated,
        updatedAt: now,
        lockedBy: null,
      })
      .where(eq(jobs.id, jobId));
    logger.error('Job falhou definitivamente', { module: 'jobs', operation: 'markFailed', jobId });
    return;
  }

  const backoffSeconds = retryInSeconds ?? Math.min(600, 30 * 2 ** row.attempts);
  await db
    .update(jobs)
    .set({
      status: 'pending',
      lastError: truncated,
      runAfter: new Date(now.getTime() + backoffSeconds * 1000),
      updatedAt: now,
      lockedBy: null,
      startedAt: null,
    })
    .where(eq(jobs.id, jobId));

  logger.warn('Job reagendado apos falha', {
    module: 'jobs',
    operation: 'markFailed',
    jobId,
    backoffSeconds,
  });
}

/** Devolve a fila a um estado seguro apos queda do processo. */
export async function requeueStaleJobs(olderThanMinutes = 15, now = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - olderThanMinutes * 60 * 1000);
  const result = await getDb()
    .update(jobs)
    .set({ status: 'pending', lockedBy: null, startedAt: null, updatedAt: now })
    .where(and(eq(jobs.status, 'running'), or(lte(jobs.lockedAt, threshold))));

  const [header] = result as unknown as [{ affectedRows?: number }];
  return header?.affectedRows ?? 0;
}

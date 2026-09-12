import 'server-only';
import { randomBytes } from 'node:crypto';
import { runWithContext } from '@/core/context/request-context';
import { logger } from '@/core/logging/logger';
import { JobRetryableError } from '@/modules/jobs/domain/job';
import { claimNextJob, markFailed, markSucceeded } from '@/modules/jobs/application/job-queue';
import { findJobHandler } from '@/modules/jobs/application/job-registry';

/**
 * Executor de jobs (Prompt 01, item 33).
 *
 * Hoje e acionado por um comando CLI no cron da Hostinger. Amanha pode ser um
 * worker persistente ou um consumidor de fila: a unica coisa que muda e QUEM
 * chama `runPendingJobs`. Nem o dominio nem os handlers precisam mudar.
 *
 * Preferimos CLI a rota HTTP (Prompt 01, item 36): sem rota, sem superficie
 * de ataque para proteger.
 */

export interface RunOptions {
  /** Limite de jobs por execucao — protege a janela do cron. */
  maxJobs?: number;
  /** Tempo maximo da rodada em milissegundos. */
  maxDurationMs?: number;
}

export interface RunSummary {
  processed: number;
  succeeded: number;
  failed: number;
}

export async function runPendingJobs(options: RunOptions = {}): Promise<RunSummary> {
  const maxJobs = options.maxJobs ?? 25;
  const maxDurationMs = options.maxDurationMs ?? 50_000;
  const workerId = `cli-${process.pid}-${randomBytes(4).toString('hex')}`;
  const startedAt = Date.now();

  const summary: RunSummary = { processed: 0, succeeded: 0, failed: 0 };

  while (summary.processed < maxJobs && Date.now() - startedAt < maxDurationMs) {
    const job = await claimNextJob(workerId);
    if (!job) break;

    summary.processed += 1;

    await runWithContext(
      {
        correlationId: job.correlationId ?? undefined,
        origin: 'job',
        tenantId: job.tenantId ?? undefined,
      },
      async () => {
        const handler = findJobHandler(job.name);

        if (!handler) {
          summary.failed += 1;
          await markFailed(job.id, `Handler nao registrado para o job "${job.name}".`);
          return;
        }

        const jobStartedAt = Date.now();
        try {
          const result = await handler.handle(job.payload as never, {
            jobId: job.id,
            attempt: job.attempts,
            correlationId: job.correlationId ?? 'no-correlation-id',
            tenantId: job.tenantId,
          });

          summary.succeeded += 1;
          await markSucceeded(job.id, result?.summary);
          logger.info('Job executado', {
            module: 'jobs',
            operation: job.name,
            durationMs: Date.now() - jobStartedAt,
            affected: result?.affected,
          });
        } catch (error) {
          summary.failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          const retryIn = error instanceof JobRetryableError ? error.retryInSeconds : undefined;
          await markFailed(job.id, message, retryIn);
        }
      },
    );
  }

  return summary;
}

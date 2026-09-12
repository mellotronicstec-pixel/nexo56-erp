/**
 * Executor de jobs acionado pelo cron da Hostinger (Prompt 01, itens 33 a 36).
 *
 * Cron sugerido no hPanel (horario do servidor, normalmente UTC):
 *   * * * * *  cd ~/domains/SEU_DOMINIO/app && /usr/bin/node --import tsx scripts/run-jobs.ts >> ~/logs/nexo56-jobs.log 2>&1
 *
 * Caracteristicas:
 *  - CLI, nao rota HTTP: nao expoe superficie de ataque (item 36);
 *  - limita duracao e quantidade por rodada, para nunca atropelar a proxima;
 *  - reivindica jobs com UPDATE condicional, entao duas execucoes simultaneas
 *    do cron nao processam o mesmo job;
 *  - agenda os jobs recorrentes usando chave de idempotencia derivada da
 *    janela de tempo: reexecutar o comando na mesma janela nao duplica nada.
 */
import './_bootstrap-env';
import { runWithContext } from '../src/core/context/request-context';
import { closeDb } from '../src/core/db/client';
import { runPendingJobs } from '../src/modules/jobs/application/job-executor';
import { enqueue } from '../src/modules/jobs/application/job-queue';
import { RECURRING_JOBS } from '../src/modules/jobs/application/job-registry';

/**
 * Enfileira os jobs recorrentes cuja janela ja chegou.
 * A chave `<nome>:<janela>` garante uma unica execucao por janela, mesmo que o
 * cron dispare varias vezes ou que duas instancias rodem em paralelo.
 */
async function scheduleRecurringJobs(now: Date): Promise<number> {
  let scheduled = 0;

  for (const recurring of RECURRING_JOBS) {
    const windowMs = recurring.everyMinutes * 60 * 1000;
    const windowIndex = Math.floor(now.getTime() / windowMs);
    const result = await enqueue({
      name: recurring.name,
      idempotencyKey: `${recurring.name}:${windowIndex}`,
      payload: {},
    });
    if (!result.deduplicated) scheduled += 1;
  }

  return scheduled;
}

async function main(): Promise<void> {
  const now = new Date();

  await runWithContext({ origin: 'job' }, async () => {
    const scheduled = await scheduleRecurringJobs(now);
    const summary = await runPendingJobs({ maxJobs: 25, maxDurationMs: 50_000 });

    console.log(
      JSON.stringify({
        timestamp: now.toISOString(),
        level: 'info',
        message: 'rodada de jobs concluida',
        scheduled,
        ...summary,
      }),
    );

    if (summary.failed > 0) process.exitCode = 1;
  });
}

main()
  .catch((error: unknown) => {
    console.error('[jobs] FALHOU:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());

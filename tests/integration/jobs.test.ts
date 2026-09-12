import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runWithContext } from '@/core/context/request-context';
import {
  claimNextJob,
  enqueue,
  markFailed,
  requeueStaleJobs,
} from '@/modules/jobs/application/job-queue';
import { runPendingJobs } from '@/modules/jobs/application/job-executor';
import { jobs } from '@/modules/jobs/infrastructure/schema';
import { createSession } from '@/modules/auth/application/session-service';
import { sessions } from '@/modules/auth/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/** IDEMPOTENCIA E EXECUCAO DE JOBS (Prompt 01, itens 33 e 34). */

let tenant: TenantFixture;

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenant = await createTenantFixture('empresa-jobs', planId);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('idempotencia', () => {
  it('a mesma chave nao cria um segundo job', async () => {
    const first = await enqueue({
      name: 'session.prune-expired',
      idempotencyKey: 'session.prune-expired:janela-1',
      tenantId: tenant.tenantId,
    });
    const second = await enqueue({
      name: 'session.prune-expired',
      idempotencyKey: 'session.prune-expired:janela-1',
      tenantId: tenant.tenantId,
    });

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.jobId).toBe(first.jobId);

    const rows = await getDb().select().from(jobs);
    expect(rows).toHaveLength(1);
  });

  it('a garantia vem do UNIQUE do banco, nao de verificacao na aplicacao', async () => {
    // Duas insercoes concorrentes com a mesma chave: apenas uma linha sobrevive.
    const results = await Promise.all([
      enqueue({ name: 'jobs.requeue-stale', idempotencyKey: 'concorrente' }),
      enqueue({ name: 'jobs.requeue-stale', idempotencyKey: 'concorrente' }),
      enqueue({ name: 'jobs.requeue-stale', idempotencyKey: 'concorrente' }),
    ]);

    const rows = await getDb().select().from(jobs);
    expect(rows).toHaveLength(1);
    expect(results.filter((result) => result.deduplicated)).toHaveLength(2);
  });

  it('chaves diferentes criam jobs diferentes', async () => {
    await enqueue({ name: 'session.prune-expired', idempotencyKey: 'janela-1' });
    await enqueue({ name: 'session.prune-expired', idempotencyKey: 'janela-2' });
    expect(await getDb().select().from(jobs)).toHaveLength(2);
  });

  it('jobs sem chave de idempotencia podem repetir (comportamento explicito)', async () => {
    await enqueue({ name: 'session.prune-expired' });
    await enqueue({ name: 'session.prune-expired' });
    expect(await getDb().select().from(jobs)).toHaveLength(2);
  });
});

describe('execucao', () => {
  it('executa o job pendente e marca como concluido', async () => {
    const session = await createSession(tenant.adminUserId, tenant.tenantId);
    await getDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.id, session.sessionId));

    await enqueue({ name: 'session.prune-expired', idempotencyKey: 'exec-1' });

    const summary = await runWithContext({ origin: 'test' }, () => runPendingJobs());

    expect(summary.processed).toBe(1);
    expect(summary.succeeded).toBe(1);

    const rows = await getDb().select().from(jobs);
    expect(rows[0]?.status).toBe('succeeded');
    expect(rows[0]?.attempts).toBe(1);
  });

  it('reexecutar a rodada nao reprocessa job ja concluido', async () => {
    await enqueue({ name: 'session.prune-expired', idempotencyKey: 'exec-2' });
    await runWithContext({ origin: 'test' }, () => runPendingJobs());
    const second = await runWithContext({ origin: 'test' }, () => runPendingJobs());
    expect(second.processed).toBe(0);
  });

  it('dois executores nao processam o mesmo job', async () => {
    await enqueue({ name: 'session.prune-expired', idempotencyKey: 'exec-3' });

    const [first, second] = await Promise.all([claimNextJob('worker-a'), claimNextJob('worker-b')]);
    const claimed = [first, second].filter(Boolean);
    expect(claimed).toHaveLength(1);
  });

  it('handler desconhecido falha de forma controlada', async () => {
    await enqueue({ name: 'job.que.nao.existe', maxAttempts: 1 });
    const summary = await runWithContext({ origin: 'test' }, () => runPendingJobs());

    expect(summary.failed).toBe(1);
    const rows = await getDb().select().from(jobs);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.lastError).toContain('Handler nao registrado');
  });

  it('falha antes do limite reagenda com backoff', async () => {
    const { jobId } = await enqueue({ name: 'session.prune-expired', maxAttempts: 3 });
    await claimNextJob('worker-a');
    await markFailed(jobId, 'erro temporario');

    const rows = await getDb().select().from(jobs).where(eq(jobs.id, jobId));
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.runAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it('devolve a fila jobs travados por queda de processo', async () => {
    const { jobId } = await enqueue({ name: 'session.prune-expired' });
    await claimNextJob('worker-morto');
    await getDb()
      .update(jobs)
      .set({ lockedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(jobs.id, jobId));

    const requeued = await requeueStaleJobs(15);
    expect(requeued).toBe(1);

    const rows = await getDb().select().from(jobs).where(eq(jobs.id, jobId));
    expect(rows[0]?.status).toBe('pending');
  });
});

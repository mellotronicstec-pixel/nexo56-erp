import {
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { tenants } from '@/modules/tenancy/infrastructure/schema';

/**
 * Fila de jobs persistida em banco (Prompt 01, itens 33 a 36).
 *
 * Nesta fase o executor e um processo CLI acionado por cron da Hostinger.
 * A tabela funciona como fila duravel: substituir o executor por worker/Redis
 * no futuro nao exige reescrever regra de negocio.
 */

export const JOB_STATUS = ['pending', 'running', 'succeeded', 'failed', 'discarded'] as const;

export const jobs = mysqlTable(
  'jobs',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    /** Nome do handler registrado (ex.: `session.prune-expired`). */
    name: varchar('name', { length: 96 }).notNull(),
    tenantId: varchar('tenant_id', { length: 36 }).references(() => tenants.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    payload: json('payload').notNull(),
    /**
     * Chave de idempotencia (Prompt 01, item 34). O UNIQUE no banco e a
     * garantia real: uma segunda tentativa de enfileirar a mesma chave e
     * rejeitada pelo proprio MariaDB, nao por uma verificacao na aplicacao.
     */
    idempotencyKey: varchar('idempotency_key', { length: 190 }),
    status: mysqlEnum('status', JOB_STATUS).notNull().default('pending'),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(3),
    runAfter: datetime('run_after', { mode: 'date', fsp: 3 }).notNull(),
    startedAt: datetime('started_at', { mode: 'date', fsp: 3 }),
    finishedAt: datetime('finished_at', { mode: 'date', fsp: 3 }),
    lastError: varchar('last_error', { length: 1000 }),
    correlationId: varchar('correlation_id', { length: 36 }),
    /** Token do processo que reivindicou o job — evita execucao concorrente. */
    lockedBy: varchar('locked_by', { length: 64 }),
    lockedAt: datetime('locked_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_jobs_idempotency_key').on(table.idempotencyKey),
    index('ix_jobs_status_run_after').on(table.status, table.runAfter),
    index('ix_jobs_name').on(table.name),
    index('ix_jobs_tenant').on(table.tenantId),
  ],
);

export type JobRow = typeof jobs.$inferSelect;

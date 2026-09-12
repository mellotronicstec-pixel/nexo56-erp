import { datetime, index, json, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { tenants } from '@/modules/tenancy/infrastructure/schema';

/**
 * Eventos de dominio persistidos (Prompt 01, itens 31 e 32).
 *
 * A gravacao ocorre DENTRO da transacao da operacao; o despacho para handlers
 * ocorre DEPOIS do commit. A tabela ja tem o formato de outbox (`publishedAt`),
 * de modo que trocar o despacho em processo por um worker externo nao exige
 * mudanca no dominio.
 */
export const domainEvents = mysqlTable(
  'domain_events',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 }).references(() => tenants.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    type: varchar('type', { length: 96 }).notNull(),
    payload: json('payload').notNull(),
    correlationId: varchar('correlation_id', { length: 36 }),
    occurredAt: datetime('occurred_at', { mode: 'date', fsp: 3 }).notNull(),
    /** Nulo enquanto o evento ainda nao foi entregue aos handlers. */
    publishedAt: datetime('published_at', { mode: 'date', fsp: 3 }),
  },
  (table) => [
    index('ix_domain_events_tenant_occurred').on(table.tenantId, table.occurredAt),
    index('ix_domain_events_type').on(table.type),
    index('ix_domain_events_unpublished').on(table.publishedAt),
  ],
);

export type DomainEventRow = typeof domainEvents.$inferSelect;

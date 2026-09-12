import { datetime, index, json, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { tenants } from '@/modules/tenancy/infrastructure/schema';

/**
 * Trilha de auditoria (Prompt 01, item 29; Prompt 00, item 24).
 *
 * Registro somente-insercao: nenhuma rotina da aplicacao atualiza ou apaga
 * linhas desta tabela. `before`/`after` passam por redacao antes da gravacao —
 * senha, token e segredo nunca chegam aqui.
 */
export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 }).references(() => tenants.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    unitId: varchar('unit_id', { length: 36 }),
    userId: varchar('user_id', { length: 36 }),
    action: varchar('action', { length: 96 }).notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 36 }),
    before: json('before'),
    after: json('after'),
    metadata: json('metadata'),
    correlationId: varchar('correlation_id', { length: 36 }),
    origin: varchar('origin', { length: 16 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [
    index('ix_audit_tenant_created').on(table.tenantId, table.createdAt),
    index('ix_audit_entity').on(table.entityType, table.entityId),
    index('ix_audit_action').on(table.action),
    index('ix_audit_correlation').on(table.correlationId),
  ],
);

export type AuditLogRow = typeof auditLogs.$inferSelect;

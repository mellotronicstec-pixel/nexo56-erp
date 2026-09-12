import { datetime, index, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { tenants } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * Sessoes server-side (Prompt 01, item 15).
 *
 * O cookie carrega apenas um token opaco; o banco guarda somente o HASH desse
 * token (SHA-256), de modo que um vazamento de leitura do banco nao permite
 * assumir sessoes. IP e user-agent NAO sao armazenados: sao dados pessoais que
 * a fundacao ainda nao precisa (Prompt 00, item 92).
 */
export const sessions = mysqlTable(
  'sessions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    tenantId: varchar('tenant_id', { length: 36 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    revokedAt: datetime('revoked_at', { mode: 'date', fsp: 3 }),
    lastUsedAt: datetime('last_used_at', { mode: 'date', fsp: 3 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_sessions_token_hash').on(table.tokenHash),
    index('ix_sessions_user').on(table.userId),
    index('ix_sessions_expires').on(table.expiresAt),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;

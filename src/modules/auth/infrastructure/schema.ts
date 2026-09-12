import { foreignKey, index, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { id, idRef, instant, tenantId } from '@/core/db/columns';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * Sessoes server-side (Prompt 01, item 15).
 *
 * O cookie carrega apenas um token opaco; o banco guarda somente o HASH desse
 * token (SHA-256), de modo que um vazamento de leitura do banco nao permite
 * assumir sessoes. IP e user-agent NAO sao armazenados: sao dados pessoais que
 * a fundacao ainda nao precisa (Prompt 00, item 92).
 *
 * Prompt 02, item 34 — a foreign key e COMPOSTA:
 *
 *   (user_id, tenant_id) -> users(id, tenant_id)
 *
 * O `tenant_id` da sessao e a origem de TODO o TenantContext da aplicacao. Com
 * a FK composta, o banco garante que ele seja exatamente o tenant do usuario
 * dono da sessao: uma linha de sessao forjada com outro tenant e rejeitada pelo
 * InnoDB antes de existir.
 */
export const sessions = mysqlTable(
  'sessions',
  {
    id: id().primaryKey(),
    userId: idRef('user_id').notNull(),
    tenantId: tenantId().notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: instant('expires_at').notNull(),
    revokedAt: instant('revoked_at'),
    lastUsedAt: instant('last_used_at').notNull(),
    /**
     * Resumo do agente (ex.: "Chrome no Windows"), truncado, so para a pessoa
     * reconhecer o proprio dispositivo na lista de sessoes ativas.
     *
     * NAO e fingerprint: nao guardamos o user-agent completo, nem versao
     * detalhada, nem IP — dados pessoais que a fundacao ainda nao precisa
     * (Prompt 00 item 92; Prompt 03 item 39).
     */
    userAgentSummary: varchar('user_agent_summary', { length: 120 }),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_sessions_token_hash').on(table.tokenHash),
    index('ix_sessions_user').on(table.userId),
    index('ix_sessions_expires').on(table.expiresAt),
    foreignKey({
      name: 'fk_sessions_user_tenant',
      columns: [table.userId, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;

/**
 * Tokens de redefinicao de senha (Prompt 03, itens 36 e 37).
 *
 * Mesmas garantias da sessao: o token bruto NUNCA e gravado — apenas o
 * SHA-256. Quem tem acesso de leitura ao banco nao consegue redefinir a senha
 * de ninguem.
 *
 * `usedAt` torna o token de uso unico; `expiresAt` limita a janela.
 * `createdBy` registra quando um administrador iniciou o reset de outra pessoa.
 */
export const passwordResetTokens = mysqlTable(
  'password_reset_tokens',
  {
    id: id().primaryKey(),
    userId: idRef('user_id').notNull(),
    tenantId: tenantId().notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: instant('expires_at').notNull(),
    usedAt: instant('used_at'),
    /** Administrador que iniciou o reset; nulo = solicitado pelo proprio titular. */
    createdBy: idRef('created_by'),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_password_reset_token_hash').on(table.tokenHash),
    index('ix_password_reset_user').on(table.userId),
    index('ix_password_reset_expires').on(table.expiresAt),
    foreignKey({
      name: 'fk_password_reset_user_tenant',
      columns: [table.userId, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
  ],
);

export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;

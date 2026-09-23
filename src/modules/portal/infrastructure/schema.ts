import { foreignKey, index, mysqlTable, unique, varchar } from 'drizzle-orm/mysql-core';
import { id, idRef, instant, tenantId, timestamps } from '@/core/db/columns';
import { customers } from '@/modules/customers/infrastructure/schema';
import { PORTAL_IDENTITY_STATUSES } from '@/modules/portal/domain/portal';

/**
 * PORTAL DO CLIENTE — persistencia (Prompt 17).
 *
 * Tres tabelas, e a separacao entre elas e da autenticacao interna (Prompt 01)
 * e o produto principal deste schema (ver domain/portal.ts e ADR-080):
 *
 *   portal_identities    o DIREITO de um customer entrar no Portal
 *   portal_login_tokens  o LINK MAGICO, opaco e de uso unico
 *   portal_sessions      a SESSAO ativa apos o link ser consumido
 *
 * NENHUMA destas tabelas referencia `users` ou `sessions` (Prompt 01/03).
 * `Customer` continua sem saber que o Portal existe: nada aqui e lido por
 * `modules/customers`, e um teste de fronteira recusa o import inverso.
 */

// ---------------------------------------------------------------------------
// Identidade do Portal (item 9, 23)
// ---------------------------------------------------------------------------

export const portalIdentities = mysqlTable(
  'portal_identities',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    /** Um customer tem NO MAXIMO uma identidade por tenant (item 23). */
    customerId: idRef('customer_id').notNull(),

    status: varchar('status', { length: 20 })
      .notNull()
      .default('active')
      .$type<(typeof PORTAL_IDENTITY_STATUSES)[number]>(),
    /** Motivo escrito por pessoa, exigido ao bloquear (abuso, pedido do cliente). */
    blockedReason: varchar('blocked_reason', { length: 300 }),
    blockedAt: instant('blocked_at'),
    blockedBy: idRef('blocked_by'),

    /** Nulo ate o primeiro link ser clicado com sucesso. */
    firstAuthenticatedAt: instant('first_authenticated_at'),
    lastAuthenticatedAt: instant('last_authenticated_at'),

    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_portal_identity_customer_tenant',
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    /** A regra do item 23: um customer, uma identidade. */
    unique('uq_portal_identity_customer').on(table.customerId),
    /** Alvo das FKs compostas de login_tokens e sessions. */
    unique('uq_portal_identity_id_tenant').on(table.id, table.tenantId),

    index('ix_portal_identity_tenant_status').on(table.tenantId, table.status),
  ],
);

// ---------------------------------------------------------------------------
// Link magico (ADR-080)
// ---------------------------------------------------------------------------

export const portalLoginTokens = mysqlTable(
  'portal_login_tokens',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    customerId: idRef('customer_id').notNull(),

    /**
     * Hash-only, igual a `sessions.token_hash` (Prompt 01, item 15). O banco
     * nunca guarda o token em claro — quem le a tabela nao pode logar como o
     * cliente.
     */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),

    /** `email` | `phone`. So o CANAL, nunca o endereco/numero (sem PII extra). */
    requestedVia: varchar('requested_via', { length: 10 }).notNull(),

    expiresAt: instant('expires_at').notNull(),
    /**
     * Consumo por CAS (ADR-044): `UPDATE ... WHERE used_at IS NULL`. Nulo
     * enquanto valido; a primeira gravacao vence a corrida do duplo clique.
     */
    usedAt: instant('used_at'),

    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_portal_login_token_customer_tenant',
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    /** Token opaco: unico globalmente, como o token do certificado de garantia. */
    unique('uq_portal_login_token_hash').on(table.tokenHash),

    index('ix_portal_login_token_customer').on(table.customerId, table.createdAt),
    /** Sustenta o job de limpeza de tokens vencidos sem varrer a tabela. */
    index('ix_portal_login_token_expires').on(table.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// Sessao do Portal (item 19)
// ---------------------------------------------------------------------------

export const portalSessions = mysqlTable(
  'portal_sessions',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    customerId: idRef('customer_id').notNull(),
    portalIdentityId: idRef('portal_identity_id').notNull(),

    /** Mesma forma de `sessions.token_hash`; tabela e cookie SEPARADOS. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),

    expiresAt: instant('expires_at').notNull(),
    revokedAt: instant('revoked_at'),
    lastUsedAt: instant('last_used_at').notNull(),
    userAgentSummary: varchar('user_agent_summary', { length: 120 }),

    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_portal_session_customer_tenant',
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_portal_session_identity_tenant',
      columns: [table.portalIdentityId, table.tenantId],
      foreignColumns: [portalIdentities.id, portalIdentities.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    unique('uq_portal_session_token_hash').on(table.tokenHash),

    index('ix_portal_session_customer').on(table.customerId, table.expiresAt),
    index('ix_portal_session_identity').on(table.portalIdentityId),
  ],
);

export type PortalIdentityRow = typeof portalIdentities.$inferSelect;
export type PortalLoginTokenRow = typeof portalLoginTokens.$inferSelect;
export type PortalSessionRow = typeof portalSessions.$inferSelect;

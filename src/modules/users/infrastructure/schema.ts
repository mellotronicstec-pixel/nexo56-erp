import {
  foreignKey,
  index,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { id, idRef, instant, tenantId, timestamps } from '@/core/db/columns';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';

/**
 * Usuarios (Prompt 01, item 13).
 *
 * Dados pessoais sao deliberadamente minimos nesta fundacao (LGPD, Prompt 00
 * item 92): identificacao, autenticacao, status e vinculo organizacional.
 *
 * O e-mail e unico POR TENANT — a mesma pessoa pode existir em empresas
 * diferentes. A resolucao de tenant no login esta documentada em
 * docs/architecture/auth.md.
 */

export const USER_STATUS = ['active', 'suspended', 'inactive'] as const;

export const users = mysqlTable(
  'users',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    email: varchar('email', { length: 190 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    /** Hash no formato `scrypt$N$r$p$salt$hash`. Nunca senha em texto puro. */
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    status: mysqlEnum('status', USER_STATUS).notNull().default('active'),
    lastLoginAt: instant('last_login_at'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_users_tenant_email').on(table.tenantId, table.email),
    index('ix_users_email').on(table.email),
    index('ix_users_tenant_status').on(table.tenantId, table.status),
    /** Alvo das FKs compostas — ver o comentario em units.uq_units_id_tenant. */
    unique('uq_users_id_tenant').on(table.id, table.tenantId),
  ],
);

/**
 * Unidades que o usuario esta autorizado a acessar.
 *
 * Prompt 02, item 34 — as foreign keys aqui sao COMPOSTAS:
 *
 *   (user_id, tenant_id) -> users(id, tenant_id)
 *   (unit_id, tenant_id) -> units(id, tenant_id)
 *
 * Como as duas compartilham a MESMA coluna `tenant_id`, o InnoDB so aceita a
 * linha quando o usuario e a unidade pertencem ao mesmo tenant. Vincular o
 * usuario de uma empresa a unidade de outra passa a ser impossivel no banco,
 * e nao apenas barrado pela aplicacao.
 *
 * A FK simples para `tenants` foi removida por redundancia: o tenant e
 * alcancado transitivamente por users/units, que mantem FK para tenants.
 */
export const userUnits = mysqlTable(
  'user_units',
  {
    userId: idRef('user_id').notNull(),
    unitId: idRef('unit_id').notNull(),
    tenantId: tenantId().notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.unitId] }),
    index('ix_user_units_tenant').on(table.tenantId),
    index('ix_user_units_unit').on(table.unitId),
    foreignKey({
      name: 'fk_user_units_user_tenant',
      columns: [table.userId, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({
      name: 'fk_user_units_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type UserUnitRow = typeof userUnits.$inferSelect;

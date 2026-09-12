import {
  datetime,
  index,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
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
    id: varchar('id', { length: 36 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    email: varchar('email', { length: 190 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    /** Hash no formato `scrypt$N$r$p$salt$hash`. Nunca senha em texto puro. */
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    status: mysqlEnum('status', USER_STATUS).notNull().default('active'),
    lastLoginAt: datetime('last_login_at', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_users_tenant_email').on(table.tenantId, table.email),
    index('ix_users_email').on(table.email),
    index('ix_users_tenant_status').on(table.tenantId, table.status),
  ],
);

/** Unidades que o usuario esta autorizado a acessar. */
export const userUnits = mysqlTable(
  'user_units',
  {
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    unitId: varchar('unit_id', { length: 36 })
      .notNull()
      .references(() => units.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    tenantId: varchar('tenant_id', { length: 36 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.unitId] }),
    index('ix_user_units_tenant').on(table.tenantId),
    index('ix_user_units_unit').on(table.unitId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type UserUnitRow = typeof userUnits.$inferSelect;

import {
  boolean,
  datetime,
  index,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { features } from '@/modules/features/infrastructure/schema';
import { tenants } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * RBAC (Prompt 01, itens 17 e 18).
 *
 * `permissions` e um catalogo global do produto (a mesma chave significa a
 * mesma coisa em todos os tenants). `roles` sao por tenant, com papeis de
 * sistema criados no bootstrap e marcados com `isSystem`.
 */

export const permissions = mysqlTable(
  'permissions',
  {
    key: varchar('key', { length: 96 }).primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    description: varchar('description', { length: 400 }).notNull(),
    /** Modulo/feature ao qual a permissao pertence (agrupamento na UI). */
    featureKey: varchar('feature_key', { length: 96 })
      .notNull()
      .references(() => features.key, { onDelete: 'restrict', onUpdate: 'cascade' }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [index('ix_permissions_feature').on(table.featureKey)],
);

export const roles = mysqlTable(
  'roles',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    key: varchar('key', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    description: varchar('description', { length: 400 }).notNull().default(''),
    /** Papel estrutural criado pelo sistema; nao pode ser excluido. */
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [uniqueIndex('uq_roles_tenant_key').on(table.tenantId, table.key)],
);

export const rolePermissions = mysqlTable(
  'role_permissions',
  {
    roleId: varchar('role_id', { length: 36 })
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    permissionKey: varchar('permission_key', { length: 96 })
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionKey] }),
    index('ix_role_permissions_permission').on(table.permissionKey),
  ],
);

export const userRoles = mysqlTable(
  'user_roles',
  {
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    roleId: varchar('role_id', { length: 36 })
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    tenantId: varchar('tenant_id', { length: 36 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('ix_user_roles_tenant').on(table.tenantId),
    index('ix_user_roles_role').on(table.roleId),
  ],
);

export type PermissionRow = typeof permissions.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;

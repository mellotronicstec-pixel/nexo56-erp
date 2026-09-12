import {
  boolean,
  foreignKey,
  index,
  mysqlTable,
  primaryKey,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { id, idRef, instant, techKey, tenantId, timestamps } from '@/core/db/columns';
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
    createdAt: instant('created_at').notNull(),
  },
  (table) => [index('ix_permissions_feature').on(table.featureKey)],
);

export const roles = mysqlTable(
  'roles',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    key: techKey('key', 64).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    description: varchar('description', { length: 400 }).notNull().default(''),
    /** Papel estrutural criado pelo sistema; nao pode ser excluido. */
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_roles_tenant_key').on(table.tenantId, table.key),
    /** Alvo das FKs compostas — ver units.uq_units_id_tenant. */
    unique('uq_roles_id_tenant').on(table.id, table.tenantId),
  ],
);

export const rolePermissions = mysqlTable(
  'role_permissions',
  {
    roleId: idRef('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    permissionKey: techKey('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionKey] }),
    index('ix_role_permissions_permission').on(table.permissionKey),
  ],
);

/**
 * Papeis atribuidos ao usuario.
 *
 * Prompt 02, item 34 — foreign keys COMPOSTAS compartilhando `tenant_id`:
 *
 *   (user_id, tenant_id) -> users(id, tenant_id)
 *   (role_id, tenant_id) -> roles(id, tenant_id)
 *
 * Isso torna impossivel, no banco, atribuir ao usuario de uma empresa um papel
 * definido em outra — inclusive por insercao direta em SQL.
 */
export const userRoles = mysqlTable(
  'user_roles',
  {
    userId: idRef('user_id').notNull(),
    roleId: idRef('role_id').notNull(),
    tenantId: tenantId().notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('ix_user_roles_tenant').on(table.tenantId),
    index('ix_user_roles_role').on(table.roleId),
    foreignKey({
      name: 'fk_user_roles_user_tenant',
      columns: [table.userId, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({
      name: 'fk_user_roles_role_tenant',
      columns: [table.roleId, table.tenantId],
      foreignColumns: [roles.id, roles.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
  ],
);

export type PermissionRow = typeof permissions.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;

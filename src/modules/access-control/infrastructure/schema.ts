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
import { actorColumns, id, idRef, instant, techKey, tenantId, timestamps } from '@/core/db/columns';
import { features } from '@/modules/features/infrastructure/schema';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { userUnits, users } from '@/modules/users/infrastructure/schema';

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
    ...actorColumns(),
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
    /** Quem concedeu. Nulo = criado pelo sistema (bootstrap). */
    createdBy: idRef('created_by'),
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

/**
 * Atribuicao de papel COM ESCOPO DE UNIDADE (Prompt 03, itens 15 a 20).
 *
 * Complementa `user_roles`, que permanece com a semantica que sempre teve:
 * atribuicao valida em todo o tenant. Nenhuma linha existente foi migrada.
 *
 *   user_roles       -> papel vale no tenant (nas unidades que o usuario acessa)
 *   user_unit_roles  -> papel vale SOMENTE na unidade indicada
 *
 * PROTECOES NO PROPRIO BANCO
 *
 * 1. Coerencia de tenant: as tres FKs compostas compartilham `tenant_id`, entao
 *    usuario, papel e unidade sao obrigatoriamente do mesmo tenant.
 *
 * 2. Membership obrigatoria (item 20): a FK `(user_id, unit_id)` aponta para a
 *    CHAVE PRIMARIA de `user_units`. Atribuir papel numa unidade onde o usuario
 *    nao tem vinculo e rejeitado pelo InnoDB, nao apenas pela aplicacao.
 *    O `ON DELETE CASCADE` dessa FK garante que remover o vinculo nao deixe
 *    atribuicao orfa concedendo acesso (item 21) — a aplicacao ainda remove e
 *    audita explicitamente; o cascade e a ultima linha de defesa.
 */
export const userUnitRoles = mysqlTable(
  'user_unit_roles',
  {
    userId: idRef('user_id').notNull(),
    roleId: idRef('role_id').notNull(),
    unitId: idRef('unit_id').notNull(),
    tenantId: tenantId().notNull(),
    createdBy: idRef('created_by'),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId, table.unitId] }),
    index('ix_user_unit_roles_tenant').on(table.tenantId),
    index('ix_user_unit_roles_unit').on(table.unitId),
    index('ix_user_unit_roles_role').on(table.roleId),
    foreignKey({
      name: 'fk_user_unit_roles_user_tenant',
      columns: [table.userId, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({
      name: 'fk_user_unit_roles_role_tenant',
      columns: [table.roleId, table.tenantId],
      foreignColumns: [roles.id, roles.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({
      name: 'fk_user_unit_roles_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    /** Exige membership — ver comentario acima. */
    foreignKey({
      name: 'fk_user_unit_roles_membership',
      columns: [table.userId, table.unitId],
      foreignColumns: [userUnits.userId, userUnits.unitId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
  ],
);

export type UserUnitRoleRow = typeof userUnitRoles.$inferSelect;

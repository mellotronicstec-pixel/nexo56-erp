import {
  boolean,
  datetime,
  index,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { tenants } from '@/modules/tenancy/infrastructure/schema';

/**
 * Modularidade (Prompt 01, itens 23 a 28; Prompt 00, item 13).
 *
 *   Feature Catalog  -> o que existe no produto
 *   Plan Entitlements -> o que o plano contratado permite
 *   Tenant Config     -> o que a empresa ativou
 *   User Permissions  -> o que o usuario pode fazer (tabelas de access-control)
 */

export const FEATURE_TYPE = ['CORE', 'OPTIONAL', 'PREMIUM', 'BETA', 'INTERNAL'] as const;
export const FEATURE_STATUS = ['available', 'deprecated'] as const;

/** Catalogo global de capacidades do produto. */
export const features = mysqlTable(
  'features',
  {
    key: varchar('key', { length: 96 }).primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    description: varchar('description', { length: 400 }).notNull(),
    type: mysqlEnum('type', FEATURE_TYPE).notNull(),
    status: mysqlEnum('status', FEATURE_STATUS).notNull().default('available'),
    /** CORE nao pode ser desativada pelo tenant (Prompt 00, item 12). */
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [index('ix_features_type').on(table.type)],
);

/** Dependencias formais entre features (Prompt 00, item 16). */
export const featureDependencies = mysqlTable(
  'feature_dependencies',
  {
    featureKey: varchar('feature_key', { length: 96 })
      .notNull()
      .references(() => features.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    dependsOnKey: varchar('depends_on_key', { length: 96 })
      .notNull()
      .references(() => features.key, { onDelete: 'restrict', onUpdate: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.featureKey, table.dependsOnKey] }),
    index('ix_feature_dependencies_depends_on').on(table.dependsOnKey),
  ],
);

export const plans = mysqlTable(
  'plans',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    key: varchar('key', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    description: varchar('description', { length: 400 }).notNull().default(''),
    /** Plano interno de desenvolvimento/homologacao, nao comercializavel. */
    isInternal: boolean('is_internal').notNull().default(false),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [uniqueIndex('uq_plans_key').on(table.key)],
);

/** O que cada plano libera. Ausencia de linha = nao contemplado pelo plano. */
export const planEntitlements = mysqlTable(
  'plan_entitlements',
  {
    planId: varchar('plan_id', { length: 36 })
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    featureKey: varchar('feature_key', { length: 96 })
      .notNull()
      .references(() => features.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.planId, table.featureKey] }),
    index('ix_plan_entitlements_feature').on(table.featureKey),
  ],
);

/**
 * Configuracao do tenant. Desativar NAO apaga dados (Prompt 00, item 17):
 * a linha permanece com `enabled = false` e o historico segue intacto.
 */
export const tenantFeatures = mysqlTable(
  'tenant_features',
  {
    tenantId: varchar('tenant_id', { length: 36 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    featureKey: varchar('feature_key', { length: 96 })
      .notNull()
      .references(() => features.key, { onDelete: 'restrict', onUpdate: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    enabledAt: datetime('enabled_at', { mode: 'date', fsp: 3 }),
    disabledAt: datetime('disabled_at', { mode: 'date', fsp: 3 }),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.featureKey] }),
    index('ix_tenant_features_feature').on(table.featureKey),
  ],
);

export type FeatureRow = typeof features.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type TenantFeatureRow = typeof tenantFeatures.$inferSelect;

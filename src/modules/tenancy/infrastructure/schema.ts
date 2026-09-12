import {
  datetime,
  index,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { plans } from '@/modules/features/infrastructure/schema';

/**
 * Tenancy — tenant (empresa cliente) e unidade (filial).
 * Prompt 01, itens 11 e 12. Campos deliberadamente minimos: cadastro
 * empresarial completo (dados fiscais, comerciais) pertence a prompts futuros.
 */

export const TENANT_STATUS = ['active', 'suspended', 'inactive'] as const;
export const UNIT_STATUS = ['active', 'inactive'] as const;

export const tenants = mysqlTable(
  'tenants',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    status: mysqlEnum('status', TENANT_STATUS).notNull().default('active'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('America/Sao_Paulo'),
    planId: varchar('plan_id', { length: 36 })
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_tenants_slug').on(table.slug),
    index('ix_tenants_status').on(table.status),
  ],
);

export const units = mysqlTable(
  'units',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 36 })
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    status: mysqlEnum('status', UNIT_STATUS).notNull().default('active'),
    /** Nulo = herda o timezone do tenant. */
    timezone: varchar('timezone', { length: 64 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_units_tenant_name').on(table.tenantId, table.name),
    index('ix_units_tenant_status').on(table.tenantId, table.status),
  ],
);

export type TenantRow = typeof tenants.$inferSelect;
export type UnitRow = typeof units.$inferSelect;

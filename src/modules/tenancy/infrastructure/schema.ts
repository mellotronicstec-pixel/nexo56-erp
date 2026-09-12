import {
  bigint,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { id, idRef, instant, techKey, tenantId, timestamps } from '@/core/db/columns';
import { plans } from '@/modules/features/infrastructure/schema';

/**
 * Tenancy — tenant (empresa cliente) e unidade (filial).
 * Prompt 01, itens 11 e 12. Campos deliberadamente minimos: cadastro
 * empresarial completo (dados fiscais, comerciais) pertence a prompts futuros.
 *
 * Prompt 02: colunas passam a usar os helpers de convencao
 * (src/core/db/columns.ts) e `units` ganha a chave composta que viabiliza
 * foreign keys tenant-safe nas tabelas filhas.
 */

export const TENANT_STATUS = ['active', 'suspended', 'inactive'] as const;
export const UNIT_STATUS = ['active', 'inactive'] as const;

export const tenants = mysqlTable(
  'tenants',
  {
    id: id().primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    status: mysqlEnum('status', TENANT_STATUS).notNull().default('active'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('America/Sao_Paulo'),
    planId: idRef('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_tenants_slug').on(table.slug),
    index('ix_tenants_status').on(table.status),
  ],
);

export const units = mysqlTable(
  'units',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    status: mysqlEnum('status', UNIT_STATUS).notNull().default('active'),
    /** Nulo = herda o timezone do tenant. */
    timezone: varchar('timezone', { length: 64 }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_units_tenant_name').on(table.tenantId, table.name),
    index('ix_units_tenant_status').on(table.tenantId, table.status),
    /**
     * Alvo das foreign keys compostas (Prompt 02, item 34).
     *
     * Sem esta chave, uma FK simples `unit_id -> units.id` garante apenas que a
     * unidade EXISTE — nao que ela pertenca ao mesmo tenant do registro que a
     * referencia. Com ela, as tabelas filhas referenciam (unit_id, tenant_id) e
     * o proprio InnoDB passa a recusar associacao entre tenants diferentes.
     */
    unique('uq_units_id_tenant').on(table.id, table.tenantId),
  ],
);

/**
 * Sequencias humanas por tenant (Prompt 02, itens 15, 17 e 50).
 *
 * O numero visivel de um documento (OS, orcamento, pedido de compra) e
 * SEQUENCIAL POR TENANT — nunca reiniciado por unidade, para que "OS 000123"
 * identifique um unico atendimento dentro da empresa, no balcao, no QR, no
 * portal e no suporte.
 *
 * Uma linha por (tenant, tipo). A alocacao usa o idioma atomico do MariaDB
 * (INSERT ... ON DUPLICATE KEY UPDATE com LAST_INSERT_ID), entao duas
 * requisicoes simultaneas nunca recebem o mesmo numero — ver
 * src/modules/tenancy/application/sequence-service.ts e ADR-013.
 *
 * NAO e primary key de nada: o ID tecnico continua sendo UUIDv7. Este numero e
 * apenas o identificador humano, gravado como coluna propria do documento.
 */
export const tenantSequences = mysqlTable(
  'tenant_sequences',
  {
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** `service_order`, `quote`, `purchase_order`, `warranty`, `document`... */
    sequenceType: techKey('sequence_type', 64).notNull(),
    /** Ultimo numero efetivamente entregue. Comeca em 0: o primeiro uso devolve 1. */
    currentValue: bigint('current_value', { mode: 'number', unsigned: true }).notNull().default(0),
    /** Prefixo opcional exibido junto ao numero (ex.: "OS"). */
    prefix: varchar('prefix', { length: 16 }).notNull().default(''),
    /** Quantidade de digitos com zeros a esquerda na formatacao. */
    padding: int('padding').notNull().default(6),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.sequenceType] })],
);

export type TenantRow = typeof tenants.$inferSelect;
export type UnitRow = typeof units.$inferSelect;
export type TenantSequenceRow = typeof tenantSequences.$inferSelect;

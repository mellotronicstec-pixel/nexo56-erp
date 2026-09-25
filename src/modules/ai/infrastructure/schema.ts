import { sql } from 'drizzle-orm';
import { check, foreignKey, index, int, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { id, idRef, instant, tenantId, techKey, unitId } from '@/core/db/columns';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * SCHEMA DO NEXO56 AI (Prompt 20, ADR-085).
 *
 * UMA TABELA SO, e ela NAO GUARDA CONTEUDO (itens 20 a 23, 82, 118, 153,
 * 182). `ai_requests` e telemetria operacional da geracao — quantos
 * caracteres entraram e saíram, quanto demorou, qual provedor, qual codigo
 * de erro. Nunca o texto original, nunca o prompt, nunca o resultado.
 *
 * Isso e deliberado, nao uma omissao a corrigir depois: o item 23 pede
 * explicitamente para NAO adicionar hash de conteudo "por precaucao" — um
 * hash de um texto curto e adivinhavel, e vira fingerprint do dado sensivel
 * que a tabela existe para nao guardar.
 */

export const AI_REQUEST_STATUS_VALUES = ['requested', 'succeeded', 'failed', 'rejected'] as const;

export const aiRequests = mysqlTable(
  'ai_requests',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    /**
     * Nulo e legitimo (item 21, "quando aplicavel"): toda superficie de hoje
     * e de uma unidade, mas o catalogo de superficies pode crescer com uma
     * que nao seja (ex.: um rascunho de nivel tenant no futuro).
     */
    unitId: unitId(),
    requestedBy: idRef('requested_by').notNull(),

    taskKey: techKey('task_key').notNull(),
    surfaceKey: techKey('surface_key').notNull(),
    entityType: varchar('entity_type', { length: 40 }).notNull(),
    entityId: idRef('entity_id').notNull(),

    /** Versao do prompt interno usado nesta chamada (item 47). */
    promptVersion: varchar('prompt_version', { length: 40 }).notNull(),

    /** Nulos ate a chamada terminar; seguem nulos se `status = 'rejected'`. */
    providerKey: varchar('provider_key', { length: 60 }),
    modelKey: varchar('model_key', { length: 120 }),

    status: varchar('status', { length: 20 }).notNull(),
    /** Um dos `AiErrorCode` — nulo quando `status = 'succeeded'`. */
    errorCode: varchar('error_code', { length: 60 }),

    /** Contagens Unicode-safe (item 172) — nunca o texto em si. */
    inputCharCount: int('input_char_count').notNull(),
    outputCharCount: int('output_char_count'),
    /** `null` quando o provedor nao informa (item 79) — nunca inventado. */
    inputTokens: int('input_tokens'),
    outputTokens: int('output_tokens'),
    latencyMs: int('latency_ms'),

    createdAt: instant('created_at').notNull(),
    completedAt: instant('completed_at'),
  },
  (table) => [
    foreignKey({
      name: 'fk_ai_request_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_ai_request_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_ai_request_requested_by_tenant',
      columns: [table.requestedBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    check('ck_ai_request_status', sql`status IN ('requested','succeeded','failed','rejected')`),

    /** "Requisicoes recentes do tenant" — tela operacional futura e manutencao (item 141). */
    index('ix_ai_request_tenant_created').on(table.tenantId, table.createdAt),
    /** "Requisicoes recentes de um usuario" (item 21). */
    index('ix_ai_request_tenant_user_created').on(
      table.tenantId,
      table.requestedBy,
      table.createdAt,
    ),
  ],
);

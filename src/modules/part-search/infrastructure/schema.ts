import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  int,
  mysqlTable,
  tinyint,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import {
  actorColumns,
  id,
  idRef,
  instant,
  money,
  tenantId,
  timestamps,
  unitId,
} from '@/core/db/columns';
import { equipment } from '@/modules/equipment/infrastructure/schema';
import { parts } from '@/modules/inventory/infrastructure/schema';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * SCHEMA DA BUSCA DE PECAS (Prompt 21, ADR-086).
 *
 * CINCO TABELAS, cada uma um conceito distinto do prompt (item 8, 9, 36,
 * 60 a 69) — NUNCA fundidas:
 *
 *   part_search_sessions       -> a BUSCA em si (quando, por quem, sobre o que)
 *   part_search_candidates     -> IDENTIDADE TECNICA observada (nao e Inventory Item)
 *   part_search_evidence       -> POR QUE um candidate tem aquele rotulo
 *   part_search_offers         -> CONDICAO COMERCIAL de uma fonte, num instante
 *   part_search_provider_calls -> OBSERVABILIDADE operacional da chamada externa
 *   part_search_selections     -> a ESCOLHA HUMANA (nunca criada pela busca sozinha)
 *
 * NADA AQUI GUARDA RESPOSTA CRUA DO PROVEDOR (item 64): so campos
 * normalizados e validados. NADA AQUI E TABELA DE ESTOQUE/COMPRA: quando um
 * candidate corresponde a uma peca real do catalogo (`parts`), guarda-se
 * `part_id` como REFERENCIA de leitura — a tabela `parts` continua a unica
 * fonte de verdade (item 99/100, sem escrita nova nenhuma nela).
 */

export const PART_SEARCH_SESSION_STATUS_VALUES = [
  'requested',
  'running',
  'completed',
  'partial',
  'failed',
] as const;

export const PART_SEARCH_SOURCE_TYPE_VALUES = [
  'internal_inventory',
  'purchase_history',
  'external',
] as const;

export const COMPATIBILITY_LABEL_VALUES = [
  'confirmada',
  'alta_probabilidade',
  'provavel',
  'nao_verificada',
  'incompativel',
] as const;

export const PART_SEARCH_AVAILABILITY_VALUES = [
  'in_stock',
  'available',
  'unavailable',
  'unknown',
] as const;

export const PART_SEARCH_PROVIDER_CALL_STATUS_VALUES = [
  'ok',
  'error',
  'timeout',
  'not_configured',
] as const;

export const partSearchSessions = mysqlTable(
  'part_search_sessions',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    /** A busca sempre acontece NUMA unidade (item 61) — estoque/preco sao locais. */
    unitId: unitId().notNull(),
    /** Origem opcional: a OS que motivou a busca (item 80). Nula = busca avulsa. */
    serviceOrderId: idRef('service_order_id'),
    /**
     * Denormalizado da OS no momento da busca, so para exibicao/auditoria
     * sem precisar rejuntar — NUNCA a fonte de verdade do equipamento.
     */
    equipmentId: idRef('equipment_id'),
    requestedBy: idRef('requested_by').notNull(),

    /** Termo como digitado, ja normalizado (Unicode/espacos) — nunca PII (item 62). */
    queryTerm: varchar('query_term', { length: 200 }).notNull(),
    querySearchKey: varchar('query_search_key', { length: 200 }).notNull(),
    partNumberHint: varchar('part_number_hint', { length: 60 }),

    status: varchar('status', { length: 20 }).notNull(),
    /** Se a busca externa foi solicitada nesta sessao (item 137/186). */
    externalRequested: tinyint('external_requested').notNull().default(0),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_part_search_session_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_part_search_session_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_part_search_session_order_tenant',
      columns: [table.serviceOrderId, table.tenantId],
      foreignColumns: [serviceOrders.id, serviceOrders.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** A OS referenciada precisa ser da MESMA unidade da sessao (mesmo padrao de `quotes`). */
    foreignKey({
      name: 'fk_part_search_session_order_unit',
      columns: [table.serviceOrderId, table.unitId],
      foreignColumns: [serviceOrders.id, serviceOrders.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_part_search_session_equipment_tenant',
      columns: [table.equipmentId, table.tenantId],
      foreignColumns: [equipment.id, equipment.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_part_search_session_requested_by_tenant',
      columns: [table.requestedBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    check(
      'ck_part_search_session_status',
      sql`status IN ('requested','running','completed','partial','failed')`,
    ),

    unique('uq_part_search_session_id_tenant').on(table.id, table.tenantId),

    /** Buscas recentes de uma unidade. */
    index('ix_part_search_session_tenant_unit_created').on(
      table.tenantId,
      table.unitId,
      table.createdAt,
    ),
    /** Buscas de uma OS especifica. */
    index('ix_part_search_session_order').on(table.tenantId, table.serviceOrderId),
  ],
);

export const partSearchCandidates = mysqlTable(
  'part_search_candidates',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    sessionId: idRef('session_id').notNull(),

    sourceType: varchar('source_type', { length: 20 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    partNumber: varchar('part_number', { length: 60 }),
    brand: varchar('brand', { length: 120 }),
    /** Preenchido SO quando o candidate corresponde a uma peca real do catalogo (item 8). */
    partId: idRef('part_id'),

    /**
     * Rotulo oficial, calculado UMA vez pelo Compatibility Assessor no
     * momento da busca — snapshot congelado (item 133: resultado externo e
     * imutavel), nunca recalculado silenciosamente depois.
     */
    compatibilityLabel: varchar('compatibility_label', { length: 20 }).notNull(),

    /** Chave de deduplicacao conservadora (item 54/55) — nunca so pelo titulo. */
    dedupeKey: varchar('dedupe_key', { length: 160 }).notNull(),

    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_part_search_candidate_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_part_search_candidate_session_tenant',
      columns: [table.sessionId, table.tenantId],
      foreignColumns: [partSearchSessions.id, partSearchSessions.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_part_search_candidate_part_tenant',
      columns: [table.partId, table.tenantId],
      foreignColumns: [parts.id, parts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    check(
      'ck_part_search_candidate_source_type',
      sql`source_type IN ('internal_inventory','purchase_history','external')`,
    ),
    check(
      'ck_part_search_candidate_label',
      sql`compatibility_label IN ('confirmada','alta_probabilidade','provavel','nao_verificada','incompativel')`,
    ),

    unique('uq_part_search_candidate_id_tenant').on(table.id, table.tenantId),

    /** Candidates de uma sessao — o caminho de leitura principal da tela de resultados. */
    index('ix_part_search_candidate_session').on(table.tenantId, table.sessionId),
  ],
);

export const partSearchEvidence = mysqlTable(
  'part_search_evidence',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    candidateId: idRef('candidate_id').notNull(),

    /** 'internal_inventory' | 'purchase_history' | nome do PartSearchProvider | 'internal'. */
    source: varchar('source', { length: 60 }).notNull(),
    type: varchar('type', { length: 40 }).notNull(),
    observedAt: instant('observed_at').notNull(),
    field: varchar('field', { length: 80 }),
    value: varchar('value', { length: 300 }),
  },
  (table) => [
    foreignKey({
      name: 'fk_part_search_evidence_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_part_search_evidence_candidate_tenant',
      columns: [table.candidateId, table.tenantId],
      foreignColumns: [partSearchCandidates.id, partSearchCandidates.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    check(
      'ck_part_search_evidence_type',
      sql`type IN ('exact_part_number','exact_equipment_model','manufacturer_part_mapping','internal_verified_mapping','provider_exact_fit_signal','title_description_mention','explicit_incompatibility','ai_inference')`,
    ),

    index('ix_part_search_evidence_candidate').on(table.tenantId, table.candidateId),
  ],
);

export const partSearchOffers = mysqlTable(
  'part_search_offers',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    candidateId: idRef('candidate_id').notNull(),

    /** 'internal_stock' | 'purchase_history' | nome do PartSearchProvider. */
    sourceKey: varchar('source_key', { length: 60 }).notNull(),
    providerOfferId: varchar('provider_offer_id', { length: 120 }),
    sellerName: varchar('seller_name', { length: 160 }),

    /** Nunca float (item 108) — `DECIMAL(14,2)` via Money, `null` = nao informado. */
    price: money('price'),
    currency: varchar('currency', { length: 3 }).notNull().default('BRL'),
    availability: varchar('availability', { length: 20 }).notNull(),
    leadTimeDays: int('lead_time_days'),
    freight: money('freight'),
    /** So preenchido quando `price` E `freight` sao AMBOS conhecidos (item 49/183). */
    totalCost: money('total_cost'),

    /** http(s) ja validada — nunca `javascript:`/`data:` (item 33). */
    url: varchar('url', { length: 2048 }),

    /** true = preco HISTORICO (compra passada), nunca "disponivel agora" (item 58). */
    isHistorical: tinyint('is_historical').notNull().default(0),

    /** Quando a FONTE informou este valor — nunca reescrito (item 50/53/133). */
    observedAt: instant('observed_at').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_part_search_offer_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_part_search_offer_candidate_tenant',
      columns: [table.candidateId, table.tenantId],
      foreignColumns: [partSearchCandidates.id, partSearchCandidates.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    check(
      'ck_part_search_offer_availability',
      sql`availability IN ('in_stock','available','unavailable','unknown')`,
    ),

    unique('uq_part_search_offer_id_tenant').on(table.id, table.tenantId),

    index('ix_part_search_offer_candidate').on(table.tenantId, table.candidateId),
  ],
);

export const partSearchProviderCalls = mysqlTable(
  'part_search_provider_calls',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    sessionId: idRef('session_id').notNull(),

    providerKey: varchar('provider_key', { length: 60 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    resultCount: int('result_count'),
    /** Um `PartSearchErrorCode` — nunca o corpo/stack cru do provedor (item 126). */
    errorCode: varchar('error_code', { length: 60 }),
    latencyMs: int('latency_ms'),

    requestedAt: instant('requested_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_part_search_provider_call_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_part_search_provider_call_session_tenant',
      columns: [table.sessionId, table.tenantId],
      foreignColumns: [partSearchSessions.id, partSearchSessions.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    check(
      'ck_part_search_provider_call_status',
      sql`status IN ('ok','error','timeout','not_configured')`,
    ),

    index('ix_part_search_provider_call_session').on(table.tenantId, table.sessionId),
  ],
);

export const partSearchSelections = mysqlTable(
  'part_search_selections',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    sessionId: idRef('session_id').notNull(),
    candidateId: idRef('candidate_id').notNull(),
    offerId: idRef('offer_id'),

    selectedBy: idRef('selected_by').notNull(),
    selectedAt: instant('selected_at').notNull(),
    /** Confirmacao consciente exigida para rotulo `nao_verificada` (item 91). */
    unverifiedAcknowledged: tinyint('unverified_acknowledged').notNull().default(0),

    /**
     * `purchase_needs.id`, SEM FK (mesmo padrao do Motor de Automacoes:
     * referencia a outro modulo e so idRef). Busca de Pecas pode LER
     * Compras via porta de aplicacao oficial, mas nunca vira dependencia
     * estrutural do schema de Compras (item 71).
     */
    purchaseNeedId: idRef('purchase_need_id'),

    ...actorColumns(),
  },
  (table) => [
    foreignKey({
      name: 'fk_part_search_selection_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_part_search_selection_session_tenant',
      columns: [table.sessionId, table.tenantId],
      foreignColumns: [partSearchSessions.id, partSearchSessions.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_part_search_selection_candidate_tenant',
      columns: [table.candidateId, table.tenantId],
      foreignColumns: [partSearchCandidates.id, partSearchCandidates.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_part_search_selection_offer_tenant',
      columns: [table.offerId, table.tenantId],
      foreignColumns: [partSearchOffers.id, partSearchOffers.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_part_search_selection_selected_by_tenant',
      columns: [table.selectedBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    index('ix_part_search_selection_session').on(table.tenantId, table.sessionId),
    index('ix_part_search_selection_candidate').on(table.tenantId, table.candidateId),
  ],
);

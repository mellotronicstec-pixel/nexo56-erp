import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { actorColumns, id, idRef, instant, tenantId, timestamps, unitId } from '@/core/db/columns';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * SCHEMA DO MOTOR DE AUTOMACOES (Prompt 19).
 *
 * CINCO CONCEITOS, CINCO TABELAS (ADR-082): Rule (ponteiro mutavel: nome,
 * habilitada, escopo, versao atual), RuleVersion (definicao IMUTAVEL: gatilho,
 * condicoes, acoes), Execution (um disparo real de uma regra contra um
 * evento/ocorrencia), ActionAttempt (append-only, uma linha por tentativa de
 * uma acao de uma execucao).
 *
 * `automation_rules.current_version_id` e `automation_action_attempts.
 * domain_result_ref` sao REFERENCIAS SEM FK (idRef puro), no mesmo padrao de
 * `communication_messages.source_event_id`: a primeira evita o ciclo
 * rule<->version, a segunda aponta para uma linha de OUTRO modulo
 * (communication_messages ou agenda_tasks) que este modulo nunca deve travar
 * por chave estrangeira — Automations LE o resultado, nunca e dono dele.
 */

// ---------------------------------------------------------------------------
// Regra (ponteiro mutavel)
// ---------------------------------------------------------------------------

export const AUTOMATION_SCOPE_KINDS = ['UNIT_SET', 'TENANT_WIDE'] as const;

export const automationRules = mysqlTable(
  'automation_rules',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),

    name: varchar('name', { length: 160 }).notNull(),

    /** Regra desabilitada nunca produz execucao nova (item 53). */
    enabled: boolean('enabled').notNull().default(false),

    /** `UNIT_SET`: opera so nas unidades persistidas em `automation_rule_units`.
     *  `TENANT_WIDE`: opera em qualquer unidade autorizada do evento. */
    scopeKind: varchar('scope_kind', { length: 20 }).notNull(),

    /** Referencia SEM FK (evita ciclo com `automation_rule_versions`). Nulo
     *  ate a primeira versao ser publicada. */
    currentVersionId: idRef('current_version_id'),

    ...actorColumns(),

    /** Arquivar preserva historico; nunca dispara de novo (item 55 e 165). */
    archivedAt: instant('archived_at'),
    archivedBy: idRef('archived_by'),

    ...timestamps(),
  },
  (table) => [
    unique('uq_automation_rule_id_tenant').on(table.id, table.tenantId),

    foreignKey({
      name: 'fk_automation_rule_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_automation_rule_created_by_tenant',
      columns: [table.createdBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    check('ck_automation_rule_scope_kind', sql`scope_kind IN ('UNIT_SET','TENANT_WIDE')`),

    /** "Regras habilitadas deste tenant, por gatilho" passa por aqui + join na versao. */
    index('ix_automation_rule_tenant_enabled').on(table.tenantId, table.enabled),
  ],
);

// ---------------------------------------------------------------------------
// Escopo de unidade persistido (item 59: nunca deriva "todas" dinamicamente)
// ---------------------------------------------------------------------------

export const automationRuleUnits = mysqlTable(
  'automation_rule_units',
  {
    ruleId: idRef('rule_id').notNull(),
    tenantId: tenantId().notNull(),
    unitId: unitId().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ruleId, table.unitId] }),

    foreignKey({
      name: 'fk_automation_rule_unit_rule_tenant',
      columns: [table.ruleId, table.tenantId],
      foreignColumns: [automationRules.id, automationRules.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_automation_rule_unit_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    index('ix_automation_rule_unit_tenant').on(table.tenantId, table.unitId),
  ],
);

// ---------------------------------------------------------------------------
// Versao da regra (definicao IMUTAVEL)
// ---------------------------------------------------------------------------

export const AUTOMATION_TRIGGER_KINDS = ['domain_event', 'schedule'] as const;

export const automationRuleVersions = mysqlTable(
  'automation_rule_versions',
  {
    id: id().primaryKey(),
    ruleId: idRef('rule_id').notNull(),
    tenantId: tenantId().notNull(),

    versionNumber: int('version_number', { unsigned: true }).notNull(),

    triggerKind: varchar('trigger_kind', { length: 20 }).notNull(),
    /** Chave do AutomationTriggerCatalog (ex.: `service_order.customer_notification_requested`). */
    triggerKey: varchar('trigger_key', { length: 80 }).notNull(),

    /**
     * Definicao completa (condicoes + acoes), SEMPRE validada por Zod contra o
     * catalogo fechado antes de gravar (item 122) — este JSON nunca e "aceitar
     * qualquer coisa". `schemaVersion` dentro do proprio objeto permite migrar
     * o formato no futuro sem quebrar versoes ja gravadas (item 123).
     */
    definition: json('definition').notNull(),

    createdAt: instant('created_at').notNull(),
    createdBy: idRef('created_by'),
  },
  (table) => [
    unique('uq_automation_rule_version_id_tenant').on(table.id, table.tenantId),
    unique('uq_automation_rule_version_number').on(table.ruleId, table.versionNumber),

    foreignKey({
      name: 'fk_automation_rule_version_rule_tenant',
      columns: [table.ruleId, table.tenantId],
      foreignColumns: [automationRules.id, automationRules.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    check(
      'ck_automation_rule_version_trigger_kind',
      sql`trigger_kind IN ('domain_event','schedule')`,
    ),

    /** "Regras habilitadas por gatilho": join a partir de `automation_rules.current_version_id`. */
    index('ix_automation_rule_version_trigger').on(table.triggerKey),
  ],
);

// ---------------------------------------------------------------------------
// Execucao (um disparo real)
// ---------------------------------------------------------------------------

export const AUTOMATION_EXECUTION_STATUSES = ['skipped', 'running', 'succeeded', 'failed'] as const;

export const automationExecutions = mysqlTable(
  'automation_executions',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    ruleId: idRef('rule_id').notNull(),
    ruleVersionId: idRef('rule_version_id').notNull(),

    triggerKind: varchar('trigger_kind', { length: 20 }).notNull(),
    /** Id do evento de dominio, ou a ocorrencia agendada (`YYYY-MM-DD`). */
    triggerRef: varchar('trigger_ref', { length: 190 }).notNull(),

    /**
     * A TRAVA DE NAO-DUPLICACAO REAL (itens 76, 77 e 126).
     *
     * `event:{eventId}:rule:{ruleId}:v{version}` ou
     * `schedule:{ruleId}:v{version}:{occurrence}`. O UNIQUE no banco, nao um
     * SELECT-then-INSERT (item 78), e o que garante que 5 processamentos
     * concorrentes do MESMO evento/regra produzem exatamente 1 execucao.
     */
    idempotencyKey: varchar('idempotency_key', { length: 240 }).notNull(),

    status: varchar('status', { length: 20 }).notNull(),

    /** Minimo necessario para explicar o disparo e tornar o retry deterministico
     *  (item 27) — nunca a entidade inteira, nunca PII (item 183). */
    inputSnapshot: json('input_snapshot').notNull(),

    startedAt: instant('started_at'),
    completedAt: instant('completed_at'),
    errorSummary: varchar('error_summary', { length: 500 }),
    correlationId: varchar('correlation_id', { length: 36 }),

    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    unique('uq_automation_execution_id_tenant').on(table.id, table.tenantId),
    unique('uq_automation_execution_idempotency').on(table.tenantId, table.idempotencyKey),

    foreignKey({
      name: 'fk_automation_execution_rule_tenant',
      columns: [table.ruleId, table.tenantId],
      foreignColumns: [automationRules.id, automationRules.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_automation_execution_version_tenant',
      columns: [table.ruleVersionId, table.tenantId],
      foreignColumns: [automationRuleVersions.id, automationRuleVersions.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    check(
      'ck_automation_execution_status',
      sql`status IN ('skipped','running','succeeded','failed')`,
    ),
    check('ck_automation_execution_trigger_kind', sql`trigger_kind IN ('domain_event','schedule')`),

    /** Historico por regra, mais recente primeiro. */
    index('ix_automation_execution_rule').on(table.tenantId, table.ruleId, table.createdAt),
    /** Execucoes em andamento (recuperacao de orfa). */
    index('ix_automation_execution_status').on(table.status),
  ],
);

// ---------------------------------------------------------------------------
// Tentativa de acao (append-only)
// ---------------------------------------------------------------------------

export const AUTOMATION_ACTION_ATTEMPT_STATUSES = [
  'running',
  'succeeded',
  'failed',
  'skipped',
] as const;

export const automationActionAttempts = mysqlTable(
  'automation_action_attempts',
  {
    id: id().primaryKey(),
    executionId: idRef('execution_id').notNull(),
    tenantId: tenantId().notNull(),

    /** Posicao da acao na lista da versao da regra (0-based). */
    actionIndex: int('action_index', { unsigned: true }).notNull(),
    attemptNumber: int('attempt_number', { unsigned: true }).notNull(),

    status: varchar('status', { length: 20 }).notNull(),

    startedAt: instant('started_at').notNull(),
    finishedAt: instant('finished_at'),

    /** Codigo estavel (item 150): `PROVIDER_NOT_CONFIGURED`, `INVALID_RECIPIENT`... */
    errorCode: varchar('error_code', { length: 60 }),
    errorSummary: varchar('error_summary', { length: 500 }),

    /** Id da linha que a acao produziu no modulo alvo (messageId/taskId).
     *  SEM FK: este modulo LE o resultado, nunca e dono da linha referenciada. */
    domainResultRef: idRef('domain_result_ref'),

    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    unique('uq_automation_action_attempt').on(
      table.executionId,
      table.actionIndex,
      table.attemptNumber,
    ),

    foreignKey({
      name: 'fk_automation_action_attempt_execution_tenant',
      columns: [table.executionId, table.tenantId],
      foreignColumns: [automationExecutions.id, automationExecutions.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    check(
      'ck_automation_action_attempt_status',
      sql`status IN ('running','succeeded','failed','skipped')`,
    ),

    index('ix_automation_action_attempt_execution').on(table.tenantId, table.executionId),
  ],
);

export type AutomationRuleRow = typeof automationRules.$inferSelect;
export type AutomationRuleUnitRow = typeof automationRuleUnits.$inferSelect;
export type AutomationRuleVersionRow = typeof automationRuleVersions.$inferSelect;
export type AutomationExecutionRow = typeof automationExecutions.$inferSelect;
export type AutomationActionAttemptRow = typeof automationActionAttempts.$inferSelect;

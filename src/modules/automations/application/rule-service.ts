import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import {
  AuthorizationError,
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from '@/core/errors';
import { newId } from '@/core/ids/id';
import {
  authorize,
  permissionsInScope,
} from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { checkAccess } from '@/modules/features/application/effective-access';
import { FEATURES } from '@/modules/features/domain/catalog';
import { hasPermissionAnywhere, type TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  actionDefinitionsFor,
  MAX_RULE_NAME_LENGTH,
  parseRuleDefinition,
  type RuleDefinition,
} from '@/modules/automations/domain/rule-definition';
import { findTrigger } from '@/modules/automations/domain/trigger-catalog';
import {
  automationExecutions as automationExecutionsTable,
  automationRules,
  automationRuleUnits,
  automationRuleVersions,
  type AutomationRuleRow,
} from '@/modules/automations/infrastructure/schema';

/**
 * CRUD DA REGRA, COM VERSIONAMENTO (Prompt 19, itens 49 a 55 e 102 a 105).
 *
 * "Editar regra NAO reescreve o passado": toda mudanca de definicao cria uma
 * `automation_rule_version` NOVA e imutavel; `automation_rules.enabled` e
 * `current_version_id` sao os UNICOS campos mutaveis da regra em si.
 *
 * AUTORIZACAO EM DUAS CAMADAS (item 64): `automations.manage` autoriza mexer
 * na REGRA; cada ACAO configurada exige, alem disso, a permissao daquele
 * modulo (`communications.send`, `agenda.tasks.create`) no MESMO escopo de
 * unidades da regra — configurar uma acao de Comunicacao para uma unidade
 * onde a pessoa nao pode enviar mensagem e recusado aqui, nunca em runtime.
 */

function blank(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

interface ScopeInput {
  scopeKind: 'UNIT_SET' | 'TENANT_WIDE';
  unitIds?: readonly string[];
}

interface ResolvedScope {
  scopeKind: 'UNIT_SET' | 'TENANT_WIDE';
  unitIds: readonly string[];
}

/**
 * PERSISTE O ESCOPO NO MOMENTO DA CRIACAO (itens 57 a 60): "todas as
 * unidades" para quem nao tem `automations.manage` no TENANT inteiro
 * significa as unidades autorizadas HOJE, gravadas — nunca recalculadas
 * amanha quando uma unidade nova aparecer.
 */
function resolveScope(context: TenantContext, input: ScopeInput): ResolvedScope {
  if (input.scopeKind === 'TENANT_WIDE') {
    /** TENANT_WIDE exige a permissao no proprio escopo TENANT (item 60), nao
     *  apenas "em alguma unidade". */
    if (!context.tenantPermissions.has(PERMISSIONS.AUTOMATIONS_MANAGE)) {
      throw new BusinessRuleError(
        'Uma regra para "toda a empresa" exige um perfil concedido no tenant inteiro, nao so numa unidade.',
      );
    }
    return { scopeKind: 'TENANT_WIDE', unitIds: [] };
  }

  const requested = input.unitIds ?? [];
  if (requested.length === 0) {
    throw new ValidationError('Escolha ao menos uma unidade para esta regra.');
  }
  const invalid = requested.filter((id) => !context.authorizedUnitIds.includes(id));
  if (invalid.length > 0) {
    throw new NotFoundError('Uma das unidades escolhidas nao foi encontrada.');
  }
  return { scopeKind: 'UNIT_SET', unitIds: requested };
}

/**
 * Autoridade para MEXER NA REGRA em si (item 56 a 60): `automations.manage`
 * precisa valer no MESMO escopo da regra — tenant inteiro para TENANT_WIDE,
 * e em CADA unidade escolhida para UNIT_SET. Um perfil concedido so na
 * Unidade Norte autoriza regra da Unidade Norte, nunca "toda a empresa"
 * nem a Unidade Sul — o mesmo raciocinio de `permissionsInScope` em
 * qualquer outro modulo do sistema, nunca um `authorize()` cego sem unidade
 * que so um perfil TENANT conseguiria passar.
 */
async function assertManageAuthority(context: TenantContext, scope: ResolvedScope): Promise<void> {
  if (scope.scopeKind === 'TENANT_WIDE') {
    await authorize(context, {
      permission: PERMISSIONS.AUTOMATIONS_MANAGE,
      featureKey: FEATURES.AUTOMATION_CORE,
    });
    return;
  }
  for (const unitId of scope.unitIds) {
    await authorize(context, {
      permission: PERMISSIONS.AUTOMATIONS_MANAGE,
      featureKey: FEATURES.AUTOMATION_CORE,
      unitId,
    });
  }
}

/**
 * Autoridade para VER a lista/historico (item 258): `automations.view` em
 * QUALQUER escopo — tenant ou alguma unidade — basta para abrir a tela
 * (item 210: "usuario view-only ve lista/historico"). A pagina lista as
 * regras do TENANT inteiro; decidir o que configurar dentro de cada uma
 * continua exigindo `automations.manage` no escopo especifico dela.
 */
async function assertViewAuthority(context: TenantContext): Promise<void> {
  const featureDecision = await checkAccess(context, { featureKey: FEATURES.AUTOMATION_CORE });
  if (!featureDecision.allowed) {
    throw new AuthorizationError(featureDecision.message, { reason: 'FEATURE_UNAVAILABLE' });
  }
  if (!hasPermissionAnywhere(context, PERMISSIONS.AUTOMATIONS_VIEW)) {
    throw new AuthorizationError('Voce nao tem permissao para executar esta acao.', {
      reason: 'PERMISSION_DENIED',
    });
  }
}

/**
 * Regra agendada SEMPRE tem unidade(s) explicitas (item 115): o gatilho
 * `schedule` nao carrega unidade nenhuma vinda de um fato — sem isso, a
 * tarefa criada nao saberia em qual unidade nascer.
 */
function assertScheduleNeedsUnitSet(
  triggerKind: 'domain_event' | 'schedule',
  scope: ResolvedScope,
): void {
  if (triggerKind === 'schedule' && scope.scopeKind !== 'UNIT_SET') {
    throw new BusinessRuleError(
      'Regras agendadas exigem uma ou mais unidades especificas, nunca "toda a empresa".',
    );
  }
}

function assertActionPermissions(
  context: TenantContext,
  definition: RuleDefinition,
  scope: ResolvedScope,
): void {
  const actions = actionDefinitionsFor(definition);
  const unitsToCheck = scope.scopeKind === 'TENANT_WIDE' ? [null] : scope.unitIds;

  for (const action of actions) {
    for (const unitId of unitsToCheck) {
      if (!permissionsInScope(context, unitId).has(action.configPermission)) {
        throw new BusinessRuleError(
          `Configurar a acao "${action.label}" exige a permissao daquele modulo no escopo da regra.`,
        );
      }
    }
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, 'De um nome para a regra.').max(MAX_RULE_NAME_LENGTH),
  scopeKind: z.enum(['UNIT_SET', 'TENANT_WIDE']),
  unitIds: z.array(z.string().trim().min(1)).optional(),
  definition: z.unknown(),
});

export interface CreatedRule {
  ruleId: string;
  versionNumber: number;
}

/**
 * Cria uma regra. NASCE SEMPRE DESABILITADA (item 103) — habilitar e uma
 * segunda acao, consciente, separada da criacao.
 */
export async function createRule(context: TenantContext, rawInput: unknown): Promise<CreatedRule> {
  const input = parse(createSchema, rawInput);
  const scope = resolveScope(context, input);
  await assertManageAuthority(context, scope);

  const validated = parseRuleDefinition(input.definition);
  if (!validated.ok) {
    throw new ValidationError(validated.errors[0] ?? 'Definicao de regra invalida.');
  }
  assertScheduleNeedsUnitSet(validated.trigger.kind, scope);
  assertActionPermissions(context, validated.definition, scope);

  const ruleId = newId();
  const versionId = newId();
  const now = new Date();

  await runInTransaction(async (tx) => {
    await tx.insert(automationRules).values({
      id: ruleId,
      tenantId: context.tenantId,
      name: input.name,
      enabled: false,
      scopeKind: scope.scopeKind,
      currentVersionId: versionId,
      createdBy: context.userId,
      updatedBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    if (scope.unitIds.length > 0) {
      await tx
        .insert(automationRuleUnits)
        .values(scope.unitIds.map((unitId) => ({ ruleId, tenantId: context.tenantId, unitId })));
    }

    await tx.insert(automationRuleVersions).values({
      id: versionId,
      ruleId,
      tenantId: context.tenantId,
      versionNumber: 1,
      triggerKind: validated.trigger.kind,
      triggerKey: validated.definition.triggerKey,
      definition: validated.definition,
      createdAt: now,
      createdBy: context.userId,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.AUTOMATION_RULE_CREATED,
        entityType: 'automation_rule',
        entityId: ruleId,
        tenantId: context.tenantId,
        userId: context.userId,
        after: {
          name: input.name,
          scopeKind: scope.scopeKind,
          triggerKey: validated.definition.triggerKey,
        },
      },
      tx,
    );
  });

  return { ruleId, versionNumber: 1 };
}

/**
 * Publica uma NOVA VERSAO da definicao. A versao anterior permanece
 * intocada — quem a usa (execucoes historicas) continua vendo exatamente o
 * que rodou (itens 49 a 51 e 105).
 */
export async function updateRuleDefinition(
  context: TenantContext,
  ruleId: string,
  rawDefinition: unknown,
): Promise<CreatedRule> {
  const rule = await loadOwnedRule(context, ruleId);
  const scope = await loadScope(context, rule);
  await assertManageAuthority(context, scope);

  const validated = parseRuleDefinition(rawDefinition);
  if (!validated.ok) {
    throw new ValidationError(validated.errors[0] ?? 'Definicao de regra invalida.');
  }
  assertScheduleNeedsUnitSet(validated.trigger.kind, scope);
  assertActionPermissions(context, validated.definition, scope);

  const versionId = newId();
  const now = new Date();

  const nextVersionNumber = await runInTransaction(async (tx) => {
    const [maxRow] = await tx
      .select({ max: sql<number>`COALESCE(MAX(${automationRuleVersions.versionNumber}), 0)` })
      .from(automationRuleVersions)
      .where(eq(automationRuleVersions.ruleId, ruleId));
    const nextNumber = Number(maxRow?.max ?? 0) + 1;

    await tx.insert(automationRuleVersions).values({
      id: versionId,
      ruleId,
      tenantId: context.tenantId,
      versionNumber: nextNumber,
      triggerKind: validated.trigger.kind,
      triggerKey: validated.definition.triggerKey,
      definition: validated.definition,
      createdAt: now,
      createdBy: context.userId,
    });

    await tx
      .update(automationRules)
      .set({ currentVersionId: versionId, updatedBy: context.userId, updatedAt: now })
      .where(and(eq(automationRules.id, ruleId), eq(automationRules.tenantId, context.tenantId)));

    await recordAudit(
      {
        action: AUDIT_ACTIONS.AUTOMATION_RULE_VERSION_PUBLISHED,
        entityType: 'automation_rule',
        entityId: ruleId,
        tenantId: context.tenantId,
        userId: context.userId,
        after: { versionNumber: nextNumber, triggerKey: validated.definition.triggerKey },
      },
      tx,
    );

    return nextNumber;
  });

  return { ruleId, versionNumber: nextVersionNumber };
}

/** Habilita ou desabilita. Desabilitar nunca apaga historico (item 53). */
export async function setRuleEnabled(
  context: TenantContext,
  ruleId: string,
  enabled: boolean,
): Promise<void> {
  const rule = await loadOwnedRule(context, ruleId);
  const scope = await loadScope(context, rule);
  await assertManageAuthority(context, scope);

  if (rule.archivedAt) {
    throw new BusinessRuleError('Esta regra foi arquivada e nao pode ser habilitada.');
  }
  if (enabled && !rule.currentVersionId) {
    throw new BusinessRuleError('Esta regra ainda nao tem uma versao publicada.');
  }

  const now = new Date();
  await runInTransaction(async (tx) => {
    await tx
      .update(automationRules)
      .set({ enabled, updatedBy: context.userId, updatedAt: now })
      .where(and(eq(automationRules.id, ruleId), eq(automationRules.tenantId, context.tenantId)));

    await recordAudit(
      {
        action: enabled
          ? AUDIT_ACTIONS.AUTOMATION_RULE_ENABLED
          : AUDIT_ACTIONS.AUTOMATION_RULE_DISABLED,
        entityType: 'automation_rule',
        entityId: ruleId,
        tenantId: context.tenantId,
        userId: context.userId,
        after: { enabled },
      },
      tx,
    );
  });
}

/** Arquiva. Preserva historico (item 55/129); nunca dispara de novo (item 165). */
export async function archiveRule(context: TenantContext, ruleId: string): Promise<void> {
  const rule = await loadOwnedRule(context, ruleId);
  const scope = await loadScope(context, rule);
  await assertManageAuthority(context, scope);

  const now = new Date();

  await runInTransaction(async (tx) => {
    await tx
      .update(automationRules)
      .set({
        enabled: false,
        archivedAt: now,
        archivedBy: context.userId,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(and(eq(automationRules.id, ruleId), eq(automationRules.tenantId, context.tenantId)));

    await recordAudit(
      {
        action: AUDIT_ACTIONS.AUTOMATION_RULE_ARCHIVED,
        entityType: 'automation_rule',
        entityId: ruleId,
        tenantId: context.tenantId,
        userId: context.userId,
        after: { name: rule.name },
      },
      tx,
    );
  });
}

async function loadOwnedRule(context: TenantContext, ruleId: string): Promise<AutomationRuleRow> {
  const [row] = await getDb()
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.id, ruleId), eq(automationRules.tenantId, context.tenantId)))
    .limit(1);
  if (!row) throw new NotFoundError('Regra nao encontrada.');
  return row;
}

async function loadScope(context: TenantContext, rule: AutomationRuleRow): Promise<ResolvedScope> {
  if (rule.scopeKind === 'TENANT_WIDE') return { scopeKind: 'TENANT_WIDE', unitIds: [] };
  const rows = await getDb()
    .select({ unitId: automationRuleUnits.unitId })
    .from(automationRuleUnits)
    .where(
      and(
        eq(automationRuleUnits.ruleId, rule.id),
        eq(automationRuleUnits.tenantId, context.tenantId),
      ),
    );
  return { scopeKind: 'UNIT_SET', unitIds: rows.map((r) => r.unitId) };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface RuleSummary {
  id: string;
  name: string;
  enabled: boolean;
  archived: boolean;
  scopeKind: 'UNIT_SET' | 'TENANT_WIDE';
  unitIds: readonly string[];
  triggerKey: string | null;
  triggerLabel: string | null;
  currentVersionNumber: number | null;
  updatedAt: Date;
}

export async function listRules(context: TenantContext): Promise<RuleSummary[]> {
  await assertViewAuthority(context);

  const rows = await getDb()
    .select({
      id: automationRules.id,
      name: automationRules.name,
      enabled: automationRules.enabled,
      archivedAt: automationRules.archivedAt,
      scopeKind: automationRules.scopeKind,
      currentVersionId: automationRules.currentVersionId,
      updatedAt: automationRules.updatedAt,
      triggerKey: automationRuleVersions.triggerKey,
      versionNumber: automationRuleVersions.versionNumber,
    })
    .from(automationRules)
    .leftJoin(
      automationRuleVersions,
      and(
        eq(automationRuleVersions.id, automationRules.currentVersionId),
        eq(automationRuleVersions.tenantId, automationRules.tenantId),
      ),
    )
    .where(eq(automationRules.tenantId, context.tenantId))
    .orderBy(desc(automationRules.updatedAt));

  const unitRows = await getDb()
    .select({ ruleId: automationRuleUnits.ruleId, unitId: automationRuleUnits.unitId })
    .from(automationRuleUnits)
    .where(eq(automationRuleUnits.tenantId, context.tenantId));
  const unitsByRule = new Map<string, string[]>();
  for (const row of unitRows) {
    const list = unitsByRule.get(row.ruleId) ?? [];
    list.push(row.unitId);
    unitsByRule.set(row.ruleId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    archived: Boolean(row.archivedAt),
    scopeKind: row.scopeKind as 'UNIT_SET' | 'TENANT_WIDE',
    unitIds: unitsByRule.get(row.id) ?? [],
    triggerKey: row.triggerKey,
    triggerLabel: row.triggerKey ? (findTrigger(row.triggerKey)?.label ?? row.triggerKey) : null,
    currentVersionNumber: row.versionNumber,
    updatedAt: row.updatedAt,
  }));
}

export interface RuleDetail extends RuleSummary {
  definition: RuleDefinition | null;
}

export async function getRule(context: TenantContext, ruleId: string): Promise<RuleDetail> {
  await assertViewAuthority(context);

  const rule = await loadOwnedRule(context, ruleId);
  const scope = await loadScope(context, rule);

  let definition: RuleDefinition | null = null;
  let versionNumber: number | null = null;
  if (rule.currentVersionId) {
    const [version] = await getDb()
      .select({
        definition: automationRuleVersions.definition,
        versionNumber: automationRuleVersions.versionNumber,
      })
      .from(automationRuleVersions)
      .where(
        and(
          eq(automationRuleVersions.id, rule.currentVersionId),
          eq(automationRuleVersions.tenantId, context.tenantId),
        ),
      )
      .limit(1);
    if (version) {
      const validated = parseRuleDefinition(version.definition);
      definition = validated.ok ? validated.definition : null;
      versionNumber = version.versionNumber;
    }
  }

  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    archived: Boolean(rule.archivedAt),
    scopeKind: scope.scopeKind,
    unitIds: scope.unitIds,
    triggerKey: definition?.triggerKey ?? null,
    triggerLabel: definition
      ? (findTrigger(definition.triggerKey)?.label ?? definition.triggerKey)
      : null,
    currentVersionNumber: versionNumber,
    updatedAt: rule.updatedAt,
    definition,
  };
}

export interface ExecutionSummary {
  id: string;
  status: 'skipped' | 'running' | 'succeeded' | 'failed';
  triggerKind: 'domain_event' | 'schedule';
  ruleVersionNumber: number | null;
  createdAt: Date;
  completedAt: Date | null;
  errorSummary: string | null;
}

/** Historico de execucoes de UMA regra (item 106), mais recente primeiro. */
export async function listExecutions(
  context: TenantContext,
  ruleId: string,
): Promise<ExecutionSummary[]> {
  await assertViewAuthority(context);
  await loadOwnedRule(context, ruleId);

  const rows = await getDb()
    .select({
      id: automationExecutionsTable.id,
      status: automationExecutionsTable.status,
      triggerKind: automationExecutionsTable.triggerKind,
      createdAt: automationExecutionsTable.createdAt,
      completedAt: automationExecutionsTable.completedAt,
      errorSummary: automationExecutionsTable.errorSummary,
      versionNumber: automationRuleVersions.versionNumber,
    })
    .from(automationExecutionsTable)
    .leftJoin(
      automationRuleVersions,
      and(
        eq(automationRuleVersions.id, automationExecutionsTable.ruleVersionId),
        eq(automationRuleVersions.tenantId, automationExecutionsTable.tenantId),
      ),
    )
    .where(
      and(
        eq(automationExecutionsTable.tenantId, context.tenantId),
        eq(automationExecutionsTable.ruleId, ruleId),
      ),
    )
    .orderBy(desc(automationExecutionsTable.createdAt))
    .limit(200);

  return rows.map((row) => ({
    id: row.id,
    status: row.status as ExecutionSummary['status'],
    triggerKind: row.triggerKind as ExecutionSummary['triggerKind'],
    ruleVersionNumber: row.versionNumber,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    errorSummary: row.errorSummary,
  }));
}

export { blank };

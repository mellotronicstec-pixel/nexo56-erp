import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { isDuplicateKeyError } from '@/core/db/duplicate-key';
import { newId } from '@/core/ids/id';
import { logger } from '@/core/logging/logger';
import type { DomainEvent } from '@/modules/events/domain/event';
import { checkFeatureEnabledForTenant } from '@/modules/features/application/effective-access';
import { FEATURES } from '@/modules/features/domain/catalog';
import { tenants } from '@/modules/tenancy/infrastructure/schema';
import { evaluateConditions } from '@/modules/automations/domain/condition';
import { parseRuleDefinition } from '@/modules/automations/domain/rule-definition';
import { triggersForEvent } from '@/modules/automations/domain/trigger-catalog';
import {
  automationExecutions,
  automationRuleUnits,
  automationRules,
  automationRuleVersions,
} from '@/modules/automations/infrastructure/schema';
import { runExecutionActions } from './execution-runner';

/**
 * EVENTO -> EXECUCAO (Prompt 19, itens 74 a 79).
 *
 * O HANDLER E CONSUMIDOR, NUNCA PARTE DO PRODUTOR (item 74): quem publica
 * `SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED` nao sabe que este arquivo
 * existe. `processAutomationEvent` roda DEPOIS do commit do fato original
 * (a mesma garantia do resto do event-bus — item 152).
 *
 * A TRAVA DE NAO-DUPLICACAO E O `UNIQUE` DE `automation_executions`, NAO UM
 * SELECT-THEN-INSERT (item 78 e 176). Cinco chamadas concorrentes para o
 * MESMO evento e a MESMA regra tentam o mesmo INSERT; so uma ganha, e e ESSA
 * que roda as acoes — as outras encontram a chave duplicada e, no maximo,
 * retomam uma execucao que ficou `running` de uma tentativa ANTERIOR (nao
 * desta corrida), o que cobre a recuperacao apos queda de worker (item 89).
 */

export async function processAutomationEvent(event: DomainEvent): Promise<void> {
  if (!event.tenantId) return;
  const triggers = triggersForEvent(event.type);
  if (triggers.length === 0) return;

  /**
   * PORTAO DO MOTOR (item 72): `automation.core` desligado significa NENHUMA
   * execucao nova, nem sequer `skipped` — o evento simplesmente nao produz
   * rastro nenhum do Motor, exatamente como um modulo OPTIONAL desligado em
   * qualquer outro lugar do sistema.
   */
  const [tenant] = await getDb()
    .select({ planId: tenants.planId })
    .from(tenants)
    .where(eq(tenants.id, event.tenantId))
    .limit(1);
  if (!tenant) return;

  const acesso = await checkFeatureEnabledForTenant(
    { tenantId: event.tenantId, planId: tenant.planId },
    FEATURES.AUTOMATION_CORE,
  );
  if (!acesso.allowed) return;

  for (const trigger of triggers) {
    await processTriggerForEvent(trigger.key, event);
  }
}

async function processTriggerForEvent(triggerKey: string, event: DomainEvent): Promise<void> {
  const tenantId = event.tenantId!;
  const db = getDb();

  const candidates = await db
    .select({
      ruleId: automationRules.id,
      scopeKind: automationRules.scopeKind,
      versionId: automationRuleVersions.id,
      versionNumber: automationRuleVersions.versionNumber,
      definition: automationRuleVersions.definition,
    })
    .from(automationRules)
    .innerJoin(
      automationRuleVersions,
      and(
        eq(automationRuleVersions.id, automationRules.currentVersionId),
        eq(automationRuleVersions.tenantId, automationRules.tenantId),
      ),
    )
    .where(
      and(
        eq(automationRules.tenantId, tenantId),
        eq(automationRules.enabled, true),
        isNull(automationRules.archivedAt),
        eq(automationRuleVersions.triggerKey, triggerKey),
      ),
    );

  if (candidates.length === 0) return;

  const unitSetRuleIds = candidates.filter((c) => c.scopeKind === 'UNIT_SET').map((c) => c.ruleId);
  const unitsByRule = new Map<string, Set<string>>();
  if (unitSetRuleIds.length > 0) {
    const unitRows = await db
      .select({ ruleId: automationRuleUnits.ruleId, unitId: automationRuleUnits.unitId })
      .from(automationRuleUnits)
      .where(
        and(
          eq(automationRuleUnits.tenantId, tenantId),
          inArray(automationRuleUnits.ruleId, unitSetRuleIds),
        ),
      );
    for (const row of unitRows) {
      const set = unitsByRule.get(row.ruleId) ?? new Set<string>();
      set.add(row.unitId);
      unitsByRule.set(row.ruleId, set);
    }
  }

  const payload = event.payload as Record<string, unknown>;
  const eventUnitId = typeof payload.unitId === 'string' ? payload.unitId : null;

  for (const candidate of candidates) {
    /** ISOLAMENTO DE UNIDADE (item 61 e 167): fora do escopo persistido, a
     *  regra nem chega a ser avaliada. */
    if (candidate.scopeKind === 'UNIT_SET' && eventUnitId) {
      const units = unitsByRule.get(candidate.ruleId);
      if (!units?.has(eventUnitId)) continue;
    }

    const validated = parseRuleDefinition(candidate.definition);
    if (!validated.ok) {
      logger.error('Versao de regra de automacao invalida encontrada em runtime', {
        module: 'automations',
        operation: 'processTriggerForEvent',
        ruleId: candidate.ruleId,
        versionId: candidate.versionId,
      });
      continue;
    }

    const fact = { ...payload, __eventId: event.id };
    const matches = evaluateConditions(validated.definition.conditions, fact);
    const idempotencyKey = `event:${event.id}:rule:${candidate.ruleId}:v${candidate.versionNumber}`;

    if (!matches) {
      await createExecutionRow({
        tenantId,
        ruleId: candidate.ruleId,
        ruleVersionId: candidate.versionId,
        triggerKind: 'domain_event',
        triggerRef: event.id,
        idempotencyKey,
        status: 'skipped',
        inputSnapshot: fact,
        correlationId: event.correlationId,
      });
      continue;
    }

    const executionId = await createExecutionRow({
      tenantId,
      ruleId: candidate.ruleId,
      ruleVersionId: candidate.versionId,
      triggerKind: 'domain_event',
      triggerRef: event.id,
      idempotencyKey,
      status: 'running',
      inputSnapshot: fact,
      correlationId: event.correlationId,
      startNow: true,
    });

    if (executionId) {
      await runExecutionActions(executionId, tenantId);
    }
  }
}

interface CreateExecutionInput {
  tenantId: string;
  ruleId: string;
  ruleVersionId: string;
  triggerKind: 'domain_event' | 'schedule';
  triggerRef: string;
  idempotencyKey: string;
  status: 'skipped' | 'running';
  inputSnapshot: Record<string, unknown>;
  correlationId: string | null;
  startNow?: boolean;
}

/**
 * Cria a execucao de forma atomica/idempotente (item 153). Devolve o id
 * quando ESTE processo e quem criou (ou reencontrou uma execucao ainda
 * `running` de uma tentativa anterior — recuperacao de orfa, item 90);
 * devolve `null` quando outra execucao ja terminal existe (nada a fazer).
 */
async function createExecutionRow(input: CreateExecutionInput): Promise<string | null> {
  const db = getDb();
  const id = newId();
  const now = new Date();

  try {
    await db.insert(automationExecutions).values({
      id,
      tenantId: input.tenantId,
      ruleId: input.ruleId,
      ruleVersionId: input.ruleVersionId,
      triggerKind: input.triggerKind,
      triggerRef: input.triggerRef,
      idempotencyKey: input.idempotencyKey,
      status: input.status,
      inputSnapshot: input.inputSnapshot,
      startedAt: input.startNow ? now : null,
      completedAt: input.status === 'skipped' ? now : null,
      correlationId: input.correlationId,
      createdAt: now,
    });
    return input.status === 'running' ? id : null;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    if (input.status !== 'running') return null;

    const [existing] = await db
      .select({ id: automationExecutions.id, status: automationExecutions.status })
      .from(automationExecutions)
      .where(
        and(
          eq(automationExecutions.tenantId, input.tenantId),
          eq(automationExecutions.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    /** So retoma se a execucao existente ainda esta em andamento (item 89). */
    return existing && existing.status === 'running' ? existing.id : null;
  }
}

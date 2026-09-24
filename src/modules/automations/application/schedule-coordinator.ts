import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { isDuplicateKeyError } from '@/core/db/duplicate-key';
import { newId } from '@/core/ids/id';
import { nowTimeIn, todayIn } from '@/core/time/civil-date';
import { logger } from '@/core/logging/logger';
import { checkFeatureEnabledForTenant } from '@/modules/features/application/effective-access';
import { FEATURES } from '@/modules/features/domain/catalog';
import { tenants } from '@/modules/tenancy/infrastructure/schema';
import { parseRuleDefinition } from '@/modules/automations/domain/rule-definition';
import type { ScheduleDailyConfig } from '@/modules/automations/domain/trigger-catalog';
import {
  automationExecutions,
  automationRuleUnits,
  automationRules,
  automationRuleVersions,
} from '@/modules/automations/infrastructure/schema';
import { runExecutionActions } from './execution-runner';

/**
 * SCHEDULE COORDINATOR (Prompt 19, itens 17 a 21 e 189 a 192).
 *
 * "Cron / CLI / futuro Worker -> Schedule Coordinator -> Motor" — a logica de
 * negocio nao mora no arquivo de cron (`scripts/run-jobs.ts` so chama o job
 * `automation.schedule-tick`, que chama `runScheduleTick`, que chama isto).
 * Trocar cron por worker permanente no futuro nao exige reescrever regra
 * nenhuma (item 190): o worker so precisaria chamar `runScheduleTick` com
 * mais frequencia.
 *
 * PRECISAO: o tick roda a cada `TICK_INTERVAL_MINUTES` (o job recorrente
 * registra isso — ver `job-registry.ts`). Uma regra configurada para "09:00"
 * dispara em algum minuto dentro de `[09:00, 09:00 + intervalo)`, nunca
 * exatamente no segundo zero. Documentado em `docs/modules/automations/
 * scheduling.md` como limite conhecido da V1 (item 18: "nao prometer
 * frequencia que o ambiente inicial nao suporta").
 */

export const TICK_INTERVAL_MINUTES = 5;

function minutesOfDay(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function isDueNow(configuredTime: string, nowTime: string): boolean {
  const configured = minutesOfDay(configuredTime);
  const now = minutesOfDay(nowTime);
  return now >= configured && now < configured + TICK_INTERVAL_MINUTES;
}

export interface ScheduleTickResult {
  evaluated: number;
  triggered: number;
}

/** Chamado pelo job `automation.schedule-tick` (item 189). */
export async function runScheduleTick(now: Date = new Date()): Promise<ScheduleTickResult> {
  const db = getDb();

  const rows = await db
    .select({
      ruleId: automationRules.id,
      tenantId: automationRules.tenantId,
      versionId: automationRuleVersions.id,
      versionNumber: automationRuleVersions.versionNumber,
      definition: automationRuleVersions.definition,
      timezone: tenants.timezone,
      planId: tenants.planId,
    })
    .from(automationRules)
    .innerJoin(
      automationRuleVersions,
      and(
        eq(automationRuleVersions.id, automationRules.currentVersionId),
        eq(automationRuleVersions.tenantId, automationRules.tenantId),
      ),
    )
    .innerJoin(tenants, eq(tenants.id, automationRules.tenantId))
    .where(
      and(
        eq(automationRules.enabled, true),
        isNull(automationRules.archivedAt),
        eq(automationRuleVersions.triggerKind, 'schedule'),
      ),
    );

  let triggered = 0;

  for (const row of rows) {
    /** Mesmo portao de `event-processor.ts` (item 72): tenant com
     *  `automation.core` desligado nunca gera ocorrencia nova. */
    const acesso = await checkFeatureEnabledForTenant(
      { tenantId: row.tenantId, planId: row.planId },
      FEATURES.AUTOMATION_CORE,
    );
    if (!acesso.allowed) continue;

    const validated = parseRuleDefinition(row.definition);
    if (!validated.ok) {
      logger.error('Versao de regra de automacao invalida encontrada no schedule tick', {
        module: 'automations',
        operation: 'runScheduleTick',
        ruleId: row.ruleId,
      });
      continue;
    }

    const config = validated.definition.triggerConfig as ScheduleDailyConfig | undefined;
    if (!config) continue;

    const nowTime = nowTimeIn(row.timezone, now);
    if (!isDueNow(config.timeOfDay, nowTime)) continue;

    const occurrenceDate = todayIn(row.timezone, now);

    const units = await db
      .select({ unitId: automationRuleUnits.unitId })
      .from(automationRuleUnits)
      .where(
        and(
          eq(automationRuleUnits.ruleId, row.ruleId),
          eq(automationRuleUnits.tenantId, row.tenantId),
        ),
      );

    for (const { unitId } of units) {
      const occurrence = `${occurrenceDate}:${unitId}`;
      const idempotencyKey = `schedule:${row.ruleId}:v${row.versionNumber}:${occurrence}`;

      const executionId = await createScheduleExecution({
        tenantId: row.tenantId,
        ruleId: row.ruleId,
        ruleVersionId: row.versionId,
        triggerRef: occurrence,
        idempotencyKey,
        unitId,
      });

      if (executionId) {
        triggered += 1;
        await runExecutionActions(executionId, row.tenantId);
      }
    }
  }

  return { evaluated: rows.length, triggered };
}

interface CreateScheduleExecutionInput {
  tenantId: string;
  ruleId: string;
  ruleVersionId: string;
  triggerRef: string;
  idempotencyKey: string;
  unitId: string;
}

/** Mesma trava de nao-duplicacao do lado de eventos (item 77 e 126): o
 *  UNIQUE de `automation_executions`, nunca um SELECT-then-INSERT. */
async function createScheduleExecution(
  input: CreateScheduleExecutionInput,
): Promise<string | null> {
  const db = getDb();
  const id = newId();
  const now = new Date();

  try {
    await db.insert(automationExecutions).values({
      id,
      tenantId: input.tenantId,
      ruleId: input.ruleId,
      ruleVersionId: input.ruleVersionId,
      triggerKind: 'schedule',
      triggerRef: input.triggerRef,
      idempotencyKey: input.idempotencyKey,
      status: 'running',
      inputSnapshot: { unitId: input.unitId, occurrence: input.triggerRef },
      startedAt: now,
      correlationId: null,
      createdAt: now,
    });
    return id;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

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

    return existing && existing.status === 'running' ? existing.id : null;
  }
}

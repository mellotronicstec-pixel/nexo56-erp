import { z } from 'zod';
import {
  AUTOMATION_ACTION_CATALOG,
  findAction,
  type AutomationActionDefinition,
} from './action-catalog';
import { conditionListSchema, OPERATORS_BY_FIELD_TYPE, type ConditionList } from './condition';
import { findTrigger, type AutomationTriggerDefinition } from './trigger-catalog';

/**
 * A DEFINICAO DE UMA VERSAO DE REGRA (Prompt 19, itens 121 a 123 e 136 a 138).
 *
 * Isto e o que vira `automation_rule_versions.definition` — JSON, mas NUNCA
 * "aceita qualquer coisa" (item 122): toda escrita passa por
 * `parseRuleDefinition`, que valida forma (Zod) E CONTEUDO contra os
 * catalogos fechados de gatilho e acao. `schemaVersion` existe para migrar o
 * formato no futuro sem quebrar versoes ja gravadas (item 123).
 *
 * Este arquivo e PURO — sem banco, sem `TenantContext` — de proposito
 * (item 216): a mesma validacao roda identica no formulario, no service e
 * no teste de unidade.
 */

export const AUTOMATION_DEFINITION_SCHEMA_VERSION = 1;

export const MAX_CONDITIONS_PER_RULE = 10;
export const MAX_ACTIONS_PER_RULE = 5;
export const MAX_RULE_NAME_LENGTH = 160;

const actionEntrySchema = z.object({
  key: z.string().trim().min(1).max(80),
  config: z.unknown(),
});

const rawDefinitionSchema = z.object({
  schemaVersion: z.literal(AUTOMATION_DEFINITION_SCHEMA_VERSION),
  triggerKey: z.string().trim().min(1).max(80),
  triggerConfig: z.unknown().optional(),
  conditions: conditionListSchema,
  actions: z.array(actionEntrySchema).min(1).max(MAX_ACTIONS_PER_RULE),
});

export interface RuleActionConfig {
  readonly key: string;
  readonly config: unknown;
}

export interface RuleDefinition {
  readonly schemaVersion: 1;
  readonly triggerKey: string;
  /** Configuracao do PROPRIO gatilho (ex.: horario do agendamento). */
  readonly triggerConfig: unknown;
  readonly conditions: ConditionList;
  readonly actions: readonly RuleActionConfig[];
}

export type RuleDefinitionValidation =
  | { ok: true; definition: RuleDefinition; trigger: AutomationTriggerDefinition }
  | { ok: false; errors: readonly string[] };

/**
 * Valida uma definicao CRUA (o que chegou do formulario, ou o que esta
 * gravado no banco) contra forma + catalogos. E o UNICO portao de escrita
 * de `automation_rule_versions.definition` (item 122) — chamado tanto ao
 * criar/editar uma regra quanto, defensivamente, ao ler uma versao antiga.
 */
export function parseRuleDefinition(raw: unknown): RuleDefinitionValidation {
  const parsed = rawDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
  }

  const errors: string[] = [];
  const { triggerKey, conditions, actions } = parsed.data;

  const trigger = findTrigger(triggerKey);
  if (!trigger) {
    return { ok: false, errors: [`Gatilho desconhecido: "${triggerKey}".`] };
  }

  let triggerConfig: unknown = undefined;
  if (trigger.configSchema) {
    const configResult = trigger.configSchema.safeParse(parsed.data.triggerConfig);
    if (!configResult.success) {
      errors.push(
        `Configuracao invalida para o gatilho "${trigger.label}": ${configResult.error.issues[0]?.message ?? 'dados invalidos'}.`,
      );
    } else {
      triggerConfig = configResult.data;
    }
  }

  if (conditions.all.length > MAX_CONDITIONS_PER_RULE) {
    errors.push(`No maximo ${MAX_CONDITIONS_PER_RULE} condicoes por regra.`);
  }

  for (const clause of conditions.all) {
    const field = trigger.fields[clause.field];
    if (!field) {
      errors.push(`O gatilho "${trigger.label}" nao tem o campo "${clause.field}".`);
      continue;
    }
    const allowedOperators = OPERATORS_BY_FIELD_TYPE[field.type];
    if (!(allowedOperators as readonly string[]).includes(clause.operator)) {
      errors.push(
        `O operador "${clause.operator}" nao e compativel com o campo "${clause.field}" (tipo ${field.type}).`,
      );
      continue;
    }
    if (
      clause.operator !== 'exists' &&
      clause.operator !== 'not_exists' &&
      clause.value === undefined
    ) {
      errors.push(
        `O campo "${clause.field}" precisa de um valor para o operador "${clause.operator}".`,
      );
    }
  }

  const validatedActions: RuleActionConfig[] = [];
  actions.forEach((entry, index) => {
    const action = findAction(entry.key);
    if (!action) {
      errors.push(`Acao desconhecida: "${entry.key}" (posicao ${index}).`);
      return;
    }
    if (!(trigger.compatibleActions as readonly string[]).includes(action.key)) {
      errors.push(
        `A acao "${action.label}" nao e compativel com o gatilho "${trigger.label}" — ele nao tem o contexto que essa acao exige.`,
      );
      return;
    }
    const configResult = action.configSchema.safeParse(entry.config);
    if (!configResult.success) {
      errors.push(
        `Configuracao invalida para "${action.label}" (posicao ${index}): ${configResult.error.issues[0]?.message ?? 'dados invalidos'}.`,
      );
      return;
    }
    validatedActions.push({ key: action.key, config: configResult.data as unknown });
  });

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    trigger,
    definition: {
      schemaVersion: AUTOMATION_DEFINITION_SCHEMA_VERSION,
      triggerKey,
      triggerConfig,
      conditions,
      actions: validatedActions,
    },
  };
}

export function actionDefinitionsFor(
  definition: RuleDefinition,
): readonly AutomationActionDefinition[] {
  return definition.actions
    .map((a) => findAction(a.key))
    .filter((a): a is AutomationActionDefinition => !!a);
}

export { AUTOMATION_ACTION_CATALOG };

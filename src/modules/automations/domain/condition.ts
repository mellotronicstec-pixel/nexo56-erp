import { z } from 'zod';
import type { TriggerFieldType } from './trigger-catalog';

/**
 * CONDICOES DECLARATIVAS (Prompt 19, itens 22 a 26).
 *
 * NENHUM interpretador aqui: nao ha JavaScript, SQL, `eval` nem parser de
 * expressao livre. Uma condicao e sempre `{field, operator, value?}`, `field`
 * sempre uma chave do catalogo FECHADO que o gatilho declara (item 23) —
 * nunca um path arbitrario tipo `customer.passwordHash`.
 *
 * LOGICA: so `ALL` na V1 (item 25) — todas as condicoes da lista precisam
 * ser verdadeiras. Lista vazia significa "sempre dispara" (nenhuma condicao
 * configurada). `ANY` fica documentado como melhoria futura (`future.md`).
 */

export const CONDITION_OPERATORS = [
  'equals',
  'not_equals',
  'in',
  'not_in',
  'exists',
  'not_exists',
  'greater_than',
  'greater_or_equal',
  'less_than',
  'less_or_equal',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** Operadores coerentes com cada tipo de campo (item 26): nunca `status > 5`
 *  nem `amount == "banana"`. */
export const OPERATORS_BY_FIELD_TYPE: Readonly<
  Record<TriggerFieldType, readonly ConditionOperator[]>
> = {
  string: ['equals', 'not_equals', 'in', 'not_in', 'exists', 'not_exists'],
  number: [
    'equals',
    'not_equals',
    'in',
    'not_in',
    'exists',
    'not_exists',
    'greater_than',
    'greater_or_equal',
    'less_than',
    'less_or_equal',
  ],
  boolean: ['equals', 'not_equals', 'exists', 'not_exists'],
};

export const conditionClauseSchema = z.object({
  field: z.string().trim().min(1).max(80),
  operator: z.enum(CONDITION_OPERATORS),
  /** Ausente para `exists`/`not_exists`. String, numero ou lista de strings. */
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())])
    .optional(),
});
export type ConditionClause = z.infer<typeof conditionClauseSchema>;

const MAX_CONDITIONS = 10;

export const conditionListSchema = z.object({
  all: z.array(conditionClauseSchema).max(MAX_CONDITIONS),
});
export type ConditionList = z.infer<typeof conditionListSchema>;

function compare(fieldValue: unknown, operator: ConditionOperator, expected: unknown): boolean {
  switch (operator) {
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;
    case 'not_exists':
      return fieldValue === undefined || fieldValue === null;
    case 'equals':
      return fieldValue === expected;
    case 'not_equals':
      return fieldValue !== expected;
    case 'in':
      return Array.isArray(expected) && (expected as unknown[]).includes(fieldValue);
    case 'not_in':
      return Array.isArray(expected) && !(expected as unknown[]).includes(fieldValue);
    case 'greater_than':
      return (
        typeof fieldValue === 'number' && typeof expected === 'number' && fieldValue > expected
      );
    case 'greater_or_equal':
      return (
        typeof fieldValue === 'number' && typeof expected === 'number' && fieldValue >= expected
      );
    case 'less_than':
      return (
        typeof fieldValue === 'number' && typeof expected === 'number' && fieldValue < expected
      );
    case 'less_or_equal':
      return (
        typeof fieldValue === 'number' && typeof expected === 'number' && fieldValue <= expected
      );
    default: {
      const _exhaustive: never = operator;
      return _exhaustive;
    }
  }
}

/**
 * Avalia a lista de condicoes contra o FATO (payload do evento, ou `{}` para
 * agendamento). Pura, sem I/O — testavel sem banco (item 216).
 *
 * Lista vazia = sempre verdadeiro (item 48: "condicao vazia" nunca e o mesmo
 * que "condicao falsa").
 */
export function evaluateConditions(
  conditions: ConditionList,
  fact: Readonly<Record<string, unknown>>,
): boolean {
  return conditions.all.every((clause) =>
    compare(fact[clause.field], clause.operator, clause.value),
  );
}

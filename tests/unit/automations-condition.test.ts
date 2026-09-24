import { describe, expect, it } from 'vitest';
import { evaluateConditions, type ConditionList } from '@/modules/automations/domain/condition';

/**
 * TESTES DO AVALIADOR DE CONDICOES (Prompt 19, itens 22 a 26).
 *
 * Puro, sem banco: exatamente o que o item 216 pede.
 */

describe('lista vazia sempre casa (item 48)', () => {
  it('nenhuma condicao configurada = sempre verdadeiro', () => {
    expect(evaluateConditions({ all: [] }, { unitId: 'u1' })).toBe(true);
    expect(evaluateConditions({ all: [] }, {})).toBe(true);
  });
});

describe('operadores', () => {
  const casos: Array<[ConditionList, Record<string, unknown>, boolean]> = [
    [
      { all: [{ field: 'reason', operator: 'equals', value: 'ready_for_pickup' }] },
      { reason: 'ready_for_pickup' },
      true,
    ],
    [
      { all: [{ field: 'reason', operator: 'equals', value: 'ready_for_pickup' }] },
      { reason: 'other' },
      false,
    ],
    [
      { all: [{ field: 'reason', operator: 'not_equals', value: 'ready_for_pickup' }] },
      { reason: 'other' },
      true,
    ],
    [{ all: [{ field: 'unitId', operator: 'in', value: ['a', 'b'] }] }, { unitId: 'b' }, true],
    [{ all: [{ field: 'unitId', operator: 'in', value: ['a', 'b'] }] }, { unitId: 'c' }, false],
    [{ all: [{ field: 'unitId', operator: 'not_in', value: ['a', 'b'] }] }, { unitId: 'c' }, true],
    [{ all: [{ field: 'reason', operator: 'exists' }] }, { reason: 'x' }, true],
    [{ all: [{ field: 'reason', operator: 'exists' }] }, {}, false],
    [{ all: [{ field: 'reason', operator: 'not_exists' }] }, {}, true],
    [{ all: [{ field: 'onHand', operator: 'greater_than', value: 5 }] }, { onHand: 10 }, true],
    [{ all: [{ field: 'onHand', operator: 'greater_than', value: 5 }] }, { onHand: 5 }, false],
    [{ all: [{ field: 'onHand', operator: 'greater_or_equal', value: 5 }] }, { onHand: 5 }, true],
    [{ all: [{ field: 'onHand', operator: 'less_than', value: 5 }] }, { onHand: 4 }, true],
    [{ all: [{ field: 'onHand', operator: 'less_or_equal', value: 5 }] }, { onHand: 5 }, true],
  ];

  for (const [conditions, fact, expected] of casos) {
    it(`${JSON.stringify(conditions.all[0])} contra ${JSON.stringify(fact)} => ${expected}`, () => {
      expect(evaluateConditions(conditions, fact)).toBe(expected);
    });
  }

  it('comparacao numerica contra valor nao-numerico nunca "e verdadeira por acidente"', () => {
    expect(
      evaluateConditions(
        { all: [{ field: 'onHand', operator: 'greater_than', value: 5 }] },
        { onHand: 'muito' },
      ),
    ).toBe(false);
  });
});

describe('logica ALL (item 25)', () => {
  it('todas as condicoes precisam ser verdadeiras', () => {
    const conditions: ConditionList = {
      all: [
        { field: 'unitId', operator: 'equals', value: 'u1' },
        { field: 'reason', operator: 'equals', value: 'ready_for_pickup' },
      ],
    };
    expect(evaluateConditions(conditions, { unitId: 'u1', reason: 'ready_for_pickup' })).toBe(true);
    expect(evaluateConditions(conditions, { unitId: 'u1', reason: 'other' })).toBe(false);
  });
});

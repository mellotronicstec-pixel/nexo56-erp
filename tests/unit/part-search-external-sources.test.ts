import { describe, expect, it } from 'vitest';
import { buildExternalCandidates } from '@/modules/part-search/application/external-sources';
import { normalizeSearchQuery } from '@/modules/part-search/domain/query-normalization';
import type { ValidatedProviderResultItem } from '@/modules/part-search/domain/provider-result-schema';

function item(overrides: Partial<ValidatedProviderResultItem> = {}): ValidatedProviderResultItem {
  return {
    providerResultId: 'r1',
    title: 'Peça externa',
    partNumber: null,
    manufacturer: null,
    sourceName: 'Loja X',
    price: null,
    availability: null,
    leadTimeDays: null,
    url: null,
    compatibilityData: null,
    observedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('buildExternalCandidates — evidencia de exact_part_number (regressao de caixa)', () => {
  it('gera exact_part_number quando o codigo do item bate com uma ancora do termo digitado (minusculo vs maiusculo)', () => {
    const query = normalizeSearchQuery('X123');
    const candidates = buildExternalCandidates(
      [item({ partNumber: 'X123' })],
      'capture',
      query,
      null,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.evidences.some((e) => e.type === 'exact_part_number')).toBe(true);
  });

  it('nao gera exact_part_number quando o codigo do item NAO aparece no termo', () => {
    const query = normalizeSearchQuery('outra peca qualquer');
    const candidates = buildExternalCandidates(
      [item({ partNumber: 'X123' })],
      'capture',
      query,
      null,
    );

    expect(candidates[0]?.evidences.some((e) => e.type === 'exact_part_number')).toBe(false);
  });

  it('gera exact_part_number via partNumberHint, independente de caixa', () => {
    const query = normalizeSearchQuery('placa fonte');
    const candidates = buildExternalCandidates(
      [item({ partNumber: 'x123' })],
      'capture',
      query,
      'X123',
    );

    expect(candidates[0]?.evidences.some((e) => e.type === 'exact_part_number')).toBe(true);
  });
});

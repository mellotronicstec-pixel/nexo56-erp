import { describe, expect, it } from 'vitest';
import {
  MAX_RESULTS_PER_PROVIDER,
  validateProviderResults,
} from '@/modules/part-search/domain/provider-result-schema';

/** Itens 106, 107, 109, 110, 165 a 167: validacao/rejeicao individual de resultado invalido. */

function validItem(overrides: Record<string, unknown> = {}) {
  return {
    providerResultId: 'r1',
    title: 'Placa fonte universal',
    partNumber: 'ABC-123',
    manufacturer: 'Acme',
    sourceName: 'Loja Exemplo',
    price: { amount: '129.90', currency: 'BRL' },
    availability: 'available',
    leadTimeDays: 3,
    url: 'https://loja.exemplo.com/produto/1',
    compatibilityData: { exactFit: false, incompatible: false, note: null },
    observedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('validateProviderResults', () => {
  it('aceita um item bem formado', () => {
    const { valid, rejectedCount } = validateProviderResults([validItem()]);
    expect(valid).toHaveLength(1);
    expect(rejectedCount).toBe(0);
  });

  it('rejeita preco nao numerico sem derrubar os outros itens', () => {
    const { valid, rejectedCount } = validateProviderResults([
      validItem({ price: { amount: 'nao-e-numero', currency: 'BRL' } }),
      validItem({ providerResultId: 'r2' }),
    ]);
    expect(valid).toHaveLength(1);
    expect(valid[0]?.providerResultId).toBe('r2');
    expect(rejectedCount).toBe(1);
  });

  it('rejeita preco negativo (item 107)', () => {
    expect(
      validateProviderResults([validItem({ price: { amount: '-10.00', currency: 'BRL' } })]).valid,
    ).toHaveLength(0);
  });

  it('rejeita moeda diferente de BRL (item 51: nunca converter silenciosamente)', () => {
    expect(
      validateProviderResults([validItem({ price: { amount: '10.00', currency: 'USD' } })]).valid,
    ).toHaveLength(0);
  });

  it('aceita price null — nao informado continua nao informado (item 109)', () => {
    const { valid } = validateProviderResults([validItem({ price: null })]);
    expect(valid).toHaveLength(1);
    expect(valid[0]?.price).toBeNull();
  });

  it('aceita availability null e rejeita valor fora do enum fechado', () => {
    expect(validateProviderResults([validItem({ availability: null })]).valid).toHaveLength(1);
    expect(validateProviderResults([validItem({ availability: 'talvez' })]).valid).toHaveLength(0);
  });

  it('rejeita leadTimeDays fracionario ou negativo (item 110/185: nunca inferido de texto vago)', () => {
    expect(validateProviderResults([validItem({ leadTimeDays: 2.5 })]).valid).toHaveLength(0);
    expect(validateProviderResults([validItem({ leadTimeDays: -1 })]).valid).toHaveLength(0);
  });

  it('rejeita item sem titulo', () => {
    expect(validateProviderResults([validItem({ title: '' })]).valid).toHaveLength(0);
  });

  it('rejeita titulo alem do limite (item 166)', () => {
    expect(validateProviderResults([validItem({ title: 'x'.repeat(500) })]).valid).toHaveLength(0);
  });

  it('limita a MAX_RESULTS_PER_PROVIDER itens (item 165)', () => {
    const many = Array.from({ length: MAX_RESULTS_PER_PROVIDER + 10 }, (_, i) =>
      validItem({ providerResultId: `r${i}` }),
    );
    const { valid } = validateProviderResults(many);
    expect(valid.length).toBeLessThanOrEqual(MAX_RESULTS_PER_PROVIDER);
  });

  it('aceita compatibilityData null', () => {
    expect(validateProviderResults([validItem({ compatibilityData: null })]).valid).toHaveLength(1);
  });
});

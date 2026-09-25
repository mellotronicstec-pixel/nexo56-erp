import { describe, expect, it } from 'vitest';
import { compareCandidates, rankCandidates } from '@/modules/part-search/domain/ranking';
import type {
  CompatibilityEvidence,
  PartSearchCandidateForAssessment,
  PartSearchOfferSnapshot,
} from '@/modules/part-search/domain/types';

/**
 * RANKING SERVICE — Prompt 21, item 178 (matriz obrigatoria) e item 46
 * (preco nunca vence compatibilidade — teste literal do prompt).
 */

const NOW = new Date('2026-01-01T00:00:00Z');

function offer(overrides: Partial<PartSearchOfferSnapshot> = {}): PartSearchOfferSnapshot {
  return {
    id: overrides.id ?? 'offer-' + Math.random(),
    sourceKey: 'test',
    providerOfferId: null,
    sellerName: null,
    priceCents: null,
    currency: null,
    availability: 'unknown',
    leadTimeDays: null,
    freightCents: null,
    totalCostCents: null,
    url: null,
    isHistorical: false,
    observedAt: NOW,
    ...overrides,
  };
}

function candidate(
  id: string,
  evidences: CompatibilityEvidence['type'][],
  offers: PartSearchOfferSnapshot[] = [],
): PartSearchCandidateForAssessment {
  return {
    id,
    sourceType: 'external',
    title: id,
    partNumber: null,
    brand: null,
    evidences: evidences.map((type) => ({ source: 'test', type, observedAt: NOW })),
    offers,
  };
}

describe('ranking: preco nunca vence compatibilidade (item 46, teste literal)', () => {
  it('Peca A: R$50 Nao Verificada; Peca B: R$120 Confirmada -> B vem antes de A', () => {
    const a = candidate('A', [], [offer({ priceCents: 5000n })]);
    const b = candidate('B', ['manufacturer_part_mapping'], [offer({ priceCents: 12000n })]);

    const ranked = rankCandidates([a, b]);
    expect(ranked.map((c) => c.id)).toEqual(['B', 'A']);
  });
});

describe('matriz obrigatoria (item 178)', () => {
  it('Confirmada cara vs Nao Verificada barata -> Confirmada primeiro', () => {
    const cheap = candidate('cheap', [], [offer({ priceCents: 1000n })]);
    const expensive = candidate(
      'expensive',
      ['internal_verified_mapping'],
      [offer({ priceCents: 99999n })],
    );
    expect(rankCandidates([cheap, expensive]).map((c) => c.id)).toEqual(['expensive', 'cheap']);
  });

  it('Alta Probabilidade disponivel vs Confirmada indisponivel -> Confirmada ainda vem primeiro (compatibilidade > disponibilidade)', () => {
    const highProbAvailable = candidate(
      'high-prob-available',
      ['exact_part_number'],
      [offer({ availability: 'in_stock' })],
    );
    const confirmedUnavailable = candidate(
      'confirmed-unavailable',
      ['manufacturer_part_mapping'],
      [offer({ availability: 'unavailable' })],
    );
    expect(rankCandidates([highProbAvailable, confirmedUnavailable]).map((c) => c.id)).toEqual([
      'confirmed-unavailable',
      'high-prob-available',
    ]);
  });

  it('mesma compatibilidade: desempate por exact_part_number primeiro', () => {
    // 'a' e 'b' caem no mesmo rotulo (alta_probabilidade, 2 categorias nao-IA cada); so 'a' tem exact_part_number (exatidao).
    const a = candidate('a', ['exact_part_number', 'title_description_mention']);
    const b = candidate('b', ['title_description_mention', 'provider_exact_fit_signal']);
    expect(rankCandidates([b, a]).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('depois de exatidao, desempate por confiabilidade de identificacao (mais categorias de evidencia)', () => {
    const moreEvidence = candidate('more', [
      'exact_part_number',
      'title_description_mention',
      'provider_exact_fit_signal',
    ]);
    const lessEvidence = candidate('less', ['exact_part_number']);
    expect(rankCandidates([lessEvidence, moreEvidence]).map((c) => c.id)).toEqual(['more', 'less']);
  });

  it('depois de confiabilidade, desempate por disponibilidade (em estoque < disponivel < desconhecida < indisponivel)', () => {
    const inStock = candidate(
      'in-stock',
      ['exact_part_number'],
      [offer({ availability: 'in_stock' })],
    );
    const unavailable = candidate(
      'unavailable',
      ['exact_part_number'],
      [offer({ availability: 'unavailable' })],
    );
    expect(rankCandidates([unavailable, inStock]).map((c) => c.id)).toEqual([
      'in-stock',
      'unavailable',
    ]);
  });

  it('depois de disponibilidade, desempate por prazo de entrega (menor primeiro, desconhecido por ultimo)', () => {
    const fast = candidate('fast', [], [offer({ leadTimeDays: 2 })]);
    const slow = candidate('slow', [], [offer({ leadTimeDays: 10 })]);
    const unknown = candidate('unknown-lead', [], [offer({ leadTimeDays: null })]);
    expect(rankCandidates([unknown, slow, fast]).map((c) => c.id)).toEqual([
      'fast',
      'slow',
      'unknown-lead',
    ]);
  });

  it('depois de prazo, desempate por custo total (preco+frete quando ambos conhecidos)', () => {
    const cheaperTotal = candidate(
      'cheaper-total',
      [],
      [offer({ priceCents: 1000n, freightCents: 100n, totalCostCents: 1100n })],
    );
    const pricierTotal = candidate(
      'pricier-total',
      [],
      [offer({ priceCents: 1000n, freightCents: 500n, totalCostCents: 1500n })],
    );
    expect(rankCandidates([pricierTotal, cheaperTotal]).map((c) => c.id)).toEqual([
      'cheaper-total',
      'pricier-total',
    ]);
  });

  it('custo total desconhecido (frete nao informado) nunca "ganha" de um custo total conhecido pior (dado faltante != melhor valor, item 179)', () => {
    const unknownTotal = candidate(
      'unknown-total',
      [],
      [offer({ priceCents: 500n, freightCents: null, totalCostCents: null })],
    );
    const knownWorseTotal = candidate(
      'known-worse-total',
      [],
      [offer({ priceCents: 500n, freightCents: 999n, totalCostCents: 1499n })],
    );
    expect(rankCandidates([unknownTotal, knownWorseTotal]).map((c) => c.id)).toEqual([
      'known-worse-total',
      'unknown-total',
    ]);
  });

  it('por fim, desempate por preco (menor primeiro, desconhecido por ultimo)', () => {
    const cheaper = candidate('cheaper', [], [offer({ priceCents: 100n })]);
    const pricier = candidate('pricier', [], [offer({ priceCents: 200n })]);
    const unknownPrice = candidate('unknown-price', [], [offer({ priceCents: null })]);
    expect(rankCandidates([unknownPrice, pricier, cheaper]).map((c) => c.id)).toEqual([
      'cheaper',
      'pricier',
      'unknown-price',
    ]);
  });

  it('desempate determinístico final por id quando tudo o mais empata', () => {
    const x = candidate('x-id', []);
    const y = candidate('y-id', []);
    const ranked1 = rankCandidates([y, x]);
    const ranked2 = rankCandidates([y, x]);
    expect(ranked1.map((c) => c.id)).toEqual(ranked2.map((c) => c.id));
    expect(ranked1.map((c) => c.id)).toEqual(['x-id', 'y-id']);
  });

  it('incompativel sempre ordena por ultimo, mesmo com preco imbativel', () => {
    const incompatible = candidate(
      'incompatible-cheap',
      ['explicit_incompatibility'],
      [offer({ priceCents: 1n })],
    );
    const unverified = candidate('unverified', []);
    expect(rankCandidates([incompatible, unverified]).map((c) => c.id)).toEqual([
      'unverified',
      'incompatible-cheap',
    ]);
  });

  it('compareCandidates e uma funcao pura e simetrica (a,b) === -(b,a) em sinal', () => {
    const a = candidate('a', ['manufacturer_part_mapping']);
    const b = candidate('b', []);
    const ab = compareCandidates(a, b);
    const ba = compareCandidates(b, a);
    expect(Math.sign(ab)).toBe(-Math.sign(ba));
  });
});

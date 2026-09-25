import { describe, expect, it } from 'vitest';
import { assessCompatibility } from '@/modules/part-search/domain/compatibility';
import type { CompatibilityEvidence } from '@/modules/part-search/domain/types';

/**
 * COMPATIBILITY ASSESSOR — Prompt 21.
 *
 * Cobre a politica documentada em domain/compatibility.ts: veto de
 * incompatibilidade, teto da IA sozinha, as duas unicas categorias
 * autoritativas, e os cinco rotulos oficiais exatos.
 */

function evidence(type: CompatibilityEvidence['type'], source = 'test'): CompatibilityEvidence {
  return { source, type, observedAt: new Date('2026-01-01T00:00:00Z') };
}

describe('assessCompatibility', () => {
  it('sem evidencia nenhuma -> nao_verificada (nao e erro)', () => {
    const result = assessCompatibility([]);
    expect(result.label).toBe('nao_verificada');
    expect(result.blockingReasons).toEqual([]);
  });

  it('explicit_incompatibility sozinha -> incompativel', () => {
    const result = assessCompatibility([evidence('explicit_incompatibility')]);
    expect(result.label).toBe('incompativel');
    expect(result.blockingReasons.length).toBeGreaterThan(0);
  });

  it('explicit_incompatibility VETA qualquer outra evidencia, mesmo autoritativa (item 44)', () => {
    const result = assessCompatibility([
      evidence('manufacturer_part_mapping'),
      evidence('exact_part_number'),
      evidence('explicit_incompatibility'),
    ]);
    expect(result.label).toBe('incompativel');
  });

  it('manufacturer_part_mapping sozinha -> confirmada', () => {
    const result = assessCompatibility([evidence('manufacturer_part_mapping')]);
    expect(result.label).toBe('confirmada');
  });

  it('internal_verified_mapping sozinha -> confirmada', () => {
    const result = assessCompatibility([evidence('internal_verified_mapping')]);
    expect(result.label).toBe('confirmada');
  });

  it('provider_exact_fit_signal SOZINHA nunca confirma (item 113) -> provavel', () => {
    const result = assessCompatibility([evidence('provider_exact_fit_signal')]);
    expect(result.label).toBe('provavel');
  });

  it('ai_inference SOZINHA nunca confirma e nunca passa de provavel (item 39/175)', () => {
    const result = assessCompatibility([evidence('ai_inference')]);
    expect(result.label).toBe('provavel');
  });

  it('exact_part_number sozinha -> alta_probabilidade', () => {
    const result = assessCompatibility([evidence('exact_part_number')]);
    expect(result.label).toBe('alta_probabilidade');
  });

  it('exact_equipment_model sozinha -> alta_probabilidade', () => {
    const result = assessCompatibility([evidence('exact_equipment_model')]);
    expect(result.label).toBe('alta_probabilidade');
  });

  it('duas categorias nao-IA distintas (fracas) -> alta_probabilidade (evidencias estruturadas consistentes)', () => {
    const result = assessCompatibility([
      evidence('provider_exact_fit_signal'),
      evidence('title_description_mention'),
    ]);
    expect(result.label).toBe('alta_probabilidade');
  });

  it('title_description_mention sozinha -> provavel', () => {
    const result = assessCompatibility([evidence('title_description_mention')]);
    expect(result.label).toBe('provavel');
  });

  it('ai_inference somada a uma evidencia fraca nao-IA continua nao ultrapassando alta_probabilidade por causa da IA', () => {
    const result = assessCompatibility([
      evidence('ai_inference'),
      evidence('title_description_mention'),
    ]);
    // duas categorias nao-IA distintas? Nao: so uma nao-IA (title_description_mention).
    // IA nao conta para "multiplas categorias nao-IA" — continua provavel.
    expect(result.label).toBe('provavel');
  });

  it('evidenceSummary nunca repete a mesma categoria duas vezes', () => {
    const result = assessCompatibility([
      evidence('exact_part_number', 'fonte-a'),
      evidence('exact_part_number', 'fonte-b'),
    ]);
    expect(result.evidenceSummary).toHaveLength(1);
  });

  it('resultado e determinístico: mesma entrada, mesma saida', () => {
    const evidences = [evidence('exact_part_number'), evidence('ai_inference')];
    const a = assessCompatibility(evidences);
    const b = assessCompatibility(evidences);
    expect(a).toEqual(b);
  });
});

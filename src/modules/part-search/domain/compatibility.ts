import type { CompatibilityEvidence, CompatibilityEvidenceType, CompatibilityLabel } from './types';

/**
 * COMPATIBILITY ASSESSOR (Prompt 21, itens 34 a 45, 173 a 176).
 *
 * PURO E DETERMINISTICO — mesma evidencia sempre produz o mesmo rotulo, sem
 * chamar rede, relogio de parede na decisao (so registrado, nunca comparado)
 * ou aleatoriedade. Recebe evidencias com proveniencia ja resolvida
 * (`CompatibilityEvidence[]`) e devolve UM dos cinco rotulos oficiais —
 * nunca inventa um sexto, nunca produz percentual (item 35).
 *
 * POLITICA, EXPLICITA E TESTADA (docs/modules/part-search/compatibility.md):
 *
 *  1. `explicit_incompatibility` em QUALQUER evidencia => `incompativel`,
 *     sempre — veto sobre qualquer outra evidencia, inclusive `ia` e preco
 *     (item 44). Nada "compensa" uma incompatibilidade declarada.
 *  2. Sem evidencia nenhuma => `nao_verificada` — resultado comercial existe,
 *     mas nao ha base para afirmar nada (item 42; NAO E ERRO).
 *  3. `manufacturer_part_mapping` OU `internal_verified_mapping` =>
 *     `confirmada`. Sao as UNICAS DUAS categorias autoritativas desta V1 —
 *     deliberadamente SEM `provider_exact_fit_signal` (alegacao de
 *     marketplace nunca e autoridade sozinha, item 113) e SEM `ai_inference`
 *     (item 39/175: IA sozinha jamais confirma).
 *  4. `exact_part_number` OU `exact_equipment_model` (evidencia FORTE), OU
 *     duas ou mais categorias NAO-IA distintas presentes (evidencias
 *     estruturadas consistentes) => `alta_probabilidade`.
 *  5. Qualquer evidencia restante (sinal fraco isolado: mencao textual,
 *     sinal de "serve" do provedor sozinho, ou SO `ai_inference`) =>
 *     `provavel` — o TETO da IA sozinha (item 175: nunca "Confirmada", nunca
 *     "Alta Probabilidade" sem apoio nao-IA).
 */

const AUTHORITATIVE_TYPES: ReadonlySet<CompatibilityEvidenceType> = new Set([
  'manufacturer_part_mapping',
  'internal_verified_mapping',
]);

const STRONG_TYPES: ReadonlySet<CompatibilityEvidenceType> = new Set([
  'exact_part_number',
  'exact_equipment_model',
]);

export interface CompatibilityAssessment {
  label: CompatibilityLabel;
  /** Texto curto, factual, sem "chain-of-thought" da IA (itens 86/87). */
  evidenceSummary: readonly string[];
  /** So preenchido quando `label === 'incompativel'` (item 90). */
  blockingReasons: readonly string[];
}

const EVIDENCE_TYPE_LABEL: Record<CompatibilityEvidenceType, string> = {
  exact_part_number: 'Codigo da peca bate exatamente',
  exact_equipment_model: 'Fonte declara compatibilidade com este modelo exato',
  manufacturer_part_mapping: 'Mapeamento do fabricante entre peca e modelo',
  internal_verified_mapping: 'Uso confirmado anteriormente no Nexo56 para este modelo',
  provider_exact_fit_signal: 'Fonte externa sinaliza "serve" para este modelo (nao verificado)',
  title_description_mention: 'Titulo/descricao menciona o modelo ou termo buscado',
  explicit_incompatibility: 'Fonte declara explicitamente que NAO serve',
  ai_inference: 'Leitura da Nexo56 AI sobre o texto (nao e confirmacao)',
};

function summarize(evidences: readonly CompatibilityEvidence[]): string[] {
  const seen = new Set<CompatibilityEvidenceType>();
  const summary: string[] = [];
  for (const evidence of evidences) {
    if (seen.has(evidence.type)) continue;
    seen.add(evidence.type);
    summary.push(EVIDENCE_TYPE_LABEL[evidence.type]);
  }
  return summary;
}

export function assessCompatibility(
  evidences: readonly CompatibilityEvidence[],
): CompatibilityAssessment {
  const incompatible = evidences.filter((e) => e.type === 'explicit_incompatibility');
  if (incompatible.length > 0) {
    return {
      label: 'incompativel',
      evidenceSummary: summarize(evidences),
      blockingReasons: summarize(incompatible),
    };
  }

  if (evidences.length === 0) {
    return { label: 'nao_verificada', evidenceSummary: [], blockingReasons: [] };
  }

  const hasAuthoritative = evidences.some((e) => AUTHORITATIVE_TYPES.has(e.type));
  if (hasAuthoritative) {
    return { label: 'confirmada', evidenceSummary: summarize(evidences), blockingReasons: [] };
  }

  const nonAiTypes = new Set(evidences.filter((e) => e.type !== 'ai_inference').map((e) => e.type));
  const hasStrong = [...nonAiTypes].some((type) => STRONG_TYPES.has(type));
  const hasMultipleConsistentNonAi = nonAiTypes.size >= 2;
  if (hasStrong || hasMultipleConsistentNonAi) {
    return {
      label: 'alta_probabilidade',
      evidenceSummary: summarize(evidences),
      blockingReasons: [],
    };
  }

  return { label: 'provavel', evidenceSummary: summarize(evidences), blockingReasons: [] };
}

/** Ordem oficial de "pior para melhor" NAO se aplica — isto e "melhor para pior" (item 45). */
export const COMPATIBILITY_RANK: Record<CompatibilityLabel, number> = {
  confirmada: 0,
  alta_probabilidade: 1,
  provavel: 2,
  nao_verificada: 3,
  incompativel: 4,
};

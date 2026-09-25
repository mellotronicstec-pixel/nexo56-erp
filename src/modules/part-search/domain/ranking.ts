import { assessCompatibility, COMPATIBILITY_RANK } from './compatibility';
import type { PartSearchCandidateForAssessment, PartSearchOfferSnapshot } from './types';

/**
 * RANKING SERVICE (Prompt 21, itens 45, 46, 177 a 185).
 *
 * COMPARADOR PURO — nenhuma nota numerica opaca (item 45: "score" nao
 * existe aqui). A ordenacao e literalmente a prioridade oficial do prompt,
 * em ordem lexicografica — cada criterio so desempata o anterior:
 *
 *   1. classe de compatibilidade     (Confirmada < ... < Incompativel)
 *   2. exatidao                      (tem exact_part_number/exact_model?)
 *   3. confiabilidade de identificacao (quantas categorias de evidencia
 *                                      nao-IA distintas apoiam o resultado)
 *   4. disponibilidade                (em estoque < disponivel < desconhecida < indisponivel)
 *   5. prazo de entrega               (conhecido, menor primeiro; desconhecido por ultimo)
 *   6. custo total                    (preco+frete quando ambos conhecidos; senao desconhecido)
 *   7. preco                          (menor primeiro; desconhecido por ultimo)
 *   8. desempate deterministico final (id do candidate, ordem estavel)
 *
 * PRECO NUNCA VENCE COMPATIBILIDADE (item 46): o criterio 1 sempre decide
 * primeiro. Uma peca R$50 "Nao Verificada" SEMPRE fica depois de uma peca
 * R$120 "Confirmada" — o comparador nem chega a olhar preco nesse caso.
 *
 * DADO FALTANTE NUNCA VIRA "MELHOR VALOR" (item 179): em cada criterio
 * numerico, `null`/desconhecido ordena DEPOIS de qualquer valor conhecido —
 * nunca antes, nunca como 0 implicito.
 */

const AVAILABILITY_RANK: Record<PartSearchOfferSnapshot['availability'], number> = {
  in_stock: 0,
  available: 1,
  unknown: 2,
  unavailable: 3,
};

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function compareNullableBigint(a: bigint | null, b: bigint | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Compara dois Offers pelos criterios 4 a 7 — usado tanto para escolher o
 * "melhor offer" de um candidate quanto, indiretamente, para desempatar
 * candidates com a mesma classe/exatidao/confiabilidade.
 */
export function compareOffers(a: PartSearchOfferSnapshot, b: PartSearchOfferSnapshot): number {
  const availability = AVAILABILITY_RANK[a.availability] - AVAILABILITY_RANK[b.availability];
  if (availability !== 0) return availability;

  const leadTime = compareNullableNumber(a.leadTimeDays, b.leadTimeDays);
  if (leadTime !== 0) return leadTime;

  const totalCost = compareNullableBigint(a.totalCostCents, b.totalCostCents);
  if (totalCost !== 0) return totalCost;

  return compareNullableBigint(a.priceCents, b.priceCents);
}

/**
 * Offer representativo de um candidate para fins de ordenacao — o MELHOR
 * pelos criterios 4 a 7, escolhido deterministicamente. Sem offer nenhum
 * (candidate so tecnico, sem condicao comercial ainda), disponibilidade
 * conta como 'unknown' e nada mais e conhecido.
 */
export function pickBestOfferForRanking(
  offers: readonly PartSearchOfferSnapshot[],
): PartSearchOfferSnapshot | null {
  if (offers.length === 0) return null;
  return [...offers].sort(compareOffers)[0] ?? null;
}

function exactnessRank(candidate: PartSearchCandidateForAssessment): number {
  const hasExact = candidate.evidences.some(
    (e) => e.type === 'exact_part_number' || e.type === 'exact_equipment_model',
  );
  return hasExact ? 0 : 1;
}

function identificationReliabilityRank(candidate: PartSearchCandidateForAssessment): number {
  const distinctNonAiTypes = new Set(
    candidate.evidences.filter((e) => e.type !== 'ai_inference').map((e) => e.type),
  );
  // Mais categorias distintas de evidencia nao-IA = mais confiavel = numero MENOR (melhor).
  return -distinctNonAiTypes.size;
}

/**
 * Comparador total — MENOR e MELHOR (convencao de `Array.prototype.sort`).
 * Estavel por construcao: todo criterio numerico termina no desempate final
 * por `id`, entao duas chamadas com a mesma entrada sempre produzem a mesma
 * ordem (item 180).
 */
export function compareCandidates(
  a: PartSearchCandidateForAssessment,
  b: PartSearchCandidateForAssessment,
): number {
  const labelA = assessCompatibility(a.evidences).label;
  const labelB = assessCompatibility(b.evidences).label;
  const compatibility = COMPATIBILITY_RANK[labelA] - COMPATIBILITY_RANK[labelB];
  if (compatibility !== 0) return compatibility;

  const exactness = exactnessRank(a) - exactnessRank(b);
  if (exactness !== 0) return exactness;

  const reliability = identificationReliabilityRank(a) - identificationReliabilityRank(b);
  if (reliability !== 0) return reliability;

  const offerA = pickBestOfferForRanking(a.offers);
  const offerB = pickBestOfferForRanking(b.offers);
  if (offerA && offerB) {
    const offers = compareOffers(offerA, offerB);
    if (offers !== 0) return offers;
  } else if (offerA && !offerB) {
    return -1;
  } else if (!offerA && offerB) {
    return 1;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Ordena uma lista de candidates pela prioridade oficial — nunca muta a entrada. */
export function rankCandidates<T extends PartSearchCandidateForAssessment>(
  candidates: readonly T[],
): T[] {
  return [...candidates].sort(compareCandidates);
}

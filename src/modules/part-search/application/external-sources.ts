import 'server-only';
import { newId } from '@/core/ids/id';
import { Money } from '@/core/money/money';
import { normalizePartNumber } from '@/modules/inventory/domain/inventory';
import { normalizeSearchable } from '@/core/text/normalize';
import { sanitizeExternalUrl } from '../domain/url-validation';
import type { CompatibilityEvidence, PartSearchOfferSnapshot } from '../domain/types';
import type { ValidatedProviderResultItem } from '../domain/provider-result-schema';
import type { NormalizedPartSearchQuery } from '../domain/query-normalization';

/**
 * MONTAGEM DE CANDIDATES EXTERNOS (Prompt 21, itens 32, 33, 36, 54 a 56,
 * 107 a 113, 172).
 *
 * Recebe SO itens ja validados pelo schema (`validateProviderResults`) — o
 * papel deste arquivo e traduzir um item estruturado em Candidate/Offer/
 * Evidence do nosso vocabulario, com DEDUPLICACAO CONSERVADORA (item 54):
 * dois itens so viram o MESMO candidate quando compartilham a mesma
 * `dedupeKey` — part number normalizado quando existe; titulo+fabricante
 * normalizados, so como ultimo recurso, quando nao existe (item 55).
 */

export interface ExternalCandidateResult {
  id: string;
  title: string;
  partNumber: string | null;
  brand: string | null;
  dedupeKey: string;
  evidences: CompatibilityEvidence[];
  offers: PartSearchOfferSnapshot[];
}

function dedupeKeyFor(item: ValidatedProviderResultItem): string {
  if (item.partNumber) return `partnumber:${normalizePartNumber(item.partNumber)}`;
  const manufacturer = item.manufacturer ? normalizeSearchable(item.manufacturer) : '';
  return `title:${normalizeSearchable(item.title)}:${manufacturer}`;
}

function buildEvidences(
  item: ValidatedProviderResultItem,
  providerName: string,
  query: NormalizedPartSearchQuery,
  partNumberHint: string | null,
): CompatibilityEvidence[] {
  const evidences: CompatibilityEvidence[] = [];
  const observedAt = item.observedAt;

  if (item.compatibilityData?.incompatible) {
    evidences.push({
      source: providerName,
      type: 'explicit_incompatibility',
      observedAt,
      field: 'compatibilityData',
      value: item.compatibilityData.note,
    });
    // Veto: nenhuma outra evidencia deste item importa quando ha incompatibilidade explicita.
    return evidences;
  }

  const hintNormalized = partNumberHint ? normalizePartNumber(partNumberHint) : null;
  if (
    item.partNumber &&
    (query.anchors.includes(normalizePartNumber(item.partNumber).toLowerCase()) ||
      (hintNormalized && hintNormalized === normalizePartNumber(item.partNumber)))
  ) {
    evidences.push({
      source: providerName,
      type: 'exact_part_number',
      observedAt,
      field: 'partNumber',
      value: item.partNumber,
    });
  }

  if (item.compatibilityData?.exactFit) {
    evidences.push({
      source: providerName,
      type: 'provider_exact_fit_signal',
      observedAt,
      field: 'compatibilityData',
      value: item.compatibilityData.note,
    });
  }

  const normalizedTitle = normalizeSearchable(item.title);
  if (query.searchKey.length > 0 && normalizedTitle.includes(query.searchKey)) {
    evidences.push({
      source: providerName,
      type: 'title_description_mention',
      observedAt,
      field: 'title',
      value: item.title,
    });
  }

  return evidences;
}

function buildOffer(
  item: ValidatedProviderResultItem,
  providerName: string,
): PartSearchOfferSnapshot {
  let priceCents: bigint | null = null;
  if (item.price) {
    try {
      priceCents = Money.parse(item.price.amount).toCents();
    } catch {
      priceCents = null;
    }
  }

  return {
    id: newId(),
    sourceKey: providerName,
    providerOfferId: item.providerResultId,
    sellerName: item.sourceName,
    priceCents,
    currency: priceCents !== null ? 'BRL' : null,
    availability: item.availability ?? 'unknown',
    leadTimeDays: item.leadTimeDays,
    freightCents: null,
    totalCostCents: null,
    url: sanitizeExternalUrl(item.url),
    isHistorical: false,
    observedAt: item.observedAt,
  };
}

export function buildExternalCandidates(
  items: readonly ValidatedProviderResultItem[],
  providerName: string,
  query: NormalizedPartSearchQuery,
  partNumberHint: string | null,
): ExternalCandidateResult[] {
  const byDedupeKey = new Map<string, ExternalCandidateResult>();

  for (const item of items) {
    const dedupeKey = dedupeKeyFor(item);
    const evidences = buildEvidences(item, providerName, query, partNumberHint);
    const offer = buildOffer(item, providerName);

    const existing = byDedupeKey.get(dedupeKey);
    if (existing) {
      existing.offers.push(offer);
      existing.evidences.push(...evidences);
      continue;
    }

    byDedupeKey.set(dedupeKey, {
      id: newId(),
      title: item.title,
      partNumber: item.partNumber,
      brand: item.manufacturer,
      dedupeKey,
      evidences,
      offers: [offer],
    });
  }

  return [...byDedupeKey.values()];
}

import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { Money } from '@/core/money/money';
import { NotFoundError } from '@/core/errors';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  partSearchCandidates,
  partSearchEvidence,
  partSearchOffers,
  partSearchSessions,
} from '../infrastructure/schema';
import { assessCompatibility, type CompatibilityAssessment } from '../domain/compatibility';
import { rankCandidates } from '../domain/ranking';
import type {
  CompatibilityEvidence,
  CompatibilityEvidenceType,
  PartSearchAvailability,
  PartSearchOfferSnapshot,
  PartSearchSourceType,
} from '../domain/types';

/**
 * LEITURA DE UMA SESSAO JA GRAVADA (Prompt 21, item 85/133).
 *
 * O rotulo de compatibilidade fica gravado no candidate (snapshot congelado
 * no momento da busca), mas o TEXTO de explicacao (`evidenceSummary`) e
 * sempre RECALCULADO a partir das linhas de evidencia — nunca duplicado em
 * texto solto no banco (uma unica fonte de verdade para o "porque").
 */
export interface PartSearchResultOffer {
  id: string;
  sourceKey: string;
  sellerName: string | null;
  price: string | null;
  currency: string | null;
  availability: PartSearchAvailability;
  leadTimeDays: number | null;
  freight: string | null;
  totalCost: string | null;
  url: string | null;
  isHistorical: boolean;
  observedAt: Date;
}

export interface PartSearchResultCandidate {
  id: string;
  sourceType: PartSearchSourceType;
  title: string;
  partNumber: string | null;
  brand: string | null;
  partId: string | null;
  compatibility: CompatibilityAssessment;
  offers: readonly PartSearchResultOffer[];
}

export interface PartSearchSessionResults {
  sessionId: string;
  unitId: string;
  status: string;
  queryTerm: string;
  createdAt: Date;
  candidates: readonly PartSearchResultCandidate[];
}

export async function getSessionResults(
  context: TenantContext,
  sessionId: string,
): Promise<PartSearchSessionResults> {
  const db = getDb();

  const [session] = await db
    .select({
      id: partSearchSessions.id,
      unitId: partSearchSessions.unitId,
      status: partSearchSessions.status,
      queryTerm: partSearchSessions.queryTerm,
      createdAt: partSearchSessions.createdAt,
    })
    .from(partSearchSessions)
    .where(
      and(eq(partSearchSessions.tenantId, context.tenantId), eq(partSearchSessions.id, sessionId)),
    )
    .limit(1);

  if (!session) throw new NotFoundError('Busca nao encontrada.');

  await authorize(context, {
    permission: PERMISSIONS.PARTS_SEARCH,
    unitId: session.unitId,
    featureKey: FEATURES.AI_PART_SEARCH,
  });

  const candidateRows = await db
    .select({
      id: partSearchCandidates.id,
      sourceType: partSearchCandidates.sourceType,
      title: partSearchCandidates.title,
      partNumber: partSearchCandidates.partNumber,
      brand: partSearchCandidates.brand,
      partId: partSearchCandidates.partId,
    })
    .from(partSearchCandidates)
    .where(
      and(
        eq(partSearchCandidates.tenantId, context.tenantId),
        eq(partSearchCandidates.sessionId, sessionId),
      ),
    )
    .orderBy(asc(partSearchCandidates.createdAt));

  if (candidateRows.length === 0) {
    return {
      sessionId: session.id,
      unitId: session.unitId,
      status: session.status,
      queryTerm: session.queryTerm,
      createdAt: session.createdAt,
      candidates: [],
    };
  }

  const candidateIds = candidateRows.map((c) => c.id);

  const [evidenceRows, offerRows] = await Promise.all([
    db
      .select({
        candidateId: partSearchEvidence.candidateId,
        source: partSearchEvidence.source,
        type: partSearchEvidence.type,
        observedAt: partSearchEvidence.observedAt,
        field: partSearchEvidence.field,
        value: partSearchEvidence.value,
      })
      .from(partSearchEvidence)
      .where(
        and(
          eq(partSearchEvidence.tenantId, context.tenantId),
          inArray(partSearchEvidence.candidateId, candidateIds),
        ),
      ),
    db
      .select({
        id: partSearchOffers.id,
        candidateId: partSearchOffers.candidateId,
        sourceKey: partSearchOffers.sourceKey,
        sellerName: partSearchOffers.sellerName,
        price: partSearchOffers.price,
        currency: partSearchOffers.currency,
        availability: partSearchOffers.availability,
        leadTimeDays: partSearchOffers.leadTimeDays,
        freight: partSearchOffers.freight,
        totalCost: partSearchOffers.totalCost,
        url: partSearchOffers.url,
        isHistorical: partSearchOffers.isHistorical,
        observedAt: partSearchOffers.observedAt,
      })
      .from(partSearchOffers)
      .where(
        and(
          eq(partSearchOffers.tenantId, context.tenantId),
          inArray(partSearchOffers.candidateId, candidateIds),
        ),
      ),
  ]);

  const evidenceByCandidate = new Map<string, CompatibilityEvidence[]>();
  for (const row of evidenceRows) {
    const list = evidenceByCandidate.get(row.candidateId) ?? [];
    list.push({
      source: row.source,
      type: row.type as CompatibilityEvidenceType,
      observedAt: row.observedAt,
      field: row.field,
      value: row.value,
    });
    evidenceByCandidate.set(row.candidateId, list);
  }

  const offersByCandidate = new Map<string, PartSearchOfferSnapshot[]>();
  const offersForDisplay = new Map<string, PartSearchResultOffer[]>();
  for (const row of offerRows) {
    const priceCents = row.price ? Money.parse(row.price).toCents() : null;
    const list = offersByCandidate.get(row.candidateId) ?? [];
    list.push({
      id: row.id,
      sourceKey: row.sourceKey,
      providerOfferId: null,
      sellerName: row.sellerName,
      priceCents,
      currency: row.currency as 'BRL' | null,
      availability: row.availability as PartSearchAvailability,
      leadTimeDays: row.leadTimeDays,
      freightCents: null,
      totalCostCents: null,
      url: row.url,
      isHistorical: row.isHistorical === 1,
      observedAt: row.observedAt,
    });
    offersByCandidate.set(row.candidateId, list);

    const display = offersForDisplay.get(row.candidateId) ?? [];
    display.push({
      id: row.id,
      sourceKey: row.sourceKey,
      sellerName: row.sellerName,
      price: row.price,
      currency: row.currency,
      availability: row.availability as PartSearchAvailability,
      leadTimeDays: row.leadTimeDays,
      freight: row.freight,
      totalCost: row.totalCost,
      url: row.url,
      isHistorical: row.isHistorical === 1,
      observedAt: row.observedAt,
    });
    offersForDisplay.set(row.candidateId, display);
  }

  const forAssessment = candidateRows.map((row) => ({
    id: row.id,
    sourceType: row.sourceType as PartSearchSourceType,
    title: row.title,
    partNumber: row.partNumber,
    brand: row.brand,
    evidences: evidenceByCandidate.get(row.id) ?? [],
    offers: offersByCandidate.get(row.id) ?? [],
  }));

  const ranked = rankCandidates(forAssessment);

  const candidates: PartSearchResultCandidate[] = ranked.map((row) => ({
    id: row.id,
    sourceType: row.sourceType,
    title: row.title,
    partNumber: row.partNumber,
    brand: row.brand,
    partId: candidateRows.find((c) => c.id === row.id)?.partId ?? null,
    compatibility: assessCompatibility(row.evidences),
    offers: offersForDisplay.get(row.id) ?? [],
  }));

  return {
    sessionId: session.id,
    unitId: session.unitId,
    status: session.status,
    queryTerm: session.queryTerm,
    createdAt: session.createdAt,
    candidates,
  };
}

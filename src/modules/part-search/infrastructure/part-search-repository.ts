import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { Money } from '@/core/money/money';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { newId } from '@/core/ids/id';
import {
  partSearchCandidates,
  partSearchEvidence,
  partSearchOffers,
  partSearchProviderCalls,
  partSearchSelections,
  partSearchSessions,
} from './schema';
import type { CompatibilityEvidence, PartSearchOfferSnapshot } from '../domain/types';
import type { CompatibilityLabel } from '../domain/types';
import type { PartSearchSessionStatus } from '../domain/part-search-request';

/**
 * REPOSITORIO DA BUSCA DE PECAS (Prompt 21, item 133 — imutavel apos
 * gravado).
 *
 * `insertSearchSession` grava a sessao inteira — sessao, candidates,
 * evidencias e offers — numa UNICA transacao (tudo ou nada; nenhuma sessao
 * parcialmente gravada). Nenhum metodo aqui faz UPDATE em candidate/
 * evidence/offer depois de criados: um novo `refresh` (fora de escopo desta
 * V1) sempre seria uma NOVA sessao, nunca uma reescrita.
 */

export interface CandidateToInsert {
  id: string;
  sourceType: 'internal_inventory' | 'purchase_history' | 'external';
  title: string;
  partNumber: string | null;
  brand: string | null;
  partId: string | null;
  compatibilityLabel: CompatibilityLabel;
  dedupeKey: string;
  evidences: readonly CompatibilityEvidence[];
  offers: readonly PartSearchOfferSnapshot[];
}

export interface ProviderCallToInsert {
  providerKey: string;
  status: 'ok' | 'error' | 'timeout' | 'not_configured';
  resultCount: number | null;
  errorCode: string | null;
  latencyMs: number | null;
  requestedAt: Date;
}

export interface InsertSearchSessionInput {
  sessionId: string;
  tenantId: string;
  unitId: string;
  serviceOrderId: string | null;
  equipmentId: string | null;
  requestedBy: string;
  queryTerm: string;
  querySearchKey: string;
  partNumberHint: string | null;
  status: PartSearchSessionStatus;
  externalRequested: boolean;
  candidates: readonly CandidateToInsert[];
  providerCalls: readonly ProviderCallToInsert[];
}

function moneyCentsToDecimal(cents: bigint | null): string | null {
  if (cents === null) return null;
  return Money.fromCents(cents).toString();
}

export async function insertSearchSession(input: InsertSearchSessionInput): Promise<void> {
  const now = new Date();

  await runInTransaction(async (tx: TransactionExecutor) => {
    await tx.insert(partSearchSessions).values({
      id: input.sessionId,
      tenantId: input.tenantId,
      unitId: input.unitId,
      serviceOrderId: input.serviceOrderId,
      equipmentId: input.equipmentId,
      requestedBy: input.requestedBy,
      queryTerm: input.queryTerm,
      querySearchKey: input.querySearchKey,
      partNumberHint: input.partNumberHint,
      status: input.status,
      externalRequested: input.externalRequested ? 1 : 0,
      createdBy: input.requestedBy,
      updatedBy: input.requestedBy,
      createdAt: now,
      updatedAt: now,
    });

    for (const candidate of input.candidates) {
      await tx.insert(partSearchCandidates).values({
        id: candidate.id,
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        sourceType: candidate.sourceType,
        title: candidate.title,
        partNumber: candidate.partNumber,
        brand: candidate.brand,
        partId: candidate.partId,
        compatibilityLabel: candidate.compatibilityLabel,
        dedupeKey: candidate.dedupeKey,
        createdAt: now,
      });

      if (candidate.evidences.length > 0) {
        await tx.insert(partSearchEvidence).values(
          candidate.evidences.map((evidence) => ({
            id: newId(),
            tenantId: input.tenantId,
            candidateId: candidate.id,
            source: evidence.source,
            type: evidence.type,
            observedAt: evidence.observedAt,
            field: evidence.field ?? null,
            value: evidence.value ?? null,
          })),
        );
      }

      if (candidate.offers.length > 0) {
        await tx.insert(partSearchOffers).values(
          candidate.offers.map((offer) => ({
            id: offer.id,
            tenantId: input.tenantId,
            candidateId: candidate.id,
            sourceKey: offer.sourceKey,
            providerOfferId: offer.providerOfferId,
            sellerName: offer.sellerName,
            price: moneyCentsToDecimal(offer.priceCents),
            currency: offer.currency ?? 'BRL',
            availability: offer.availability,
            leadTimeDays: offer.leadTimeDays,
            freight: moneyCentsToDecimal(offer.freightCents),
            totalCost: moneyCentsToDecimal(offer.totalCostCents),
            url: offer.url,
            isHistorical: offer.isHistorical ? 1 : 0,
            observedAt: offer.observedAt,
            createdAt: now,
          })),
        );
      }
    }

    if (input.providerCalls.length > 0) {
      await tx.insert(partSearchProviderCalls).values(
        input.providerCalls.map((call) => ({
          id: newId(),
          tenantId: input.tenantId,
          sessionId: input.sessionId,
          providerKey: call.providerKey,
          status: call.status,
          resultCount: call.resultCount,
          errorCode: call.errorCode,
          latencyMs: call.latencyMs,
          requestedAt: call.requestedAt,
        })),
      );
    }
  });
}

export interface StoredSession {
  id: string;
  tenantId: string;
  unitId: string;
  serviceOrderId: string | null;
  status: string;
  queryTerm: string;
  createdAt: Date;
}

export async function findSessionInTenant(
  tenantId: string,
  sessionId: string,
): Promise<StoredSession | null> {
  const [row] = await getDb()
    .select({
      id: partSearchSessions.id,
      tenantId: partSearchSessions.tenantId,
      unitId: partSearchSessions.unitId,
      serviceOrderId: partSearchSessions.serviceOrderId,
      status: partSearchSessions.status,
      queryTerm: partSearchSessions.queryTerm,
      createdAt: partSearchSessions.createdAt,
    })
    .from(partSearchSessions)
    .where(and(eq(partSearchSessions.tenantId, tenantId), eq(partSearchSessions.id, sessionId)))
    .limit(1);

  return row ?? null;
}

export interface StoredCandidate {
  id: string;
  sessionId: string;
  sourceType: string;
  title: string;
  partNumber: string | null;
  brand: string | null;
  partId: string | null;
  compatibilityLabel: CompatibilityLabel;
}

export async function findCandidateInTenant(
  tenantId: string,
  candidateId: string,
): Promise<StoredCandidate | null> {
  const [row] = await getDb()
    .select({
      id: partSearchCandidates.id,
      sessionId: partSearchCandidates.sessionId,
      sourceType: partSearchCandidates.sourceType,
      title: partSearchCandidates.title,
      partNumber: partSearchCandidates.partNumber,
      brand: partSearchCandidates.brand,
      partId: partSearchCandidates.partId,
      compatibilityLabel: partSearchCandidates.compatibilityLabel,
    })
    .from(partSearchCandidates)
    .where(
      and(eq(partSearchCandidates.tenantId, tenantId), eq(partSearchCandidates.id, candidateId)),
    )
    .limit(1);

  return (row as StoredCandidate | undefined) ?? null;
}

export interface StoredOffer {
  id: string;
  candidateId: string;
  sourceKey: string;
  price: string | null;
}

export async function findOfferInTenant(
  tenantId: string,
  offerId: string,
): Promise<StoredOffer | null> {
  const [row] = await getDb()
    .select({
      id: partSearchOffers.id,
      candidateId: partSearchOffers.candidateId,
      sourceKey: partSearchOffers.sourceKey,
      price: partSearchOffers.price,
    })
    .from(partSearchOffers)
    .where(and(eq(partSearchOffers.tenantId, tenantId), eq(partSearchOffers.id, offerId)))
    .limit(1);

  return row ?? null;
}

export interface InsertSelectionInput {
  id: string;
  tenantId: string;
  sessionId: string;
  candidateId: string;
  offerId: string | null;
  selectedBy: string;
  unverifiedAcknowledged: boolean;
}

/** A ESCOLHA HUMANA (item 89/95) — nunca cria/move nada em outro modulo. */
export async function insertSelection(input: InsertSelectionInput): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(partSearchSelections)
    .values({
      id: input.id,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      candidateId: input.candidateId,
      offerId: input.offerId,
      selectedBy: input.selectedBy,
      selectedAt: now,
      unverifiedAcknowledged: input.unverifiedAcknowledged ? 1 : 0,
      purchaseNeedId: null,
      createdBy: input.selectedBy,
      updatedBy: input.selectedBy,
    });
}

export interface StoredSelection {
  id: string;
  sessionId: string;
  candidateId: string;
  offerId: string | null;
  purchaseNeedId: string | null;
}

export async function findSelectionInTenant(
  tenantId: string,
  selectionId: string,
): Promise<StoredSelection | null> {
  const [row] = await getDb()
    .select({
      id: partSearchSelections.id,
      sessionId: partSearchSelections.sessionId,
      candidateId: partSearchSelections.candidateId,
      offerId: partSearchSelections.offerId,
      purchaseNeedId: partSearchSelections.purchaseNeedId,
    })
    .from(partSearchSelections)
    .where(
      and(eq(partSearchSelections.tenantId, tenantId), eq(partSearchSelections.id, selectionId)),
    )
    .limit(1);

  return row ?? null;
}

/**
 * So gravado APOS a necessidade de compra ja existir (item 145) — nunca o
 * contrario. `updatedBy` registra quem confirmou a criacao.
 */
export async function attachPurchaseNeedToSelection(
  tenantId: string,
  selectionId: string,
  purchaseNeedId: string,
  updatedBy: string,
): Promise<void> {
  await getDb()
    .update(partSearchSelections)
    .set({ purchaseNeedId, updatedBy })
    .where(
      and(eq(partSearchSelections.tenantId, tenantId), eq(partSearchSelections.id, selectionId)),
    );
}

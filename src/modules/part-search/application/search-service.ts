import 'server-only';
import { z } from 'zod';
import { authorize, can } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { isAppError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { logger } from '@/core/logging/logger';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { findServiceOrderDetail } from '@/modules/service-orders/application/service-order-queries';
import { assessCompatibility } from '../domain/compatibility';
import { rankCandidates } from '../domain/ranking';
import { normalizeSearchQuery, MAX_QUERY_LENGTH } from '../domain/query-normalization';
import { partSearchError } from '../domain/part-search-request';
import { validateProviderResults } from '../domain/provider-result-schema';
import { searchInternalCandidates } from './internal-sources';
import { buildExternalCandidates } from './external-sources';
import { getPartSearchProvider } from '../infrastructure/provider-registry';
import {
  insertSearchSession,
  type CandidateToInsert,
  type ProviderCallToInsert,
} from '../infrastructure/part-search-repository';
import type {
  CompatibilityEvidence,
  PartSearchEquipmentContext,
  PartSearchOfferSnapshot,
  PartSearchSourceType,
} from '../domain/types';

/**
 * ORQUESTRADOR DA BUSCA DE PECAS (Prompt 21 — mesmo desenho de
 * `generateAiDraft`, ADR-085/ADR-086).
 *
 * FLUXO, nesta ordem:
 *
 *   1. Valida entrada (termo obrigatorio, contexto opcional de OS).
 *   2. Se veio de uma OS: carrega a OS (leitura tenant-scoped), autoriza
 *      `service_orders.view` NA UNIDADE DA OS (nunca aceita unitId solto do
 *      cliente quando ha OS — a OS e que manda qual e a unidade real).
 *   3. Autorizacao composta: `parts.search` + feature `operations.part_search`
 *      (independente de `ai.core` — correcao pos-CI #33), na MESMA unidade
 *      (item 74).
 *   4. Normaliza a consulta (nunca altera parte tecnica do termo).
 *   5. Busca interna (Estoque + historico de compra), SO se o usuario tiver
 *      as permissoes daqueles modulos NA MESMA unidade — senao, omite a
 *      secao inteira, sem erro (item 129: Estoque continua independente).
 *   6. Busca externa opcional: provedor ausente ou em producao sem
 *      provedor real -> `not_configured`, busca interna nao e afetada.
 *   7. Classifica cada candidate (Compatibility Assessor) e ordena
 *      (Ranking) — puro, determinístico.
 *   8. Grava tudo numa transacao; devolve o resultado ja ordenado.
 *
 * NENHUMA ESCRITA em `parts`/`stock_balances`/`service_orders` acontece
 * aqui — as unicas tabelas escritas sao as cinco de `part-search` (item 88).
 */

const performSearchInputSchema = z.object({
  term: z.string().trim().min(1, 'Informe um termo ou codigo de peca.').max(MAX_QUERY_LENGTH),
  partNumberHint: z.string().trim().max(60).optional(),
  serviceOrderId: z.string().trim().min(1).optional(),
  /** Exigido SO quando nao ha OS — com OS, a unidade vem dela (item 81). */
  unitId: z.string().trim().min(1).optional(),
  includeExternal: z.boolean().default(true),
});

export type PerformPartSearchInput = z.input<typeof performSearchInputSchema>;

const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
let providerTimeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS;

/** So para teste (mesmo padrao de `setAiProviderTimeoutMsForTesting`). */
export function setPartSearchProviderTimeoutMsForTesting(ms: number | null): void {
  providerTimeoutMs = ms ?? DEFAULT_PROVIDER_TIMEOUT_MS;
}

async function callProviderWithTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

interface ResolvedContext {
  unitId: string;
  serviceOrderId: string | null;
  equipmentId: string | null;
  equipmentContext: PartSearchEquipmentContext | null;
}

async function resolveContext(
  context: TenantContext,
  input: z.infer<typeof performSearchInputSchema>,
): Promise<ResolvedContext> {
  if (input.serviceOrderId) {
    const detail = await findServiceOrderDetail(context, input.serviceOrderId);
    if (!detail) throw partSearchError('PART_SEARCH_CONTEXT_NOT_FOUND');

    // service_orders.view NA UNIDADE REAL da OS (item 74/81) — nunca a unidade que o cliente mandou.
    await authorize(context, {
      permission: PERMISSIONS.SERVICE_ORDERS_VIEW,
      unitId: detail.order.unitId,
      featureKey: FEATURES.CORE_SERVICE_ORDERS,
      resource: { tenantId: context.tenantId, unitId: detail.order.unitId },
    });

    return {
      unitId: detail.order.unitId,
      serviceOrderId: detail.order.id,
      equipmentId: detail.equipmentItem.id,
      equipmentContext: {
        kind: detail.equipmentItem.kind,
        brand: detail.equipmentItem.brand,
        model: detail.equipmentItem.model,
      },
    };
  }

  if (!input.unitId) {
    throw new ValidationError('Informe a unidade da busca.');
  }
  if (!context.authorizedUnitIds.includes(input.unitId)) {
    throw partSearchError('PART_SEARCH_CONTEXT_NOT_FOUND');
  }

  return {
    unitId: input.unitId,
    serviceOrderId: null,
    equipmentId: null,
    equipmentContext: null,
  };
}

export interface PerformPartSearchResultCandidate {
  id: string;
  sourceType: PartSearchSourceType;
  title: string;
  partNumber: string | null;
  brand: string | null;
  compatibilityLabel: ReturnType<typeof assessCompatibility>['label'];
  evidenceSummary: readonly string[];
  blockingReasons: readonly string[];
  offers: readonly PartSearchOfferSnapshot[];
}

export interface PerformPartSearchResult {
  sessionId: string;
  status: 'completed' | 'partial';
  internalSearched: boolean;
  externalOutcome: 'ok' | 'not_configured' | 'error' | 'timeout' | 'skipped';
  candidates: readonly PerformPartSearchResultCandidate[];
}

/** Decora `AuthorizationError` de `parts.search`/`operations.part_search` com o codigo estavel do item 127. */
async function authorizePartSearch(context: TenantContext, unitId: string): Promise<void> {
  try {
    await authorize(context, {
      permission: PERMISSIONS.PARTS_SEARCH,
      unitId,
      featureKey: FEATURES.OPERATIONS_PART_SEARCH,
    });
  } catch (error) {
    if (isAppError(error) && error.code === 'AUTHORIZATION_ERROR') {
      const reason = (error.details as { reason?: string } | undefined)?.reason;
      throw partSearchError(
        reason === 'FEATURE_UNAVAILABLE'
          ? 'PART_SEARCH_FEATURE_DISABLED'
          : 'PART_SEARCH_PERMISSION_DENIED',
      );
    }
    throw error;
  }
}

export async function performPartSearch(
  context: TenantContext,
  rawInput: unknown,
): Promise<PerformPartSearchResult> {
  const parsed = performSearchInputSchema.safeParse(rawInput);
  if (!parsed.success) throw partSearchError('PART_SEARCH_QUERY_INVALID');
  const input = parsed.data;

  const resolved = await resolveContext(context, input);

  await authorizePartSearch(context, resolved.unitId);

  const query = normalizeSearchQuery(input.term);
  const partNumberHint = input.partNumberHint?.trim() || null;

  const sessionId = newId();
  const requestedBy = context.userId;

  // --- fonte interna: so roda se o usuario tiver acesso a Estoque NESTA unidade -----------
  const inventoryAccess = await can(context, {
    permission: PERMISSIONS.INVENTORY_VIEW,
    unitId: resolved.unitId,
    featureKey: FEATURES.OPERATIONS_INVENTORY,
  });

  let internalCandidates: CandidateToInsert[] = [];
  if (inventoryAccess.allowed) {
    const internal = await searchInternalCandidates(
      context,
      resolved.unitId,
      query,
      partNumberHint,
    );
    internalCandidates = internal.map((candidate) => {
      const assessment = assessCompatibility(candidate.evidences);
      return {
        id: candidate.id,
        sourceType: 'internal_inventory' as const,
        title: candidate.title,
        partNumber: candidate.partNumber,
        brand: candidate.brand,
        partId: candidate.partId,
        compatibilityLabel: assessment.label,
        dedupeKey: candidate.dedupeKey,
        evidences: candidate.evidences,
        offers: candidate.offers,
      };
    });
  }

  // --- fonte externa: nunca derruba a busca interna se faltar/falhar (item 23/129/137) -----
  let externalOutcome: PerformPartSearchResult['externalOutcome'] = 'skipped';
  let externalCandidates: CandidateToInsert[] = [];
  const providerCalls: ProviderCallToInsert[] = [];

  if (input.includeExternal) {
    const provider = getPartSearchProvider();
    const requestedAt = new Date();

    if (!provider) {
      externalOutcome = 'not_configured';
      providerCalls.push({
        providerKey: 'none',
        status: 'not_configured',
        resultCount: null,
        errorCode: 'PART_SEARCH_PROVIDER_NOT_CONFIGURED',
        latencyMs: null,
        requestedAt,
      });
    } else {
      const result = await callProviderWithTimeout(
        () =>
          provider.search(
            {
              term: query.displayTerm,
              partNumberHint,
              equipmentKind: resolved.equipmentContext?.kind ?? null,
              equipmentBrand: resolved.equipmentContext?.brand ?? null,
              equipmentModel: resolved.equipmentContext?.model ?? null,
            },
            { timeoutMs: providerTimeoutMs },
          ),
        providerTimeoutMs,
        () => ({ outcome: 'error' as const, kind: 'timeout' as const, detail: null }),
      );

      const latencyMs = Date.now() - requestedAt.getTime();

      if (result.outcome === 'error') {
        externalOutcome = result.kind === 'timeout' ? 'timeout' : 'error';
        providerCalls.push({
          providerKey: provider.name,
          status: result.kind === 'timeout' ? 'timeout' : 'error',
          resultCount: null,
          errorCode:
            result.kind === 'timeout'
              ? 'PART_SEARCH_PROVIDER_TIMEOUT'
              : 'PART_SEARCH_PROVIDER_ERROR',
          latencyMs,
          requestedAt,
        });
        logger.warn('Busca de Pecas: provedor externo devolveu erro', {
          module: 'part-search',
          operation: 'performPartSearch',
          sessionId,
          kind: result.kind,
        });
      } else {
        const { valid, rejectedCount } = validateProviderResults(result.items);
        externalOutcome = 'ok';
        providerCalls.push({
          providerKey: provider.name,
          status: 'ok',
          resultCount: valid.length,
          errorCode: null,
          latencyMs,
          requestedAt,
        });
        if (rejectedCount > 0) {
          logger.warn('Busca de Pecas: resultados invalidos do provedor foram descartados', {
            module: 'part-search',
            operation: 'performPartSearch',
            sessionId,
            rejectedCount,
          });
        }

        const external = buildExternalCandidates(valid, provider.name, query, partNumberHint);
        externalCandidates = external.map((candidate) => {
          const assessment = assessCompatibility(candidate.evidences);
          return {
            id: candidate.id,
            sourceType: 'external' as const,
            title: candidate.title,
            partNumber: candidate.partNumber,
            brand: candidate.brand,
            partId: null,
            compatibilityLabel: assessment.label,
            dedupeKey: candidate.dedupeKey,
            evidences: candidate.evidences,
            offers: candidate.offers,
          };
        });
      }
    }
  }

  const allCandidates = [...internalCandidates, ...externalCandidates];

  const status: PerformPartSearchResult['status'] =
    input.includeExternal && externalOutcome !== 'ok' && externalOutcome !== 'skipped'
      ? 'partial'
      : 'completed';

  await insertSearchSession({
    sessionId,
    tenantId: context.tenantId,
    unitId: resolved.unitId,
    serviceOrderId: resolved.serviceOrderId,
    equipmentId: resolved.equipmentId,
    requestedBy,
    queryTerm: query.displayTerm,
    querySearchKey: query.searchKey,
    partNumberHint,
    status,
    externalRequested: input.includeExternal,
    candidates: allCandidates,
    providerCalls,
  });

  const ranked = rankCandidates(
    allCandidates.map((c) => ({
      id: c.id,
      sourceType: c.sourceType,
      title: c.title,
      partNumber: c.partNumber,
      brand: c.brand,
      evidences: c.evidences,
      offers: c.offers,
    })),
  );

  const candidates: PerformPartSearchResultCandidate[] = ranked.map((row) => {
    const source = allCandidates.find((c) => c.id === row.id);
    const assessment = assessCompatibility(row.evidences as readonly CompatibilityEvidence[]);
    return {
      id: row.id,
      sourceType: row.sourceType,
      title: row.title,
      partNumber: row.partNumber,
      brand: row.brand,
      compatibilityLabel: assessment.label,
      evidenceSummary: assessment.evidenceSummary,
      blockingReasons: assessment.blockingReasons,
      offers: source?.offers ?? [],
    };
  });

  return {
    sessionId,
    status,
    internalSearched: inventoryAccess.allowed,
    externalOutcome,
    candidates,
  };
}

export function isPartSearchError(error: unknown): boolean {
  return (
    isAppError(error) &&
    Boolean((error.details as { partSearchErrorCode?: string })?.partSearchErrorCode)
  );
}

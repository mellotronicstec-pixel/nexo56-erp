import 'server-only';
import { and, eq, or, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { Money } from '@/core/money/money';
import { normalizePartNumber, partSearchKey } from '@/modules/inventory/domain/inventory';
import { parts } from '@/modules/inventory/infrastructure/schema';
import { loadBalance } from '@/modules/inventory/application/stock-service';
import { listPriceHistoryForPart } from '@/modules/purchasing/application/purchasing-queries';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import type { NormalizedPartSearchQuery } from '../domain/query-normalization';
import type { CompatibilityEvidence, PartSearchOfferSnapshot } from '../domain/types';
import { newId } from '@/core/ids/id';

/**
 * FONTES INTERNAS (Prompt 21, itens 13, 57 a 59, 99, 100, 199).
 *
 * LEITURA, sempre — nenhuma linha aqui escreve em `parts`/`stock_balances`/
 * `purchase_price_history`. Estoque continua a UNICA fonte de verdade do
 * catalogo (item 8): quando um candidate corresponde a uma peca real,
 * guardamos so o `partId` como referencia.
 *
 * O saldo de estoque (`loadBalance`) e o historico de compra
 * (`listPriceHistoryForPart`) SEMPRE passam pela porta de aplicacao oficial
 * dos modulos donos — nunca uma tabela concreta deles e escrita, e
 * `loadBalance` em particular ja recusa unidade nao autorizada por conta
 * propria (item 15/78).
 *
 * A UNICA leitura direta de tabela neste arquivo e um `SELECT` simples em
 * `parts` (catalogo, tenant-wide, sem coluna de unidade) usando as MESMAS
 * funcoes de normalizacao que o proprio Estoque exporta
 * (`normalizePartNumber`/`partSearchKey`) — nenhuma logica de negocio nova,
 * so correspondencia de texto. Nenhuma porta de aplicacao existente busca
 * pelo catalogo INTEIRO (code/name/brand/partNumber) independente da
 * unidade ativa do usuario ao mesmo tempo — documentado como escolha
 * deliberada em docs/modules/part-search/architecture.md.
 */

export interface InternalCandidateResult {
  id: string;
  partId: string;
  title: string;
  partNumber: string | null;
  brand: string | null;
  dedupeKey: string;
  evidences: CompatibilityEvidence[];
  offers: PartSearchOfferSnapshot[];
}

const MAX_INTERNAL_MATCHES = 20;

/** Peca do catalogo do tenant cujo nome/marca/codigo/referencia bate com a busca. */
async function findMatchingParts(
  tenantId: string,
  query: NormalizedPartSearchQuery,
): Promise<
  Array<{
    id: string;
    code: string;
    name: string;
    brand: string | null;
    partNumber: string | null;
    partNumberNormalized: string | null;
    suggestedPrice: string | null;
  }>
> {
  const key = partSearchKey(query.displayTerm);
  if (key.length === 0) return [];

  const like = `%${key}%`;
  return getDb()
    .select({
      id: parts.id,
      code: parts.code,
      name: parts.name,
      brand: parts.brand,
      partNumber: parts.partNumber,
      partNumberNormalized: parts.partNumberNormalized,
      suggestedPrice: parts.suggestedPrice,
    })
    .from(parts)
    .where(
      and(
        eq(parts.tenantId, tenantId),
        eq(parts.status, 'active'),
        or(
          sql`${parts.nameSearch} LIKE ${like}`,
          sql`${parts.brandSearch} LIKE ${like}`,
          sql`${parts.codeNormalized} LIKE ${like}`,
          sql`${parts.partNumberNormalized} LIKE ${like}`,
        ),
      ),
    )
    .limit(MAX_INTERNAL_MATCHES);
}

export async function searchInternalCandidates(
  context: TenantContext,
  unitId: string,
  query: NormalizedPartSearchQuery,
  partNumberHint: string | null,
): Promise<InternalCandidateResult[]> {
  const matches = await findMatchingParts(context.tenantId, query);
  if (matches.length === 0) return [];

  const now = new Date();
  const hintNormalized = partNumberHint ? normalizePartNumber(partNumberHint) : null;

  const results: InternalCandidateResult[] = [];

  for (const part of matches) {
    const evidences: CompatibilityEvidence[] = [];

    /**
     * SO evidencia se o codigo bate EXATAMENTE (item 114: nunca por
     * coincidencia de nome). Nenhum mapeamento "peca <-> modelo" e inventado
     * aqui — o Estoque nao guarda essa relacao hoje.
     */
    if (
      part.partNumberNormalized &&
      (query.anchors.includes(part.partNumberNormalized.toLowerCase()) ||
        (hintNormalized && hintNormalized === part.partNumberNormalized))
    ) {
      evidences.push({
        source: 'internal_inventory',
        type: 'exact_part_number',
        observedAt: now,
        field: 'partNumber',
        value: part.partNumber,
      });
    }

    const offers: PartSearchOfferSnapshot[] = [];

    const balance = await loadBalance(context, unitId, part.id);
    const onHand = Number(balance.onHand);
    offers.push({
      id: newId(),
      sourceKey: 'internal_stock',
      providerOfferId: null,
      sellerName: null,
      priceCents: part.suggestedPrice ? Money.parse(part.suggestedPrice).toCents() : null,
      currency: part.suggestedPrice ? 'BRL' : null,
      availability: onHand > 0 ? 'in_stock' : 'unavailable',
      leadTimeDays: null,
      freightCents: null,
      totalCostCents: null,
      url: null,
      isHistorical: false,
      observedAt: now,
    });

    const history = await listPriceHistoryForPart(context, part.id, 5);
    for (const row of history) {
      offers.push({
        id: newId(),
        sourceKey: 'purchase_history',
        providerOfferId: row.id,
        sellerName: row.supplierName,
        priceCents: Money.parse(row.unitCost).toCents(),
        currency: 'BRL',
        availability: 'unknown',
        leadTimeDays: row.observedLeadTimeDays,
        freightCents: null,
        totalCostCents: null,
        url: null,
        isHistorical: true,
        observedAt: row.occurredAt,
      });
    }

    results.push({
      id: newId(),
      partId: part.id,
      title: part.name,
      partNumber: part.partNumber,
      brand: part.brand,
      dedupeKey: `internal:${part.id}`,
      evidences,
      offers,
    });
  }

  return results;
}

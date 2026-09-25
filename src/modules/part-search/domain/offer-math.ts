/**
 * Custo total de um Offer (item 49/183): SO existe quando preco E frete sao
 * AMBOS conhecidos. Frete desconhecido nunca vira "gratis" nem "zero" —
 * gratuito so quando a fonte informou EXPLICITAMENTE (item 184), e nesse
 * caso o chamador ja passa `freightCents = 0n`, nao `null`.
 */
export function computeTotalCostCents(
  priceCents: bigint | null,
  freightCents: bigint | null,
): bigint | null {
  if (priceCents === null || freightCents === null) return null;
  return priceCents + freightCents;
}

/**
 * A PORTA DE SAIDA DA BUSCA EXTERNA (Prompt 21, itens 17 a 23, 164).
 *
 * `PartSearchProvider` != `AiProvider` (item 10, deliberado): esta porta
 * representa uma FONTE DE CATALOGO/MARKETPLACE estruturada — nunca um
 * modelo de linguagem. O dominio e a UI nunca veem vendor nenhum; a
 * selecao acontece so em `infrastructure/provider-registry.ts`, do lado do
 * servidor (item 18 — nenhuma chave/bearer alcanca o navegador).
 *
 * CONTRATO ESTRUTURADO (item 17 e 164): o provedor devolve CAMPOS, nunca
 * texto livre para o sistema "adivinhar". `PartSearchProviderResultItem` e
 * exatamente o que o item 164 pede — nada mais, nada de HTML, nada de
 * "descricao completa da pagina".
 */

export interface PartSearchProviderQuery {
  /** Termo normalizado (`NormalizedPartSearchQuery.displayTerm`). */
  term: string;
  partNumberHint: string | null;
  equipmentKind: string | null;
  equipmentBrand: string | null;
  equipmentModel: string | null;
}

export interface PartSearchProviderPrice {
  /** String decimal (`"129.90"`) — o CHAMADOR converte via `Money.parse`, nunca aqui. */
  amount: string;
  currency: 'BRL';
}

export type PartSearchProviderAvailability = 'available' | 'unavailable' | 'unknown';

/**
 * Sinal de compatibilidade que a FONTE declarou — nunca inferido pelo
 * sistema. `exactFit`/`incompatible` viram, respectivamente, evidencia
 * `provider_exact_fit_signal`/`explicit_incompatibility` (item 36).
 */
export interface PartSearchProviderCompatibilitySignal {
  exactFit: boolean;
  incompatible: boolean;
  note: string | null;
}

export interface PartSearchProviderResultItem {
  providerResultId: string;
  title: string;
  partNumber: string | null;
  manufacturer: string | null;
  sourceName: string;
  price: PartSearchProviderPrice | null;
  availability: PartSearchProviderAvailability | null;
  leadTimeDays: number | null;
  /** http(s) apenas — validado de novo no chamador, nunca confiado cru (item 33). */
  url: string | null;
  compatibilityData: PartSearchProviderCompatibilitySignal | null;
  observedAt: Date;
}

export type PartSearchProviderResult =
  | { outcome: 'ok'; items: readonly PartSearchProviderResultItem[] }
  | {
      outcome: 'error';
      kind: 'timeout' | 'provider_error' | 'invalid_response';
      /** Detalhe TECNICO para log sanitizado — nunca repassado ao usuario cru. */
      detail: string | null;
    };

export interface PartSearchProvider {
  /** Nome curto e estavel — vai para `part_search_offers.source_key` e `provider_calls`. */
  readonly name: string;

  /**
   * Busca. CONTRATO: falha e RESULTADO (`outcome: 'error'`), nao excecao —
   * timeout, payload invalido, tudo volta traduzido para o vocabulario do
   * dominio. Uma excecao que escape daqui e defeito do adaptador.
   */
  search(
    query: PartSearchProviderQuery,
    options: { timeoutMs: number },
  ): Promise<PartSearchProviderResult>;
}

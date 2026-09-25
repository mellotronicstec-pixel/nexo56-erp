/**
 * VOCABULARIO CENTRAL DA BUSCA DE PECAS (Prompt 21).
 *
 * Um unico arquivo de tipos para quebrar o ciclo entre `compatibility.ts`
 * (que classifica um Candidate a partir de evidencias) e `ranking.ts` (que
 * ordena Candidates + Offers) — os dois precisam do MESMO vocabulario, sem
 * um importar do outro.
 *
 * SEPARACAO CONCEITUAL QUE ESTE ARQUIVO EXISTE PARA PROTEGER (item 8 do
 * prompt): Candidate != Offer != Inventory Item. Um Candidate e a
 * IDENTIDADE TECNICA observada numa busca (o que e a peca, e o quanto ela
 * parece compativel); um Offer e UMA CONDICAO COMERCIAL de UMA fonte, num
 * instante (`observedAt`) — preco, disponibilidade, prazo, URL. O mesmo
 * Candidate pode ter varios Offers (estoque interno, historico de compra,
 * fontes externas). Nenhum dos dois e a linha de `parts` do Estoque
 * (Prompt 10) — essa e a unica fonte de verdade do catalogo interno, e a
 * Busca de Pecas so LE `parts`/`stock_balances`/`purchase_price_history`
 * pelas portas de aplicacao ja existentes (nunca escreve, nunca duplica).
 */

/** As CINCO etiquetas oficiais — nenhuma outra existe (item 34, exato). */
export const COMPATIBILITY_LABELS = [
  'confirmada',
  'alta_probabilidade',
  'provavel',
  'nao_verificada',
  'incompativel',
] as const;
export type CompatibilityLabel = (typeof COMPATIBILITY_LABELS)[number];

/** Rotulo em pt-BR para exibicao — nunca inventar um sexto rotulo (item 35). */
export const COMPATIBILITY_LABEL_TEXT: Record<CompatibilityLabel, string> = {
  confirmada: 'Confirmada',
  alta_probabilidade: 'Alta Probabilidade',
  provavel: 'Provável',
  nao_verificada: 'Não Verificada',
  incompativel: 'Incompatível',
};

/**
 * Categorias de evidencia (item 36) — so as que este prompt realmente
 * produz, justificadas por uma fonte de codigo real:
 *
 * - `exact_part_number`      : o part number do candidate bate, caractere a
 *                               caractere (normalizado), com o codigo que o
 *                               usuario informou OU com o da OS.
 * - `exact_equipment_model`  : o candidate declara compatibilidade com o
 *                               MODELO exato do equipamento da OS.
 * - `manufacturer_part_mapping`: mapeamento do FABRICANTE (nao de um
 *                               vendedor/marketplace) entre part number e
 *                               modelo — fonte estruturada, nao alegacao.
 * - `internal_verified_mapping`: mapeamento ja confirmado dentro do proprio
 *                               Nexo56 (ex.: peca com o mesmo part number ja
 *                               usada em OS anteriores do MESMO modelo de
 *                               equipamento, com resultado registrado) —
 *                               NUNCA por coincidencia de nome (item 114).
 * - `provider_exact_fit_signal`: a fonte externa (marketplace) DECLAROU
 *                               "serve para este modelo" — e um SINAL, nao
 *                               prova (item 113): sozinho nunca confirma.
 * - `title_description_mention`: o titulo/descricao do resultado MENCIONA o
 *                               modelo ou termo buscado — o sinal mais fraco.
 * - `explicit_incompatibility`: a fonte declarou explicitamente que a peca
 *                               NAO serve para este modelo/especificacao —
 *                               veto sobre qualquer outra evidencia.
 * - `ai_inference`            : leitura da Nexo56 AI sobre o texto — nunca
 *                               por si so leva a "Confirmada" (item 39/175).
 */
export const COMPATIBILITY_EVIDENCE_TYPES = [
  'exact_part_number',
  'exact_equipment_model',
  'manufacturer_part_mapping',
  'internal_verified_mapping',
  'provider_exact_fit_signal',
  'title_description_mention',
  'explicit_incompatibility',
  'ai_inference',
] as const;
export type CompatibilityEvidenceType = (typeof COMPATIBILITY_EVIDENCE_TYPES)[number];

/**
 * Proveniencia obrigatoria de cada evidencia (item 37): de onde veio, que
 * tipo e, quando foi observada, e o campo/valor relevante quando aplicavel.
 */
export interface CompatibilityEvidence {
  /** Fonte real: 'internal_inventory' | 'purchase_history' | provider.name | 'ai'. */
  source: string;
  type: CompatibilityEvidenceType;
  observedAt: Date;
  field?: string | null;
  value?: string | null;
}

export const PART_SEARCH_AVAILABILITY_VALUES = [
  'in_stock',
  'available',
  'unavailable',
  'unknown',
] as const;
export type PartSearchAvailability = (typeof PART_SEARCH_AVAILABILITY_VALUES)[number];

export const PART_SEARCH_SOURCE_TYPES = [
  'internal_inventory',
  'purchase_history',
  'external',
] as const;
export type PartSearchSourceType = (typeof PART_SEARCH_SOURCE_TYPES)[number];

/**
 * Snapshot de uma condicao comercial, de UMA fonte, num instante
 * (`observedAt`). Preco EXTERNO e sempre temporal (item 14/50): nunca
 * reescrito, sempre uma nova observacao (item 53).
 */
export interface PartSearchOfferSnapshot {
  id: string;
  /** 'internal_stock' | 'purchase_history' | nome do PartSearchProvider. */
  sourceKey: string;
  providerOfferId: string | null;
  sellerName: string | null;
  /** Centavos + moeda via Money — nunca float (item 108). `null` = nao informado. */
  priceCents: bigint | null;
  currency: 'BRL' | null;
  availability: PartSearchAvailability;
  leadTimeDays: number | null;
  freightCents: bigint | null;
  /** So existe quando preco E frete sao AMBOS conhecidos (item 49/183). */
  totalCostCents: bigint | null;
  /** http(s) apenas, ja validada — nunca `javascript:`/`data:` (item 33). */
  url: string | null;
  /** true = preco/condicao HISTORICA (compra passada), nunca "disponivel agora" (item 58). */
  isHistorical: boolean;
  observedAt: Date;
}

/** Identidade tecnica observada numa busca — nunca um Inventory Item (item 8). */
export interface PartSearchCandidateForAssessment {
  id: string;
  sourceType: PartSearchSourceType;
  title: string;
  partNumber: string | null;
  brand: string | null;
  evidences: readonly CompatibilityEvidence[];
  offers: readonly PartSearchOfferSnapshot[];
}

/** Contexto tecnico minimo do equipamento — nunca PII de cliente (item 26). */
export interface PartSearchEquipmentContext {
  kind: string | null;
  brand: string | null;
  model: string | null;
}

import { Money, sumMoney } from '@/core/money/money';
import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';

/**
 * Dominio do Orcamento (Prompt 09).
 *
 * ESTE ARQUIVO E A AUTORIDADE sobre o que um orcamento pode ser e para onde
 * pode ir. Assim como o workflow da OS (Prompt 08), nenhuma pagina, action ou
 * repositorio decide: todos perguntam aqui.
 *
 * A FRONTEIRA QUE ESTE MODULO EXISTE PARA PRESERVAR
 *
 *   Orcamento decide VALORES e a DECISAO COMERCIAL do cliente.
 *   O workflow decide o ESTADO DA OS.
 *   Estoque nao existe ainda.
 *
 * O estado do orcamento e o estado da OS sao coisas diferentes, de propósito
 * (item 16): um orcamento pode estar Enviado enquanto a OS esta Aguardando
 * Aprovacao, e essa nao e uma duplicacao — sao dois fatos distintos sobre duas
 * entidades distintas. Uma OS pode ate ter orcamento nenhum.
 */

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

export const QUOTE_STATUSES = [
  'draft',
  'sent',
  'approved',
  'rejected',
  'expired',
  'superseded',
  'cancelled',
] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_INITIAL_STATUS: QuoteStatus = 'draft';

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'Rascunho',
  sent: 'Enviado',
  approved: 'Aprovado',
  rejected: 'Recusado',
  expired: 'Expirado',
  superseded: 'Substituido',
  cancelled: 'Cancelado',
};

export const QUOTE_STATUS_TONE: Record<
  QuoteStatus,
  'neutral' | 'brand' | 'success' | 'warning' | 'danger'
> = {
  draft: 'neutral',
  sent: 'brand',
  approved: 'success',
  rejected: 'danger',
  expired: 'warning',
  superseded: 'neutral',
  cancelled: 'neutral',
};

/**
 * Estados em que o orcamento ainda e a proposta VIVA da Ordem de Servico.
 *
 * Uma OS tem no maximo UM orcamento ativo por vez (item 65). Quem responde
 * "qual e o orcamento vigente?" e esta lista — nao o maior id, que mudaria de
 * resposta ao renumerar ou importar dados.
 */
export const QUOTE_ACTIVE_STATUSES: readonly QuoteStatus[] = ['draft', 'sent'];

/** De onde nao se sai. */
export const QUOTE_TERMINAL_STATUSES: readonly QuoteStatus[] = [
  'approved',
  'rejected',
  'expired',
  'superseded',
  'cancelled',
];

export function isKnownQuoteStatus(status: string): status is QuoteStatus {
  return (QUOTE_STATUSES as readonly string[]).includes(status);
}

export function isQuoteActive(status: string): boolean {
  return (QUOTE_ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isQuoteTerminal(status: string): boolean {
  return (QUOTE_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function quoteStatusLabel(status: string): string {
  return isKnownQuoteStatus(status) ? QUOTE_STATUS_LABEL[status] : status;
}

export function quoteStatusTone(
  status: string,
): 'neutral' | 'brand' | 'success' | 'warning' | 'danger' {
  return isKnownQuoteStatus(status) ? QUOTE_STATUS_TONE[status] : 'neutral';
}

/**
 * Um orcamento so aceita edicao de valores enquanto e RASCUNHO (itens 27 e 28).
 *
 * Depois de enviado, o cliente ja viu aqueles numeros; depois de aprovado, ele
 * decidiu com base neles. Mudar qualquer um dos dois no lugar apagaria a
 * proposta que existiu — e e exatamente o que uma revisao serve para evitar.
 */
export function isQuoteEditable(status: string): boolean {
  return status === 'draft';
}

// ---------------------------------------------------------------------------
// Transicoes do orcamento
// ---------------------------------------------------------------------------

export interface QuoteTransitionRule {
  from: QuoteStatus;
  to: QuoteStatus;
  label: string;
  permission: PermissionKey;
  requiresReason?: boolean;
  hint?: string;
}

/**
 * A MATRIZ. Tudo que nao esta aqui e proibido.
 *
 * `superseded` nao aparece como destino: ele nao e uma decisao de ninguem, e
 * sim a consequencia automatica de uma revisao nascer. Quem o produz e
 * `reviseQuote`, e por isso ele nao e oferecido como botao.
 */
export const QUOTE_TRANSITIONS: readonly QuoteTransitionRule[] = [
  {
    from: 'draft',
    to: 'sent',
    label: 'Enviar orcamento',
    permission: PERMISSIONS.QUOTES_SEND,
    hint: 'Formaliza a proposta e leva a Ordem de Servico para Aguardando Aprovacao.',
  },
  {
    from: 'draft',
    to: 'cancelled',
    label: 'Descartar rascunho',
    permission: PERMISSIONS.QUOTES_CANCEL,
    hint: 'O rascunho deixa de valer. A Ordem de Servico nao muda de situacao.',
  },
  {
    from: 'sent',
    to: 'approved',
    label: 'Registrar aprovacao',
    permission: PERMISSIONS.QUOTES_APPROVE,
    hint: 'O cliente aprovou. A Ordem de Servico segue para Aguardando Conserto.',
  },
  {
    from: 'sent',
    to: 'rejected',
    label: 'Registrar recusa',
    permission: PERMISSIONS.QUOTES_REJECT,
    requiresReason: true,
    hint: 'O cliente recusou. A Ordem de Servico NAO e cancelada automaticamente.',
  },
  {
    from: 'sent',
    to: 'cancelled',
    label: 'Cancelar orcamento',
    permission: PERMISSIONS.QUOTES_CANCEL,
    requiresReason: true,
    hint: 'A proposta e retirada antes de o cliente decidir.',
  },
  {
    /**
     * So o job de expiracao produz isto (item 23). Fica na matriz porque E uma
     * transicao de verdade e precisa das mesmas travas; a interface nao a
     * oferece porque ninguem "expira" um orcamento a mao — o prazo e que vence.
     */
    from: 'sent',
    to: 'expired',
    label: 'Marcar como expirado',
    permission: PERMISSIONS.QUOTES_SEND,
    hint: 'A validade venceu.',
  },
];

/** Transicoes que a interface oferece como botao. */
export const QUOTE_MANUAL_DESTINATIONS: readonly QuoteStatus[] = [
  'sent',
  'approved',
  'rejected',
  'cancelled',
];

export function quoteTransitionsFrom(status: string): QuoteTransitionRule[] {
  if (!isKnownQuoteStatus(status)) return [];
  return QUOTE_TRANSITIONS.filter((rule) => rule.from === status);
}

export function manualQuoteTransitionsFrom(status: string): QuoteTransitionRule[] {
  return quoteTransitionsFrom(status).filter((rule) =>
    (QUOTE_MANUAL_DESTINATIONS as readonly string[]).includes(rule.to),
  );
}

export function findQuoteTransition(from: string, to: string): QuoteTransitionRule | null {
  if (!isKnownQuoteStatus(from) || !isKnownQuoteStatus(to)) return null;
  return QUOTE_TRANSITIONS.find((rule) => rule.from === from && rule.to === to) ?? null;
}

/** Motivo pelo qual a mudanca NAO e possivel, em portugues. */
export function explainQuoteRefusal(from: string, to: string): string {
  if (!isKnownQuoteStatus(from)) return 'A situacao atual deste orcamento nao e reconhecida.';
  if (!isKnownQuoteStatus(to)) return 'Situacao de destino desconhecida.';
  if (from === to) return 'O orcamento ja esta nesta situacao.';
  if (isQuoteTerminal(from)) {
    return `Este orcamento esta ${QUOTE_STATUS_LABEL[from]} e nao muda mais de situacao.`;
  }
  return `Um orcamento ${QUOTE_STATUS_LABEL[from]} nao pode ir direto para ${QUOTE_STATUS_LABEL[to]}.`;
}

// ---------------------------------------------------------------------------
// Itens
// ---------------------------------------------------------------------------

/**
 * Tipos de linha comercial (itens 30 a 32).
 *
 * `part` E APENAS UMA LINHA DE ORCAMENTO. Nao e item de estoque, nao reserva
 * nada e nao movimenta nada (itens 31, 104 e 105) — o catalogo real de pecas e
 * do Prompt 10. Ate la, a descricao e livre, escrita por quem orca.
 */
export const QUOTE_ITEM_KINDS = ['service', 'part', 'other'] as const;
export type QuoteItemKind = (typeof QUOTE_ITEM_KINDS)[number];

export const QUOTE_ITEM_KIND_LABEL: Record<QuoteItemKind, string> = {
  service: 'Servico',
  part: 'Peca',
  other: 'Outros',
};

export function isKnownItemKind(kind: string): kind is QuoteItemKind {
  return (QUOTE_ITEM_KINDS as readonly string[]).includes(kind);
}

export function itemKindLabel(kind: string): string {
  return isKnownItemKind(kind) ? QUOTE_ITEM_KIND_LABEL[kind] : kind;
}

export const DESCRIPTION_MAX = 200;
export const NOTES_MAX = 2000;
export const REASON_MAX = 300;

/** Teto defensivo: `DECIMAL(14,4)` comporta mais, mas ninguem orca 10 mil unidades. */
export const QUANTITY_MAX = 9999;
/** `DECIMAL(14,2)` comporta 12 digitos inteiros; o teto comercial e bem menor. */
export const UNIT_PRICE_MAX_CENTS = 99_999_999_99n;

// ---------------------------------------------------------------------------
// Calculo
// ---------------------------------------------------------------------------

export interface QuoteItemInput {
  kind: QuoteItemKind;
  description: string;
  /** Decimal em string, para nao reintroduzir float. Ex.: `"1"`, `"2.5"`. */
  quantity: string;
  /** Decimal em string, ex.: `"149.90"`. */
  unitPrice: string;
  /** Desconto da LINHA, em valor. String decimal; `"0"` quando nao ha. */
  discount?: string;
}

export interface QuoteItemTotals {
  /** quantidade x valor unitario, arredondado uma vez. */
  gross: Money;
  discount: Money;
  /** gross - discount. */
  total: Money;
}

export interface QuoteTotals {
  /** Soma dos totais de linha (ja com o desconto de cada linha). */
  subtotal: Money;
  /** Desconto aplicado sobre o subtotal. */
  discount: Money;
  /** subtotal - desconto global. */
  total: Money;
}

const QUANTITY_PATTERN = /^\d+(\.\d{1,4})?$/;

/**
 * Normaliza uma quantidade para string decimal segura.
 *
 * Rejeita negativo e zero: uma linha de orcamento com quantidade zero nao e
 * cortesia, e linha esquecida. Cortesia se expressa com VALOR zero (item 43).
 */
export function normalizeQuantity(raw: string): string {
  const value = raw.trim().replace(',', '.');
  if (!QUANTITY_PATTERN.test(value)) {
    throw new RangeError('Informe uma quantidade valida, maior que zero.');
  }
  if (Number(value) <= 0) {
    throw new RangeError('A quantidade precisa ser maior que zero.');
  }
  if (Number(value) > QUANTITY_MAX) {
    throw new RangeError(`A quantidade maxima por linha e ${QUANTITY_MAX}.`);
  }
  return value;
}

/**
 * Total de UMA linha.
 *
 * O ARREDONDAMENTO ACONTECE UMA VEZ SO, no produto (`Money.multiply` aplica
 * half-up). Arredondar a cada etapa faria 3 x R$ 0,335 virar R$ 1,02 em vez de
 * R$ 1,01 — um centavo por linha que, no fechamento do mes, ninguem consegue
 * explicar.
 */
export function calculateItemTotals(item: QuoteItemInput): QuoteItemTotals {
  const quantity = normalizeQuantity(item.quantity);
  const unitPrice = Money.parse(item.unitPrice.trim());

  if (unitPrice.isNegative()) {
    throw new RangeError('O valor unitario nao pode ser negativo.');
  }
  if (unitPrice.toCents() > UNIT_PRICE_MAX_CENTS) {
    throw new RangeError('O valor unitario excede o limite permitido.');
  }

  const gross = unitPrice.multiply(quantity);
  const discount = Money.parse((item.discount ?? '0').trim());

  if (discount.isNegative()) {
    throw new RangeError('O desconto nao pode ser negativo.');
  }
  if (discount.compare(gross) > 0) {
    throw new RangeError('O desconto da linha nao pode ser maior que o valor dela.');
  }

  return { gross, discount, total: gross.subtract(discount) };
}

/**
 * Totais do orcamento.
 *
 * O BACKEND E A AUTORIDADE (itens 36 e 40). O navegador pode mostrar um
 * previa; o que vale e o que esta funcao devolve, recalculado a cada gravacao
 * a partir das linhas persistidas. Total enviado pelo formulario e ignorado.
 */
export function calculateQuoteTotals(
  items: readonly QuoteItemInput[],
  globalDiscount = '0',
): QuoteTotals {
  const subtotal = sumMoney(items.map((item) => calculateItemTotals(item).total));
  const discount = Money.parse(globalDiscount.trim());

  if (discount.isNegative()) {
    throw new RangeError('O desconto nao pode ser negativo.');
  }
  if (discount.compare(subtotal) > 0) {
    throw new RangeError('O desconto nao pode ser maior que o subtotal do orcamento.');
  }

  return { subtotal, discount, total: subtotal.subtract(discount) };
}

/**
 * Um orcamento so pode ser ENVIADO se tiver o que propor (item 18).
 *
 * Enviar uma proposta vazia ao cliente nao e um caso de uso: e um engano de
 * quem clicou antes de terminar.
 */
export function assertSendable(items: readonly unknown[]): void {
  if (items.length === 0) {
    throw new RangeError('Inclua ao menos um item antes de enviar o orcamento.');
  }
}

// ---------------------------------------------------------------------------
// Numeracao
// ---------------------------------------------------------------------------

export const QUOTE_NUMBER_PREFIX = 'ORC';
export const QUOTE_NUMBER_PADDING = 6;

/**
 * Numero humano do orcamento (itens 10 e 14).
 *
 * O banco guarda so o inteiro; prefixo e zeros a esquerda sao apresentacao,
 * exatamente como na OS. A REVISAO entra no rotulo porque o cliente precisa
 * saber que o "orcamento 12" que ele tem na mao nao e mais o vigente.
 */
export function formatQuoteNumber(
  value: number,
  revision = 1,
  prefix: string = QUOTE_NUMBER_PREFIX,
  padding: number = QUOTE_NUMBER_PADDING,
): string {
  const digits = String(value).padStart(padding, '0');
  const base = prefix ? `${prefix} #${digits}` : `#${digits}`;
  return revision > 1 ? `${base} rev. ${revision}` : base;
}

export function parseQuoteNumber(raw: string): number | null {
  const digits = raw
    .trim()
    .replace(/^[a-zA-Z]+/, '')
    .replace(/[#\s.]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isInteger(value) && value > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Origem da aprovacao (item 51)
// ---------------------------------------------------------------------------

/**
 * De onde veio a decisao do cliente.
 *
 * HOJE SO EXISTE `internal`: alguem da equipe falou com o cliente e registrou.
 * Nao ha Portal (Prompt 17) nem canal externo (Prompt 16), e declarar uma
 * origem que nao existe faria a trilha mentir sobre como a decisao chegou.
 *
 * A coluna e `varchar` justamente para receber `customer_portal` e
 * `external_confirmation` sem migration quando eles existirem de verdade.
 */
export const APPROVAL_SOURCES = { INTERNAL: 'internal' } as const;
export type ApprovalSource = (typeof APPROVAL_SOURCES)[keyof typeof APPROVAL_SOURCES];

export const APPROVAL_SOURCE_LABEL: Record<string, string> = {
  internal: 'Registrado pela equipe',
};

export function approvalSourceLabel(source: string): string {
  return APPROVAL_SOURCE_LABEL[source] ?? source;
}

// ---------------------------------------------------------------------------
// Linha do tempo do orcamento (item 58)
// ---------------------------------------------------------------------------

export const QUOTE_TIMELINE_KINDS = {
  CREATED: 'created',
  ITEMS_UPDATED: 'items_updated',
  DETAILS_UPDATED: 'details_updated',
  SENT: 'sent',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  SUPERSEDED: 'superseded',
  REVISED: 'revised',
} as const;

export type QuoteTimelineKind = (typeof QUOTE_TIMELINE_KINDS)[keyof typeof QUOTE_TIMELINE_KINDS];

export const QUOTE_TIMELINE_LABEL: Record<string, string> = {
  created: 'Orcamento criado',
  items_updated: 'Itens alterados',
  details_updated: 'Dados do orcamento alterados',
  sent: 'Orcamento enviado',
  approved: 'Orcamento aprovado',
  rejected: 'Orcamento recusado',
  expired: 'Orcamento expirado',
  cancelled: 'Orcamento cancelado',
  superseded: 'Substituido por uma revisao',
  revised: 'Revisao criada',
};

export function quoteTimelineLabel(kind: string): string {
  return QUOTE_TIMELINE_LABEL[kind] ?? kind;
}

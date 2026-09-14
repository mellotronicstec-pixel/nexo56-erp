import { Money, sumMoney } from '@/core/money/money';
import { Quantity } from '@/core/quantity/quantity';
import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';

/**
 * Dominio de Fornecedores e Compras (Prompt 11).
 *
 * ESTE ARQUIVO E A AUTORIDADE sobre o que uma compra pode ser e para onde pode
 * ir. Nenhuma pagina, action ou repositorio decide sozinho se um pedido pode
 * ser recebido ou se cabe mais uma unidade no recebimento: todos perguntam
 * aqui.
 *
 * AS ONZE COISAS QUE ESTE MODULO INSISTE EM MANTER SEPARADAS (item 2)
 *
 *   Fornecedor        de quem se compra.      Do TENANT. Nao e o fabricante.
 *   Peca              o que se compra.        Do catalogo (Prompt 10).
 *   Necessidade       o que FALTA.            Da unidade. Nao e um pedido.
 *   Pedido            o que foi COMPRADO.     Da unidade. Nao e estoque.
 *   Item do pedido    quanto e por quanto.    Snapshot comercial.
 *   Recebimento       o que CHEGOU.           Vira entrada de estoque.
 *   Movimentacao      o saldo mudando.        Do Prompt 10, e so dele.
 *   Reserva           peca com dono.          Do Prompt 10. Nunca automatica.
 *   Conta a pagar     a divida.               NAO EXISTE (Prompt 12).
 *   Pagamento         a quitacao.             NAO EXISTE (Prompt 12).
 *   Fabricante        quem produziu.          Campo da peca, nao entidade.
 *
 * AS FRONTEIRAS QUE ESTE MODULO NAO ATRAVESSA
 *
 *   Compras NUNCA escreve `stock_balances` nem `stock_movements` (item 20).
 *   Receber chama a primitiva oficial do Inventory, dentro da mesma transacao.
 *
 *   Compras NUNCA escreve `service_orders.status` (item 60). Peca que chega
 *   nao tira a OS de Aguardando Peca — quem decide isso e quem conserta.
 *
 *   Compras NUNCA reserva peca sozinho (item 61). A chegada da mercadoria
 *   pode OFERECER a reserva; quem reserva e uma pessoa.
 *
 *   Compras NAO cria titulo financeiro (item 42). Publica
 *   `PURCHASE_RECEIPT_CREATED` e para por ai.
 */

// ---------------------------------------------------------------------------
// Fornecedor (itens 4 e 5)
// ---------------------------------------------------------------------------

/**
 * FORNECEDOR NAO E FABRICANTE (item 5).
 *
 *   Fabricante: Samsung            -> campo `brand` da peca
 *   Fornecedor: Distribuidora XYZ  -> esta entidade
 *
 * A mesma peca e comprada de varios fornecedores; o mesmo fornecedor vende
 * pecas de varios fabricantes. Converter `parts.brand` em fornecedor criaria
 * um cadastro de empresas que nunca venderam nada.
 */
export const SUPPLIER_KINDS = ['company', 'individual'] as const;
export type SupplierKind = (typeof SUPPLIER_KINDS)[number];

export const SUPPLIER_KIND_LABEL: Record<SupplierKind, string> = {
  company: 'Pessoa juridica',
  individual: 'Pessoa fisica',
};

export const SUPPLIER_STATUSES = ['active', 'inactive'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

export const SUPPLIER_STATUS_LABEL: Record<SupplierStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
};

export const SUPPLIER_NAME_MAX = 200;
export const SUPPLIER_TRADE_NAME_MAX = 200;
export const SUPPLIER_EMAIL_MAX = 190;
export const SUPPLIER_PHONE_MAX = 40;
export const SUPPLIER_WEBSITE_MAX = 200;
export const SUPPLIER_NOTES_MAX = 2000;
export const SUPPLIER_TERMS_MAX = 400;
export const SUPPLIER_CONTACT_NAME_MAX = 120;
export const SUPPLIER_CODE_MAX = 60;

/**
 * Prazo medio INFORMADO pelo fornecedor, em dias (item 4).
 *
 * E o que ele promete, nao o que entrega. O prazo OBSERVADO sai do historico
 * de precos, comparando a data do pedido com a do recebimento — e por isso os
 * dois nao moram na mesma coluna.
 */
export const SUPPLIER_LEAD_TIME_MAX_DAYS = 365;

export function isKnownSupplierStatus(value: string): value is SupplierStatus {
  return (SUPPLIER_STATUSES as readonly string[]).includes(value);
}

export function supplierStatusLabel(value: string): string {
  return isKnownSupplierStatus(value) ? SUPPLIER_STATUS_LABEL[value] : value;
}

/**
 * O DOCUMENTO E OPCIONAL, e isso e uma regra de negocio (item 4).
 *
 * Assistencia tecnica compra parafuso e cabo de fornecedor informal, na loja
 * da esquina, sem nota. Exigir CNPJ recusaria o cadastro de quem realmente
 * fornece — e o sistema passaria a ser contornado com "Fornecedor Diversos".
 *
 * Quando informado, e validado e unico DENTRO DO TENANT. Nunca entre tenants:
 * duas empresas compram do mesmo distribuidor, e cada uma tem o proprio
 * cadastro dele.
 */
export const SUPPLIER_DOCUMENT_REQUIRED = false;

/** Nome exibido: fantasia quando houver, razao social como base. */
export function supplierDisplayName(supplier: { name: string; tradeName: string | null }): string {
  return supplier.tradeName?.trim() || supplier.name;
}

// ---------------------------------------------------------------------------
// Necessidade de compra (itens 8, 9 e 30)
// ---------------------------------------------------------------------------

/**
 * NECESSIDADE NAO E PEDIDO (item 10; ADR-048).
 *
 *   Necessidade: "faltam 5 capacitores na Unidade Centro."
 *   Pedido:      "comprei 10 capacitores da Eletronica ABC por R$ 12,50."
 *
 * Colapsar os dois faria toda falta de estoque virar compra — e uma falta pode
 * ser resolvida por transferencia entre unidades, por uma peca que ja estava
 * reservada e foi liberada, ou simplesmente esperando.
 */
export const NEED_ORIGINS = ['manual', 'service_order', 'low_stock'] as const;
export type NeedOrigin = (typeof NEED_ORIGINS)[number];

export const NEED_ORIGIN_LABEL: Record<NeedOrigin, string> = {
  manual: 'Registrada manualmente',
  service_order: 'Ordem de Servico',
  low_stock: 'Estoque abaixo do minimo',
};

export const NEED_STATUSES = ['open', 'ordered', 'fulfilled', 'cancelled'] as const;
export type NeedStatus = (typeof NEED_STATUSES)[number];

export const NEED_STATUS_LABEL: Record<NeedStatus, string> = {
  open: 'Em aberto',
  ordered: 'Pedido feito',
  fulfilled: 'Atendida',
  cancelled: 'Cancelada',
};

export const NEED_STATUS_TONE: Record<NeedStatus, 'neutral' | 'brand' | 'success' | 'warning'> = {
  open: 'warning',
  ordered: 'brand',
  fulfilled: 'success',
  cancelled: 'neutral',
};

export const NEED_JUSTIFICATION_MAX = 400;

export function isKnownNeedStatus(value: string): value is NeedStatus {
  return (NEED_STATUSES as readonly string[]).includes(value);
}

export function needStatusLabel(value: string): string {
  return isKnownNeedStatus(value) ? NEED_STATUS_LABEL[value] : value;
}

export function needOriginLabel(value: string): string {
  return (NEED_ORIGIN_LABEL as Record<string, string>)[value] ?? value;
}

export interface NeedSnapshot {
  quantity: Quantity;
  orderedQuantity: Quantity;
  receivedQuantity: Quantity;
  status: string;
}

/** Quanto ainda nao entrou em nenhum pedido. */
export function needPendingToOrder(need: NeedSnapshot): Quantity {
  const pending = need.quantity.subtract(need.orderedQuantity);
  return pending.isNegative() ? Quantity.zero() : pending;
}

/** Quanto ainda nao chegou. */
export function needPendingToReceive(need: NeedSnapshot): Quantity {
  const pending = need.quantity.subtract(need.receivedQuantity);
  return pending.isNegative() ? Quantity.zero() : pending;
}

/**
 * A SITUACAO DA NECESSIDADE DERIVA DO QUE CHEGOU, nao do que foi pedido
 * (item 30).
 *
 * Marcar "atendida" ao criar o pedido seria mentir para quem confere: o pedido
 * pode atrasar, chegar pela metade, ou ser cancelado. Enquanto a mercadoria nao
 * entrou no estoque, a necessidade continua existindo.
 */
export function nextNeedStatus(need: NeedSnapshot): NeedStatus {
  if (need.status === 'cancelled') return 'cancelled';
  if (need.receivedQuantity.compare(need.quantity) >= 0) return 'fulfilled';
  if (need.orderedQuantity.isPositive()) return 'ordered';
  return 'open';
}

// ---------------------------------------------------------------------------
// Estados do pedido (itens 16 e 17)
// ---------------------------------------------------------------------------

export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'approved',
  'placed',
  'partially_received',
  'received',
  'cancelled',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_INITIAL_STATUS: PurchaseOrderStatus = 'draft';

export const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: 'Rascunho',
  approved: 'Aprovado',
  placed: 'Pedido realizado',
  partially_received: 'Parcialmente recebido',
  received: 'Recebido',
  cancelled: 'Cancelado',
};

export const PURCHASE_ORDER_STATUS_TONE: Record<
  PurchaseOrderStatus,
  'neutral' | 'brand' | 'success' | 'warning' | 'danger'
> = {
  draft: 'neutral',
  approved: 'brand',
  placed: 'brand',
  partially_received: 'warning',
  received: 'success',
  cancelled: 'neutral',
};

/** De onde nao se sai. */
export const PURCHASE_ORDER_TERMINAL_STATUSES: readonly PurchaseOrderStatus[] = [
  'received',
  'cancelled',
];

/** Situacoes em que o pedido ainda aceita recebimento. */
export const PURCHASE_ORDER_RECEIVABLE_STATUSES: readonly PurchaseOrderStatus[] = [
  'placed',
  'partially_received',
];

/** Situacoes em que os itens e valores ainda podem ser alterados. */
export function isPurchaseOrderEditable(status: string): boolean {
  return status === 'draft';
}

export function isKnownPurchaseOrderStatus(value: string): value is PurchaseOrderStatus {
  return (PURCHASE_ORDER_STATUSES as readonly string[]).includes(value);
}

export function purchaseOrderStatusLabel(value: string): string {
  return isKnownPurchaseOrderStatus(value) ? PURCHASE_ORDER_STATUS_LABEL[value] : value;
}

export function purchaseOrderStatusTone(
  value: string,
): 'neutral' | 'brand' | 'success' | 'warning' | 'danger' {
  return isKnownPurchaseOrderStatus(value) ? PURCHASE_ORDER_STATUS_TONE[value] : 'neutral';
}

export function isPurchaseOrderTerminal(status: string): boolean {
  return (PURCHASE_ORDER_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isPurchaseOrderReceivable(status: string): boolean {
  return (PURCHASE_ORDER_RECEIVABLE_STATUSES as readonly string[]).includes(status);
}

export interface PurchaseOrderTransitionRule {
  from: PurchaseOrderStatus;
  to: PurchaseOrderStatus;
  label: string;
  permission: PermissionKey;
  requiresReason?: boolean;
  hint?: string;
}

/**
 * A MATRIZ. Tudo que nao esta aqui e proibido.
 *
 * `partially_received` e `received` NAO aparecem como destino manual: nao sao
 * decisao de ninguem, sao a CONSEQUENCIA aritmetica do que chegou. Quem os
 * produz e o recebimento, comparando pedido com recebido — e por isso nao ha
 * botao "marcar como recebido" que contrarie o que entrou no estoque.
 *
 * `approved` existe porque quem monta o pedido nao e, necessariamente, quem
 * autoriza a despesa (item 17). Numa assistencia pequena a mesma pessoa tem as
 * duas permissoes e passa pelos dois passos em dois cliques; numa maior, o
 * corte e real.
 */
export const PURCHASE_ORDER_TRANSITIONS: readonly PurchaseOrderTransitionRule[] = [
  {
    from: 'draft',
    to: 'approved',
    label: 'Aprovar compra',
    permission: PERMISSIONS.PURCHASES_APPROVE,
    hint: 'Autoriza a despesa. Os itens e valores ficam congelados a partir daqui.',
  },
  {
    from: 'approved',
    to: 'placed',
    label: 'Registrar pedido realizado',
    permission: PERMISSIONS.PURCHASES_APPROVE,
    hint: 'Voce confirma que o pedido foi feito ao fornecedor. O Nexo56 nao envia nada.',
  },
  {
    from: 'draft',
    to: 'cancelled',
    label: 'Descartar rascunho',
    permission: PERMISSIONS.PURCHASES_CANCEL,
    hint: 'O rascunho deixa de valer. Nenhuma necessidade e alterada.',
  },
  {
    from: 'approved',
    to: 'cancelled',
    label: 'Cancelar compra',
    permission: PERMISSIONS.PURCHASES_CANCEL,
    requiresReason: true,
  },
  {
    from: 'placed',
    to: 'cancelled',
    label: 'Cancelar pedido',
    permission: PERMISSIONS.PURCHASES_CANCEL,
    requiresReason: true,
    hint: 'O pedido deixa de esperar entrega.',
  },
  {
    from: 'partially_received',
    to: 'cancelled',
    label: 'Cancelar o que falta',
    permission: PERMISSIONS.PURCHASES_CANCEL,
    requiresReason: true,
    hint: 'O que ja chegou permanece no estoque. So o saldo pendente e cancelado.',
  },
];

/** Transicoes que a interface oferece como botao. */
export function purchaseOrderTransitionsFrom(status: string): PurchaseOrderTransitionRule[] {
  if (!isKnownPurchaseOrderStatus(status)) return [];
  return PURCHASE_ORDER_TRANSITIONS.filter((rule) => rule.from === status);
}

export function findPurchaseOrderTransition(
  from: string,
  to: string,
): PurchaseOrderTransitionRule | null {
  if (!isKnownPurchaseOrderStatus(from) || !isKnownPurchaseOrderStatus(to)) return null;
  return PURCHASE_ORDER_TRANSITIONS.find((rule) => rule.from === from && rule.to === to) ?? null;
}

/** Motivo pelo qual a mudanca NAO e possivel, em portugues. */
export function explainPurchaseOrderRefusal(from: string, to: string): string {
  if (!isKnownPurchaseOrderStatus(from)) return 'A situacao atual deste pedido nao e reconhecida.';
  if (!isKnownPurchaseOrderStatus(to)) return 'Situacao de destino desconhecida.';
  if (from === to) return 'O pedido ja esta nesta situacao.';
  if (isPurchaseOrderTerminal(from)) {
    return `Este pedido esta ${PURCHASE_ORDER_STATUS_LABEL[from]} e nao muda mais de situacao.`;
  }
  if (to === 'received' || to === 'partially_received') {
    return 'A situacao de recebimento e consequencia do que chegou — registre o recebimento.';
  }
  return `Um pedido ${PURCHASE_ORDER_STATUS_LABEL[from]} nao pode ir direto para ${PURCHASE_ORDER_STATUS_LABEL[to]}.`;
}

export const CANCEL_REASON_MAX = 300;
export const CANCEL_REASON_MIN = 5;

export function normalizeCancelReason(raw: string): string {
  const reason = raw.trim().replace(/\s+/g, ' ');
  if (reason.length < CANCEL_REASON_MIN) {
    throw new RangeError('Descreva o motivo do cancelamento.');
  }
  return reason.slice(0, CANCEL_REASON_MAX);
}

// ---------------------------------------------------------------------------
// Itens e valores (itens 13, 14 e 15)
// ---------------------------------------------------------------------------

export const ITEM_DESCRIPTION_MAX = 200;
export const ITEM_NOTES_MAX = 300;
export const ORDER_NOTES_MAX = 2000;
export const DOCUMENT_NUMBER_MAX = 60;

/** Teto defensivo. `DECIMAL(14,4)` comporta mais; ninguem compra 1 milhao. */
export const QUANTITY_MAX = 999_999;
/** `DECIMAL(14,2)` comporta 12 digitos inteiros; o teto comercial e menor. */
export const UNIT_COST_MAX_CENTS = 99_999_999_99n;

export interface PurchaseItemInput {
  /** Decimal em string, para nao reintroduzir float. */
  quantity: string;
  /** Decimal em string, ex.: `"12.50"`. */
  unitCost: string;
}

export interface PurchaseItemTotals {
  quantity: Quantity;
  unitCost: Money;
  /** quantidade x custo unitario, arredondado UMA vez no produto. */
  total: Money;
}

export interface PurchaseOrderTotals {
  /** Soma dos totais de linha. */
  subtotal: Money;
  discount: Money;
  freight: Money;
  otherCosts: Money;
  /** subtotal - desconto + frete + outras despesas. */
  total: Money;
}

/**
 * Total de UMA linha.
 *
 * O ARREDONDAMENTO ACONTECE UMA VEZ SO, no produto — a mesma regra do
 * orcamento (Prompt 09). Arredondar a cada etapa produziria centavos que
 * ninguem consegue explicar no fechamento do mes.
 */
export function calculateItemTotals(item: PurchaseItemInput): PurchaseItemTotals {
  const quantity = parsePurchaseQuantity(item.quantity);
  const unitCost = Money.parse(item.unitCost.trim());

  if (unitCost.isNegative()) {
    throw new RangeError('O custo unitario nao pode ser negativo.');
  }
  if (unitCost.toCents() > UNIT_COST_MAX_CENTS) {
    throw new RangeError('O custo unitario excede o limite permitido.');
  }

  return { quantity, unitCost, total: unitCost.multiply(quantity.toString()) };
}

/**
 * Quantidade de um item de pedido: precisa ser maior que zero.
 *
 * Pedir zero unidades nao e caso de uso — e linha que alguem abriu e nao usou.
 */
export function parsePurchaseQuantity(raw: string, unitOfMeasure?: string): Quantity {
  const value = Quantity.parse(raw.trim().replace(',', '.'));

  if (!value.isPositive()) {
    throw new RangeError('A quantidade precisa ser maior que zero.');
  }
  if (value.compare(Quantity.parse(String(QUANTITY_MAX))) > 0) {
    throw new RangeError(`A quantidade maxima por linha e ${QUANTITY_MAX}.`);
  }
  if (unitOfMeasure && !allowsFraction(unitOfMeasure) && value.hasFraction()) {
    throw new RangeError('Esta unidade de medida nao aceita quantidade fracionada.');
  }

  return value;
}

/**
 * Unidades integrais do catalogo de pecas (Prompt 10, item 15).
 *
 * Duplicada aqui de propósito? NAO: a lista vem do dominio de Estoque, que e a
 * autoridade sobre unidade de medida. Esta funcao apenas a consulta — Compras
 * nao decide o que e fracionavel.
 */
function allowsFraction(unitOfMeasure: string): boolean {
  return !['unit', 'package'].includes(unitOfMeasure);
}

/**
 * Totais do pedido.
 *
 * O BACKEND E A AUTORIDADE (item 15). O navegador mostra uma previa; o que vale
 * e o que esta funcao devolve, recalculado a cada gravacao a partir das linhas
 * persistidas. Total enviado pelo formulario e ignorado.
 *
 * FRETE E DESPESAS SOMAM NO TOTAL DO PEDIDO, e NAO no custo da peca (item 27;
 * ADR-051). Ratear frete no custo unitario e uma politica contabil legitima —
 * e uma decisao que ninguem tomou, e que mudaria silenciosamente o custo medio
 * do estoque.
 */
export function calculatePurchaseOrderTotals(
  items: readonly PurchaseItemInput[],
  extras: { discount?: string; freight?: string; otherCosts?: string } = {},
): PurchaseOrderTotals {
  const subtotal = sumMoney(items.map((item) => calculateItemTotals(item).total));
  const discount = Money.parse((extras.discount ?? '0').trim());
  const freight = Money.parse((extras.freight ?? '0').trim());
  const otherCosts = Money.parse((extras.otherCosts ?? '0').trim());

  for (const [value, name] of [
    [discount, 'desconto'],
    [freight, 'frete'],
    [otherCosts, 'despesa'],
  ] as const) {
    if (value.isNegative()) throw new RangeError(`O ${name} nao pode ser negativo.`);
  }

  if (discount.compare(subtotal) > 0) {
    throw new RangeError('O desconto nao pode ser maior que o subtotal do pedido.');
  }

  return {
    subtotal,
    discount,
    freight,
    otherCosts,
    total: subtotal.subtract(discount).add(freight).add(otherCosts),
  };
}

// ---------------------------------------------------------------------------
// Recebimento (itens 19, 21 e 22)
// ---------------------------------------------------------------------------

export interface OrderItemSnapshot {
  /** Quanto foi pedido. */
  quantity: Quantity;
  /** Quanto ja chegou. */
  receivedQuantity: Quantity;
}

/** Quanto ainda falta chegar desta linha. */
export function itemPendingQuantity(item: OrderItemSnapshot): Quantity {
  const pending = item.quantity.subtract(item.receivedQuantity);
  return pending.isNegative() ? Quantity.zero() : pending;
}

/**
 * NAO SE RECEBE MAIS DO QUE FOI PEDIDO (item 22).
 *
 * A regra e do dominio E do banco: a CHECK `received_quantity <= quantity` em
 * `purchase_order_items` continua valendo no dia em que alguem escrever um
 * segundo caminho de gravacao.
 *
 * Aceitar excesso e uma politica comercial defensavel — fornecedor manda 12
 * quando voce pediu 10 e cobra os 12 — mas e uma DECISAO, e ninguem a tomou.
 * Enquanto isso, o excesso entra por ajuste de estoque, com motivo, que deixa
 * rastro de quem decidiu aceitar.
 */
export function canReceive(item: OrderItemSnapshot, wanted: Quantity): boolean {
  return itemPendingQuantity(item).compare(wanted) >= 0;
}

export function explainOverReceipt(item: OrderItemSnapshot, wanted: Quantity): string {
  return `Faltam ${formatQuantityValue(itemPendingQuantity(item))} desta peca e foram informadas ${formatQuantityValue(wanted)}. Receber acima do pedido nao e permitido.`;
}

/**
 * A SITUACAO DO PEDIDO DERIVA DO QUE CHEGOU (itens 16 e 21).
 *
 * Nao existe botao "marcar como recebido": a situacao e calculada comparando
 * cada linha com o que foi pedido. Um pedido so fica Recebido quando TODAS as
 * linhas fecharam — e enquanto uma nao fechou, ele fica Parcialmente Recebido,
 * que e a informacao que a pessoa precisa para cobrar o fornecedor.
 */
export function nextPurchaseOrderStatus(
  items: readonly OrderItemSnapshot[],
  currentStatus: string,
): PurchaseOrderStatus {
  if (currentStatus === 'cancelled') return 'cancelled';
  if (items.length === 0)
    return isKnownPurchaseOrderStatus(currentStatus) ? currentStatus : 'draft';

  const allComplete = items.every((item) => itemPendingQuantity(item).isZero());
  if (allComplete) return 'received';

  const anyReceived = items.some((item) => item.receivedQuantity.isPositive());
  if (anyReceived) return 'partially_received';

  return isKnownPurchaseOrderStatus(currentStatus) ? currentStatus : 'placed';
}

// ---------------------------------------------------------------------------
// Numeracao (item 12)
// ---------------------------------------------------------------------------

export const PURCHASE_ORDER_NUMBER_PREFIX = 'PC';
export const PURCHASE_ORDER_NUMBER_PADDING = 6;

/**
 * Numero humano do pedido.
 *
 * O banco guarda so o inteiro; prefixo e zeros a esquerda sao apresentacao —
 * exatamente como na OS e no orcamento. A sequencia vem de `tenant_sequences`,
 * tipo `purchase_order`, que ja existia desde o Prompt 02. NUNCA `MAX + 1`.
 */
export function formatPurchaseOrderNumber(
  value: number,
  prefix: string = PURCHASE_ORDER_NUMBER_PREFIX,
  padding: number = PURCHASE_ORDER_NUMBER_PADDING,
): string {
  return `${prefix} ${String(value).padStart(padding, '0')}`;
}

// ---------------------------------------------------------------------------
// Linha do tempo do pedido (item 45)
// ---------------------------------------------------------------------------

export const PURCHASE_TIMELINE_KINDS = {
  CREATED: 'created',
  ITEMS_UPDATED: 'items_updated',
  DETAILS_UPDATED: 'details_updated',
  APPROVED: 'approved',
  PLACED: 'placed',
  PARTIALLY_RECEIVED: 'partially_received',
  RECEIVED: 'received',
  CANCELLED: 'cancelled',
} as const;

export type PurchaseTimelineKind =
  (typeof PURCHASE_TIMELINE_KINDS)[keyof typeof PURCHASE_TIMELINE_KINDS];

export const PURCHASE_TIMELINE_LABEL: Readonly<Record<string, string>> = {
  [PURCHASE_TIMELINE_KINDS.CREATED]: 'Pedido criado',
  [PURCHASE_TIMELINE_KINDS.ITEMS_UPDATED]: 'Itens alterados',
  [PURCHASE_TIMELINE_KINDS.DETAILS_UPDATED]: 'Dados do pedido atualizados',
  [PURCHASE_TIMELINE_KINDS.APPROVED]: 'Compra aprovada',
  [PURCHASE_TIMELINE_KINDS.PLACED]: 'Pedido realizado ao fornecedor',
  [PURCHASE_TIMELINE_KINDS.PARTIALLY_RECEIVED]: 'Recebimento parcial',
  [PURCHASE_TIMELINE_KINDS.RECEIVED]: 'Pedido recebido por completo',
  [PURCHASE_TIMELINE_KINDS.CANCELLED]: 'Pedido cancelado',
};

export function purchaseTimelineLabel(kind: string): string {
  return PURCHASE_TIMELINE_LABEL[kind] ?? kind;
}

// ---------------------------------------------------------------------------
// Apresentacao
// ---------------------------------------------------------------------------

/** `"3.0000"` -> `"3"`; `"2.5000"` -> `"2,5"`. Mesma regra do Estoque. */
export function formatQuantityValue(value: Quantity): string {
  const [whole = '0', fraction = ''] = value.toString().split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole},${trimmed}` : whole;
}

// ---------------------------------------------------------------------------
// Idempotencia (item 55)
// ---------------------------------------------------------------------------

export const IDEMPOTENCY_KEY_MAX = 80;

/**
 * Operacoes que aceitam chave de comando.
 *
 * O RECEBIMENTO E O CASO GRAVE: ele cria saldo de estoque. Um duplo clique que
 * passasse duas vezes inflaria o estoque com mercadoria que chegou uma vez so,
 * e a divergencia so apareceria no proximo inventario.
 */
export const IDEMPOTENT_OPERATIONS = ['create_order', 'receive'] as const;
export type IdempotentOperation = (typeof IDEMPOTENT_OPERATIONS)[number];

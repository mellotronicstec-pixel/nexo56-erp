import { Money, sumMoney } from '@/core/money/money';
import { isOverdue } from '@/core/time/civil-date';
import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';

/**
 * DOMINIO FINANCEIRO (Prompt 12).
 *
 * A autoridade do modulo. Aqui vivem as palavras, os estados, a aritmetica do
 * parcelamento e as regras que decidem o que pode acontecer com um titulo.
 *
 * O EIXO: aprovar um orcamento nao e receber dinheiro, e fazer um pedido de
 * compra nao e pagar. Uma OBRIGACAO e um direito ou um dever; uma LIQUIDACAO e
 * dinheiro que efetivamente mudou de lugar. Sao fatos diferentes, com datas
 * diferentes, e o sistema inteiro depende de nao confundir os dois.
 *
 * ESTE LEDGER NAO E CONTABILIDADE. Ele e operacional: responde "quanto entrou e
 * saiu de cada conta, e por causa de que". Nao ha partidas dobradas, plano de
 * contas contabil, competencia nem DRE — e nada aqui deve ser lido como se
 * houvesse.
 */

// ---------------------------------------------------------------------------
// Direcao do titulo (itens 3 e 8)
// ---------------------------------------------------------------------------

/**
 * A UNICA palavra que decide se dinheiro entra ou sai.
 *
 * `receivable` = o cliente deve a empresa.
 * `payable`    = a empresa deve a terceiro.
 *
 * Na interface em pt-BR: RECEBIMENTO e a entrada do cliente, PAGAMENTO e a
 * saida para fornecedor ou despesa. "Pagamento" nunca e usado para dinheiro
 * entrando — a ambiguidade custaria caro na primeira conferencia de caixa.
 */
export const TITLE_DIRECTIONS = ['receivable', 'payable'] as const;
export type TitleDirection = (typeof TITLE_DIRECTIONS)[number];

export const TITLE_DIRECTION_LABEL: Record<TitleDirection, string> = {
  receivable: 'Conta a receber',
  payable: 'Conta a pagar',
};

/** O verbo da operacao, que a tela usa em botao e em confirmacao. */
export const SETTLEMENT_VERB: Record<TitleDirection, string> = {
  receivable: 'Receber',
  payable: 'Pagar',
};

export const SETTLEMENT_PAST: Record<TitleDirection, string> = {
  receivable: 'Recebido',
  payable: 'Pago',
};

/**
 * O SUBSTANTIVO do ato, que e o que a tela precisa na maior parte dos casos.
 *
 * `SETTLEMENT_VERB` sozinho produzia "Registrar receber" no botao — portugues
 * errado, e do tipo que faz a pessoa reler a tela para ter certeza do que o
 * botao faz. O que se registra e um recebimento, nao um "receber".
 */
export const SETTLEMENT_NOUN: Record<TitleDirection, string> = {
  receivable: 'recebimento',
  payable: 'pagamento',
};

/**
 * Com quem se tem a obrigacao.
 *
 * `other` existe porque despesa real nem sempre tem fornecedor cadastrado: a
 * conta de energia, o motoboy avulso, o aluguel. Obrigar o cadastro faria a
 * pessoa inventar um fornecedor — pior que nao ter.
 */
export const COUNTERPARTY_KINDS = ['customer', 'supplier', 'other'] as const;
export type CounterpartyKind = (typeof COUNTERPARTY_KINDS)[number];

/** A combinacao valida de direcao e contraparte. O banco confere isto tambem. */
export function counterpartyMatchesDirection(
  direction: TitleDirection,
  kind: CounterpartyKind,
): boolean {
  return direction === 'receivable' ? kind === 'customer' : kind === 'supplier' || kind === 'other';
}

// ---------------------------------------------------------------------------
// Situacao do titulo (item 10)
// ---------------------------------------------------------------------------

/**
 * VENCIDO NAO E ESTADO (item 10).
 *
 * `overdue` seria um estado que muda sozinho a cada meia-noite, e manter isso
 * no banco exigiria um job diario reescrevendo milhoes de linhas so para
 * trocar uma palavra. Vencido e uma CLASSIFICACAO derivada: situacao aberta,
 * saldo positivo e vencimento no passado, no fuso da empresa.
 */
export const TITLE_STATUSES = ['open', 'partially_settled', 'settled', 'cancelled'] as const;
export type TitleStatus = (typeof TITLE_STATUSES)[number];

export const TITLE_STATUS_LABEL: Record<TitleStatus, string> = {
  open: 'Em aberto',
  partially_settled: 'Parcial',
  settled: 'Liquidado',
  cancelled: 'Cancelado',
};

/** O rotulo muda com a direcao: "Recebido" e "Pago" nao sao a mesma palavra. */
export function titleStatusLabel(status: string, direction: TitleDirection): string {
  if (status === 'settled') return direction === 'receivable' ? 'Recebido' : 'Pago';
  if (status === 'partially_settled') {
    return direction === 'receivable' ? 'Recebido em parte' : 'Pago em parte';
  }
  return TITLE_STATUS_LABEL[status as TitleStatus] ?? status;
}

export const TITLE_STATUS_TONE: Record<TitleStatus, 'neutral' | 'brand' | 'success' | 'warning'> = {
  open: 'warning',
  partially_settled: 'brand',
  settled: 'success',
  cancelled: 'neutral',
};

export function isKnownTitleStatus(value: string): value is TitleStatus {
  return (TITLE_STATUSES as readonly string[]).includes(value);
}

/** Titulo que ainda aceita liquidacao. */
export function isTitleSettleable(status: string): boolean {
  return status === 'open' || status === 'partially_settled';
}

// ---------------------------------------------------------------------------
// Vencido, derivado (item 10)
// ---------------------------------------------------------------------------

export interface DueSnapshot {
  status: string;
  dueDate: string;
  outstanding: Money;
}

/**
 * Vencido = ainda deve, e o dia ja passou NO FUSO DA EMPRESA.
 *
 * O fuso do navegador nao e autoridade: uma parcela que vence dia 15 vence no
 * dia 15 da loja, nao no dia 15 de quem abriu a tela viajando.
 */
export function isTitleOverdue(snapshot: DueSnapshot, timeZone: string, now = new Date()): boolean {
  if (!isTitleSettleable(snapshot.status)) return false;
  if (!snapshot.outstanding.isPositive()) return false;
  return isOverdue(snapshot.dueDate, timeZone, now);
}

// ---------------------------------------------------------------------------
// Aritmetica do titulo (itens 11 e 12)
// ---------------------------------------------------------------------------

export interface SettleableSnapshot {
  amount: Money;
  settledAmount: Money;
}

/** Quanto ainda falta. Nunca negativo: o excesso e barrado antes de chegar aqui. */
export function outstandingOf(snapshot: SettleableSnapshot): Money {
  const rest = snapshot.amount.subtract(snapshot.settledAmount);
  return rest.isNegative() ? Money.zero() : rest;
}

/**
 * OVER-SETTLEMENT E PROIBIDO (item 12).
 *
 * Titulo de R$ 500 nao recebe R$ 600. O excesso nao vira credito do cliente
 * nem saldo do fornecedor: credito e outra entidade, com outras regras, e
 * inventa-lo aqui criaria dinheiro que ninguem sabe de onde veio.
 */
export function canSettle(snapshot: SettleableSnapshot, wanted: Money): boolean {
  if (!wanted.isPositive()) return false;
  return wanted.compare(outstandingOf(snapshot)) <= 0;
}

export function explainOverSettlement(
  snapshot: SettleableSnapshot,
  wanted: Money,
  direction: TitleDirection,
): string {
  const verbo = direction === 'receivable' ? 'receber' : 'pagar';
  if (!wanted.isPositive()) return `O valor a ${verbo} precisa ser maior que zero.`;
  return (
    `Nao da para ${verbo} ${formatAmountForMessage(wanted)}: ` +
    `faltam apenas ${formatAmountForMessage(outstandingOf(snapshot))}.`
  );
}

/** Formatacao minima para mensagem de erro; a tela usa o formatador do core. */
function formatAmountForMessage(value: Money): string {
  return `R$ ${value.toString().replace('.', ',')}`;
}

/**
 * A situacao SAI DA ARITMETICA, nunca de um botao (item 10).
 *
 * Nao existe "marcar como recebido": recebido e a consequencia de o saldo ter
 * chegado a zero. Cancelado e o unico estado que uma pessoa escolhe.
 */
export function nextTitleStatus(snapshot: SettleableSnapshot, current: string): TitleStatus {
  if (current === 'cancelled') return 'cancelled';
  if (outstandingOf(snapshot).isZero()) return 'settled';
  if (snapshot.settledAmount.isPositive()) return 'partially_settled';
  return 'open';
}

// ---------------------------------------------------------------------------
// Parcelamento (item 9)
// ---------------------------------------------------------------------------

export const INSTALLMENTS_MIN = 1;
export const INSTALLMENTS_MAX = 60;

export interface PlannedInstallment {
  number: number;
  amount: Money;
  dueDate: string;
}

/**
 * DISTRIBUICAO DETERMINISTICA DOS CENTAVOS (item 9).
 *
 * R$ 100 em 3 parcelas nao pode virar R$ 99,99 nem R$ 100,02. A soma das
 * parcelas tem de ser EXATAMENTE o total — e essa e uma invariante, nao uma
 * aproximacao aceitavel.
 *
 * O algoritmo: divisao inteira em centavos, e o resto distribuido de UM centavo
 * por vez nas PRIMEIRAS parcelas. R$ 100 / 3 = 33,34 + 33,33 + 33,33.
 *
 * A sobra vai para o inicio, e nao para o fim, de proposito: quem paga prefere
 * que a parcela diminua ao longo do tempo, e quem cobra prefere receber o
 * centavo a mais primeiro. Nao ha resposta "certa" — ha a resposta ESCOLHIDA,
 * documentada e testada, que e o que impede duas partes do sistema de
 * arredondarem para lados opostos.
 */
export function splitAmountIntoInstallments(total: Money, count: number): Money[] {
  if (!Number.isInteger(count) || count < INSTALLMENTS_MIN || count > INSTALLMENTS_MAX) {
    throw new RangeError(`O numero de parcelas precisa estar entre 1 e ${INSTALLMENTS_MAX}.`);
  }
  if (!total.isPositive()) {
    throw new RangeError('O valor do titulo precisa ser maior que zero.');
  }

  const cents = total.toCents();
  const size = BigInt(count);

  if (cents < size) {
    throw new RangeError(
      `Nao da para dividir ${formatAmountForMessage(total)} em ${count} parcelas: ` +
        'cada parcela ficaria com menos de um centavo.',
    );
  }

  const base = cents / size;
  const rest = cents % size;

  return Array.from({ length: count }, (_, index) =>
    Money.fromCents(base + (BigInt(index) < rest ? 1n : 0n)),
  );
}

/** A invariante que o teste cobra e que o servico confere antes de gravar. */
export function installmentsSumExactly(parts: readonly Money[], total: Money): boolean {
  return sumMoney(parts).equals(total);
}

/**
 * Vencimentos mensais a partir do primeiro.
 *
 * DIA 31 NAO EXISTE EM TODO MES, e o comportamento precisa ser previsivel: a
 * parcela cai no ULTIMO DIA do mes que nao tiver o dia escolhido. 31/01 vira
 * 28/02 (ou 29/02 em ano bissexto) e depois 31/03 — o dia original e
 * preservado como referencia em vez de "andar" para 28 em todos os meses
 * seguintes, que e o erro classico de somar 30 dias.
 */
export function monthlyDueDates(firstDueDate: string, count: number): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(firstDueDate);
  if (!match) throw new RangeError('Data de vencimento invalida.');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return Array.from({ length: count }, (_, index) => {
    const total = month - 1 + index;
    const targetYear = year + Math.floor(total / 12);
    const targetMonth = (total % 12) + 1;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    const targetDay = Math.min(day, lastDay);
    return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
  });
}

/** Plano completo: valores exatos e vencimentos, prontos para gravar. */
export function planInstallments(
  total: Money,
  count: number,
  firstDueDate: string,
): PlannedInstallment[] {
  const amounts = splitAmountIntoInstallments(total, count);
  const dates = monthlyDueDates(firstDueDate, count);

  /** Cinto e suspensorio: a invariante do item 9 conferida antes de sair daqui. */
  if (!installmentsSumExactly(amounts, total)) {
    throw new RangeError('A soma das parcelas nao bateu com o total do titulo.');
  }

  return amounts.map((amount, index) => ({
    number: index + 1,
    amount,
    dueDate: dates[index] as string,
  }));
}

// ---------------------------------------------------------------------------
// Movimento financeiro (itens 14 e 15)
// ---------------------------------------------------------------------------

/**
 * A CONVENCAO DE SINAL, escolhida e documentada uma vez (item 15).
 *
 * `inflow`  = dinheiro ENTROU na conta financeira.
 * `outflow` = dinheiro SAIU da conta financeira.
 *
 * O campo `amount` do movimento e SEMPRE POSITIVO. Quem carrega o sinal e a
 * direcao, e nao o numero — um `-150.00` perdido numa coluna e a origem
 * classica de somas que ninguem consegue explicar. O saldo da conta soma os
 * `inflow` e subtrai os `outflow`, e esta e a unica interpretacao valida em
 * todo o codigo.
 */
export const MOVEMENT_DIRECTIONS = ['inflow', 'outflow'] as const;
export type MovementDirection = (typeof MOVEMENT_DIRECTIONS)[number];

export const MOVEMENT_DIRECTION_LABEL: Record<MovementDirection, string> = {
  inflow: 'Entrada',
  outflow: 'Saida',
};

/** Receber aumenta o caixa; pagar diminui. Uma linha, sem condicional solta. */
export function movementDirectionFor(direction: TitleDirection): MovementDirection {
  return direction === 'receivable' ? 'inflow' : 'outflow';
}

export function oppositeDirection(direction: MovementDirection): MovementDirection {
  return direction === 'inflow' ? 'outflow' : 'inflow';
}

/** O que causou o movimento. Todo movimento tem origem rastreavel (item 27). */
export const MOVEMENT_ORIGINS = [
  'settlement',
  'reversal',
  'cash_opening',
  'cash_supply',
  'cash_withdrawal',
] as const;
export type MovementOrigin = (typeof MOVEMENT_ORIGINS)[number];

export const MOVEMENT_ORIGIN_LABEL: Record<MovementOrigin, string> = {
  settlement: 'Liquidacao',
  reversal: 'Estorno',
  cash_opening: 'Abertura de caixa',
  cash_supply: 'Suprimento',
  cash_withdrawal: 'Sangria',
};

export function movementOriginLabel(value: string): string {
  return MOVEMENT_ORIGIN_LABEL[value as MovementOrigin] ?? value;
}

/** O efeito de um movimento sobre o saldo da conta. */
export function applyToBalance(balance: Money, direction: MovementDirection, amount: Money): Money {
  return direction === 'inflow' ? balance.add(amount) : balance.subtract(amount);
}

// ---------------------------------------------------------------------------
// Contas financeiras (itens 16, 17 e 18)
// ---------------------------------------------------------------------------

/**
 * CONTA FINANCEIRA NAO E FORMA DE PAGAMENTO (item 16).
 *
 * A forma e COMO o dinheiro se moveu — PIX, dinheiro, cartao. A conta e ONDE
 * ele esta depois — o caixa do balcao, o banco, a conta da maquininha. "PIX
 * recebido no Itau" sao as duas coisas, e uma tabela so nao responderia nem
 * "quanto entrou por PIX" nem "quanto tem no banco".
 */
export const ACCOUNT_KINDS = ['cash', 'bank', 'digital_wallet', 'clearing', 'other'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  cash: 'Caixa (dinheiro)',
  bank: 'Conta bancaria',
  digital_wallet: 'Carteira digital',
  clearing: 'Conta de recebiveis (maquininha)',
  other: 'Outra',
};

export function accountKindLabel(value: string): string {
  return ACCOUNT_KIND_LABEL[value as AccountKind] ?? value;
}

export function isKnownAccountKind(value: string): value is AccountKind {
  return (ACCOUNT_KINDS as readonly string[]).includes(value);
}

/** So conta do tipo caixa participa de sessao de caixa (item 22). */
export function supportsCashSession(kind: string): boolean {
  return kind === 'cash';
}

export const ACCOUNT_STATUSES = ['active', 'inactive'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  active: 'Ativa',
  inactive: 'Inativa',
};

// ---------------------------------------------------------------------------
// Formas de pagamento (itens 19, 20 e 21)
// ---------------------------------------------------------------------------

/**
 * O catalogo do que existe. O tenant escolhe o que fica ATIVO (item 19) e pode
 * renomear ("Cartao Cielo"), mas nao inventa um meio que o dominio desconhece.
 */
export const PAYMENT_METHOD_KINDS = [
  'cash',
  'pix',
  'debit_card',
  'credit_card',
  'bank_transfer',
  'boleto',
  'other',
] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

export const PAYMENT_METHOD_KIND_LABEL: Record<PaymentMethodKind, string> = {
  cash: 'Dinheiro',
  pix: 'PIX',
  debit_card: 'Cartao de debito',
  credit_card: 'Cartao de credito',
  bank_transfer: 'Transferencia',
  boleto: 'Boleto',
  other: 'Outro',
};

export function paymentMethodKindLabel(value: string): string {
  return PAYMENT_METHOD_KIND_LABEL[value as PaymentMethodKind] ?? value;
}

export function isKnownPaymentMethodKind(value: string): value is PaymentMethodKind {
  return (PAYMENT_METHOD_KINDS as readonly string[]).includes(value);
}

/** Só cartão de crédito registra número de parcelas do cartão (item 20). */
export function supportsCardInstallments(kind: string): boolean {
  return kind === 'credit_card';
}

export const CARD_INSTALLMENTS_MAX = 24;

/**
 * O QUE NAO SE GUARDA DE CARTAO (item 109).
 *
 * Nunca: numero completo, CVV, senha, token de adquirente. Nao ha integracao
 * PCI neste sistema, e guardar esses dados sem ela seria assumir um risco que
 * o produto nao tem como cobrir. O que se guarda e a REFERENCIA textual que o
 * operador anota — numero de autorizacao, ultimos digitos se a loja quiser —
 * e o campo se chama `reference` justamente para nao convidar a mais que isso.
 */
export const SETTLEMENT_REFERENCE_MAX = 120;
export const SETTLEMENT_NOTES_MAX = 300;

// ---------------------------------------------------------------------------
// Sessao de caixa (itens 23 a 26)
// ---------------------------------------------------------------------------

export const CASH_SESSION_STATUSES = ['open', 'closed'] as const;
export type CashSessionStatus = (typeof CASH_SESSION_STATUSES)[number];

export const CASH_SESSION_STATUS_LABEL: Record<CashSessionStatus, string> = {
  open: 'Aberto',
  closed: 'Fechado',
};

export interface CashClosingSnapshot {
  openingAmount: Money;
  inflow: Money;
  outflow: Money;
  countedAmount: Money;
}

/** O que o sistema ESPERA encontrar na gaveta. */
export function expectedCashAmount(snapshot: {
  openingAmount: Money;
  inflow: Money;
  outflow: Money;
}): Money {
  return snapshot.openingAmount.add(snapshot.inflow).subtract(snapshot.outflow);
}

/**
 * A DIFERENCA NAO DESAPARECE (item 25).
 *
 * Positiva = sobrou dinheiro na gaveta. Negativa = faltou. O sistema NAO cria
 * movimento automatico para "zerar" a diferenca: ela e gravada como o fato que
 * e, e quem quiser corrigir o saldo faz um suprimento ou uma sangria, com
 * motivo e com nome.
 */
export function cashDifference(snapshot: CashClosingSnapshot): Money {
  return snapshot.countedAmount.subtract(expectedCashAmount(snapshot));
}

export const CASH_REASON_MIN = 5;
export const CASH_REASON_MAX = 300;

// ---------------------------------------------------------------------------
// Categorias financeiras (item 28)
// ---------------------------------------------------------------------------

/**
 * CATEGORIA FINANCEIRA NAO E CONTA CONTABIL (item 28).
 *
 * Serve para a pessoa responder "quanto gastei com transporte este mes". Nao
 * ha plano de contas, nao ha grau, nao ha natureza contabil — e quando o
 * Nexo56 tiver contabilidade, ela sera outra coisa, ao lado desta.
 */
export const CATEGORY_KINDS = ['revenue', 'expense'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const CATEGORY_KIND_LABEL: Record<CategoryKind, string> = {
  revenue: 'Receita',
  expense: 'Despesa',
};

/** Categoria de receita so entra em titulo a receber, e vice-versa. */
export function categoryMatchesDirection(kind: string, direction: TitleDirection): boolean {
  return direction === 'receivable' ? kind === 'revenue' : kind === 'expense';
}

// ---------------------------------------------------------------------------
// Origem do titulo (itens 33, 34 e 38)
// ---------------------------------------------------------------------------

/**
 * DE ONDE A OBRIGACAO NASCEU, e a chave que impede duplicar (item 38).
 *
 * `manual`           — alguem digitou. Despesa de aluguel, cobranca avulsa.
 * `service_order`    — a cobranca do atendimento.
 * `purchase_receipt` — a mercadoria que chegou (ADR-057).
 */
export const TITLE_ORIGINS = ['manual', 'service_order', 'purchase_receipt'] as const;
export type TitleOrigin = (typeof TITLE_ORIGINS)[number];

export const TITLE_ORIGIN_LABEL: Record<TitleOrigin, string> = {
  manual: 'Manual',
  service_order: 'Ordem de Servico',
  purchase_receipt: 'Recebimento de compra',
};

export function titleOriginLabel(value: string): string {
  return TITLE_ORIGIN_LABEL[value as TitleOrigin] ?? value;
}

/**
 * A CHAVE DE ORIGEM (item 38).
 *
 * `service_order:<id>` e `purchase_receipt:<id>`. UNIQUE por tenant no banco:
 * repetir a mesma acao — por duplo clique, por retry, por duas pessoas ao
 * mesmo tempo — REENCONTRA o titulo em vez de criar um segundo.
 *
 * Titulo manual NAO tem chave de origem: duas despesas de energia no mesmo mes
 * sao dois fatos legitimos, e travar isso seria transformar uma protecao em
 * obstaculo.
 */
export function originKeyFor(origin: TitleOrigin, originId: string): string | null {
  if (origin === 'manual') return null;
  return `${origin}:${originId}`;
}

// ---------------------------------------------------------------------------
// Limites de texto
// ---------------------------------------------------------------------------

export const TITLE_DESCRIPTION_MAX = 200;
export const TITLE_NOTES_MAX = 2000;
export const TITLE_PAYEE_MAX = 200;
export const ACCOUNT_NAME_MAX = 120;
export const CATEGORY_NAME_MAX = 120;
export const CANCEL_REASON_MIN = 5;
export const CANCEL_REASON_MAX = 300;
export const REVERSAL_REASON_MIN = 5;
export const REVERSAL_REASON_MAX = 300;
export const IDEMPOTENCY_KEY_MAX = 80;

/** Valor maximo de um titulo: R$ 99.999.999,99. O `DECIMAL(14,2)` comporta mais. */
export const TITLE_AMOUNT_MAX_CENTS = 99_999_999_99n;

export function normalizeReason(raw: string, min: number, max: number, what: string): string {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length < min) {
    throw new RangeError(`${what} precisa ter ao menos ${min} caracteres.`);
  }
  return value.slice(0, max);
}

// ---------------------------------------------------------------------------
// Numeracao (item 47)
// ---------------------------------------------------------------------------

/**
 * TITULO TEM NUMERO HUMANO, e ele ganha o seu lugar (item 47).
 *
 * "CR 000123" ao telefone e "CP 000045" na conferencia do fornecedor sao mais
 * uteis que um UUID, e a sequencia ja existe desde o Prompt 02 — nao ha
 * infraestrutura paralela, nao ha `MAX + 1`.
 */
export const RECEIVABLE_NUMBER_PREFIX = 'CR';
export const PAYABLE_NUMBER_PREFIX = 'CP';
export const TITLE_NUMBER_PADDING = 6;

export function titleNumberPrefix(direction: TitleDirection): string {
  return direction === 'receivable' ? RECEIVABLE_NUMBER_PREFIX : PAYABLE_NUMBER_PREFIX;
}

export function sequenceTypeFor(direction: TitleDirection): string {
  return direction === 'receivable' ? 'financial_receivable' : 'financial_payable';
}

export function formatTitleNumber(direction: TitleDirection, value: number): string {
  return `${titleNumberPrefix(direction)} ${String(value).padStart(TITLE_NUMBER_PADDING, '0')}`;
}

// ---------------------------------------------------------------------------
// Linha do tempo (item 49)
// ---------------------------------------------------------------------------

export const TITLE_TIMELINE_KINDS = {
  CREATED: 'created',
  UPDATED: 'updated',
  SETTLED: 'settled',
  FULLY_SETTLED: 'fully_settled',
  REVERSED: 'reversed',
  CANCELLED: 'cancelled',
} as const;

export type TitleTimelineKind = (typeof TITLE_TIMELINE_KINDS)[keyof typeof TITLE_TIMELINE_KINDS];

export const TITLE_TIMELINE_LABEL: Readonly<Record<string, string>> = {
  created: 'Titulo criado',
  updated: 'Titulo alterado',
  settled: 'Liquidacao registrada',
  fully_settled: 'Titulo liquidado por completo',
  reversed: 'Liquidacao estornada',
  cancelled: 'Titulo cancelado',
};

export function titleTimelineLabel(kind: string): string {
  return TITLE_TIMELINE_LABEL[kind] ?? kind;
}

// ---------------------------------------------------------------------------
// Permissoes por operacao (item 51)
// ---------------------------------------------------------------------------

/**
 * Receber e pagar sao capacidades DIFERENTES, e por isso duas permissoes.
 *
 * Quem atende no balcao recebe do cliente; quem paga o fornecedor mexe no
 * dinheiro que sai da empresa. Numa assistencia pequena e a mesma pessoa —
 * mas o corte precisa existir no modelo para poder existir na empresa.
 */
export function settlementPermission(direction: TitleDirection): PermissionKey {
  return direction === 'receivable' ? PERMISSIONS.FINANCE_RECEIVE : PERMISSIONS.FINANCE_PAY;
}

export function titleManagePermission(direction: TitleDirection): PermissionKey {
  return direction === 'receivable'
    ? PERMISSIONS.FINANCE_RECEIVABLES_MANAGE
    : PERMISSIONS.FINANCE_PAYABLES_MANAGE;
}

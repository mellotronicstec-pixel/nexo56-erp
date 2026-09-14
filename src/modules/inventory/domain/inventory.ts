import { Money } from '@/core/money/money';
import { Quantity } from '@/core/quantity/quantity';
import { normalizeCompactCode, normalizeSearchable } from '@/core/text/normalize';
import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';

/**
 * Dominio de Estoque e Pecas (Prompt 10).
 *
 * ESTE ARQUIVO E A AUTORIDADE sobre o que o estoque pode ser e sobre o que
 * pode acontecer com ele. Nenhuma pagina, action ou repositorio decide sozinho
 * se uma reserva cabe ou se um saldo pode ficar negativo: todos perguntam aqui.
 *
 * AS SEIS COISAS QUE ESTE MODULO INSISTE EM MANTER SEPARADAS (item 4)
 *
 *   Peca          o que a coisa E.            Do TENANT. Nao tem quantidade.
 *   Localizacao   ONDE ela fica.              Da UNIDADE. Nao e a unidade.
 *   Saldo         QUANTO existe.              Da UNIDADE, por peca.
 *   Movimentacao  O QUE ACONTECEU.            Historia, append-only.
 *   Reserva       Quanto ja tem dono.         Compromisso, nao saida fisica.
 *   Linha PART    O que foi PROPOSTO.         Do orcamento, e continua dele.
 *
 * Colapsar qualquer par disso numa tabela `products` com um campo `quantity`
 * e como o erro comeca: o dia em que duas unidades tem a mesma peca, ou em que
 * alguem pergunta "por que o saldo mudou ontem a noite?", a resposta deixa de
 * existir.
 *
 * AS FRONTEIRAS QUE ESTE MODULO NAO ATRAVESSA
 *
 *   Estoque NUNCA escreve `service_orders.status` (itens 46 e 47). Quando uma
 *   operacao precisar mover a OS, ela usa o workflow central do Prompt 08 —
 *   `planTransition` + `applyTransition` — e nada mais.
 *
 *   Salvar, enviar ou aprovar orcamento NAO movimenta e NAO consome estoque
 *   (itens 36, 104 e 105 do Prompt 09; itens 36 a 38 e 44 daqui). Reservar e
 *   consumir sao acoes explicitas de uma pessoa com permissao.
 *
 *   Peca sem saldo NAO vira pedido de compra (item 45). Fornecedores e Compras
 *   sao o Prompt 11; aqui existe apenas o evento que eles vao consumir.
 */

// ---------------------------------------------------------------------------
// Unidade de medida (item 15)
// ---------------------------------------------------------------------------

/**
 * Conjunto PEQUENO e deliberado.
 *
 * Uma assistencia tecnica compra peca por unidade, cabo por metro, pasta
 * termica por grama e alcool isopropilico por litro. Um catalogo com as 40
 * unidades do SI transformaria um `select` de tres opcoes uteis numa lista que
 * ninguem le — e o item 15 pede exatamente para nao fazer isso. Acrescentar
 * uma unidade depois e aditivo: a coluna e texto.
 */
export const UNITS_OF_MEASURE = ['unit', 'package', 'meter', 'gram', 'kilogram', 'liter'] as const;
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];

export const DEFAULT_UNIT_OF_MEASURE: UnitOfMeasure = 'unit';

export const UNIT_OF_MEASURE_LABEL: Record<UnitOfMeasure, string> = {
  unit: 'Unidade',
  package: 'Pacote',
  meter: 'Metro',
  gram: 'Grama',
  kilogram: 'Quilograma',
  liter: 'Litro',
};

export const UNIT_OF_MEASURE_ABBREVIATION: Record<UnitOfMeasure, string> = {
  unit: 'un',
  package: 'pct',
  meter: 'm',
  gram: 'g',
  kilogram: 'kg',
  liter: 'L',
};

/**
 * Unidades que NAO admitem fracao.
 *
 * Meia tela de LCD nao existe; meio metro de cabo existe. A verificacao mora
 * no dominio e nao no banco porque a coluna e a mesma `DECIMAL(14,4)` para
 * todas as pecas — quem decide se `0.5` faz sentido e a unidade da peca.
 */
export const INTEGRAL_UNITS_OF_MEASURE: readonly UnitOfMeasure[] = ['unit', 'package'];

export function isKnownUnitOfMeasure(value: string): value is UnitOfMeasure {
  return (UNITS_OF_MEASURE as readonly string[]).includes(value);
}

export function unitOfMeasureLabel(value: string): string {
  return isKnownUnitOfMeasure(value) ? UNIT_OF_MEASURE_LABEL[value] : value;
}

export function unitOfMeasureAbbreviation(value: string): string {
  return isKnownUnitOfMeasure(value) ? UNIT_OF_MEASURE_ABBREVIATION[value] : value;
}

export function allowsFractionalQuantity(unitOfMeasure: string): boolean {
  return !(INTEGRAL_UNITS_OF_MEASURE as readonly string[]).includes(unitOfMeasure);
}

// ---------------------------------------------------------------------------
// Quantidades (itens 16, 29 e 30)
// ---------------------------------------------------------------------------

/**
 * Teto operacional. `DECIMAL(14,4)` comporta muito mais; uma assistencia que
 * lanca 1.000.000 de unidades de uma peca digitou errado, e o erro barato de
 * corrigir e o que o sistema recusa na hora.
 */
export const QUANTITY_MAX = 999_999;

const MAX_QUANTITY = Quantity.parse(String(QUANTITY_MAX));

/**
 * Quantidade de uma OPERACAO: precisa ser maior que zero.
 *
 * Entrada de zero pecas, reserva de zero pecas e saida de zero pecas nao sao
 * casos de uso — sao formulario enviado antes da hora. Ajuste tambem nao usa
 * zero: quem quer "nao mexer" nao ajusta.
 */
export function parseOperationQuantity(raw: string, unitOfMeasure?: string): Quantity {
  const value = Quantity.parse(raw.trim().replace(',', '.'));

  if (!value.isPositive()) {
    throw new RangeError('A quantidade precisa ser maior que zero.');
  }
  if (value.compare(MAX_QUANTITY) > 0) {
    throw new RangeError(`A quantidade maxima por operacao e ${QUANTITY_MAX}.`);
  }
  if (unitOfMeasure && !allowsFractionalQuantity(unitOfMeasure) && value.hasFraction()) {
    throw new RangeError(
      `A unidade de medida ${unitOfMeasureLabel(unitOfMeasure)} nao aceita quantidade fracionada.`,
    );
  }

  return value;
}

/**
 * Quantidade de CONFIGURACAO: zero e legitimo.
 *
 * Estoque minimo zero significa "nao acompanhe esta peca", e nao "avise
 * sempre" — e a diferenca entre um alerta util e um painel que ninguem olha.
 */
export function parseConfiguredQuantity(raw: string, unitOfMeasure?: string): Quantity {
  const trimmed = raw.trim().replace(',', '.');
  const value = trimmed === '' ? Quantity.zero() : Quantity.parse(trimmed);

  if (value.isNegative()) {
    throw new RangeError('A quantidade nao pode ser negativa.');
  }
  if (value.compare(MAX_QUANTITY) > 0) {
    throw new RangeError(`A quantidade maxima e ${QUANTITY_MAX}.`);
  }
  if (unitOfMeasure && !allowsFractionalQuantity(unitOfMeasure) && value.hasFraction()) {
    throw new RangeError(
      `A unidade de medida ${unitOfMeasureLabel(unitOfMeasure)} nao aceita quantidade fracionada.`,
    );
  }

  return value;
}

// ---------------------------------------------------------------------------
// Peca: identificacao (itens 5, 11 a 14)
// ---------------------------------------------------------------------------

export const PART_NAME_MAX = 120;
export const PART_DESCRIPTION_MAX = 500;
export const PART_CODE_MAX = 40;
export const PART_BRAND_MAX = 80;
export const PART_NUMBER_MAX = 60;
export const PART_BARCODE_MAX = 64;
export const PART_NOTES_MAX = 2000;

export const PART_STATUSES = ['active', 'inactive'] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

export const PART_STATUS_LABEL: Record<PartStatus, string> = {
  active: 'Ativa',
  inactive: 'Inativa',
};

export function isKnownPartStatus(value: string): value is PartStatus {
  return (PART_STATUSES as readonly string[]).includes(value);
}

/**
 * CODIGO INTERNO da empresa (item 12).
 *
 * Unico por TENANT — e a etiqueta que a loja usa para falar da peca, e dois
 * "TELA-01" na mesma empresa tornam o codigo inutil. A forma comparada e
 * compacta e maiuscula: quem cadastrou "tela 01" e quem digita "TELA-01"
 * querem dizer a mesma coisa, e deixar os dois entrarem cria a duplicidade que
 * a unicidade deveria impedir.
 *
 * O valor EXIBIDO e o que a pessoa digitou; esta funcao produz so a chave.
 */
export function normalizePartCode(value: string): string {
  return normalizeCompactCode(value);
}

/**
 * PART NUMBER do fabricante (item 13).
 *
 * NAO tem unicidade: dois fabricantes usam a mesma referencia com frequencia,
 * e travar isso obrigaria a inventar sufixos que nao existem na caixa. Serve
 * para BUSCA, e so.
 */
export function normalizePartNumber(value: string): string {
  return normalizeCompactCode(value);
}

/**
 * CODIGO DE BARRAS (item 14).
 *
 * Nao presume EAN-13, nao valida digito verificador e nao rejeita letras:
 * fornecedor pequeno imprime Code-128 com texto, e QR interno pode ser
 * qualquer coisa. Normalizamos so o bastante para o mesmo codigo, lido de
 * duas formas, encontrar a mesma peca.
 *
 * NAO EXISTE LEITOR. A arquitetura aceita o codigo e a busca o encontra
 * (item 114); scanner de camera e outro prompt.
 */
export function normalizeBarcode(value: string): string {
  return normalizeCompactCode(value);
}

/** Chave de busca por texto livre: nome, descricao e fabricante (item 95). */
export function partSearchKey(value: string): string {
  return normalizeSearchable(value);
}

/**
 * Rotulo curto da peca para listas e para a linha do tempo da OS.
 * Codigo primeiro porque e por ele que a bancada chama a peca.
 */
export function partLabel(part: { code: string; name: string }): string {
  return `${part.code} — ${part.name}`;
}

// ---------------------------------------------------------------------------
// Localizacao (itens 8, 9 e 10)
// ---------------------------------------------------------------------------

export const LOCATION_NAME_MAX = 80;
export const LOCATION_CODE_MAX = 30;
export const LOCATION_DESCRIPTION_MAX = 300;

export const LOCATION_STATUSES = ['active', 'inactive'] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export const LOCATION_STATUS_LABEL: Record<LocationStatus, string> = {
  active: 'Ativa',
  inactive: 'Inativa',
};

/**
 * SUGESTOES, nao categorias (item 8).
 *
 * A loja nomeia suas proprias prateleiras. Isto existe apenas para a tela de
 * cadastro oferecer um ponto de partida — nao ha enum de localizacao, nao ha
 * tipo obrigatorio, e nada no dominio consulta esta lista.
 */
export const LOCATION_NAME_SUGGESTIONS: readonly string[] = [
  'Estoque',
  'Prateleira A',
  'Gaveta 1',
  'Bancada',
  'Deposito',
];

export function normalizeLocationCode(value: string): string {
  return normalizeCompactCode(value);
}

// ---------------------------------------------------------------------------
// Ledger: movimentacoes (itens 20 a 24)
// ---------------------------------------------------------------------------

/**
 * TIPOS DE MOVIMENTACAO (item 22).
 *
 * RESERVA NAO ESTA AQUI, e essa e uma decisao (ADR-045). Reserva nao muda
 * quanto existe fisicamente na prateleira — muda quanto ja tem dono. Coloca-la
 * no ledger obrigaria o saldo fisico a ser "soma dos movimentos menos os de
 * reserva", e a primeira consulta que esquecesse esse filtro mostraria um
 * estoque que nao corresponde ao que se ve na prateleira.
 *
 * O ledger responde: QUANTO ENTROU E QUANTO SAIU FISICAMENTE.
 */
export const MOVEMENT_TYPES = [
  'receipt',
  'issue',
  'adjustment_in',
  'adjustment_out',
  'transfer_out',
  'transfer_in',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** +1 aumenta o saldo fisico, -1 diminui. Nao ha movimento neutro. */
export const MOVEMENT_DIRECTION: Record<MovementType, 1 | -1> = {
  receipt: 1,
  issue: -1,
  adjustment_in: 1,
  adjustment_out: -1,
  transfer_out: -1,
  transfer_in: 1,
};

export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  receipt: 'Entrada',
  issue: 'Saida',
  adjustment_in: 'Ajuste positivo',
  adjustment_out: 'Ajuste negativo',
  transfer_out: 'Transferencia (saida)',
  transfer_in: 'Transferencia (entrada)',
};

export function isKnownMovementType(value: string): value is MovementType {
  return (MOVEMENT_TYPES as readonly string[]).includes(value);
}

export function movementTypeLabel(value: string): string {
  return isKnownMovementType(value) ? MOVEMENT_TYPE_LABEL[value] : value;
}

export function movementDirection(type: string): 1 | -1 {
  if (!isKnownMovementType(type)) {
    throw new RangeError(`Tipo de movimentacao desconhecido: ${JSON.stringify(type)}`);
  }
  return MOVEMENT_DIRECTION[type];
}

/** Quantidade COM SINAL, do jeito que vai para a coluna do ledger. */
export function signedMovementQuantity(type: string, value: Quantity): Quantity {
  return movementDirection(type) === -1 ? value.negate() : value;
}

/**
 * DE ONDE VEIO a movimentacao (itens 21 e 77).
 *
 * `manual` e honesto: entrada digitada por uma pessoa, sem nota e sem pedido
 * de compra. FINGIR que existe um `purchase_order` aqui seria antecipar o
 * Prompt 11 na estrutura de dados — e o dia em que Compras chegar, encontraria
 * linhas apontando para pedidos que nunca existiram.
 */
export const MOVEMENT_ORIGINS = ['manual', 'service_order', 'transfer'] as const;
export type MovementOrigin = (typeof MOVEMENT_ORIGINS)[number];

export const MOVEMENT_ORIGIN_LABEL: Record<MovementOrigin, string> = {
  manual: 'Lancamento manual',
  service_order: 'Ordem de Servico',
  transfer: 'Transferencia entre unidades',
};

export const MOVEMENT_REASON_MAX = 300;
export const MOVEMENT_REFERENCE_MAX = 120;

/**
 * Movimentacoes que EXIGEM motivo (item 55).
 *
 * Ajuste e a unica operacao que reescreve o saldo sem que nada tenha entrado
 * ou saido pela porta. Sem motivo obrigatorio, o ledger registra "o saldo
 * mudou" sem registrar por que — que e justamente a pergunta que alguem vai
 * fazer tres meses depois.
 */
export const MOVEMENT_TYPES_REQUIRING_REASON: readonly MovementType[] = [
  'adjustment_in',
  'adjustment_out',
];

export function requiresReason(type: string): boolean {
  return (MOVEMENT_TYPES_REQUIRING_REASON as readonly string[]).includes(type);
}

export const ADJUSTMENT_REASON_MIN = 5;

export function normalizeAdjustmentReason(raw: string): string {
  const reason = raw.trim().replace(/\s+/g, ' ');
  if (reason.length < ADJUSTMENT_REASON_MIN) {
    throw new RangeError('Descreva o motivo do ajuste.');
  }
  return reason.slice(0, MOVEMENT_REASON_MAX);
}

/** Permissao exigida por tipo de movimentacao (itens 78 e 90). */
export const MOVEMENT_TYPE_PERMISSION: Record<MovementType, PermissionKey> = {
  receipt: PERMISSIONS.INVENTORY_RECEIVE,
  issue: PERMISSIONS.INVENTORY_ISSUE,
  adjustment_in: PERMISSIONS.INVENTORY_ADJUST,
  adjustment_out: PERMISSIONS.INVENTORY_ADJUST,
  transfer_out: PERMISSIONS.INVENTORY_TRANSFER,
  transfer_in: PERMISSIONS.INVENTORY_TRANSFER,
};

// ---------------------------------------------------------------------------
// Saldo (itens 25 a 30)
// ---------------------------------------------------------------------------

/**
 * O QUE CADA NUMERO SIGNIFICA. Definido uma vez, aqui.
 *
 *   on_hand    o que esta fisicamente na unidade, incluindo o que ja tem dono;
 *   reserved   o que ja foi comprometido com alguma OS e ainda nao saiu;
 *   available  on_hand - reserved: o que alguem novo ainda pode pegar.
 *
 * `reserved` NAO e subtraido de `on_hand` quando a reserva e criada: a peca
 * continua na prateleira. Quem confunde os dois acaba com um inventario fisico
 * que nunca bate com o sistema.
 */
export interface StockBalanceSnapshot {
  onHand: Quantity;
  reserved: Quantity;
}

export function availableQuantity(balance: StockBalanceSnapshot): Quantity {
  return balance.onHand.subtract(balance.reserved);
}

/**
 * AS TRES INVARIANTES DO SALDO.
 *
 * Sao verificadas aqui E no banco, por CHECK constraint (item 123). A checagem
 * do dominio produz mensagem em portugues; a do banco e a que continua valendo
 * quando alguem escrever um segundo caminho de gravacao, ou um `UPDATE` a mao.
 */
export function assertBalanceInvariants(balance: StockBalanceSnapshot): void {
  if (balance.onHand.isNegative()) {
    throw new RangeError('O saldo fisico nao pode ficar negativo.');
  }
  if (balance.reserved.isNegative()) {
    throw new RangeError('A quantidade reservada nao pode ficar negativa.');
  }
  if (balance.reserved.compare(balance.onHand) > 0) {
    throw new RangeError('A quantidade reservada nao pode ser maior que o saldo fisico.');
  }
}

/** Cabe reservar? Reserva consome DISPONIVEL, nao saldo fisico (item 29). */
export function canReserve(balance: StockBalanceSnapshot, wanted: Quantity): boolean {
  return availableQuantity(balance).compare(wanted) >= 0;
}

/**
 * Cabe dar saida?
 *
 * Saida avulsa consome DISPONIVEL, e nao `on_hand`: retirar peca que esta
 * reservada para a OS do colega deixaria a reserva dele apontando para algo
 * que nao existe mais. Consumir a PROPRIA reserva e outra operacao, atomica,
 * e nao passa por aqui.
 */
export function canIssue(balance: StockBalanceSnapshot, wanted: Quantity): boolean {
  return availableQuantity(balance).compare(wanted) >= 0;
}

/** Mensagem unica para falta de saldo, em portugues e com os numeros reais. */
export function explainInsufficientStock(
  available: Quantity,
  wanted: Quantity,
  unitOfMeasure: string,
): string {
  const unit = unitOfMeasureAbbreviation(unitOfMeasure);
  return `Saldo disponivel insuficiente: ha ${formatQuantityValue(available)} ${unit} e foram pedidas ${formatQuantityValue(wanted)} ${unit}.`;
}

/** `"3.0000"` -> `"3"`; `"2.5000"` -> `"2,5"`. Apresentacao pt-BR. */
export function formatQuantityValue(value: Quantity): string {
  const [whole = '0', fraction = ''] = value.toString().split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole},${trimmed}` : whole;
}

// ---------------------------------------------------------------------------
// Reserva (itens 27, 33 a 38, 103 a 105)
// ---------------------------------------------------------------------------

/**
 * RESERVA E UM COMPROMISSO, NAO UMA SAIDA (item 33).
 *
 * Ela responde "esta peca ja tem dono", e o dono e sempre uma Ordem de Servico
 * da MESMA UNIDADE (itens 34 e 35). A OS da unidade A nao reserva a prateleira
 * da unidade B: para isso existe transferencia, que e um processo explicito com
 * duas movimentacoes e rastro.
 *
 * NAO EXISTE RESERVA AUTOMATICA (itens 36 a 38). Um orcamento aprovado com
 * linha PART vinculada a uma peca real HABILITA o botao de reservar; quem
 * reserva e uma pessoa. Reservar sozinho no `approveQuote` significaria que
 * aprovar tres orcamentos do mesmo modelo de tela esvazia o disponivel sem
 * ninguem ter pego nada — e o quarto cliente ouviria "nao temos" com a peca na
 * prateleira.
 */
export const RESERVATION_STATUSES = ['open', 'closed', 'cancelled'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  open: 'Aberta',
  closed: 'Encerrada',
  cancelled: 'Cancelada',
};

export interface ReservationSnapshot {
  /** Quanto foi reservado no total, ao longo da vida da reserva. */
  quantity: Quantity;
  /** Quanto virou consumo fisico. */
  consumedQuantity: Quantity;
  /** Quanto voltou para o disponivel sem ser usado. */
  releasedQuantity: Quantity;
  status: string;
}

/** O que ainda esta preso a esta reserva. */
export function reservationRemaining(reservation: ReservationSnapshot): Quantity {
  return reservation.quantity
    .subtract(reservation.consumedQuantity)
    .subtract(reservation.releasedQuantity);
}

export function isReservationOpen(status: string): boolean {
  return status === 'open';
}

export function isKnownReservationStatus(value: string): value is ReservationStatus {
  return (RESERVATION_STATUSES as readonly string[]).includes(value);
}

export function reservationStatusLabel(value: string): string {
  return isKnownReservationStatus(value) ? RESERVATION_STATUS_LABEL[value] : value;
}

/**
 * Situacao a que a reserva chega depois de consumir ou liberar.
 *
 * Deriva do que sobrou, e nao de qual botao foi clicado: uma reserva de 3 com
 * 1 consumida e 2 liberadas esta encerrada pelos dois caminhos.
 */
export function nextReservationStatus(reservation: ReservationSnapshot): ReservationStatus {
  return reservationRemaining(reservation).isPositive() ? 'open' : 'closed';
}

// ---------------------------------------------------------------------------
// Transferencia (itens 50 a 54)
// ---------------------------------------------------------------------------

/**
 * V1 E IMEDIATA, E ISSO ESTA DOCUMENTADO COMO LIMITACAO (item 53).
 *
 * A transferencia retira da origem e adiciona ao destino na MESMA transacao.
 * Nao ha estado `in_transit` porque o sistema nao acompanha o motoboy: fingir
 * uma etapa de transporte que ninguem confirma produziria saldo parado em
 * "transito" para sempre, que e pior que nao ter a etapa.
 *
 * O estado existe como coluna para o dia em que houver conferencia no destino
 * — acrescentar `in_transit` sera aditivo.
 */
export const TRANSFER_STATUSES = ['completed'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  completed: 'Concluida',
};

export const TRANSFER_NUMBER_PREFIX = 'TRF';
export const TRANSFER_NUMBER_PADDING = 6;

/** Numero humano da transferencia. O banco guarda so o inteiro. */
export function formatTransferNumber(
  value: number,
  prefix: string = TRANSFER_NUMBER_PREFIX,
  padding: number = TRANSFER_NUMBER_PADDING,
): string {
  return `${prefix} ${String(value).padStart(padding, '0')}`;
}

/**
 * Origem e destino precisam ser unidades DIFERENTES.
 *
 * A coerencia de tenant nao e checada aqui: ela e garantida pelas FKs compostas
 * `(unit_id, tenant_id)` no banco (item 54). Checagem de aplicacao some no dia
 * em que alguem escreve o segundo caminho de criacao; a FK nao some.
 */
export function assertTransferUnits(fromUnitId: string, toUnitId: string): void {
  if (fromUnitId === toUnitId) {
    throw new RangeError('A unidade de origem e a de destino precisam ser diferentes.');
  }
}

// ---------------------------------------------------------------------------
// Estoque minimo e alerta (itens 59 a 63)
// ---------------------------------------------------------------------------

/**
 * O MINIMO E POR PECA E POR UNIDADE (item 59).
 *
 * A loja do centro gira tela de iPhone toda semana; a do bairro vende uma por
 * mes. Um minimo global obrigaria as duas ao mesmo numero, e o alerta viraria
 * ruido numa e silencio na outra.
 *
 * Minimo ZERO significa "nao acompanhe", nao "avise sempre".
 */
export function hasMinimumConfigured(minimum: Quantity): boolean {
  return minimum.isPositive();
}

/**
 * A COMPARACAO E CONTRA O DISPONIVEL, nao contra o saldo fisico (item 60).
 *
 * Peca reservada ja tem dono: contar 5 na prateleira, com 5 comprometidas, como
 * "estoque saudavel" e o mesmo que nao ter alerta nenhum. Quem quiser ver o
 * fisico ve o fisico — a coluna esta na tela, ao lado.
 */
export function isBelowMinimum(balance: StockBalanceSnapshot, minimum: Quantity): boolean {
  if (!hasMinimumConfigured(minimum)) return false;
  return availableQuantity(balance).compare(minimum) < 0;
}

// ---------------------------------------------------------------------------
// Custo (itens 17, 18 e 70)
// ---------------------------------------------------------------------------

/**
 * TRES CUSTOS DIFERENTES, e o item 18 pede que nao se confundam:
 *
 *   custo da movimentacao  o que aquela entrada custou. Congelado no ledger.
 *   custo unitario atual   media ponderada do que ha em estoque hoje.
 *   custo historico        o ledger inteiro, que ninguem reescreve.
 *
 * Mudar o custo de uma peca NAO reescreve o que ja foi lancado (item 18): as
 * movimentacoes antigas continuam com o custo que tinham, porque foi ele que
 * saiu do caixa.
 *
 * NAO HA FIFO NEM LIFO (item 71). Media ponderada movel e deterministica,
 * testavel e suficiente para saber quanto vale o estoque; valuation contabil
 * de verdade e requisito que ninguem pediu.
 */
export function movementTotalCost(unitCost: Money | null, value: Quantity): Money | null {
  if (!unitCost) return null;
  return unitCost.multiply(value.toString());
}

/**
 * Proxima media ponderada, depois de uma entrada.
 *
 * Entrada SEM custo informado nao altera a media: nao saber quanto custou e
 * diferente de ter custado zero, e tratar as duas coisas igual derrubaria o
 * custo medio a cada lancamento apressado.
 *
 * Saida nao altera a media — e essa e a propriedade que torna o calculo
 * deterministico: a media so depende das ENTRADAS, na ordem em que ocorreram.
 */
export function nextAverageCost(
  currentOnHand: Quantity,
  currentAverage: Money | null,
  incoming: Quantity,
  incomingUnitCost: Money | null,
): Money | null {
  if (!incomingUnitCost) return currentAverage;
  if (!currentAverage || !currentOnHand.isPositive()) return incomingUnitCost;

  const onHandUnits = currentOnHand.toUnits();
  const incomingUnits = incoming.toUnits();
  const totalUnits = onHandUnits + incomingUnits;
  if (totalUnits <= 0n) return incomingUnitCost;

  const weighted =
    onHandUnits * currentAverage.toCents() + incomingUnits * incomingUnitCost.toCents();
  return Money.fromCents(roundHalfUpDivision(weighted, totalUnits));
}

/** Divisao inteira half-up, preservando o sinal. Mesma convencao do `Money`. */
function roundHalfUpDivision(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Divisao por zero.');
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const quotient = a / b;
  const remainder = a % b;
  const rounded = remainder * 2n >= b ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

// ---------------------------------------------------------------------------
// Vinculo com o orcamento (itens 39 a 42, 108 a 110)
// ---------------------------------------------------------------------------

/**
 * O ORCAMENTO CONTINUA SENDO O SNAPSHOT COMERCIAL (itens 41 e 42).
 *
 * `quote_items.part_id` e uma coluna ADITIVA e OPCIONAL. Escolher a peca
 * preenche descricao e valor como CONVENIENCIA, no momento da escolha; dali em
 * diante o orcamento guarda os proprios numeros. Renomear a peca, trocar seu
 * codigo ou reajustar seu preco nao muda uma virgula de um orcamento enviado —
 * o cliente aprovou aquele papel, nao um `JOIN`.
 *
 * E por isso que a leitura do orcamento NAO depende do modulo de estoque
 * (item 110): tudo que a proposta precisa dizer ja esta gravado nela.
 */
export interface PartSnapshotForQuote {
  description: string;
  unitPrice: string;
  unitOfMeasure: UnitOfMeasure;
}

/**
 * Linha PART manual continua valida para sempre (item 40).
 *
 * Retorna `true` quando a linha tem peca vinculada — nunca use isto para
 * decidir se a linha vale, so para decidir se ha ficha para abrir.
 */
export function hasCatalogLink(item: { partId: string | null }): boolean {
  return item.partId !== null;
}

// ---------------------------------------------------------------------------
// Idempotencia (itens 118 a 121)
// ---------------------------------------------------------------------------

export const IDEMPOTENCY_KEY_MAX = 80;

/**
 * Operacoes que aceitam chave de comando.
 *
 * Sao exatamente as que nao podem acontecer duas vezes por um duplo clique ou
 * por um retry de rede: dar entrada duas vezes infla o saldo, e transferir duas
 * vezes esvazia a unidade de origem.
 */
export const IDEMPOTENT_OPERATIONS = ['receive', 'issue', 'transfer', 'consume'] as const;
export type IdempotentOperation = (typeof IDEMPOTENT_OPERATIONS)[number];

/**
 * Dominio da Ordem de Servico (Prompt 07).
 *
 * A OS E UMA ENTIDADE PROPRIA (item 5).
 *
 * Nao e um formulario do Cliente, nem uma aba do Equipamento, nem um
 * Recebimento com mais campos. Ela tem identidade, numero humano, dono
 * (tenant + unidade), autoria e historico proprios — e sobreviverA a
 * correcoes feitas depois no cadastro do cliente ou do aparelho.
 *
 * A FRONTEIRA COM O PROMPT 08 (item 3)
 *
 *   Prompt 07 = o que a Ordem de Servico E.
 *   Prompt 08 = como a Ordem de Servico MUDA DE ESTADO.
 *
 * Por isso este arquivo declara UM unico estado — o inicial — e nenhuma
 * transicao. Declarar aqui a lista inteira de estados futuros seria antecipar
 * a maquina de estados pela porta dos fundos: bastaria alguem escrever um
 * `if` em cima dela para o workflow comecar a existir espalhado, que e
 * exatamente o que a separacao entre os dois prompts existe para impedir.
 */

// ---------------------------------------------------------------------------
// Estado (itens 25, 26 e 27 do Prompt 07; formalizado no Prompt 08)
// ---------------------------------------------------------------------------

/**
 * O ESTADO E A MAQUINA DE ESTADOS VIVEM EM `workflow.ts`.
 *
 * O Prompt 07 declarou aqui um unico estado inicial, deliberadamente, para nao
 * antecipar o workflow. O Prompt 08 trouxe os estados oficiais e as transicoes
 * — e o lugar deles e um arquivo so, que e a autoridade. Reexportamos os nomes
 * que o restante do modulo ja usava, em vez de manter uma segunda lista aqui:
 * duas listas de estados divergem no primeiro ajuste.
 *
 * `status` continua persistido como texto de tamanho fixo, e nao como ENUM do
 * MySQL — foi essa decisao que permitiu ao Prompt 08 acrescentar oito estados
 * sem nenhum `ALTER TABLE ... MODIFY COLUMN`.
 */
export {
  SERVICE_ORDER_INITIAL_STATUS,
  SERVICE_ORDER_STATUSES,
  SERVICE_ORDER_STATUS_LABEL,
  statusLabel,
  statusTone,
  isTerminal,
  type ServiceOrderStatus,
} from './workflow';

// ---------------------------------------------------------------------------
// Numero humano (itens 13, 18 e 19)
// ---------------------------------------------------------------------------

/**
 * Prefixo e zeros a esquerda padrao da numeracao de OS.
 *
 * Ficam em `tenant_sequences` no momento da primeira alocacao, de onde a
 * apresentacao os le. O BANCO DA OS GUARDA SO O NUMERO (item 18): acoplar o
 * prefixo ao valor persistido tornaria irreversivel uma decisao de
 * apresentacao — mudar "OS" para outra sigla exigiria reescrever linhas
 * historicas, e dois formatos conviveriam na mesma empresa.
 */
export const SERVICE_ORDER_NUMBER_PREFIX = 'OS';
export const SERVICE_ORDER_NUMBER_PADDING = 6;

/**
 * Formata o numero para exibicao: `OS #000123`.
 *
 * O `#` separa a sigla do numero e deixa claro que aquilo e um identificador
 * de documento, nao uma quantidade.
 */
export function formatServiceOrderNumber(
  value: number,
  prefix: string = SERVICE_ORDER_NUMBER_PREFIX,
  padding: number = SERVICE_ORDER_NUMBER_PADDING,
): string {
  const digits = String(value).padStart(Math.max(0, padding), '0');
  return prefix ? `${prefix} #${digits}` : `#${digits}`;
}

/**
 * Interpreta o que a pessoa digitou na busca como numero de OS.
 *
 * Aceita `1234`, `OS 1234`, `OS #1234`, `os#001234` e devolve `1234`. Quem
 * procura uma OS no balcao digita do jeito que ela aparece impressa, nao o
 * inteiro cru — e uma busca que so aceita o inteiro cru obriga a pessoa a
 * traduzir mentalmente o que esta lendo.
 */
export function parseServiceOrderNumber(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return null;

  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value < 1) return null;
  return value;
}

// ---------------------------------------------------------------------------
// Relato do cliente x observacao interna (itens 21, 22 e 24)
// ---------------------------------------------------------------------------

/**
 * Limites de texto.
 *
 * O relato e generoso porque cliente descreve defeito em paragrafos; a
 * observacao interna e menor porque e recado de operacao, nao laudo.
 */
export const CUSTOMER_REPORT_MAX = 4000;
export const INTERNAL_NOTES_MAX = 2000;

/**
 * O RELATO DO CLIENTE NAO E DIAGNOSTICO (item 22).
 *
 * "Cliente informa que o aparelho nao liga" pertence a abertura.
 * "Fonte chaveada com MOSFET em curto" pertence ao trabalho tecnico, que
 * acontece depois e em outro lugar do sistema.
 *
 * Misturar os dois faz o atendente do balcao emitir parecer tecnico sem abrir
 * o aparelho — e faz o cliente receber como diagnostico aquilo que ele mesmo
 * disse. A separacao esta no modelo (duas colunas), na interface (dois campos
 * com rotulos explicitos) e aqui, no dominio.
 */
export function normalizeCustomerReport(raw: string): string {
  return raw.trim().replace(/\r\n/g, '\n');
}

// ---------------------------------------------------------------------------
// Etiqueta fisica (itens 81 a 85)
// ---------------------------------------------------------------------------

/**
 * Dados da etiqueta fisica da OS.
 *
 * A Constituicao fixa CINCO elementos e mais nenhum: nome do cliente, numero
 * da OS, tensao, indicacao de garantia quando aplicavel e QR Code.
 *
 * ESTE TIPO E O CONTRATO — NAO A ETIQUETA OPERACIONAL. Dois dos cinco
 * elementos dependem de dominios que ainda nao existem:
 *
 *   - `warranty` depende da classificacao de garantia (Prompt 13);
 *   - `qrToken` depende da referencia opaca segura (item 85).
 *
 * Ambos sao `null` hoje, e e assim que devem ficar ate existirem de verdade.
 * Preencher qualquer um deles com um palpite produziria etiqueta errada
 * colada num aparelho de cliente.
 */
export interface ServiceOrderLabelData {
  /** Nome do cliente, como cadastrado. */
  customerName: string;
  /** Numero da OS ja formatado para leitura humana. */
  number: string;
  /** Tensao do equipamento, em texto curto. `N/A` quando nao se aplica. */
  voltage: string;
  /** `null` enquanto a classificacao de garantia nao existir. */
  warranty: 'factory' | 'internal' | null;
  /** `null` enquanto a referencia opaca do QR nao existir. */
  qrToken: string | null;
}

/**
 * Tensao como ela deve aparecer na etiqueta (item 84).
 *
 * `not_applicable` vira `N/A`. `unknown` vira "Nao identificada" — escrito por
 * extenso, jamais deixado em branco nem substituido por um chute: etiqueta sem
 * tensao e etiqueta com tensao errada levam ao mesmo lugar, que e o tecnico
 * ligando um 110 na tomada de 220.
 */
export function labelVoltage(voltage: string): string {
  if (voltage === 'not_applicable') return 'N/A';
  if (voltage === 'unknown') return 'Nao identificada';
  if (voltage === 'bivolt') return 'Bivolt';
  if (voltage === 'v110') return '110 V';
  if (voltage === 'v127') return '127 V';
  if (voltage === 'v220') return '220 V';
  return 'Nao identificada';
}

/**
 * Monta os dados da etiqueta a partir do que existe.
 *
 * Recebe somente o necessario: qualquer campo a mais aqui viraria tentacao de
 * imprimir o que a Constituicao proibe (item 83 — telefone, CPF, endereco,
 * defeito, acessorios, tecnico, preco, marca, modelo, serial).
 */
export function buildLabelData(input: {
  customerName: string;
  number: number;
  voltage: string;
  numberPrefix?: string;
  numberPadding?: number;
}): ServiceOrderLabelData {
  return {
    customerName: input.customerName,
    number: formatServiceOrderNumber(input.number, input.numberPrefix, input.numberPadding),
    voltage: labelVoltage(input.voltage),
    warranty: null,
    qrToken: null,
  };
}

/**
 * A etiqueta so pode ser impressa quando os cinco elementos existirem.
 *
 * Hoje responde sempre `false`, e e a resposta honesta: sem QR e sem
 * classificacao de garantia, o que sairia da impressora nao seria a etiqueta
 * oficial do Nexo56 — seria tres quintos dela.
 */
export function isLabelPrintable(data: ServiceOrderLabelData): boolean {
  return data.qrToken !== null;
}

// ---------------------------------------------------------------------------
// Historico estrutural (itens 37 e 38)
// ---------------------------------------------------------------------------

/**
 * Tipos de fato da linha do tempo da OS.
 *
 * So existem os que acontecem de verdade neste prompt. O Prompt 08 acrescenta
 * `status_changed` e os demais sem migration nova: `kind` e texto, e a tabela
 * e apenas append.
 *
 * POR QUE ISSO NAO E O AUDITLOG (item 37): o AuditLog e trilha de seguranca —
 * responde "quem mexeu no que, e quando". A linha do tempo e narrativa de
 * negocio — responde "o que aconteceu com este aparelho". Os dois coincidem
 * hoje porque so ha dois fatos; deixariam de coincidir no primeiro orcamento
 * enviado ou peca encomendada, e reaproveitar o AuditLog como timeline
 * significaria expor nome de tabela e coluna a quem so quer acompanhar a OS.
 */
export const TIMELINE_KINDS = {
  // --- Prompt 07: abertura e correcao ---------------------------------------
  CREATED: 'created',
  CUSTOMER_REPORT_UPDATED: 'customer_report_updated',
  DETAILS_UPDATED: 'details_updated',

  // --- Prompt 08: workflow --------------------------------------------------
  STATUS_CHANGED: 'status_changed',
  TECHNICIAN_ASSIGNED: 'technician_assigned',
  FOLLOW_UP_RESCHEDULED: 'follow_up_rescheduled',
  PART_PICKUP_REQUESTED: 'part_pickup_requested',
  TASK_COMPLETED: 'task_completed',
  CUSTOMER_NOTIFICATION_REQUESTED: 'customer_notification_requested',

  // --- Prompt 10: estoque ---------------------------------------------------
  /**
   * RESUMO, nao copia do ledger (Prompt 10, item 69).
   *
   * A ficha da OS mostra "2 un. de Tela LCD reservadas"; quem quer a
   * movimentacao com custo, localizacao e ator abre a ficha da peca. Espelhar
   * o ledger inteiro aqui transformaria o historico do atendimento num extrato
   * de almoxarifado.
   */
  PART_RESERVED: 'part_reserved',
  PART_RESERVATION_RELEASED: 'part_reservation_released',
  PART_CONSUMED: 'part_consumed',

  // --- Prompt 13: garantias -------------------------------------------------
  /**
   * Na OS ORIGINAL: o aparelho voltou, e ha uma nova OS cuidando disso.
   *
   * E um FATO acrescentado a historia, nao uma mudanca: a OS original continua
   * finalizada, com o mesmo parecer e o mesmo numero (item 24). O vinculo
   * estrutural mora em `warranty_returns`; esta linha e o que a pessoa le.
   */
  WARRANTY_RETURN_LINKED: 'warranty_return_linked',
  /** Na OS DE GARANTIA: o defeito nao estava coberto, e virou orcamento. */
  WARRANTY_RECLASSIFIED: 'warranty_reclassified',
} as const;

export type TimelineKind = (typeof TIMELINE_KINDS)[keyof typeof TIMELINE_KINDS];

export const TIMELINE_LABEL: Readonly<Record<string, string>> = {
  [TIMELINE_KINDS.CREATED]: 'Ordem de Servico aberta',
  [TIMELINE_KINDS.CUSTOMER_REPORT_UPDATED]: 'Relato do cliente atualizado',
  [TIMELINE_KINDS.DETAILS_UPDATED]: 'Dados de abertura atualizados',
  [TIMELINE_KINDS.STATUS_CHANGED]: 'Situacao alterada',
  [TIMELINE_KINDS.TECHNICIAN_ASSIGNED]: 'Tecnico responsavel definido',
  [TIMELINE_KINDS.FOLLOW_UP_RESCHEDULED]: 'Acompanhamento reagendado',
  [TIMELINE_KINDS.PART_PICKUP_REQUESTED]: 'Busca de peca registrada',
  [TIMELINE_KINDS.TASK_COMPLETED]: 'Tarefa concluida',
  [TIMELINE_KINDS.WARRANTY_RETURN_LINKED]: 'Retorno em garantia registrado',
  [TIMELINE_KINDS.WARRANTY_RECLASSIFIED]: 'Reclassificada para orcamento',
  [TIMELINE_KINDS.CUSTOMER_NOTIFICATION_REQUESTED]: 'Cliente marcado como avisado',
  [TIMELINE_KINDS.PART_RESERVED]: 'Peca reservada',
  [TIMELINE_KINDS.PART_RESERVATION_RELEASED]: 'Reserva de peca liberada',
  [TIMELINE_KINDS.PART_CONSUMED]: 'Peca consumida',
};

export function timelineLabel(kind: string): string {
  return TIMELINE_LABEL[kind] ?? kind;
}

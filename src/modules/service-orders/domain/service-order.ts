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
// Estado inicial minimo (itens 25, 26 e 27)
// ---------------------------------------------------------------------------

/**
 * Estado com que toda OS nasce.
 *
 * A Constituicao preve que uma OS comum entre no fluxo aguardando o parecer
 * tecnico. Persistimos exatamente esse estado inicial formal — e NADA alem
 * disso: nao ha transicao, nao ha acao que o altere, nao ha regra que dependa
 * dele. O Prompt 08 sera a autoridade sobre a maquina de estados.
 *
 * `status` e persistido como texto livre de tamanho fixo, e nao como ENUM do
 * MySQL, justamente para que o Prompt 08 acrescente estados sem precisar de
 * um `ALTER TABLE ... MODIFY COLUMN` na coluna (item 157).
 */
export const SERVICE_ORDER_INITIAL_STATUS = 'awaiting_technical_opinion';

/**
 * Rotulo do unico estado que existe hoje.
 *
 * Deliberadamente um registro de uma entrada so: quando o Prompt 08 trouxer os
 * demais estados, eles entram aqui junto com o comportamento correspondente —
 * nunca antes.
 */
export const SERVICE_ORDER_STATUS_LABEL: Readonly<Record<string, string>> = {
  [SERVICE_ORDER_INITIAL_STATUS]: 'Aguardando parecer tecnico',
};

/** Rotulo legivel de um estado; desconhecido volta como veio, sem inventar. */
export function statusLabel(status: string): string {
  return SERVICE_ORDER_STATUS_LABEL[status] ?? status;
}

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
  CREATED: 'created',
  CUSTOMER_REPORT_UPDATED: 'customer_report_updated',
  DETAILS_UPDATED: 'details_updated',
} as const;

export type TimelineKind = (typeof TIMELINE_KINDS)[keyof typeof TIMELINE_KINDS];

export const TIMELINE_LABEL: Readonly<Record<string, string>> = {
  [TIMELINE_KINDS.CREATED]: 'Ordem de Servico aberta',
  [TIMELINE_KINDS.CUSTOMER_REPORT_UPDATED]: 'Relato do cliente atualizado',
  [TIMELINE_KINDS.DETAILS_UPDATED]: 'Dados de abertura atualizados',
};

export function timelineLabel(kind: string): string {
  return TIMELINE_LABEL[kind] ?? kind;
}

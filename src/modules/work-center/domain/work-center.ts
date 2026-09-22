import {
  isTerminal,
  SERVICE_ORDER_STATUS_LABEL,
  type ServiceOrderStatus,
} from '@/modules/service-orders/domain/workflow';

/**
 * CENTRAL DE TRABALHO (Prompt 15).
 *
 * O QUE ELA E: uma LEITURA que responde "o que precisa da minha atencao
 * agora?" sem obrigar ninguem a abrir modulo por modulo.
 *
 * O QUE ELA NAO E, e o modulo inteiro depende disso:
 *
 * NAO E UM SEGUNDO WORKFLOW. Nenhum estado novo de Ordem de Servico nasce
 * aqui. As filas abaixo sao os estados OFICIAIS do Prompt 08, agrupados para
 * leitura — "Urgente", "Parada" e "Na bancada" nao existem como estado, e
 * inventa-los criaria duas verdades sobre onde a OS esta.
 *
 * NAO E UMA SEGUNDA AGENDA. Tarefas continuam em `agenda_tasks` e
 * `service_order_tasks`; follow-up continua em `service_orders.follow_up_at`.
 * A Central LE essas fontes e nunca grava nelas.
 *
 * NAO E FONTE DE VERDADE. Nada aqui e persistido: as filas sao consultas e os
 * sinais de atencao sao derivados na hora (ADR-077).
 *
 * "Centralizar a atencao nao significa centralizar a autoridade."
 */

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

/**
 * AS FILAS SAO OS ESTADOS OFICIAIS, nao um vocabulario paralelo.
 *
 * Finalizada e Cancelada ficam de fora do trabalho ativo (item 162): elas nao
 * exigem acao de ninguem, e somadas ao resto empurrariam para baixo tudo que
 * realmente precisa acontecer. Continuam acessiveis pelo modulo de OS.
 */
export const WORK_QUEUES = [
  'awaiting_technical_opinion',
  'awaiting_approval',
  'awaiting_repair',
  'awaiting_part',
  'repair_completed',
  'awaiting_delivery_preparation',
  'awaiting_customer_pickup',
] as const satisfies readonly ServiceOrderStatus[];

export type WorkQueue = (typeof WORK_QUEUES)[number];

export function isWorkQueue(value: string): value is WorkQueue {
  return (WORK_QUEUES as readonly string[]).includes(value);
}

/** O rotulo vem do Prompt 08: um mapa so, nunca uma copia (item 193). */
export function workQueueLabel(queue: WorkQueue): string {
  return SERVICE_ORDER_STATUS_LABEL[queue];
}

/**
 * Texto curto do estado vazio de cada fila (item 57).
 *
 * Operacional, nao comemorativo: "Nenhuma OS aguardando parecer tecnico nesta
 * unidade" informa; "Tudo em dia!" faz a pessoa duvidar se a tela carregou.
 */
export const WORK_QUEUE_EMPTY: Record<WorkQueue, string> = {
  awaiting_technical_opinion: 'Nenhuma OS aguardando parecer tecnico nesta unidade.',
  awaiting_approval: 'Nenhuma OS aguardando aprovacao nesta unidade.',
  awaiting_repair: 'Nenhuma OS aguardando conserto nesta unidade.',
  awaiting_part: 'Nenhuma OS aguardando peca nesta unidade.',
  repair_completed: 'Nenhuma OS com reparo concluido nesta unidade.',
  awaiting_delivery_preparation: 'Nenhuma OS aguardando preparacao para entrega nesta unidade.',
  awaiting_customer_pickup: 'Nenhuma OS aguardando o cliente retirar nesta unidade.',
};

/** Uma OS entra no trabalho ativo enquanto nao estiver encerrada. */
export function isActiveWork(status: string): boolean {
  return isWorkQueue(status) && !isTerminal(status);
}

// ---------------------------------------------------------------------------
// Sinais de atencao
// ---------------------------------------------------------------------------

/**
 * ATENCAO NAO E STATUS (item 30).
 *
 * Estas sao flags DERIVADAS, calculadas na leitura a partir das fontes
 * oficiais. Nenhuma delas vira coluna: persistir "atrasada" exigiria um job
 * reescrevendo a carteira a meia-noite de cada fuso, e no dia em que ele
 * falhasse a tela diria "em dia" para o que esta vencido (ADR-074).
 */
export const ATTENTION_FLAGS = [
  /** `follow_up_at` ficou para tras na data civil da empresa. */
  'overdue_follow_up',
  /** `follow_up_at` e hoje. */
  'follow_up_today',
  /** Ha tarefa de fluxo ou da Agenda vencida ligada a esta OS. */
  'overdue_task',
  /** A OS nao tem tecnico atribuido. */
  'unassigned',
] as const;

export type AttentionFlag = (typeof ATTENTION_FLAGS)[number];

export function isAttentionFlag(value: string): value is AttentionFlag {
  return (ATTENTION_FLAGS as readonly string[]).includes(value);
}

/** Texto do badge. A cor sozinha nao informa (item 112). */
export const ATTENTION_FLAG_LABEL: Record<AttentionFlag, string> = {
  overdue_follow_up: 'Acompanhamento atrasado',
  follow_up_today: 'Acompanhar hoje',
  overdue_task: 'Tarefa atrasada',
  unassigned: 'Sem responsavel',
};

export const ATTENTION_FLAG_TONE: Record<AttentionFlag, 'danger' | 'warning' | 'neutral'> = {
  overdue_follow_up: 'danger',
  follow_up_today: 'warning',
  overdue_task: 'danger',
  unassigned: 'neutral',
};

/**
 * Deriva as flags de uma OS. Funcao PURA: recebe os fatos ja lidos do banco e
 * a data civil da empresa, e nao consulta nada.
 */
export function attentionFlagsFor(
  item: {
    followUpAt: string | null;
    hasOverdueTask: boolean;
    assigneeId: string | null;
  },
  today: string,
): AttentionFlag[] {
  const flags: AttentionFlag[] = [];

  if (item.followUpAt !== null) {
    if (item.followUpAt < today) flags.push('overdue_follow_up');
    else if (item.followUpAt === today) flags.push('follow_up_today');
  }

  if (item.hasOverdueTask) flags.push('overdue_task');
  if (item.assigneeId === null) flags.push('unassigned');

  return flags;
}

// ---------------------------------------------------------------------------
// Prioridade e ordenacao
// ---------------------------------------------------------------------------

/**
 * A PRECEDENCIA E DECLARADA, NAO ESCONDIDA (itens 27 e 28).
 *
 * Nao ha "score", nao ha peso arbitrario, nao ha float e nao ha aleatoriedade.
 * O mesmo conjunto de dados produz sempre a mesma ordem, e qualquer pessoa
 * consegue explicar por que a linha 1 veio antes da linha 2:
 *
 *   1. URGENCIA TEMPORAL — acompanhamento atrasado vem antes de tarefa
 *      atrasada, que vem antes de acompanhar hoje, que vem antes do resto.
 *   2. DATA DE REFERENCIA — dentro do mesmo grau de urgencia, o mais antigo
 *      primeiro. Sem data vai para o fim: nao compete com quem tem prazo.
 *   3. NUMERO DA OS — chave estavel que garante ordem total (item 158).
 *
 * "SEM RESPONSAVEL" NAO ENTRA NA PRECEDENCIA, de proposito. Uma OS sem
 * responsavel nao e mais urgente do que uma atrasada: ela e um problema de
 * distribuicao, nao de prazo. Continua sendo badge e filtro.
 *
 * O RANK E POSICAO, NAO PESO. Zero vem primeiro. Isso esta escrito porque o
 * Prompt 14 teve exatamente este defeito: um rank de posicao comparado como se
 * fosse peso invertia a ordem inteira, e so um teste de dominio pegou.
 */
export const URGENCY_RANK = {
  overdue_follow_up: 0,
  overdue_task: 1,
  follow_up_today: 2,
  none: 3,
} as const;

export type UrgencyRank = (typeof URGENCY_RANK)[keyof typeof URGENCY_RANK];

export function urgencyRankFor(flags: readonly AttentionFlag[]): UrgencyRank {
  if (flags.includes('overdue_follow_up')) return URGENCY_RANK.overdue_follow_up;
  if (flags.includes('overdue_task')) return URGENCY_RANK.overdue_task;
  if (flags.includes('follow_up_today')) return URGENCY_RANK.follow_up_today;
  return URGENCY_RANK.none;
}

/**
 * Um item da Central, na forma em que a tela o consome.
 *
 * E PROJECAO, nao entidade: nada disto e gravado em lugar nenhum (item 26).
 * Os campos opcionais existem porque modulos opcionais podem estar desligados
 * — e nesse caso eles simplesmente nao vem, em vez de virem vazios (item 92).
 */
export interface WorkCenterItem {
  serviceOrderId: string;
  /** Identificador humano; e ele que a pessoa procura no balcao (item 181). */
  number: number;
  status: ServiceOrderStatus;
  unitId: string;
  unitName: string | null;
  customerName: string;
  /** Resumo compacto: tipo, marca e modelo. Nunca a ficha inteira (item 64). */
  equipmentSummary: string;
  assigneeId: string | null;
  assigneeName: string | null;
  followUpAt: string | null;
  openTaskCount: number;
  flags: AttentionFlag[];
  urgency: UrgencyRank;
  /** Classificacao oficial da OS, quando houver (item 65). */
  classification: string | null;
  openedAt: Date;
}

/**
 * A data que manda no desempate: o acompanhamento, quando existe, porque e
 * ele que diz quando alguem prometeu olhar de novo. Sem acompanhamento, a
 * abertura — uma OS parada ha tres semanas precede uma de ontem.
 */
export function referenceDateOf(item: Pick<WorkCenterItem, 'followUpAt'>): string | null {
  return item.followUpAt;
}

export function compareWorkCenterItems(a: WorkCenterItem, b: WorkCenterItem): number {
  // 1. Urgencia temporal. Rank e POSICAO: crescente.
  if (a.urgency !== b.urgency) return a.urgency - b.urgency;

  // 2. Data de referencia, mais antiga primeiro; sem data vai para o fim.
  const dataA = referenceDateOf(a);
  const dataB = referenceDateOf(b);
  if (dataA !== dataB) {
    if (dataA === null) return 1;
    if (dataB === null) return -1;
    return dataA < dataB ? -1 : 1;
  }

  // 3. Numero da OS: chave estavel, ordem total garantida.
  return a.number - b.number;
}

// ---------------------------------------------------------------------------
// Visoes
// ---------------------------------------------------------------------------

/**
 * AS DUAS VISOES, e o que "minha" significa de verdade (itens 16 e 115).
 *
 * `mine` e o trabalho com VINCULO REAL com a pessoa: OS em que ela e a tecnica
 * atribuida. Nao inclui "tudo que esta sem responsavel", porque trabalho de
 * ninguem nao e trabalho meu — fingir esse vinculo encheria a tela de itens
 * que a pessoa nao reconhece como seus e a faria parar de olhar.
 *
 * `unit` e o trabalho operacional da unidade que a pessoa ja tem permissao de
 * ver. Nao ha permissao separada para isto: quem pode listar as OS da unidade
 * em `/ordens-de-servico` ja ve os mesmos registros, e criar uma chave so para
 * a Central seria esconder na cozinha o que esta servido no salao (item 116).
 */
export const WORK_VIEWS = ['mine', 'unit'] as const;
export type WorkView = (typeof WORK_VIEWS)[number];

export function isWorkView(value: string): value is WorkView {
  return (WORK_VIEWS as readonly string[]).includes(value);
}

export const WORK_VIEW_LABEL: Record<WorkView, string> = {
  mine: 'Minha visao',
  unit: 'Unidade',
};

/**
 * Resumo por fila, para os cartoes do topo.
 *
 * Os cartoes sao FILTROS, nao paineis (item 110): clicar em "Aguardando Peca"
 * filtra a lista abaixo, em vez de abrir uma tela nova para cada estado.
 */
export interface WorkQueueSummary {
  queue: WorkQueue;
  label: string;
  total: number;
}

/** Contagem dos sinais de atencao, na mesma leitura das filas (item 160). */
export interface AttentionSummary {
  overdueFollowUp: number;
  followUpToday: number;
  overdueTask: number;
  unassigned: number;
}

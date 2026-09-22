import { addDays, isOverdue } from '@/core/time/civil-date';

/**
 * AGENDA E TAREFAS — O DOMINIO (Prompt 14).
 *
 * A REGRA CENTRAL DO PRODUTO, que orienta tudo abaixo:
 * "Nenhuma Ordem de Servico importante deve ser esquecida."
 *
 * ---------------------------------------------------------------------------
 * O QUE E CADA COISA, E POR QUE NAO SAO A MESMA COISA (itens 3 a 11)
 * ---------------------------------------------------------------------------
 *
 * Quatro conceitos deste prompt tem data, e a tentacao e fundi-los num
 * "item com prazo". Fundir destroi informacao operacional:
 *
 * TASK — algo que uma PESSOA precisa fazer. Tem prazo opcional, responsavel
 *   opcional, prioridade. NAO reserva horario na agenda de ninguem: "conferir
 *   documentacao ate sexta" nao ocupa das 14h as 15h.
 *
 * APPOINTMENT — um COMPROMISSO com posicao temporal: visita tecnica, retirada
 *   agendada, entrega programada. Ocupa um intervalo (ou um dia inteiro). Uma
 *   task com prazo NAO e um compromisso: o prazo diz "ate quando", o
 *   compromisso diz "quando".
 *
 * FOLLOW-UP — o proximo ponto de atencao de uma Ordem de Servico. No Nexo56
 *   ele JA EXISTE desde o Prompt 08, e nao como tarefa: e a coluna
 *   `service_orders.follow_up_at`. Ele pertence a OS, move-se com o fluxo dela
 *   e some quando ela encerra. Transforma-lo em task o desligaria do estado da
 *   ordem — ver ADR-073.
 *
 * TAREFA DE FLUXO DA OS — `service_order_tasks`, tambem do Prompt 08: uma
 *   aberta por tipo por ordem, criada pelo proprio workflow. Nao e tarefa
 *   avulsa; e um passo operacional da ordem.
 *
 * E o que NENHUM deles e:
 *
 * OS STATUS — onde a ordem esta no fluxo. Agenda nao escreve nisso (item 8).
 * OS ACTION — "Buscar Peca", "Informar Ordem Disponivel": atos, nunca estados.
 * AUTOMATION — regra configuravel. Nao existe aqui (Prompt 19).
 * NOTIFICATION — envio externo. Nao existe aqui (Prompt 16). Ter tarefa
 *   "ligar para o cliente" NAO significa que alguem ligou.
 * REMINDER — mecanismo de lembrar. Nao ha plataforma de lembretes neste
 *   prompt; ha destaque visual de atraso, que e outra coisa (item 59).
 */

// ---------------------------------------------------------------------------
// Tarefa (itens 4, 24 a 30)
// ---------------------------------------------------------------------------

/**
 * `done`, NAO `completed` — o mesmo vocabulario de `service_order_tasks`
 * (Prompt 08). Duas tabelas de tarefa dizendo a mesma coisa com palavras
 * diferentes obrigariam toda consulta unificada a traduzir, e alguma
 * esqueceria. As colunas `completed_at`/`completed_by` seguem o nome que a
 * tabela do Prompt 08 ja usa, inclusive nessa mistura (ADR-073).
 */
export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type AgendaTaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<AgendaTaskStatus, string> = {
  open: 'Aberta',
  done: 'Concluida',
  cancelled: 'Cancelada',
};

export const TASK_STATUS_TONE: Record<AgendaTaskStatus, 'neutral' | 'success' | 'brand'> = {
  open: 'brand',
  done: 'success',
  cancelled: 'neutral',
};

export function isKnownTaskStatus(value: string): value is AgendaTaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * "ATRASADA" NAO E SITUACAO (itens 27 e 28).
 *
 * Persistir `overdue` exigiria um job reescrevendo a carteira toda a
 * meia-noite de cada fuso, e no dia em que ele falhasse a tela mostraria
 * "em dia" para tarefas vencidas — sem nenhum sinal de que algo deu errado.
 * E a mesma decisao ja tomada para "vencido" no Financeiro (ADR-055) e para a
 * vigencia de garantia (ADR-064).
 *
 * Atraso e a conjuncao de duas coisas, calculada na hora: a tarefa esta ABERTA
 * e o prazo ficou para tras no fuso de quem opera.
 */
export function isTaskOverdue(
  task: { status: string; dueDate: string | null },
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (task.status !== 'open') return false;
  if (!task.dueDate) return false;
  return isOverdue(task.dueDate, timeZone, now);
}

/** Dias de atraso, para a tela dizer "Atrasada ha 2 dias" em vez de so pintar. */
export function daysLate(dueDate: string, today: string): number {
  const fim = Date.parse(`${dueDate}T00:00:00Z`);
  const hoje = Date.parse(`${today}T00:00:00Z`);
  return Math.max(0, Math.round((hoje - fim) / 86_400_000));
}

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

/**
 * Ordem de urgencia para ordenacao. Nao e "matriz de severidade" (item 29):
 * sao quatro degraus que cabem na cabeca de quem abre a loja de manha.
 */
export const TASK_PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function isKnownPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

export const DEFAULT_TASK_PRIORITY: TaskPriority = 'normal';

export const TASK_TITLE_MAX = 160;
export const TASK_NOTES_MAX = 2000;
export const CANCEL_REASON_MIN = 5;
export const CANCEL_REASON_MAX = 300;

/**
 * Transicoes permitidas da tarefa (itens 35 a 37).
 *
 * `completed` e `cancelled` sao TERMINAIS: nao ha reabertura nesta versao, e
 * isso e decisao declarada, nao esquecimento (ADR-073). Reabrir uma tarefa
 * concluida apagaria `completed_at`/`completed_by` — o registro de que alguem
 * fez o trabalho. Quando reabrir for necessario, sera ato proprio, com
 * permissao propria e historico, nunca um `UPDATE` que volta o estado.
 */
export function canComplete(status: string): boolean {
  return status === 'open';
}

export function canCancel(status: string): boolean {
  return status === 'open';
}

export function canEdit(status: string): boolean {
  return status === 'open';
}

export function explainNotOpen(status: string): string {
  if (status === 'done') return 'Esta tarefa ja foi concluida.';
  if (status === 'cancelled') return 'Esta tarefa foi cancelada.';
  return 'Esta tarefa nao esta aberta.';
}

// ---------------------------------------------------------------------------
// Compromisso (itens 5, 45 a 49)
// ---------------------------------------------------------------------------

export const APPOINTMENT_STATUSES = ['scheduled', 'cancelled'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  cancelled: 'Cancelado',
};

export function isKnownAppointmentStatus(value: string): value is AppointmentStatus {
  return (APPOINTMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * NAO EXISTE `completed` PARA COMPROMISSO (item 47).
 *
 * A passagem do tempo nao prova que a visita aconteceu. Marcar automaticamente
 * como realizado tudo que ja passou encheria o historico de fatos que ninguem
 * confirmou — e o dia em que o tecnico faltou ficaria registrado como
 * atendimento feito. Quando "realizado" for necessario, sera um ato humano
 * explicito, com quem confirmou e quando.
 */

export const APPOINTMENT_TITLE_MAX = 160;
export const APPOINTMENT_NOTES_MAX = 2000;

/**
 * O compromisso e de HORARIO ou de DIA INTEIRO — nunca os dois (item 49).
 *
 * Um evento de dia inteiro NAO e "00:00 as 23:59 UTC": em Sao Paulo isso
 * comeca as 21h do dia anterior. Dia inteiro e DATA CIVIL, e por isso mora em
 * colunas proprias, separadas dos instantes.
 */
export type AppointmentWhen =
  | { allDay: false; startAt: Date; endAt: Date }
  | { allDay: true; startDate: string; endDate: string };

export function validateAppointmentWhen(when: AppointmentWhen): string | null {
  if (when.allDay) {
    if (when.endDate < when.startDate) {
      return 'O ultimo dia do compromisso nao pode ser anterior ao primeiro.';
    }
    return null;
  }
  if (when.endAt.getTime() <= when.startAt.getTime()) {
    return 'O fim do compromisso precisa ser depois do inicio.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Item da agenda (itens 55, 56 e 57)
// ---------------------------------------------------------------------------

/**
 * O QUE APARECE NA AGENDA, e de onde veio.
 *
 * A agenda AGREGA quatro origens e mantem cada uma identificavel. Isso e
 * projecao de leitura: nenhuma tarefa vira compromisso, nenhum follow-up vira
 * tarefa, e nada e copiado de uma tabela para outra.
 *
 * DEDUPLICACAO POR CONSTRUCAO (item 57): cada origem e uma tabela distinta e
 * contribui com os proprios registros. Nao existe caminho por onde o mesmo
 * trabalho apareca duas vezes, porque nenhum registro e projetado em dois
 * lugares.
 */
export const AGENDA_ITEM_TYPES = [
  /** Tarefa operacional propria da Agenda — manual, com ou sem OS. */
  'task',
  /** Compromisso com posicao temporal. */
  'appointment',
  /** Tarefa do fluxo da Ordem de Servico (Prompt 08). */
  'service_order_task',
  /** Proximo ponto de atencao da Ordem de Servico (Prompt 08). */
  'follow_up',
] as const;

export type AgendaItemType = (typeof AGENDA_ITEM_TYPES)[number];

export const AGENDA_ITEM_TYPE_LABEL: Record<AgendaItemType, string> = {
  task: 'Tarefa',
  appointment: 'Compromisso',
  service_order_task: 'Tarefa da OS',
  follow_up: 'Acompanhamento',
};

/** Texto curto que explica a origem na ficha (item 109). */
export const AGENDA_ITEM_TYPE_HINT: Record<AgendaItemType, string> = {
  task: 'Criada por uma pessoa nesta unidade.',
  appointment: 'Compromisso com horario reservado.',
  service_order_task: 'Gerada pelo fluxo da Ordem de Servico.',
  follow_up: 'Proximo ponto de atencao da Ordem de Servico.',
};

export function isKnownAgendaItemType(value: string): value is AgendaItemType {
  return (AGENDA_ITEM_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Recortes temporais (itens 33, 52 e 103)
// ---------------------------------------------------------------------------

/**
 * "Hoje", "atrasada" e "proximas" sao calculados na DATA CIVIL DA EMPRESA.
 *
 * Nao no fuso do navegador: o dono viajando nao pode ver como atrasada uma
 * tarefa que na loja ainda vence hoje. E a mesma regra do follow-up (Prompt 08)
 * e do vencimento financeiro (ADR-055).
 */
export const TASK_BUCKETS = ['overdue', 'today', 'upcoming', 'no_due'] as const;
export type TaskBucket = (typeof TASK_BUCKETS)[number];

export const TASK_BUCKET_LABEL: Record<TaskBucket, string> = {
  overdue: 'Atrasadas',
  today: 'Para hoje',
  upcoming: 'Proximas',
  no_due: 'Sem prazo',
};

export function bucketFor(dueDate: string | null, today: string): TaskBucket {
  if (!dueDate) return 'no_due';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return 'upcoming';
}

/** Janela padrao da agenda: a semana operacional a partir de hoje. */
export const DEFAULT_AGENDA_RANGE_DAYS = 7;

export function defaultAgendaRange(today: string): { from: string; to: string } {
  return { from: today, to: addDays(today, DEFAULT_AGENDA_RANGE_DAYS) };
}

/** Teto da janela consultavel, para a agenda nao virar varredura de historico. */
export const MAX_AGENDA_RANGE_DAYS = 92;

export function isRangeTooWide(from: string, to: string): boolean {
  const inicio = Date.parse(`${from}T00:00:00Z`);
  const fim = Date.parse(`${to}T00:00:00Z`);
  return fim - inicio > MAX_AGENDA_RANGE_DAYS * 86_400_000;
}

// ---------------------------------------------------------------------------
// Projecao de leitura da agenda (itens 55 a 57 e 102 a 109)
// ---------------------------------------------------------------------------

/**
 * UM ITEM DA AGENDA, venha de onde vier.
 *
 * As quatro origens tem colunas diferentes e respondem a perguntas diferentes,
 * mas a tela faz uma pergunta so: "o que tem para hoje?". Esta forma e o
 * denominador comum — e mantem `type`, porque esconder a origem faria a pessoa
 * tentar concluir um follow-up como se fosse tarefa.
 *
 * NADA AQUI E GRAVADO. E projecao: os registros continuam em `agenda_tasks`,
 * `agenda_appointments`, `service_order_tasks` e `service_orders` (ADR-073).
 */
export interface AgendaItem {
  type: AgendaItemType;
  /** Id do registro NA TABELA DE ORIGEM. Com `type`, identifica o item. */
  id: string;
  title: string;
  unitId: string;
  assigneeId: string | null;
  /**
   * Dia em que o item se ancora, em data civil. Tarefa e follow-up tem prazo;
   * compromisso de dia inteiro tem o primeiro dia; compromisso com horario tem
   * o dia local do inicio, calculado por quem consulta.
   */
  dueDate: string | null;
  /** Instantes, apenas para compromisso com horario. */
  startAt: Date | null;
  endAt: Date | null;
  allDay: boolean;
  /** Situacao NA ORIGEM: `open`, `scheduled`... Cada origem tem a sua. */
  status: string;
  /** So a tarefa propria tem prioridade; as outras origens nao a possuem. */
  priority: TaskPriority | null;
  serviceOrderId: string | null;
  serviceOrderNumber: number | null;
  customerName: string | null;
  /** Derivado, nunca persistido (ADR-074). */
  overdue: boolean;
}

/**
 * ORDEM DA AGENDA: por dia, e dentro do dia pelo que tem hora marcada.
 *
 * Quem abre a agenda quer saber o que vem primeiro. Compromisso com horario
 * vem antes das tarefas do mesmo dia porque ele TEM hora; tarefa sem prazo vem
 * por ultimo, porque nao compete com nada. Item sem dia nenhum fica no fim, em
 * vez de sumir: tarefa sem prazo continua sendo trabalho.
 */
export function compareAgendaItems(a: AgendaItem, b: AgendaItem): number {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }

  const horaA = a.startAt?.getTime() ?? null;
  const horaB = b.startAt?.getTime() ?? null;
  if (horaA !== horaB) {
    if (horaA === null) return 1;
    if (horaB === null) return -1;
    return horaA - horaB;
  }

  /**
   * Empate real: a prioridade desempata, e o titulo estabiliza a lista.
   *
   * `TASK_PRIORITY_RANK` e POSICAO, nao peso: `urgent` vale 0 porque vem
   * primeiro. Entao a comparacao e crescente — trata-la como peso inverteria a
   * ordem e colocaria o urgente por ultimo, que foi exatamente o defeito que o
   * teste de dominio pegou.
   *
   * Item sem prioridade (follow-up, compromisso, tarefa de fluxo) entra como
   * `normal`: ele nao e mais urgente nem menos que uma tarefa comum, so nao
   * tem o campo.
   */
  const posA = a.priority ? TASK_PRIORITY_RANK[a.priority] : TASK_PRIORITY_RANK.normal;
  const posB = b.priority ? TASK_PRIORITY_RANK[b.priority] : TASK_PRIORITY_RANK.normal;
  if (posA !== posB) return posA - posB;

  return a.title.localeCompare(b.title, 'pt-BR');
}

export interface AgendaDay {
  /** Data civil, ou `null` para o grupo dos itens sem dia. */
  date: string | null;
  items: AgendaItem[];
}

/**
 * Agrupa por dia preservando a ordem. O grupo sem dia vem por ultimo — e
 * existe mesmo vazio? Nao: grupo vazio na tela e ruido, entao so aparece
 * quando ha o que mostrar.
 */
export function groupAgendaByDay(items: readonly AgendaItem[]): AgendaDay[] {
  const ordenados = [...items].sort(compareAgendaItems);
  const grupos: AgendaDay[] = [];

  for (const item of ordenados) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.date === item.dueDate) {
      ultimo.items.push(item);
      continue;
    }
    grupos.push({ date: item.dueDate, items: [item] });
  }

  return grupos;
}

/**
 * Quantos itens vencidos ha na lista. Serve ao contador da navegacao (item
 * 105) e nao consulta nada: quem chamou ja tem a lista.
 */
export function countOverdue(items: readonly AgendaItem[]): number {
  return items.filter((item) => item.overdue).length;
}

import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';

/**
 * Maquina de estados da Ordem de Servico (Prompt 08).
 *
 * ESTE ARQUIVO E A AUTORIDADE. Nenhuma pagina, server action, componente,
 * handler ou repository decide se uma transicao pode acontecer — todos
 * perguntam aqui. Regra de workflow espalhada em `if (status === ...)` e
 * exatamente o que a separacao entre os Prompts 07 e 08 existe para impedir:
 * bastam dois lugares divergirem para a mesma OS poder e nao poder a mesma
 * coisa, dependendo de por onde a pessoa entrou.
 *
 * A SEPARACAO FORMAL QUE ESTE MODULO PRESERVA:
 *
 *   Entity        -> a OS (Prompt 07)
 *   State         -> aqui: onde a OS esta
 *   Classification-> futura (garantia, retorno) — Prompt 13
 *   Action        -> service-order-actions.ts: o que uma pessoa FAZ
 *   Event         -> outbox: o que ACONTECEU
 *   Rule          -> aqui: quais transicoes existem e o que exigem
 *   Permission    -> access-control: quem pode
 *   Automation    -> Prompt 19; hoje so ha um job que emite evento
 *
 * "Buscar Peca" e "Informar Ordem Disponivel" sao ACOES, nunca estados. Uma
 * acao pode causar uma transicao (informar disponivel leva a Aguardando
 * Cliente Retirar) ou nao causar nenhuma (buscar peca cria tarefa e a OS
 * continua Aguardando Peca).
 */

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

export const SERVICE_ORDER_STATUSES = [
  'awaiting_technical_opinion',
  'awaiting_approval',
  'awaiting_repair',
  'awaiting_part',
  'repair_completed',
  'awaiting_delivery_preparation',
  'awaiting_customer_pickup',
  'completed',
  'cancelled',
] as const;

export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

/** Estado com que toda OS comum nasce (Prompt 07, formalizado aqui). */
export const SERVICE_ORDER_INITIAL_STATUS: ServiceOrderStatus = 'awaiting_technical_opinion';

/**
 * A ORIGEM da ordem — e a UNICA coisa que decide o estado inicial.
 *
 * `standard`        : balcao, recebimento, cadastro. Nasce Aguardando Parecer.
 * `warranty_return` : retorno de Garantia Interna VIGENTE e COBERTA, cuja
 *                     cobertura ja foi avaliada por uma pessoa autorizada.
 */
export type ServiceOrderOrigin =
  | { kind: 'standard' }
  | { kind: 'warranty_return'; warrantyId: string; originalServiceOrderId: string };

/**
 * A EXCECAO FORMAL DO PROMPT 13 (itens 23, 27 e 110).
 *
 * Uma OS comum nasce em Aguardando Parecer Tecnico porque ninguem sabe ainda
 * o que o aparelho tem. Uma OS de retorno em garantia nasce em Aguardando
 * Conserto porque o parecer JA FOI DADO: o defeito foi diagnosticado na OS
 * original, a loja reconheceu a cobertura e mandar o aparelho para a fila de
 * parecer seria pedir de novo um trabalho que ja foi feito — e fazer o cliente
 * esperar duas vezes pelo mesmo conserto.
 *
 * A EXCECAO E INEXPLORAVEL POR CONSTRUCAO. Esta funcao nao recebe um estado:
 * recebe a ORIGEM, e nenhum caminho do sistema aceita `status` de fora na
 * criacao. Quem quiser nascer em Aguardando Conserto precisa de um retorno em
 * garantia de verdade — com garantia vigente, cobertura avaliada e permissao —
 * e nao de um campo escondido no formulario.
 */
export function initialStatusForOrigin(origin: ServiceOrderOrigin): ServiceOrderStatus {
  return origin.kind === 'warranty_return' ? 'awaiting_repair' : SERVICE_ORDER_INITIAL_STATUS;
}

export const SERVICE_ORDER_STATUS_LABEL: Record<ServiceOrderStatus, string> = {
  awaiting_technical_opinion: 'Aguardando Parecer Tecnico',
  awaiting_approval: 'Aguardando Aprovacao',
  awaiting_repair: 'Aguardando Conserto',
  awaiting_part: 'Aguardando Peca',
  repair_completed: 'Reparo Concluido',
  awaiting_delivery_preparation: 'Aguardando Preparacao para Entrega',
  awaiting_customer_pickup: 'Aguardando Cliente Retirar',
  completed: 'Finalizada',
  cancelled: 'Cancelada',
};

/**
 * Tom visual do estado.
 *
 * COR NUNCA E A REGRA (item 86): o rotulo em texto acompanha o tom em toda
 * superficie. Quem nao distingue verde de amarelo continua sabendo em que
 * situacao a ordem esta.
 */
export const SERVICE_ORDER_STATUS_TONE: Record<
  ServiceOrderStatus,
  'neutral' | 'brand' | 'success' | 'warning' | 'danger'
> = {
  awaiting_technical_opinion: 'brand',
  awaiting_approval: 'warning',
  awaiting_repair: 'brand',
  awaiting_part: 'warning',
  repair_completed: 'success',
  awaiting_delivery_preparation: 'brand',
  awaiting_customer_pickup: 'warning',
  completed: 'success',
  cancelled: 'neutral',
};

/**
 * Estados TERMINais (itens 54 e 55).
 *
 * De `completed` e `cancelled` nao se sai. Reabertura, se um dia existir, sera
 * caso de uso dedicado e auditado — nunca uma transicao comum, e jamais um
 * `UPDATE` de status.
 */
export const TERMINAL_STATUSES: readonly ServiceOrderStatus[] = ['completed', 'cancelled'];

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isKnownStatus(status: string): status is ServiceOrderStatus {
  return (SERVICE_ORDER_STATUSES as readonly string[]).includes(status);
}

export function statusLabel(status: string): string {
  return isKnownStatus(status) ? SERVICE_ORDER_STATUS_LABEL[status] : status;
}

export function statusTone(status: string): 'neutral' | 'brand' | 'success' | 'warning' | 'danger' {
  return isKnownStatus(status) ? SERVICE_ORDER_STATUS_TONE[status] : 'neutral';
}

// ---------------------------------------------------------------------------
// Transicoes
// ---------------------------------------------------------------------------

export interface TransitionRule {
  from: ServiceOrderStatus;
  to: ServiceOrderStatus;
  /** Rotulo do BOTAO que executa a transicao, em pt-BR. */
  label: string;
  /** Permissao exigida. Avaliada sempre no escopo da UNIDADE da ordem. */
  permission: PermissionKey;
  /** `true` quando a transicao exige justificativa escrita. */
  requiresReason?: boolean;
  /**
   * `true` quando a transicao so pode ser disparada por uma ACAO especifica,
   * e nao pelo botao generico de mudanca de situacao.
   */
  actionOnly?: boolean;
  /** Explicacao curta do efeito, para a confirmacao. */
  hint?: string;
}

/**
 * A MATRIZ. Tudo que nao esta aqui e proibido (item 8).
 *
 * Nao existe "qualquer estado vira qualquer outro": cada linha foi escolhida
 * porque descreve algo que acontece de verdade numa assistencia.
 */
export const TRANSITIONS: readonly TransitionRule[] = [
  // --- parecer tecnico ------------------------------------------------------
  {
    from: 'awaiting_technical_opinion',
    to: 'awaiting_repair',
    label: 'Liberar para conserto',
    permission: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    hint: 'O parecer dispensou aprovacao do cliente.',
  },
  {
    /**
     * Quando o parecer conclui que ha custo a aprovar. O ORCAMENTO em si e do
     * Prompt 09: aqui existe apenas o estado que ele vai alimentar (item 15).
     */
    from: 'awaiting_technical_opinion',
    to: 'awaiting_approval',
    label: 'Enviar para aprovacao',
    permission: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    hint: 'O cliente precisa aprovar antes do conserto.',
  },

  // --- aprovacao ------------------------------------------------------------
  {
    from: 'awaiting_approval',
    to: 'awaiting_repair',
    label: 'Registrar aprovacao',
    permission: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    hint: 'O cliente aprovou. O conserto pode comecar.',
  },

  // --- conserto -------------------------------------------------------------
  {
    from: 'awaiting_repair',
    to: 'awaiting_part',
    label: 'Marcar falta de peca',
    permission: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    hint: 'O conserto depende de uma peca que nao esta disponivel.',
  },
  {
    from: 'awaiting_repair',
    to: 'repair_completed',
    label: 'Concluir reparo',
    permission: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    hint: 'Conclusao TECNICA. O aparelho ainda nao esta pronto para entrega.',
  },

  {
    /**
     * RECLASSIFICACAO DE GARANTIA (Prompt 13, itens 29 a 32).
     *
     * A OS de retorno em garantia nasceu em Aguardando Conserto porque o
     * parecer ja existia — o defeito fora diagnosticado na OS original. Quando
     * o tecnico abre o aparelho e descobre que a causa e OUTRA (oxidacao
     * posterior, queda, intervencao de terceiro), aquele parecer deixa de
     * valer: e preciso um novo, e dele sai o orcamento.
     *
     * POR QUE `actionOnly`. Esta transicao NAO aparece no seletor generico de
     * situacao. Ela so acontece pela acao de reclassificar, que exige
     * `warranties.reclassify` alem desta permissao, e justificativa tecnica
     * escrita. Sem `actionOnly`, qualquer pessoa com permissao de transicao
     * poderia devolver uma OS de Aguardando Conserto para a fila de parecer
     * pelo botao comum — o que nao e o que esta regra descreve.
     *
     * POR QUE NAO IR DIRETO PARA Aguardando Aprovacao: nao ha orcamento ainda.
     * Pular o parecer criaria uma OS esperando o cliente aprovar um valor que
     * ninguem calculou.
     */
    from: 'awaiting_repair',
    to: 'awaiting_technical_opinion',
    label: 'Reclassificar para orcamento',
    permission: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    requiresReason: true,
    actionOnly: true,
    hint: 'O defeito nao esta coberto pela garantia e precisa de novo parecer.',
  },

  // --- peca -----------------------------------------------------------------
  {
    from: 'awaiting_part',
    to: 'awaiting_repair',
    label: 'Peca disponivel',
    permission: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    hint: 'A peca chegou e o conserto pode continuar.',
  },

  // --- preparacao -----------------------------------------------------------
  {
    /**
     * NAO e automatica (item 59). Reparo concluido e o fim do trabalho do
     * tecnico; a preparacao e de outra pessoa, e pular esse passo faria o
     * aparelho ir para o balcao sujo e sem conferencia.
     */
    from: 'repair_completed',
    to: 'awaiting_delivery_preparation',
    label: 'Enviar para preparacao',
    permission: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    hint: 'Cria a tarefa de limpeza, conferencia e preparacao.',
  },
  {
    /**
     * SO pela acao "Informar Ordem Disponivel" (itens 17, 62 e 132), e so
     * depois de a preparacao estar concluida. Por isso `actionOnly`.
     */
    from: 'awaiting_delivery_preparation',
    to: 'awaiting_customer_pickup',
    label: 'Informar Ordem Disponivel',
    permission: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    actionOnly: true,
    hint: 'Avisa que o aparelho esta pronto para retirada.',
  },

  // --- encerramento ---------------------------------------------------------
  {
    from: 'awaiting_customer_pickup',
    to: 'completed',
    label: 'Finalizar',
    permission: PERMISSIONS.SERVICE_ORDERS_COMPLETE,
    hint: 'O cliente retirou o aparelho. A ordem passa a ser historico.',
  },
];

/**
 * Cancelamento (item 53).
 *
 * Sai de qualquer estado NAO terminal, exige permissao propria e exige motivo.
 * Fica fora da matriz principal porque nao e um passo do fluxo: e a saida de
 * emergencia dele.
 */
export const CANCEL_RULE: Omit<TransitionRule, 'from'> = {
  to: 'cancelled',
  label: 'Cancelar Ordem de Servico',
  permission: PERMISSIONS.SERVICE_ORDERS_CANCEL,
  requiresReason: true,
  hint: 'Encerra a ordem sem conclusao. Nao e possivel desfazer.',
};

/** Todas as transicoes validas a partir de um estado, cancelamento incluso. */
export function transitionsFrom(status: string): TransitionRule[] {
  if (!isKnownStatus(status) || isTerminal(status)) return [];

  const rules = TRANSITIONS.filter((rule) => rule.from === status);
  return [...rules, { ...CANCEL_RULE, from: status }];
}

/** Transicoes que a interface oferece como botao generico de situacao. */
export function manualTransitionsFrom(status: string): TransitionRule[] {
  return transitionsFrom(status).filter((rule) => !rule.actionOnly);
}

export function findTransition(from: string, to: string): TransitionRule | null {
  if (!isKnownStatus(from) || !isKnownStatus(to)) return null;
  if (isTerminal(from)) return null;
  if (to === 'cancelled') return { ...CANCEL_RULE, from };
  return TRANSITIONS.find((rule) => rule.from === from && rule.to === to) ?? null;
}

/**
 * Motivo pelo qual uma transicao NAO e possivel, em portugues.
 *
 * A interface usa isto para responder "por que nao posso?" (item 80) em vez de
 * mostrar um botao desabilitado e mudo.
 */
export function explainRefusal(from: string, to: string): string {
  if (!isKnownStatus(from)) return 'A situacao atual desta Ordem de Servico nao e reconhecida.';
  if (!isKnownStatus(to)) return 'Situacao de destino desconhecida.';

  if (isTerminal(from)) {
    return `Esta Ordem de Servico esta ${SERVICE_ORDER_STATUS_LABEL[from]} e nao pode mais mudar de situacao.`;
  }
  if (from === to) return 'A Ordem de Servico ja esta nesta situacao.';

  return `Esta Ordem de Servico nao pode ir de ${SERVICE_ORDER_STATUS_LABEL[from]} diretamente para ${SERVICE_ORDER_STATUS_LABEL[to]}.`;
}

// ---------------------------------------------------------------------------
// Follow-up (itens 33 a 40)
// ---------------------------------------------------------------------------

/**
 * Prazos padrao, em DIAS CORRIDOS.
 *
 * A Constituicao fixa +2 e +3 dias e nao menciona dias uteis. Inventar um
 * calendario de feriados seria criar regra que ninguem pediu — e calendario
 * errado atrasa atendimento de verdade. Dias corridos ficam documentados como
 * a escolha, revisavel quando houver decisao de negocio (item 38).
 */
export const FOLLOW_UP_ON_CREATION_DAYS = 2;
export const FOLLOW_UP_ON_AWAITING_REPAIR_DAYS = 3;

/**
 * Politica de follow-up por estado de destino (item 126).
 *
 *   'set'   -> grava um novo prazo, com os dias indicados
 *   'keep'  -> mantem o prazo vigente
 *   'clear' -> encerra o follow-up: a ordem sai do radar de pendencias
 *
 * Onde a Constituicao nao definiu prazo, MANTEMOS o vigente em vez de inventar
 * um numero. O prazo continua ajustavel a mao por quem acompanha a ordem.
 */
export type FollowUpPolicy = { kind: 'set'; days: number } | { kind: 'keep' } | { kind: 'clear' };

export function followUpPolicyFor(to: ServiceOrderStatus): FollowUpPolicy {
  if (to === 'awaiting_repair') return { kind: 'set', days: FOLLOW_UP_ON_AWAITING_REPAIR_DAYS };
  // Terminal nao gera mais alerta (itens 127 e 128).
  if (to === 'completed' || to === 'cancelled') return { kind: 'clear' };
  return { kind: 'keep' };
}

// ---------------------------------------------------------------------------
// Motivo (itens 52, 107 e 108)
// ---------------------------------------------------------------------------

export const REASON_MAX = 300;

export function requiresReason(rule: TransitionRule): boolean {
  return rule.requiresReason === true;
}

// ---------------------------------------------------------------------------
// Tarefas de workflow (itens 22, 23, 30 a 32)
// ---------------------------------------------------------------------------

export const TASK_KINDS = {
  /** Limpeza, conferencia e preparacao antes da entrega. */
  DELIVERY_PREPARATION: 'delivery_preparation',
  /** Busca/retirada da peca que falta. */
  PART_PICKUP: 'part_pickup',
} as const;

export type TaskKind = (typeof TASK_KINDS)[keyof typeof TASK_KINDS];

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Aberta',
  done: 'Concluida',
  cancelled: 'Cancelada',
};

/**
 * TEXTO OFICIAL da tarefa de preparacao (item 23).
 *
 * Vem da Constituicao e nao deve ser parafraseado: e o que a pessoa le na
 * bancada, e "conferencia estetica" nao e a mesma coisa que "conferir".
 */
export const DELIVERY_PREPARATION_TASK_TITLE = 'Preparar equipamento para entrega';

/**
 * TEXTO OFICIAL DA TAREFA DE PREPARACAO — COM ACENTOS, DE PROPOSITO.
 *
 * O restante do codigo escreve portugues sem acentos; esta constante e a
 * excecao deliberada porque ela NAO e comentario nem rotulo de tela montado
 * aqui: e o texto normativo definido pela Constituicao do Nexo56, e o lugar
 * onde ele aparece e a bancada do tecnico. "conferencia estetica" foi um
 * empobrecimento acidental da especificacao, nao uma decisao.
 *
 * A IDENTIDADE DA TAREFA NAO DEPENDE DESTE TEXTO. Quem diz que duas tarefas
 * sao a mesma e `(service_order_id, kind, open_marker)` — ver `createWorkflowTask`
 * e a UNIQUE `uq_so_task_open`. Por isso corrigir a redacao nao cria segunda
 * tarefa, nao reabre tarefa concluida e nao altera estado de OS nenhuma
 * (ADR-075).
 */
export const DELIVERY_PREPARATION_TASK_DESCRIPTION =
  'Realizar limpeza final, conferência estética e preparação do equipamento para entrega ao cliente.';

/**
 * A REDACAO ANTIGA, preservada para a migration 0013 reconhecer exatamente as
 * linhas que ela mesma gravou — e apenas essas. Nada no fluxo escreve este
 * valor; ele existe para o backfill e para o teste que prova que o backfill
 * acertou o alvo.
 */
export const DELIVERY_PREPARATION_TASK_DESCRIPTION_LEGACY =
  'Realizar limpeza final, conferencia estetica e preparacao do equipamento para entrega ao cliente.';

export const PART_PICKUP_TASK_TITLE = 'Buscar peca';

/** Prazo padrao da tarefa de preparacao, em dias corridos. */
export const DELIVERY_PREPARATION_DUE_DAYS = 2;

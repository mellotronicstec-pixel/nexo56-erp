/**
 * Eventos internos de dominio (Prompt 01, item 31).
 *
 * Apenas eventos que a fundacao realmente emite. Eventos de negocio
 * (WORK_ORDER_CREATED, QUOTE_APPROVED...) serao declarados pelos respectivos
 * modulos, nos seus proprios prompts.
 */

export const EVENT_TYPES = {
  USER_LOGGED_IN: 'USER_LOGGED_IN',
  USER_LOGGED_OUT: 'USER_LOGGED_OUT',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  TENANT_CREATED: 'TENANT_CREATED',
  UNIT_CREATED: 'UNIT_CREATED',
  USER_CREATED: 'USER_CREATED',
  MODULE_ENABLED: 'MODULE_ENABLED',
  MODULE_DISABLED: 'MODULE_DISABLED',
  FEATURE_ENABLED: 'FEATURE_ENABLED',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  PLAN_ENTITLEMENT_CHANGED: 'PLAN_ENTITLEMENT_CHANGED',

  // --- Prompt 03: gestao de acesso ----------------------------------------
  USER_UPDATED: 'USER_UPDATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_ACTIVATED: 'USER_ACTIVATED',
  USER_UNIT_GRANTED: 'USER_UNIT_GRANTED',
  USER_UNIT_REVOKED: 'USER_UNIT_REVOKED',
  ROLE_CREATED: 'ROLE_CREATED',
  ROLE_ASSIGNED: 'ROLE_ASSIGNED',
  ROLE_REVOKED: 'ROLE_REVOKED',
  ROLE_PERMISSIONS_CHANGED: 'ROLE_PERMISSIONS_CHANGED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  SESSION_REVOKED: 'SESSION_REVOKED',

  // --- Prompt 05: clientes -------------------------------------------------
  CUSTOMER_CREATED: 'CUSTOMER_CREATED',
  CUSTOMER_UPDATED: 'CUSTOMER_UPDATED',
  CUSTOMER_STATUS_CHANGED: 'CUSTOMER_STATUS_CHANGED',

  // --- Prompt 06: equipamentos e recebimento -------------------------------
  EQUIPMENT_CREATED: 'EQUIPMENT_CREATED',
  EQUIPMENT_UPDATED: 'EQUIPMENT_UPDATED',
  EQUIPMENT_INTAKE_CREATED: 'EQUIPMENT_INTAKE_CREATED',
  EQUIPMENT_MEDIA_ADDED: 'EQUIPMENT_MEDIA_ADDED',
  EQUIPMENT_LABEL_CONFIRMED: 'EQUIPMENT_LABEL_CONFIRMED',

  // --- Prompt 07: ordem de servico -----------------------------------------
  SERVICE_ORDER_CREATED: 'SERVICE_ORDER_CREATED',
  SERVICE_ORDER_UPDATED: 'SERVICE_ORDER_UPDATED',

  // --- Prompt 08: workflow --------------------------------------------------
  SERVICE_ORDER_STATUS_CHANGED: 'SERVICE_ORDER_STATUS_CHANGED',
  SERVICE_ORDER_TECHNICIAN_ASSIGNED: 'SERVICE_ORDER_TECHNICIAN_ASSIGNED',
  SERVICE_ORDER_TASK_CREATED: 'SERVICE_ORDER_TASK_CREATED',
  SERVICE_ORDER_TASK_COMPLETED: 'SERVICE_ORDER_TASK_COMPLETED',
  /** Intencao de avisar o cliente. O envio real e do Prompt 16. */
  SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED: 'SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED',
  SERVICE_ORDER_FOLLOW_UP_OVERDUE: 'SERVICE_ORDER_FOLLOW_UP_OVERDUE',

  // --- Prompt 09: orcamentos ------------------------------------------------
  QUOTE_CREATED: 'QUOTE_CREATED',
  /**
   * A proposta foi FORMALIZADA. Nao significa que uma mensagem saiu: nao ha
   * canal de comunicacao (Prompt 16). E o gancho de que ele vai precisar.
   */
  QUOTE_SENT: 'QUOTE_SENT',
  QUOTE_APPROVED: 'QUOTE_APPROVED',
  QUOTE_REJECTED: 'QUOTE_REJECTED',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  QUOTE_CANCELLED: 'QUOTE_CANCELLED',
  QUOTE_REVISED: 'QUOTE_REVISED',

  // --- Prompt 10: estoque e pecas -------------------------------------------
  PART_CREATED: 'PART_CREATED',
  PART_UPDATED: 'PART_UPDATED',
  STOCK_RECEIVED: 'STOCK_RECEIVED',
  STOCK_ISSUED: 'STOCK_ISSUED',
  STOCK_ADJUSTED: 'STOCK_ADJUSTED',
  STOCK_TRANSFERRED: 'STOCK_TRANSFERRED',
  STOCK_RESERVED: 'STOCK_RESERVED',
  STOCK_RESERVATION_RELEASED: 'STOCK_RESERVATION_RELEASED',
  /** Reserva virou consumo fisico, numa unica operacao (item 105). */
  STOCK_RESERVATION_CONSUMED: 'STOCK_RESERVATION_CONSUMED',
  /**
   * Disponivel caiu abaixo do minimo da unidade (itens 60 a 63).
   *
   * NAO HA CONSUMIDOR. Nao existe Rule Engine (item 171), nao existe canal de
   * comunicacao (item 170) e nao existe compra (item 61). O evento e o gancho
   * de que esses modulos vao precisar — e dizer que "o estoque baixo e
   * notificado" seria mentira enquanto so existir isto.
   */
  LOW_STOCK_DETECTED: 'LOW_STOCK_DETECTED',

  // --- Prompt 11: fornecedores e compras ------------------------------------
  SUPPLIER_CREATED: 'SUPPLIER_CREATED',
  SUPPLIER_UPDATED: 'SUPPLIER_UPDATED',
  PURCHASE_NEED_CREATED: 'PURCHASE_NEED_CREATED',
  PURCHASE_ORDER_CREATED: 'PURCHASE_ORDER_CREATED',
  PURCHASE_ORDER_APPROVED: 'PURCHASE_ORDER_APPROVED',
  /** O pedido foi feito ao fornecedor FORA do sistema, e alguem registrou. */
  PURCHASE_ORDER_PLACED: 'PURCHASE_ORDER_PLACED',
  PURCHASE_ORDER_PARTIALLY_RECEIVED: 'PURCHASE_ORDER_PARTIALLY_RECEIVED',
  PURCHASE_ORDER_RECEIVED: 'PURCHASE_ORDER_RECEIVED',
  PURCHASE_ORDER_CANCELLED: 'PURCHASE_ORDER_CANCELLED',
  /**
   * A mercadoria chegou e virou saldo.
   *
   * O Prompt 12 tornou este o MOMENTO em que a obrigacao financeira nasce
   * (ADR-057) — mas a criacao continua sendo uma ACAO DE PESSOA na ficha do
   * pedido, e nao um consumidor automatico deste evento. O evento segue sendo
   * o registro do fato; quem confere a nota e quem decide pagar.
   */
  PURCHASE_RECEIPT_CREATED: 'PURCHASE_RECEIPT_CREATED',

  // --- Prompt 12: financeiro ------------------------------------------------
  /**
   * Uma OBRIGACAO nasceu. Nao ha dinheiro nenhum envolvido ainda: um titulo e
   * um direito ou um dever, e a liquidacao e outro fato, com outra data.
   */
  RECEIVABLE_CREATED: 'RECEIVABLE_CREATED',
  PAYABLE_CREATED: 'PAYABLE_CREATED',
  FINANCIAL_TITLE_CANCELLED: 'FINANCIAL_TITLE_CANCELLED',
  /** Dinheiro do cliente ENTROU. */
  CUSTOMER_PAYMENT_RECEIVED: 'CUSTOMER_PAYMENT_RECEIVED',
  /** Dinheiro da empresa SAIU. */
  SUPPLIER_PAYMENT_MADE: 'SUPPLIER_PAYMENT_MADE',
  /** Uma liquidacao foi desfeita por contramovimento. Nada foi apagado. */
  FINANCIAL_SETTLEMENT_REVERSED: 'FINANCIAL_SETTLEMENT_REVERSED',
  CASH_SESSION_OPENED: 'CASH_SESSION_OPENED',
  CASH_SESSION_CLOSED: 'CASH_SESSION_CLOSED',
  CASH_SUPPLY_RECORDED: 'CASH_SUPPLY_RECORDED',
  CASH_WITHDRAWAL_RECORDED: 'CASH_WITHDRAWAL_RECORDED',
  /**
   * TODA a cobranca de uma Ordem de Servico foi liquidada (item 79).
   *
   * Publicado UMA vez, quando o ultimo titulo daquela OS chega a saldo zero —
   * nunca a cada recebimento parcial. E o gancho do Prompt 13 (Garantias),
   * para o dia em que o pagamento final disparar a documentacao de garantia.
   *
   * O PROMPT 13 CHEGOU E DELIBERADAMENTE NAO O CONSOME (ADR-063).
   *
   * Pagamento integral nao e prova de entrega fisica: o cliente paga por PIX
   * na terca e busca o aparelho na sexta. Emitir garantia aqui dataria a
   * cobertura tres dias antes de o aparelho sair da loja. Quem habilita a
   * emissao e a FINALIZACAO da OS — o ato em que o cliente retira. Este evento
   * segue publicado, e util para quem quiser lembrar o balcao de emitir; nao
   * ha handler, e a situacao da Ordem de Servico NAO muda por causa dele.
   */
  SERVICE_ORDER_FINANCIAL_SETTLED: 'SERVICE_ORDER_FINANCIAL_SETTLED',

  // --- Garantias (Prompt 13, item 67) ---------------------------------------
  /** Garantia criada, ainda em rascunho: nao vale contra a loja. */
  WARRANTY_CREATED: 'WARRANTY_CREATED',
  /** Garantia EMITIDA: a partir daqui ela vale, com os termos congelados. */
  WARRANTY_ACTIVATED: 'WARRANTY_ACTIVATED',
  /** Certificado gerado para uma garantia ja emitida. */
  WARRANTY_CERTIFICATE_ISSUED: 'WARRANTY_CERTIFICATE_ISSUED',
  /** O aparelho voltou. Registrar o retorno nao decide cobertura. */
  WARRANTY_RETURN_REGISTERED: 'WARRANTY_RETURN_REGISTERED',
  /** O retorno coberto gerou uma NOVA Ordem de Servico, vinculada a original. */
  WARRANTY_RETURN_SERVICE_ORDER_CREATED: 'WARRANTY_RETURN_SERVICE_ORDER_CREATED',
  /**
   * O tecnico concluiu que o defeito NAO estava coberto.
   *
   * ESTE EVENTO E O FATO DE COMUNICACAO PENDENTE (item 30). O cliente esperava
   * conserto gratuito e vai receber orcamento — alguem precisa dizer isso a
   * ele. O Prompt 16 ainda nao existe, entao nada e enviado: o evento fica no
   * outbox com o minimo necessario, SEM o texto da justificativa, para que o
   * canal futuro saiba a quem falar sem que o payload carregue dado sensivel.
   */
  WARRANTY_RETURN_RECLASSIFIED_TO_QUOTE: 'WARRANTY_RETURN_RECLASSIFIED_TO_QUOTE',
  /** Garantia cancelada: emitida por engano, antes de produzir efeito. */
  WARRANTY_CANCELLED: 'WARRANTY_CANCELLED',
  /** Garantia revogada: a cobertura existia e deixou de valer. */
  WARRANTY_REVOKED: 'WARRANTY_REVOKED',

  // --- Prompt 14: agenda e tarefas -----------------------------------------
  /**
   * SEIS EVENTOS, e nenhum para "editei a prioridade" (item 87).
   *
   * O criterio e o mesmo do resto do outbox: publica-se o que outro modulo
   * poderia querer saber, nao cada alteracao de campo. Trocar o prazo de uma
   * tarefa nao muda nada para ninguem de fora; atribui-la a alguem, sim.
   *
   * O PAYLOAD LEVA IDENTIFICADORES (item 88). Nunca o titulo, as notas, o
   * nome do cliente ou o contexto tecnico: nota de tarefa e texto livre de
   * quem opera, e o outbox nao e lugar para isso.
   *
   * NENHUM DELES ENVIA NADA (item 11). Tarefa "ligar para o cliente" criada
   * nao significa cliente avisado — a Comunicacao e o Prompt 16.
   */
  TASK_CREATED: 'TASK_CREATED',
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_CANCELLED: 'TASK_CANCELLED',
  APPOINTMENT_CREATED: 'APPOINTMENT_CREATED',
  APPOINTMENT_RESCHEDULED: 'APPOINTMENT_RESCHEDULED',
  APPOINTMENT_CANCELLED: 'APPOINTMENT_CANCELLED',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  type: EventType;
  tenantId: string | null;
  payload: TPayload;
  correlationId: string | null;
  occurredAt: Date;
}

export type EventHandler = (event: DomainEvent) => Promise<void> | void;

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
   * E o gancho que o Prompt 12 vai consumir para gerar Conta a Pagar. HOJE NAO
   * HA CONSUMIDOR: nenhum titulo financeiro e criado, nenhum pagamento e
   * registrado (itens 42 e 88).
   */
  PURCHASE_RECEIPT_CREATED: 'PURCHASE_RECEIPT_CREATED',
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

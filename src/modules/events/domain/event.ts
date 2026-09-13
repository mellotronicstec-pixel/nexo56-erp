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

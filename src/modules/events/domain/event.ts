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

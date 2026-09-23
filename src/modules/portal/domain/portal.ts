/**
 * PORTAL DO CLIENTE — vocabulario e constantes (Prompt 17).
 *
 * A SEPARACAO FORMAL QUE ESTE MODULO PRESERVA (item 7 a 9):
 *
 *   Customer      -> quem a loja atende (modules/customers). Nao muda aqui.
 *   PortalIdentity-> o direito de UM customer, em UM tenant, entrar no Portal.
 *                    Vive so neste modulo; nunca e um `User`.
 *   InternalUser  -> quem trabalha na loja (modules/users). O Portal nunca
 *                    autentica um destes, e nunca reutiliza TenantContext.
 *
 * Um `Customer` pode ter zero, uma ou N `PortalIdentity` (uma por tenant onde
 * tem cadastro com o mesmo contato) — nunca o contrario.
 */

import { isValidPhone, normalizeEmail, normalizePhone } from '@/core/contact/phone';
import {
  SERVICE_ORDER_STATUS_LABEL,
  SERVICE_ORDER_STATUS_TONE,
  type ServiceOrderStatus,
} from '@/modules/service-orders/domain/workflow';

// ---------------------------------------------------------------------------
// Link magico (ADR-080)
// ---------------------------------------------------------------------------

/** Bytes de entropia do token de login. Mesmo tamanho de session-service.ts. */
export const PORTAL_LOGIN_TOKEN_BYTES = 32;

/**
 * Validade do link (ADR-080, item 11 a 13).
 *
 * Curto de proposito: e um link de e-mail/WhatsApp, nao uma sessao. Passado
 * isso, pedir outro custa um clique — nao ha por que manter a janela aberta.
 */
export const PORTAL_LOGIN_TOKEN_TTL_MINUTES = 15;

/** Sessao do Portal e mais curta que a sessao interna (item 19). */
export const PORTAL_SESSION_TTL_HOURS = 12;

export const PORTAL_LOGIN_COOKIE = 'nexo56_portal_session';

// ---------------------------------------------------------------------------
// Identidade do Portal (item 9, 23)
// ---------------------------------------------------------------------------

export const PORTAL_IDENTITY_STATUSES = ['active', 'blocked'] as const;
export type PortalIdentityStatus = (typeof PORTAL_IDENTITY_STATUSES)[number];

/**
 * O CONTEXTO DO PORTAL — nunca um `TenantContext` (item 9).
 *
 * De proposito, nao tem `tenantPermissions`, `unitPermissions` nem
 * `authorizedUnitIds`: nenhum desses conceitos existe para um `Customer`.
 * Autorizacao no Portal e SEMPRE por ownership de recurso (o registro e
 * deste `customerId`?), nunca por papel/permissao.
 */
export interface PortalContext {
  tenantId: string;
  customerId: string;
  portalIdentityId: string;
  sessionId: string;
  sessionExpiresAt: Date;
}

// ---------------------------------------------------------------------------
// Normalizacao do contato de entrada (mesma forma de customer_contacts)
// ---------------------------------------------------------------------------

export type PortalLoginContactKind = 'email' | 'phone';

export interface NormalizedLoginContact {
  kind: PortalLoginContactKind;
  valueNormalized: string;
}

/**
 * Decide se o texto digitado e e-mail ou telefone e normaliza do MESMO jeito
 * que `customer_contacts.value_normalized` (item 27) — sem isso a busca por
 * contato nunca bateria com o cadastro que o balcao fez.
 */
export function normalizeLoginContact(raw: string): NormalizedLoginContact | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.includes('@')) {
    return { kind: 'email', valueNormalized: normalizeEmail(trimmed) };
  }

  if (!isValidPhone(trimmed)) return null;
  return { kind: 'phone', valueNormalized: normalizePhone(trimmed) };
}

// ---------------------------------------------------------------------------
// Projecao externa da Ordem de Servico (item 38)
// ---------------------------------------------------------------------------

/**
 * O Portal usa O MESMO rotulo e o MESMO tom do painel interno (item 38): o
 * texto ja e em portugues de atendimento, sem termo tecnico interno, e
 * manter um segundo mapa so criaria uma segunda fonte para divergir da
 * primeira. O que protege o cliente de ver detalhe operacional NAO e o
 * rotulo do estado — e a lista de linha do tempo abaixo.
 */
export function externalServiceOrderStatusLabel(status: string): string {
  return isKnownExternalStatus(status) ? SERVICE_ORDER_STATUS_LABEL[status] : status;
}

export function externalServiceOrderStatusTone(
  status: string,
): 'neutral' | 'brand' | 'success' | 'warning' | 'danger' {
  return isKnownExternalStatus(status) ? SERVICE_ORDER_STATUS_TONE[status] : 'neutral';
}

function isKnownExternalStatus(status: string): status is ServiceOrderStatus {
  return status in SERVICE_ORDER_STATUS_LABEL;
}

/**
 * LINHA DO TEMPO QUE O CLIENTE VE — lista de PERMISSAO, nao de bloqueio
 * (item 41 a 44).
 *
 * `service_order_timeline.kind` e texto livre porque o painel interno pode
 * crescer sem migration; o Portal faz o oposto de proposito: comeca vazio e
 * só entra tipo que uma pessoa revisou e decidiu que e fato do CLIENTE, nao
 * fato da OPERACAO. Um `kind` novo no futuro fica invisivel ao Portal ate
 * alguem adicionar aqui de caso pensado — o padrao seguro por omissao.
 *
 * Fora da lista, hoje, de proposito: `technician_assigned` (identifica quem
 * da equipe atende — informacao interna), `part_reserved` /
 * `part_reservation_released` / `part_consumed` (extrato de estoque),
 * `task_completed` e `part_pickup_requested` (tarefa de bancada),
 * `details_updated` (pode carregar nota interna), `warranty_reclassified`
 * (julgamento interno de cobertura, ainda sem o orcamento que o explica).
 */
export const PORTAL_VISIBLE_TIMELINE_KINDS: readonly string[] = [
  'created',
  'status_changed',
  'customer_notification_requested',
  'warranty_return_linked',
];

export function isPortalVisibleTimelineEntry(kind: string): boolean {
  return PORTAL_VISIBLE_TIMELINE_KINDS.includes(kind);
}

// ---------------------------------------------------------------------------
// Mascaramento (mesma logica do certificado de garantia — item 47)
// ---------------------------------------------------------------------------

/**
 * Numero de serie completo nunca aparece no Portal, pela mesma razao do
 * certificado: identifica o aparelho de forma unica e circula em garantia de
 * fabrica, revenda e seguro — nao acrescenta nada que o cliente precise para
 * reconhecer o proprio aparelho, e acrescenta tudo que alguem com acesso a
 * conta de outra pessoa gostaria de ter. Os 4 ultimos caracteres bastam para
 * o cliente confirmar "e este mesmo".
 */
export function maskEquipmentSerial(serial: string | null): string | null {
  const trimmed = serial?.trim();
  if (!trimmed) return null;
  return trimmed.length <= 4 ? '••••' : `•••• ${trimmed.slice(-4)}`;
}

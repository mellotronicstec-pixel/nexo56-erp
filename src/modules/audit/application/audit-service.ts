import 'server-only';
import { getDb } from '@/core/db/client';
import { getContext } from '@/core/context/request-context';
import { newId } from '@/core/ids/id';
import { redact } from '@/core/logging/logger';
import { auditLogs } from '@/modules/audit/infrastructure/schema';

/**
 * Servico de auditoria (Prompt 01, item 29).
 *
 * Somente insercao. Nada nesta aplicacao atualiza ou apaga linhas de
 * `audit_logs` — um registro editado depois nao apaga o fato de que foi
 * editado (Prompt 00, item 24).
 *
 * `before`/`after`/`metadata` passam pela MESMA redacao usada nos logs, entao
 * senha, hash, token e segredo nao chegam a ser gravados nem por engano.
 */

export const AUDIT_ACTIONS = {
  USER_LOGIN_SUCCEEDED: 'user.login.succeeded',
  USER_LOGIN_FAILED: 'user.login.failed',
  USER_LOGGED_OUT: 'user.logged_out',
  TENANT_CREATED: 'tenant.created',
  UNIT_CREATED: 'unit.created',
  USER_CREATED: 'user.created',
  ROLE_ASSIGNED: 'role.assigned',
  MODULE_ENABLED: 'module.enabled',
  MODULE_DISABLED: 'module.disabled',
  FEATURE_ENABLED: 'feature.enabled',
  FEATURE_DISABLED: 'feature.disabled',
  PLAN_ENTITLEMENT_CHANGED: 'plan.entitlement_changed',
  UNIT_SWITCHED: 'unit.switched',

  // --- Prompt 03: gestao de acesso ----------------------------------------
  USER_UPDATED: 'user.updated',
  USER_ACTIVATED: 'user.activated',
  USER_DEACTIVATED: 'user.deactivated',
  USER_UNIT_GRANTED: 'user.unit.granted',
  USER_UNIT_REVOKED: 'user.unit.revoked',
  ROLE_CREATED: 'role.created',
  ROLE_UPDATED: 'role.updated',
  ROLE_DELETED: 'role.deleted',
  ROLE_REVOKED: 'role.revoked',
  ROLE_PERMISSIONS_CHANGED: 'role.permissions_changed',
  PASSWORD_CHANGED: 'password.changed',
  PASSWORD_RESET_REQUESTED: 'password.reset_requested',
  PASSWORD_RESET_COMPLETED: 'password.reset_completed',
  SESSION_REVOKED: 'session.revoked',
  ALL_SESSIONS_REVOKED: 'session.all_revoked',

  // --- Prompt 05: clientes -------------------------------------------------
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_DOCUMENT_CHANGED: 'customer.document_changed',
  CUSTOMER_ACTIVATED: 'customer.activated',
  CUSTOMER_DEACTIVATED: 'customer.deactivated',

  // --- Prompt 06: equipamentos e recebimento -------------------------------
  EQUIPMENT_CREATED: 'equipment.created',
  EQUIPMENT_UPDATED: 'equipment.updated',
  EQUIPMENT_INTAKE_CREATED: 'equipment_intake.created',
  EQUIPMENT_MEDIA_ADDED: 'equipment_media.added',
  EQUIPMENT_MEDIA_REMOVED: 'equipment_media.removed',
  EQUIPMENT_LABEL_CONFIRMED: 'equipment_label.confirmed',

  // --- Prompt 07: ordem de servico -----------------------------------------
  SERVICE_ORDER_CREATED: 'service_order.created',
  SERVICE_ORDER_UPDATED: 'service_order.updated',
  SERVICE_ORDER_CUSTOMER_REPORT_UPDATED: 'service_order.customer_report_updated',

  // --- Prompt 08: workflow --------------------------------------------------
  SERVICE_ORDER_STATUS_CHANGED: 'service_order.status_changed',
  SERVICE_ORDER_TECHNICIAN_ASSIGNED: 'service_order.technician_assigned',
  SERVICE_ORDER_FOLLOW_UP_RESCHEDULED: 'service_order.follow_up_rescheduled',
  SERVICE_ORDER_TASK_CREATED: 'service_order_task.created',
  SERVICE_ORDER_TASK_COMPLETED: 'service_order_task.completed',
  SERVICE_ORDER_TASK_CANCELLED: 'service_order_task.cancelled',
  SERVICE_ORDER_CUSTOMER_NOTIFIED: 'service_order.customer_notification_requested',

  // --- Prompt 09: orcamentos ------------------------------------------------
  QUOTE_CREATED: 'quote.created',
  QUOTE_UPDATED: 'quote.updated',
  QUOTE_ITEMS_UPDATED: 'quote.items_updated',
  QUOTE_SENT: 'quote.sent',
  QUOTE_APPROVED: 'quote.approved',
  QUOTE_REJECTED: 'quote.rejected',
  QUOTE_EXPIRED: 'quote.expired',
  QUOTE_CANCELLED: 'quote.cancelled',
  QUOTE_SUPERSEDED: 'quote.superseded',

  // --- Prompt 10: estoque e pecas -------------------------------------------
  /**
   * AUDITLOG != LEDGER (item 67).
   *
   * O ledger e historia de NEGOCIO: quanto entrou, quanto saiu, para qual OS.
   * O AuditLog e historia de ACESSO: quem executou uma acao sensivel, de onde,
   * com qual permissao. Auditar aqui o que ja esta no ledger duplicaria o
   * dado e faria as duas trilhas divergirem na primeira correcao.
   *
   * Por isso so o que e administrativo ou sensivel entra: catalogo,
   * localizacao, AJUSTE (que reescreve saldo) e transferencia (que move valor
   * entre unidades). Entrada e saida comuns vivem no ledger.
   */
  PART_CREATED: 'part.created',
  PART_UPDATED: 'part.updated',
  PART_STATUS_CHANGED: 'part.status_changed',
  STOCK_LOCATION_CREATED: 'stock_location.created',
  STOCK_LOCATION_UPDATED: 'stock_location.updated',
  STOCK_ADJUSTED: 'stock.adjusted',
  STOCK_TRANSFERRED: 'stock.transferred',
  STOCK_MINIMUM_CHANGED: 'stock.minimum_changed',

  // --- Prompt 11: fornecedores e compras ------------------------------------
  /**
   * AUDITLOG != TIMELINE DO PEDIDO (item 44).
   *
   * A timeline conta a historia OPERACIONAL para quem acompanha a compra
   * ("recebimento parcial: 6/10"). O AuditLog registra quem executou acao
   * SENSIVEL: mexer no cadastro do fornecedor, autorizar a compra, receber
   * mercadoria (que vira saldo) e cancelar o que sobrou.
   */
  SUPPLIER_CREATED: 'supplier.created',
  SUPPLIER_UPDATED: 'supplier.updated',
  SUPPLIER_STATUS_CHANGED: 'supplier.status_changed',
  PURCHASE_ORDER_CREATED: 'purchase_order.created',
  PURCHASE_ORDER_UPDATED: 'purchase_order.updated',
  PURCHASE_ORDER_APPROVED: 'purchase_order.approved',
  PURCHASE_ORDER_PLACED: 'purchase_order.placed',
  PURCHASE_ORDER_CANCELLED: 'purchase_order.cancelled',
  PURCHASE_RECEIPT_CREATED: 'purchase_receipt.created',

  // --- Prompt 12: financeiro ------------------------------------------------
  FINANCIAL_TITLE_CREATED: 'financial_title.created',
  FINANCIAL_TITLE_UPDATED: 'financial_title.updated',
  FINANCIAL_TITLE_CANCELLED: 'financial_title.cancelled',
  FINANCIAL_SETTLEMENT_CREATED: 'financial_settlement.created',
  FINANCIAL_SETTLEMENT_REVERSED: 'financial_settlement.reversed',
  CASH_SESSION_OPENED: 'cash_session.opened',
  CASH_SESSION_CLOSED: 'cash_session.closed',
  CASH_ADJUSTMENT_RECORDED: 'cash_adjustment.recorded',
  FINANCIAL_ACCOUNT_CHANGED: 'financial_account.changed',
  PAYMENT_METHOD_CHANGED: 'payment_method.changed',
  FINANCIAL_CATEGORY_CHANGED: 'financial_category.changed',

  // --- Garantias (Prompt 13) ------------------------------------------------
  WARRANTY_POLICY_CHANGED: 'warranty_policy.changed',
  WARRANTY_CREATED: 'warranty.created',
  WARRANTY_ACTIVATED: 'warranty.activated',
  WARRANTY_CANCELLED: 'warranty.cancelled',
  WARRANTY_REVOKED: 'warranty.revoked',
  WARRANTY_CERTIFICATE_ISSUED: 'warranty_certificate.issued',
  /**
   * Prompt 13.1: a geracao do arquivo PDF e rastreavel; o DOWNLOAD nao e
   * auditado, pelo mesmo criterio ja aplicado a midia de equipamento — um
   * registro por clique inundaria a auditoria sem responder pergunta nenhuma.
   */
  WARRANTY_CERTIFICATE_PDF_GENERATED: 'warranty_certificate.pdf_generated',
  WARRANTY_RETURN_REGISTERED: 'warranty_return.registered',
  WARRANTY_RETURN_RECLASSIFIED: 'warranty_return.reclassified',
  WARRANTY_COST_RECORDED: 'warranty_cost.recorded',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditInput {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  tenantId?: string | null;
  unitId?: string | null;
  userId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

type Executor = Pick<ReturnType<typeof getDb>, 'insert'>;

export async function recordAudit(input: AuditInput, tx?: Executor): Promise<void> {
  const executor = tx ?? getDb();
  const context = getContext();

  await executor.insert(auditLogs).values({
    id: newId(),
    tenantId: input.tenantId ?? context?.tenantId ?? null,
    unitId: input.unitId ?? context?.unitId ?? null,
    userId: input.userId ?? context?.userId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: input.before === undefined ? null : redact(input.before),
    after: input.after === undefined ? null : redact(input.after),
    metadata: input.metadata === undefined ? null : redact(input.metadata),
    correlationId: context?.correlationId ?? null,
    origin: context?.origin ?? 'web',
    createdAt: new Date(),
  });
}

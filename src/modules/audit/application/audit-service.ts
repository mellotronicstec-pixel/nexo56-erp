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

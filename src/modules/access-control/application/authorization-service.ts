import 'server-only';
import { AuthenticationError, AuthorizationError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import type { PermissionKey } from '@/modules/access-control/domain/permissions';
import { getCurrentContext } from '@/modules/auth/application/current-context';
import { checkAccess } from '@/modules/features/application/effective-access';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Servico central de autorizacao (Prompt 03, itens 6, 28, 29 e 30).
 *
 * TODA decisao de acesso do Nexo56 passa por aqui. Nao existe
 * `if (user.role === 'admin')` espalhado por pagina, action ou repository —
 * inclusive o Administrador e resolvido pelo RBAC, sem superpoder embutido
 * (item 13).
 *
 * PIPELINE — deny by default (item 6)
 *
 *   Authenticated
 *     AND TenantValid
 *     AND UserActive            (verificados na montagem do TenantContext)
 *     AND SessionValid
 *     AND UnitAuthorizedWhenRequired
 *     AND PermissionGrantedInScope
 *     AND FeatureAvailableWhenRequired
 *     AND ResourceBelongsToContext
 *   => ALLOW, caso contrario DENY
 *
 * As quatro primeiras condicoes ja sao garantidas por `getCurrentContext()`:
 * sem sessao valida, de usuario ativo, em tenant ativo, o contexto simplesmente
 * nao existe. As demais sao avaliadas aqui.
 */

export type DenialReason =
  | 'NOT_AUTHENTICATED'
  | 'UNIT_REQUIRED'
  | 'UNIT_NOT_AUTHORIZED'
  | 'PERMISSION_DENIED'
  | 'FEATURE_UNAVAILABLE'
  | 'RESOURCE_OUT_OF_SCOPE';

export interface AuthorizationRequest {
  /** Capacidade exigida. */
  permission: PermissionKey;
  /**
   * Unidade em que a acao acontece.
   *
   * - omitido: acao de nivel tenant (ex.: administrar perfis);
   * - informado: a permissao precisa valer NAQUELA unidade, e o usuario
   *   precisa ter vinculo com ela.
   */
  unitId?: string | null;
  /** Feature que precisa estar disponivel para o tenant (Effective Access). */
  featureKey?: string;
  /**
   * Recurso alvo, quando a acao opera sobre um registro existente.
   * Permite negar IDOR: ID valido de outro tenant/unidade nao passa (item 31).
   */
  resource?: { tenantId: string; unitId?: string | null };
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: DenialReason | 'ALLOWED';
  message: string;
}

const MESSAGES: Record<DenialReason | 'ALLOWED', string> = {
  ALLOWED: 'Acesso permitido.',
  NOT_AUTHENTICATED: 'Sessao expirada ou inexistente. Faca login novamente.',
  UNIT_REQUIRED: 'Esta operacao exige uma unidade selecionada.',
  UNIT_NOT_AUTHORIZED: 'Voce nao tem acesso a esta unidade.',
  PERMISSION_DENIED: 'Voce nao tem permissao para executar esta acao.',
  FEATURE_UNAVAILABLE: 'Esta funcionalidade nao esta disponivel para a sua empresa.',
  RESOURCE_OUT_OF_SCOPE: 'Registro nao encontrado.',
};

function deny(reason: DenialReason): AuthorizationDecision {
  return { allowed: false, reason, message: MESSAGES[reason] };
}

/**
 * Permissoes validas para o usuario NA UNIDADE indicada.
 *
 * - papeis de escopo TENANT valem em qualquer unidade que o usuario acesse;
 * - papeis de escopo UNIT valem somente na sua unidade.
 *
 * Sem unidade informada, valem apenas os papeis TENANT — um papel concedido
 * so na Unidade Norte nao autoriza uma acao de nivel tenant.
 */
export function permissionsInScope(
  context: TenantContext,
  unitId?: string | null,
): ReadonlySet<PermissionKey> {
  if (!unitId) return context.tenantPermissions;

  const combined = new Set<PermissionKey>(context.tenantPermissions);
  for (const permission of context.unitPermissions.get(unitId) ?? []) {
    combined.add(permission);
  }
  return combined;
}

/** Avalia sem lancar. Use quando a interface precisa apenas decidir o que mostrar. */
export async function can(
  context: TenantContext | null,
  request: AuthorizationRequest,
): Promise<AuthorizationDecision> {
  if (!context) return deny('NOT_AUTHENTICATED');

  // --- unidade -------------------------------------------------------------
  const unitId = request.unitId;
  if (unitId !== undefined && unitId !== null) {
    if (!context.authorizedUnitIds.includes(unitId)) return deny('UNIT_NOT_AUTHORIZED');
  }

  // --- recurso (anti-IDOR) -------------------------------------------------
  if (request.resource) {
    if (request.resource.tenantId !== context.tenantId) return deny('RESOURCE_OUT_OF_SCOPE');
    if (
      request.resource.unitId != null &&
      !context.authorizedUnitIds.includes(request.resource.unitId)
    ) {
      return deny('RESOURCE_OUT_OF_SCOPE');
    }
  }

  // --- permissao no escopo -------------------------------------------------
  const scopeUnitId = unitId ?? request.resource?.unitId ?? null;
  if (!permissionsInScope(context, scopeUnitId).has(request.permission)) {
    return deny('PERMISSION_DENIED');
  }

  // --- feature (Effective Access) -----------------------------------------
  if (request.featureKey) {
    const decision = await checkAccess(context, { featureKey: request.featureKey });
    if (!decision.allowed) return deny('FEATURE_UNAVAILABLE');
  }

  return { allowed: true, reason: 'ALLOWED', message: MESSAGES.ALLOWED };
}

/**
 * Exige autorizacao. Lanca quando negado — e a forma usada por Server Actions,
 * route handlers e application services.
 */
export async function authorize(
  context: TenantContext | null,
  request: AuthorizationRequest,
): Promise<TenantContext> {
  const decision = await can(context, request);

  if (!decision.allowed || !context) {
    logger.warn('Autorizacao negada', {
      module: 'access-control',
      operation: 'authorize',
      permission: request.permission,
      reason: decision.reason,
    });

    if (decision.reason === 'NOT_AUTHENTICATED') throw new AuthenticationError(decision.message);
    throw new AuthorizationError(decision.message, { reason: decision.reason });
  }

  return context;
}

/** Resolve o contexto da sessao e exige autorizacao, em uma chamada. */
export async function requireAuthorization(request: AuthorizationRequest): Promise<TenantContext> {
  return authorize(await getCurrentContext(), request);
}

/**
 * Exige que exista unidade ativa e que a acao seja autorizada nela.
 * Usado por operacoes que so fazem sentido dentro de uma unidade (item 25).
 */
export async function requireUnitAuthorization(
  permission: PermissionKey,
  featureKey?: string,
): Promise<{ context: TenantContext; unitId: string }> {
  const context = await getCurrentContext();
  if (!context) throw new AuthenticationError(MESSAGES.NOT_AUTHENTICATED);

  if (!context.activeUnitId) {
    throw new AuthorizationError(MESSAGES.UNIT_REQUIRED, { reason: 'UNIT_REQUIRED' });
  }

  await authorize(context, { permission, unitId: context.activeUnitId, featureKey });
  return { context, unitId: context.activeUnitId };
}

import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import type { PermissionKey } from '@/modules/access-control/domain/permissions';
import {
  features,
  planEntitlements,
  tenantFeatures,
} from '@/modules/features/infrastructure/schema';
import { findFeature, isCore } from '@/modules/features/domain/catalog';
import { hasPermission, type TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Effective Access (Prompt 00, item 13; Prompt 01, item 27).
 *
 *   featureExists AND planAllows AND tenantEnabled AND userAuthorized
 *
 * Responsabilidade unica: e o UNICO lugar que decide se um recurso pode ser
 * usado. Nenhum service, rota ou componente pode improvisar a propria
 * verificacao de plano/modulo (Prompt 00, item 13).
 *
 * O frontend pode consultar o resultado para ajustar a UX, mas o backend
 * revalida sempre antes de executar operacao protegida (Prompt 01, item 27).
 */

export type AccessDenialReason =
  | 'UNKNOWN_FEATURE'
  | 'FEATURE_DEPRECATED'
  | 'PLAN_NOT_ENTITLED'
  | 'TENANT_DISABLED'
  | 'DEPENDENCY_UNSATISFIED'
  | 'PERMISSION_DENIED';

export interface AccessDecision {
  allowed: boolean;
  featureKey: string;
  reason: AccessDenialReason | 'ALLOWED';
  /** Mensagem pronta para a interface, em pt-BR. */
  message: string;
  missingDependencies?: string[];
  requiredPermission?: PermissionKey;
}

export interface AccessQuery {
  featureKey: string;
  permission?: PermissionKey;
}

const MESSAGES: Record<AccessDenialReason | 'ALLOWED', string> = {
  ALLOWED: 'Acesso permitido.',
  UNKNOWN_FEATURE: 'Esta funcionalidade nao existe no Nexo56.',
  FEATURE_DEPRECATED: 'Esta funcionalidade foi descontinuada.',
  PLAN_NOT_ENTITLED: 'Esta funcionalidade nao esta incluida no plano contratado.',
  TENANT_DISABLED: 'Esta funcionalidade esta desativada para a sua empresa.',
  DEPENDENCY_UNSATISFIED: 'Esta funcionalidade depende de outra que nao esta ativa.',
  PERMISSION_DENIED: 'Voce nao tem permissao para acessar esta funcionalidade.',
};

function deny(
  featureKey: string,
  reason: AccessDenialReason,
  extra: Partial<AccessDecision> = {},
): AccessDecision {
  return { allowed: false, featureKey, reason, message: MESSAGES[reason], ...extra };
}

/**
 * Estado de modularidade do tenant, lido uma vez e reutilizado nas consultas
 * da mesma requisicao (evita N+1 quando o menu avalia varias features).
 */
export interface TenantAccessSnapshot {
  tenantId: string;
  planId: string;
  knownFeatures: Map<string, { type: string; status: string }>;
  entitledFeatureKeys: Set<string>;
  tenantEnabledKeys: Set<string>;
  tenantConfiguredKeys: Set<string>;
}

export async function loadTenantAccessSnapshot(
  context: Pick<TenantContext, 'tenantId' | 'planId'>,
): Promise<TenantAccessSnapshot> {
  const db = getDb();

  const [catalogRows, entitlementRows, tenantRows] = await Promise.all([
    db.select({ key: features.key, type: features.type, status: features.status }).from(features),
    db
      .select({ featureKey: planEntitlements.featureKey })
      .from(planEntitlements)
      .where(eq(planEntitlements.planId, context.planId)),
    db
      .select({ featureKey: tenantFeatures.featureKey, enabled: tenantFeatures.enabled })
      .from(tenantFeatures)
      .where(eq(tenantFeatures.tenantId, context.tenantId)),
  ]);

  return {
    tenantId: context.tenantId,
    planId: context.planId,
    knownFeatures: new Map(
      catalogRows.map((row) => [row.key, { type: row.type, status: row.status }]),
    ),
    entitledFeatureKeys: new Set(entitlementRows.map((row) => row.featureKey)),
    tenantEnabledKeys: new Set(
      tenantRows.filter((row) => row.enabled).map((row) => row.featureKey),
    ),
    tenantConfiguredKeys: new Set(tenantRows.map((row) => row.featureKey)),
  };
}

/**
 * Avalia uma feature contra um snapshot ja carregado.
 *
 * `context` e nulo quando quem pergunta nao tem `TenantContext` nenhum — o
 * caso do Portal do Cliente (Prompt 17, item 9), que nao e usuario interno e
 * nunca tem papel/permissao para avaliar. Nesse caso `query.permission` tem
 * de vir vazio: perguntar por uma permissao sem contexto para avalia-la e
 * erro de quem chamou, nunca um "permitido" silencioso.
 */
export function evaluateAccess(
  snapshot: TenantAccessSnapshot,
  context: TenantContext | null,
  query: AccessQuery,
): AccessDecision {
  const { featureKey, permission } = query;

  // 1. A funcionalidade existe no produto?
  const catalogEntry = snapshot.knownFeatures.get(featureKey);
  if (!catalogEntry) return deny(featureKey, 'UNKNOWN_FEATURE');
  if (catalogEntry.status === 'deprecated') return deny(featureKey, 'FEATURE_DEPRECATED');

  const definition = findFeature(featureKey);
  const core = isCore(featureKey) || catalogEntry.type === 'CORE';

  // 2. O plano permite? (CORE e sempre entitled — e estrutural.)
  if (!core && !snapshot.entitledFeatureKeys.has(featureKey)) {
    return deny(featureKey, 'PLAN_NOT_ENTITLED');
  }

  // 3. O tenant ativou? CORE nao depende de ativacao; opcional precisa de
  //    linha explicita com enabled = true.
  if (!core && !snapshot.tenantEnabledKeys.has(featureKey)) {
    return deny(featureKey, 'TENANT_DISABLED');
  }

  // 4. Dependencias satisfeitas?
  const missing = (definition?.dependsOn ?? []).filter((dependency) => {
    const dependencyEntry = snapshot.knownFeatures.get(dependency);
    if (!dependencyEntry) return true;
    if (dependencyEntry.type === 'CORE') return false;
    return !(
      snapshot.entitledFeatureKeys.has(dependency) && snapshot.tenantEnabledKeys.has(dependency)
    );
  });
  if (missing.length > 0) {
    return deny(featureKey, 'DEPENDENCY_UNSATISFIED', { missingDependencies: missing });
  }

  // 5. O usuario tem permissao? So se aplica a quem TEM TenantContext.
  if (permission && (!context || !hasPermission(context, permission))) {
    return deny(featureKey, 'PERMISSION_DENIED', { requiredPermission: permission });
  }

  return { allowed: true, featureKey, reason: 'ALLOWED', message: MESSAGES.ALLOWED };
}

/** Consulta pontual (carrega o snapshot). */
export async function checkAccess(
  context: TenantContext,
  query: AccessQuery,
): Promise<AccessDecision> {
  const snapshot = await loadTenantAccessSnapshot(context);
  return evaluateAccess(snapshot, context, query);
}

/** Avalia varias features de uma vez com um unico snapshot. */
export async function checkManyAccess(
  context: TenantContext,
  queries: readonly AccessQuery[],
): Promise<Map<string, AccessDecision>> {
  const snapshot = await loadTenantAccessSnapshot(context);
  return new Map(
    queries.map((query) => [query.featureKey, evaluateAccess(snapshot, context, query)]),
  );
}

/** Lista as features realmente disponiveis ao tenant (para UI de modulos). */
export async function listTenantFeatureStates(
  context: TenantContext,
): Promise<Array<{ featureKey: string; type: string; decision: AccessDecision }>> {
  const snapshot = await loadTenantAccessSnapshot(context);
  const keys = [...snapshot.knownFeatures.keys()].sort();

  return keys.map((featureKey) => ({
    featureKey,
    type: snapshot.knownFeatures.get(featureKey)?.type ?? 'OPTIONAL',
    decision: evaluateAccess(snapshot, context, { featureKey }),
  }));
}

/**
 * Feature ligada para o tenant, SEM pessoa nem permissao envolvida (Prompt
 * 17, item 9). E o que o Portal usa: ele sabe `tenantId` e `planId` do
 * customer autenticado, e nunca deve ganhar `TenantContext`.
 */
export async function checkFeatureEnabledForTenant(
  tenant: { tenantId: string; planId: string },
  featureKey: string,
): Promise<AccessDecision> {
  const snapshot = await loadTenantAccessSnapshot(tenant);
  return evaluateAccess(snapshot, null, { featureKey });
}

/** Util interno: features do catalogo que existem no banco. */
export async function assertFeaturesExist(keys: readonly string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({ key: features.key })
    .from(features)
    .where(inArray(features.key, [...keys]));
  const found = new Set(rows.map((row) => row.key));
  return keys.filter((key) => !found.has(key));
}

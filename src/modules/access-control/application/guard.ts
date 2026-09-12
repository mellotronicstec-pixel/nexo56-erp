import 'server-only';
import { redirect } from 'next/navigation';
import { AuthenticationError, AuthorizationError, isAppError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import type { PermissionKey } from '@/modules/access-control/domain/permissions';
import { checkAccess, type AccessDecision } from '@/modules/features/application/effective-access';
import { requireContext } from '@/modules/auth/application/current-context';
import { hasPermission, type TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Guarda de execucao (Prompt 01, itens 26 e 27).
 *
 * Todo caminho protegido — pagina, server action ou route handler — passa por
 * aqui. A verificacao de interface NUNCA substitui esta: o backend revalida
 * antes de executar a operacao, mesmo que o menu ja tenha escondido o item.
 */

export interface GuardResult {
  context: TenantContext;
  decision: AccessDecision;
}

export async function requireAccess(
  featureKey: string,
  permission?: PermissionKey,
): Promise<GuardResult> {
  const context = await requireContext();
  const decision = await checkAccess(context, { featureKey, permission });

  if (!decision.allowed) {
    logger.warn('Acesso negado', {
      module: 'access-control',
      operation: 'requireAccess',
      featureKey,
      reason: decision.reason,
    });
    throw new AuthorizationError(decision.message, {
      featureKey,
      reason: decision.reason,
    });
  }

  return { context, decision };
}

/** Exige apenas permissao RBAC, sem vinculo a uma feature especifica. */
export async function requirePermission(permission: PermissionKey): Promise<TenantContext> {
  const context = await requireContext();
  if (!hasPermission(context, permission)) {
    throw new AuthorizationError('Voce nao tem permissao para executar esta acao.', { permission });
  }
  return context;
}

/**
 * Variante para PAGINAS.
 *
 * A mesma verificacao de `requireAccess`, mas em vez de propagar a excecao
 * para a fronteira de erro, encaminha para /login (sem sessao) ou
 * /acesso-negado (sem acesso). Server Actions e route handlers continuam
 * usando `requireAccess`, que lanca — resposta de erro e o comportamento
 * correto ali.
 */
export async function requireAccessForPage(
  featureKey: string,
  permission?: PermissionKey,
): Promise<GuardResult> {
  try {
    return await requireAccess(featureKey, permission);
  } catch (error) {
    if (isAppError(error) && error instanceof AuthenticationError) redirect('/login');
    if (isAppError(error) && error instanceof AuthorizationError) redirect('/acesso-negado');
    throw error;
  }
}

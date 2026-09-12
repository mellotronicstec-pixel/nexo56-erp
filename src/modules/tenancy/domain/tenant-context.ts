import type { PermissionKey } from '@/modules/access-control/domain/permissions';

/**
 * Contexto de tenant (Prompt 01, item 20).
 *
 * REGRA CRITICA: este objeto so pode ser construido a partir de uma SESSAO
 * VALIDA no servidor. Nenhum campo aqui pode vir de parametro de rota, corpo
 * de request, cabecalho ou cookie controlado pelo cliente.
 *
 * E a unica fonte de tenant para toda a aplicacao — services e repositories
 * recebem o contexto pronto em vez de cada um descobrir o tenant a sua moda.
 */
export interface TenantContext {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly tenantName: string;
  readonly tenantTimezone: string;
  readonly planId: string;
  readonly userId: string;
  readonly userName: string;
  readonly userEmail: string;
  /** Unidade selecionada; sempre uma das `authorizedUnitIds`. */
  readonly unitId: string | null;
  readonly authorizedUnitIds: readonly string[];
  readonly roleKeys: readonly string[];
  readonly permissions: ReadonlySet<PermissionKey>;
  readonly sessionId: string;
}

export function hasPermission(context: TenantContext, permission: PermissionKey): boolean {
  return context.permissions.has(permission);
}

/** O contexto so reconhece unidades que o usuario realmente pode acessar. */
export function canAccessUnit(context: TenantContext, unitId: string): boolean {
  return context.authorizedUnitIds.includes(unitId);
}

import type { PermissionKey } from '@/modules/access-control/domain/permissions';

/**
 * Contexto de tenant (Prompt 01 item 20; Prompt 03 itens 4, 22 e 27).
 *
 * REGRA CRITICA: este objeto so pode ser construido a partir de uma SESSAO
 * VALIDA no servidor. Nenhum campo aqui pode vir de parametro de rota, corpo
 * de request, cabecalho ou cookie controlado pelo cliente.
 *
 * E a unica fonte de tenant para toda a aplicacao — services e repositories
 * recebem o contexto pronto em vez de cada um descobrir o tenant a sua moda.
 *
 * SEPARACAO DE CONCEITOS (Prompt 03, item 4)
 *
 *   Identity      -> userId, userName, userEmail
 *   Membership    -> authorizedUnitIds, activeUnitId
 *   Authorization -> tenantRoles, unitRoles, tenantPermissions, unitPermissions
 *   Features      -> resolvidas pelo Effective Access, fora deste objeto
 *
 * Acesso a unidade NAO e permissao (item 5): `authorizedUnitIds` responde
 * "onde a pessoa pode operar"; as permissoes respondem "o que ela pode fazer".
 *
 * NUNCA guardar senha, hash, token bruto ou segredo aqui.
 */

export interface RoleAssignment {
  roleId: string;
  roleKey: string;
  roleName: string;
}

export interface UnitRoleAssignment extends RoleAssignment {
  unitId: string;
}

export interface TenantContext {
  // --- Identity ------------------------------------------------------------
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly tenantName: string;
  readonly tenantTimezone: string;
  readonly planId: string;
  readonly userId: string;
  readonly userName: string;
  readonly userEmail: string;

  // --- Membership ----------------------------------------------------------
  /** Unidades em que o usuario pode operar. Membership, nao permissao. */
  readonly authorizedUnitIds: readonly string[];
  /** Unidade selecionada; sempre uma das autorizadas, ou null. */
  readonly activeUnitId: string | null;

  // --- Authorization -------------------------------------------------------
  /** Papeis validos em todo o tenant, nas unidades que o usuario acessa. */
  readonly tenantRoles: readonly RoleAssignment[];
  /** Papeis validos apenas em unidades especificas. */
  readonly unitRoles: readonly UnitRoleAssignment[];
  /** Permissoes dos papeis TENANT. */
  readonly tenantPermissions: ReadonlySet<PermissionKey>;
  /** Permissoes por unidade, vindas dos papeis UNIT. */
  readonly unitPermissions: ReadonlyMap<string, ReadonlySet<PermissionKey>>;

  // --- Sessao --------------------------------------------------------------
  readonly sessionId: string;
  readonly sessionExpiresAt: Date;
}

/**
 * Permissoes efetivas no contexto ATUAL: papeis de tenant mais os papeis da
 * unidade ativa (Prompt 03, item 61).
 *
 * Nao inclui permissoes de outras unidades — trocar de unidade muda o
 * resultado, que e exatamente o comportamento esperado (item 26).
 */
export function effectivePermissions(context: TenantContext): ReadonlySet<PermissionKey> {
  if (!context.activeUnitId) return context.tenantPermissions;

  const combined = new Set<PermissionKey>(context.tenantPermissions);
  for (const permission of context.unitPermissions.get(context.activeUnitId) ?? []) {
    combined.add(permission);
  }
  return combined;
}

/**
 * Verificacao rapida no contexto atual.
 *
 * Conveniencia de LEITURA, para a interface decidir o que mostrar. Nao
 * substitui o AuthorizationService: toda operacao protegida revalida no
 * servidor (item 30).
 */
export function hasPermission(context: TenantContext, permission: PermissionKey): boolean {
  return effectivePermissions(context).has(permission);
}

/** True se a permissao vale no tenant ou em ALGUMA unidade autorizada. */
export function hasPermissionAnywhere(context: TenantContext, permission: PermissionKey): boolean {
  if (context.tenantPermissions.has(permission)) return true;
  for (const permissions of context.unitPermissions.values()) {
    if (permissions.has(permission)) return true;
  }
  return false;
}

/** O contexto so reconhece unidades que o usuario realmente pode acessar. */
export function canAccessUnit(context: TenantContext, unitId: string): boolean {
  return context.authorizedUnitIds.includes(unitId);
}

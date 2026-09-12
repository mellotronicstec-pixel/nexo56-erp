import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { enrichContext } from '@/core/context/request-context';
import { AuthenticationError } from '@/core/errors';
import type { PermissionKey } from '@/modules/access-control/domain/permissions';
import {
  rolePermissions,
  roles,
  userRoles,
  userUnitRoles,
} from '@/modules/access-control/infrastructure/schema';
import { findActiveSession, SESSION_COOKIE } from '@/modules/auth/application/session-service';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import type {
  RoleAssignment,
  TenantContext,
  UnitRoleAssignment,
} from '@/modules/tenancy/domain/tenant-context';
import { users, userUnits } from '@/modules/users/infrastructure/schema';

/**
 * Resolucao do contexto autenticado (Prompt 01 itens 19/20; Prompt 03 item 22).
 *
 * ESTE E O UNICO CAMINHO pelo qual um tenantId entra na aplicacao.
 *
 * O tenant vem da linha de `sessions` no banco, alcancada pelo hash do token
 * do cookie. Nao existe parametro, cabecalho ou campo de formulario capaz de
 * influenciar qual tenant sera usado — manipular um ID na URL nao muda o
 * contexto, apenas faz a consulta escopada nao encontrar o registro.
 *
 * A unidade ativa vem de cookie, mas so vale se estiver entre as autorizadas:
 * o cliente pode PEDIR uma unidade, nunca conceder acesso a ela (item 23).
 */

export const UNIT_COOKIE = 'nexo56_unit';

export async function getCurrentContext(): Promise<TenantContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await findActiveSession(token);
  if (!session) return null;

  return loadContextForSession(session, cookieStore.get(UNIT_COOKIE)?.value);
}

/**
 * Monta o contexto a partir de uma sessao JA validada.
 *
 * Separado de `getCurrentContext` para que a regra de montagem (permissoes,
 * unidades autorizadas, situacao de conta e empresa) possa ser testada sem
 * depender de cookies/HTTP.
 */
export async function loadContextForSession(
  session: { id: string; userId: string; tenantId: string; expiresAt?: Date },
  requestedUnitId?: string,
): Promise<TenantContext | null> {
  const db = getDb();

  const rows = await db
    .select({
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      userStatus: users.status,
      tenantId: tenants.id,
      tenantSlug: tenants.slug,
      tenantName: tenants.name,
      tenantStatus: tenants.status,
      tenantTimezone: tenants.timezone,
      planId: tenants.planId,
    })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(eq(users.id, session.userId), eq(users.tenantId, session.tenantId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Sessao valida mas conta/empresa desativada: o contexto deixa de existir
  // (Prompt 03, item 43).
  if (row.userStatus !== 'active' || row.tenantStatus !== 'active') return null;

  /**
   * Quatro consultas em paralelo, cada uma com JOIN — nunca uma consulta por
   * papel ou por unidade (item 93). O volume e pequeno e limitado ao usuario.
   */
  const [tenantRoleRows, tenantPermissionRows, unitRoleRows, unitPermissionRows, unitRows] =
    await Promise.all([
      // papeis de escopo TENANT
      db
        .select({ roleId: roles.id, roleKey: roles.key, roleName: roles.name })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(and(eq(userRoles.userId, row.userId), eq(userRoles.tenantId, row.tenantId))),
      // permissoes dos papeis TENANT
      db
        .select({ permissionKey: rolePermissions.permissionKey })
        .from(userRoles)
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
        .where(and(eq(userRoles.userId, row.userId), eq(userRoles.tenantId, row.tenantId))),
      // papeis de escopo UNIT
      db
        .select({
          roleId: roles.id,
          roleKey: roles.key,
          roleName: roles.name,
          unitId: userUnitRoles.unitId,
        })
        .from(userUnitRoles)
        .innerJoin(roles, eq(roles.id, userUnitRoles.roleId))
        .where(and(eq(userUnitRoles.userId, row.userId), eq(userUnitRoles.tenantId, row.tenantId))),
      // permissoes dos papeis UNIT, ja agrupadas por unidade
      db
        .select({
          unitId: userUnitRoles.unitId,
          permissionKey: rolePermissions.permissionKey,
        })
        .from(userUnitRoles)
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, userUnitRoles.roleId))
        .where(and(eq(userUnitRoles.userId, row.userId), eq(userUnitRoles.tenantId, row.tenantId))),
      // membership: unidades ativas a que o usuario esta vinculado
      db
        .select({ unitId: units.id })
        .from(userUnits)
        .innerJoin(units, eq(units.id, userUnits.unitId))
        .where(
          and(
            eq(userUnits.userId, row.userId),
            eq(userUnits.tenantId, row.tenantId),
            eq(units.status, 'active'),
          ),
        )
        .orderBy(units.name),
    ]);

  const authorizedUnitIds = unitRows.map((unit) => unit.unitId);

  const unitPermissions = new Map<string, Set<PermissionKey>>();
  for (const entry of unitPermissionRows) {
    // Papel de unidade so vale se a membership ainda existir. A FK do banco ja
    // garante isso; a checagem aqui cobre unidade inativada.
    if (!authorizedUnitIds.includes(entry.unitId)) continue;
    const bucket = unitPermissions.get(entry.unitId) ?? new Set<PermissionKey>();
    bucket.add(entry.permissionKey as PermissionKey);
    unitPermissions.set(entry.unitId, bucket);
  }

  // A unidade pedida so vale se estiver entre as autorizadas do usuario.
  const activeUnitId =
    requestedUnitId && authorizedUnitIds.includes(requestedUnitId)
      ? requestedUnitId
      : (authorizedUnitIds[0] ?? null);

  const context: TenantContext = {
    tenantId: row.tenantId,
    tenantSlug: row.tenantSlug,
    tenantName: row.tenantName,
    tenantTimezone: row.tenantTimezone,
    planId: row.planId,
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    authorizedUnitIds,
    activeUnitId,
    tenantRoles: tenantRoleRows satisfies RoleAssignment[],
    unitRoles: unitRoleRows.filter((assignment) =>
      authorizedUnitIds.includes(assignment.unitId),
    ) satisfies UnitRoleAssignment[],
    tenantPermissions: new Set(
      tenantPermissionRows.map((permission) => permission.permissionKey as PermissionKey),
    ),
    unitPermissions,
    sessionId: session.id,
    sessionExpiresAt: session.expiresAt ?? new Date(),
  };

  enrichContext({
    tenantId: context.tenantId,
    userId: context.userId,
    unitId: context.activeUnitId ?? undefined,
  });

  return context;
}

/** Igual a `getCurrentContext`, porem lanca quando nao ha sessao valida. */
export async function requireContext(): Promise<TenantContext> {
  const context = await getCurrentContext();
  if (!context)
    throw new AuthenticationError('Sessao expirada ou inexistente. Faca login novamente.');
  return context;
}

/**
 * Variante para PAGINAS: sem sessao valida, encaminha para /login em vez de
 * propagar excecao ate a fronteira de erro (Prompt 01, item 77).
 */
export async function requireContextForPage(): Promise<TenantContext> {
  const context = await getCurrentContext();
  if (!context) redirect('/login');
  return context;
}

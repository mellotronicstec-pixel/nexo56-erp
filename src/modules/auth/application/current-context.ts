import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { enrichContext } from '@/core/context/request-context';
import { AuthenticationError } from '@/core/errors';
import type { PermissionKey } from '@/modules/access-control/domain/permissions';
import { rolePermissions, roles, userRoles } from '@/modules/access-control/infrastructure/schema';
import { findActiveSession, SESSION_COOKIE } from '@/modules/auth/application/session-service';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { users, userUnits } from '@/modules/users/infrastructure/schema';

/**
 * Resolucao do contexto autenticado (Prompt 01, itens 19 e 20).
 *
 * ESTE E O UNICO CAMINHO pelo qual um tenantId entra na aplicacao.
 *
 * O tenant vem da linha de `sessions` no banco, alcancada pelo hash do token
 * do cookie. Nao existe parametro, cabecalho ou campo de formulario capaz de
 * influenciar qual tenant sera usado — manipular um ID na URL nao muda o
 * contexto, apenas faz a consulta escopada nao encontrar o registro.
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
 * Separado de `getCurrentContext` para que a regra de montagem do contexto
 * (permissoes, unidades autorizadas, situacao de conta e empresa) possa ser
 * testada sem depender de cookies/HTTP.
 */
export async function loadContextForSession(
  session: { id: string; userId: string; tenantId: string },
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

  // Sessao valida mas conta/empresa desativada: o contexto deixa de existir.
  if (row.userStatus !== 'active' || row.tenantStatus !== 'active') return null;

  const [roleRows, permissionRows, unitRows] = await Promise.all([
    db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, row.userId), eq(userRoles.tenantId, row.tenantId))),
    db
      .select({ permissionKey: rolePermissions.permissionKey })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .where(and(eq(userRoles.userId, row.userId), eq(userRoles.tenantId, row.tenantId))),
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
      ),
  ]);

  const authorizedUnitIds = unitRows.map((unit) => unit.unitId);

  // A unidade pedida so vale se estiver entre as autorizadas do usuario.
  const unitId =
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
    unitId,
    authorizedUnitIds,
    roleKeys: roleRows.map((role) => role.key),
    permissions: new Set(
      permissionRows.map((permission) => permission.permissionKey as PermissionKey),
    ),
    sessionId: session.id,
  };

  enrichContext({
    tenantId: context.tenantId,
    userId: context.userId,
    unitId: context.unitId ?? undefined,
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

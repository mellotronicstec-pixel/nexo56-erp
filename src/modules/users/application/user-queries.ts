import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { scopedWhere } from '@/core/db/tenant-scoped';
import { roles, userRoles } from '@/modules/access-control/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  status: string;
  lastLoginAt: Date | null;
}

/** Lista usuarios do tenant da sessao. Nunca retorna hash de senha. */
export async function listUsers(context: TenantContext): Promise<UserSummary[]> {
  return getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(scopedWhere(context, users.tenantId))
    .orderBy(users.name);
}

export async function findUserById(
  context: TenantContext,
  userId: string,
): Promise<UserSummary | null> {
  const rows = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(scopedWhere(context, users.tenantId, eq(users.id, userId)))
    .limit(1);

  return rows[0] ?? null;
}

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
}

export async function listRoles(context: TenantContext): Promise<RoleSummary[]> {
  return getDb()
    .select({
      id: roles.id,
      key: roles.key,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
    })
    .from(roles)
    .where(scopedWhere(context, roles.tenantId))
    .orderBy(roles.name);
}

export async function listUserRoleKeys(context: TenantContext, userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(scopedWhere(context, userRoles.tenantId, eq(userRoles.userId, userId)));

  return rows.map((row) => row.key);
}

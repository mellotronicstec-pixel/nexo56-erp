import 'server-only';
import { eq, sql } from 'drizzle-orm';
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

export interface UnitMember {
  id: string;
  name: string;
}

/**
 * Quem opera numa unidade: ativo, da empresa, com vinculo naquela unidade.
 *
 * MORA EM `users` DE PROPOSITO. A pergunta "quem trabalha aqui" nao pertence a
 * Ordens de Servico nem a Agenda — os dois so a fazem. Deixa-la em um dos dois
 * obrigaria o outro a depender de um modulo com o qual ele nao tem relacao: a
 * Agenda e OPCIONAL e nao depende de OS (ADR-073), e uma tarefa
 * administrativa precisa de responsavel do mesmo jeito.
 *
 * E a MESMA regra que `assertAssignee` aplica ao gravar. Se a lista da tela
 * fosse mais larga que a regra do servidor, o formulario ofereceria nomes que
 * a gravacao recusa.
 */
export async function listUnitMembers(
  context: TenantContext,
  unitId: string,
): Promise<UnitMember[]> {
  if (!context.authorizedUnitIds.includes(unitId)) return [];

  const rows = await getDb().execute(sql`
    SELECT u.id, u.name
      FROM users u
      JOIN user_units uu ON uu.user_id = u.id AND uu.unit_id = ${unitId}
     WHERE u.tenant_id = ${context.tenantId}
       AND u.status = 'active'
     ORDER BY u.name ASC
     LIMIT 100
  `);

  return ((rows as unknown as Array<UnitMember[]>)[0] ?? []).map((row) => ({
    id: row.id,
    name: row.name,
  }));
}

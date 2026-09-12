import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { BusinessRuleError, NotFoundError } from '@/core/errors';
import {
  assertCanGrantPermissions,
  assertNotSelfEscalation,
  assertTenantKeepsAdmin,
} from '@/modules/access-control/application/admin-guard';
import {
  ROLE_SCOPES,
  type PermissionKey,
  type RoleScope,
} from '@/modules/access-control/domain/permissions';
import {
  rolePermissions,
  roles,
  userRoles,
  userUnitRoles,
} from '@/modules/access-control/infrastructure/schema';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { userUnits } from '@/modules/users/infrastructure/schema';
import { findUserInTenant } from '@/modules/users/application/user-service';

/**
 * Atribuicao de perfis com escopo (Prompt 03, itens 15 a 21).
 *
 *   TENANT — vale nas unidades que o usuario ja acessa. NAO concede vinculo
 *            a novas unidades (item 16).
 *   UNIT   — vale somente na unidade indicada, e exige vinculo previo (item 20).
 *
 * Toda concessao passa pela politica anti-escalonamento: ninguem concede
 * permissao de alto risco que nao possua, nem amplia o proprio acesso.
 */

export interface AssignRoleInput {
  userId: string;
  roleId: string;
  scope: RoleScope;
  /** Obrigatorio quando o escopo e UNIT. */
  unitId?: string | null;
}

async function loadRoleInTenant(context: TenantContext, roleId: string) {
  const rows = await getDb()
    .select({ id: roles.id, key: roles.key, name: roles.name, isSystem: roles.isSystem })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.tenantId, context.tenantId)))
    .limit(1);

  const role = rows[0];
  // Perfil de outro tenant simplesmente "nao existe" (item 65).
  if (!role) throw new NotFoundError('Perfil de acesso nao encontrado.');
  return role;
}

async function permissionsOfRole(roleId: string): Promise<PermissionKey[]> {
  const rows = await getDb()
    .select({ permissionKey: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((row) => row.permissionKey as PermissionKey);
}

export async function assignRole(context: TenantContext, input: AssignRoleInput): Promise<void> {
  const user = await findUserInTenant(context, input.userId);
  const role = await loadRoleInTenant(context, input.roleId);
  const granted = await permissionsOfRole(role.id);

  // Anti-escalonamento antes de qualquer escrita.
  assertCanGrantPermissions(context, granted);
  assertNotSelfEscalation(context, user.id, granted);

  if (input.scope === ROLE_SCOPES.UNIT) {
    if (!input.unitId) {
      throw new BusinessRuleError('Informe a unidade para um perfil de escopo por unidade.');
    }

    // Membership obrigatoria (item 20). A FK do banco tambem barra, mas aqui a
    // mensagem explica o motivo em vez de estourar erro de constraint.
    const membership = await getDb()
      .select({ userId: userUnits.userId })
      .from(userUnits)
      .where(
        and(
          eq(userUnits.userId, user.id),
          eq(userUnits.unitId, input.unitId),
          eq(userUnits.tenantId, context.tenantId),
        ),
      )
      .limit(1);

    if (!membership[0]) {
      throw new BusinessRuleError(
        'O usuario precisa estar vinculado a esta unidade antes de receber um perfil nela.',
      );
    }
  }

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    if (input.scope === ROLE_SCOPES.TENANT) {
      await tx
        .insert(userRoles)
        .values({
          userId: user.id,
          roleId: role.id,
          tenantId: context.tenantId,
          createdBy: context.userId,
          createdAt: now,
        })
        .onDuplicateKeyUpdate({ set: { userId: user.id } });
    } else {
      await tx
        .insert(userUnitRoles)
        .values({
          userId: user.id,
          roleId: role.id,
          unitId: input.unitId as string,
          tenantId: context.tenantId,
          createdBy: context.userId,
          createdAt: now,
        })
        .onDuplicateKeyUpdate({ set: { userId: user.id } });
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.ROLE_ASSIGNED,
        entityType: 'role_assignment',
        entityId: role.id,
        tenantId: context.tenantId,
        unitId: input.scope === ROLE_SCOPES.UNIT ? input.unitId : null,
        userId: context.userId,
        after: {
          targetUserId: user.id,
          roleKey: role.key,
          roleName: role.name,
          scope: input.scope,
          unitId: input.unitId ?? null,
        },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.ROLE_ASSIGNED,
      tenantId: context.tenantId,
      payload: {
        targetUserId: user.id,
        roleId: role.id,
        scope: input.scope,
        unitId: input.unitId ?? null,
      },
    });
  });
}

export async function revokeRole(context: TenantContext, input: AssignRoleInput): Promise<void> {
  const user = await findUserInTenant(context, input.userId);
  const role = await loadRoleInTenant(context, input.roleId);

  await runInTransaction(async (tx, emit) => {
    if (input.scope === ROLE_SCOPES.TENANT) {
      await tx
        .delete(userRoles)
        .where(
          and(
            eq(userRoles.userId, user.id),
            eq(userRoles.roleId, role.id),
            eq(userRoles.tenantId, context.tenantId),
          ),
        );
    } else {
      if (!input.unitId) throw new BusinessRuleError('Informe a unidade do perfil a revogar.');
      await tx
        .delete(userUnitRoles)
        .where(
          and(
            eq(userUnitRoles.userId, user.id),
            eq(userUnitRoles.roleId, role.id),
            eq(userUnitRoles.unitId, input.unitId),
            eq(userUnitRoles.tenantId, context.tenantId),
          ),
        );
    }

    // Estado ja alterado nesta transacao: se isto tirou o ultimo administrador,
    // o commit nao acontece.
    await assertTenantKeepsAdmin(tx, context.tenantId, { operation: 'revokeRole' });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.ROLE_REVOKED,
        entityType: 'role_assignment',
        entityId: role.id,
        tenantId: context.tenantId,
        unitId: input.scope === ROLE_SCOPES.UNIT ? input.unitId : null,
        userId: context.userId,
        before: {
          targetUserId: user.id,
          roleKey: role.key,
          scope: input.scope,
          unitId: input.unitId ?? null,
        },
        after: null,
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.ROLE_REVOKED,
      tenantId: context.tenantId,
      payload: { targetUserId: user.id, roleId: role.id, scope: input.scope },
    });
  });
}

export interface UserAssignments {
  tenantRoles: Array<{ roleId: string; roleKey: string; roleName: string }>;
  unitRoles: Array<{ roleId: string; roleKey: string; roleName: string; unitId: string }>;
}

/** Atribuicoes do usuario, sempre escopadas ao tenant da sessao. */
export async function listUserAssignments(
  context: TenantContext,
  userId: string,
): Promise<UserAssignments> {
  const db = getDb();

  const [tenantRows, unitRows] = await Promise.all([
    db
      .select({ roleId: roles.id, roleKey: roles.key, roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, context.tenantId))),
    db
      .select({
        roleId: roles.id,
        roleKey: roles.key,
        roleName: roles.name,
        unitId: userUnitRoles.unitId,
      })
      .from(userUnitRoles)
      .innerJoin(roles, eq(roles.id, userUnitRoles.roleId))
      .where(and(eq(userUnitRoles.userId, userId), eq(userUnitRoles.tenantId, context.tenantId))),
  ]);

  return { tenantRoles: tenantRows, unitRoles: unitRows };
}

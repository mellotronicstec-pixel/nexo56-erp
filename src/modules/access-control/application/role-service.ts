import 'server-only';
import { and, count, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import {
  assertCanGrantPermissions,
  assertTenantKeepsAdmin,
} from '@/modules/access-control/application/admin-guard';
import {
  PERMISSION_CATALOG,
  type PermissionKey,
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

/**
 * Perfis de acesso — na interface, "perfil"; internamente, Role (item 11).
 * Um unico sistema, dois nomes conforme o publico.
 *
 * Perfis pertencem ao tenant. Perfil de outro tenant nao e encontrado, muito
 * menos editavel.
 */

const KNOWN_PERMISSIONS = new Set<string>(PERMISSION_CATALOG.map((permission) => permission.key));

export const roleSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do perfil.').max(160),
  description: z.string().trim().max(400).default(''),
});

function slugifyKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

export async function createRole(context: TenantContext, input: unknown): Promise<string> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');

  const key = slugifyKey(parsed.data.name);
  if (!key) throw new ValidationError('Nome de perfil invalido.');

  const existing = await getDb()
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, context.tenantId), eq(roles.key, key)))
    .limit(1);

  if (existing[0]) throw new ConflictError('Ja existe um perfil com este nome.');

  const roleId = newId();
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx.insert(roles).values({
      id: roleId,
      tenantId: context.tenantId,
      key,
      name: parsed.data.name,
      description: parsed.data.description,
      isSystem: false,
      createdBy: context.userId,
      updatedBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.ROLE_CREATED,
        entityType: 'role',
        entityId: roleId,
        tenantId: context.tenantId,
        userId: context.userId,
        after: { key, name: parsed.data.name },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.ROLE_CREATED,
      tenantId: context.tenantId,
      payload: { roleId, key },
    });
  });

  return roleId;
}

export async function updateRole(
  context: TenantContext,
  roleId: string,
  input: unknown,
): Promise<void> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');

  const role = await findRoleInTenant(context, roleId);

  if (role.isSystem) {
    throw new BusinessRuleError(
      'O perfil Administrador e estrutural do Nexo56 e nao pode ser renomeado.',
    );
  }

  await runInTransaction(async (tx) => {
    await tx
      .update(roles)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        updatedBy: context.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(roles.id, role.id), eq(roles.tenantId, context.tenantId)));

    await recordAudit(
      {
        action: AUDIT_ACTIONS.ROLE_UPDATED,
        entityType: 'role',
        entityId: role.id,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { name: role.name, description: role.description },
        after: { name: parsed.data.name, description: parsed.data.description },
      },
      tx,
    );
  });
}

/**
 * Altera QUAIS permissoes o perfil concede.
 *
 * Operacao mais sensivel do modulo — por isso tem permissao propria
 * (`roles.manage_permissions`) e passa pela politica anti-escalonamento:
 * ninguem acrescenta a um perfil uma permissao de alto risco que nao possua.
 */
export async function setRolePermissions(
  context: TenantContext,
  roleId: string,
  permissionKeys: readonly string[],
): Promise<void> {
  const role = await findRoleInTenant(context, roleId);

  const unknown = permissionKeys.filter((key) => !KNOWN_PERMISSIONS.has(key));
  if (unknown.length > 0) {
    throw new ValidationError(`Permissao desconhecida: ${unknown.join(', ')}`);
  }

  const desired = [...new Set(permissionKeys)] as PermissionKey[];

  const current = (
    await getDb()
      .select({ permissionKey: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, role.id))
  ).map((row) => row.permissionKey as PermissionKey);

  const added = desired.filter((permission) => !current.includes(permission));
  const removed = current.filter((permission) => !desired.includes(permission));

  if (added.length === 0 && removed.length === 0) return;

  // So é possivel conceder o que se tem (item 57).
  assertCanGrantPermissions(context, added);

  if (role.isSystem) {
    throw new BusinessRuleError(
      'As permissoes do perfil Administrador sao estruturais e nao podem ser alteradas.',
    );
  }

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    if (removed.length > 0) {
      await tx
        .delete(rolePermissions)
        .where(
          and(eq(rolePermissions.roleId, role.id), inArray(rolePermissions.permissionKey, removed)),
        );
    }

    for (const permission of added) {
      await tx
        .insert(rolePermissions)
        .values({ roleId: role.id, permissionKey: permission, createdAt: now })
        .onDuplicateKeyUpdate({ set: { roleId: role.id } });
    }

    await tx
      .update(roles)
      .set({ updatedBy: context.userId, updatedAt: now })
      .where(eq(roles.id, role.id));

    await assertTenantKeepsAdmin(tx, context.tenantId, { operation: 'setRolePermissions' });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.ROLE_PERMISSIONS_CHANGED,
        entityType: 'role',
        entityId: role.id,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { permissions: current },
        after: { permissions: desired },
        metadata: { added, removed },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.ROLE_PERMISSIONS_CHANGED,
      tenantId: context.tenantId,
      payload: { roleId: role.id, added, removed },
    });
  });
}

export async function deleteRole(context: TenantContext, roleId: string): Promise<void> {
  const role = await findRoleInTenant(context, roleId);

  if (role.isSystem) {
    throw new BusinessRuleError('O perfil Administrador nao pode ser excluido.');
  }

  await runInTransaction(async (tx) => {
    await tx.delete(userUnitRoles).where(eq(userUnitRoles.roleId, role.id));
    await tx.delete(userRoles).where(eq(userRoles.roleId, role.id));
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    await tx.delete(roles).where(and(eq(roles.id, role.id), eq(roles.tenantId, context.tenantId)));

    await assertTenantKeepsAdmin(tx, context.tenantId, { operation: 'deleteRole' });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.ROLE_DELETED,
        entityType: 'role',
        entityId: role.id,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { key: role.key, name: role.name },
        after: null,
      },
      tx,
    );
  });
}

export async function findRoleInTenant(context: TenantContext, roleId: string) {
  const rows = await getDb()
    .select({
      id: roles.id,
      key: roles.key,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
    })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.tenantId, context.tenantId)))
    .limit(1);

  const role = rows[0];
  if (!role) throw new NotFoundError('Perfil de acesso nao encontrado.');
  return role;
}

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissionCount: number;
  assignmentCount: number;
}

/** Lista os perfis do tenant com contagens, sem N+1. */
export async function listRolesWithCounts(context: TenantContext): Promise<RoleSummary[]> {
  const db = getDb();

  const [roleRows, permissionCounts, tenantAssignments, unitAssignments] = await Promise.all([
    db
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
      })
      .from(roles)
      .where(eq(roles.tenantId, context.tenantId))
      .orderBy(roles.name),
    db
      .select({ roleId: rolePermissions.roleId, total: count() })
      .from(rolePermissions)
      .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
      .where(eq(roles.tenantId, context.tenantId))
      .groupBy(rolePermissions.roleId),
    db
      .select({ roleId: userRoles.roleId, total: count() })
      .from(userRoles)
      .where(eq(userRoles.tenantId, context.tenantId))
      .groupBy(userRoles.roleId),
    db
      .select({ roleId: userUnitRoles.roleId, total: count() })
      .from(userUnitRoles)
      .where(eq(userUnitRoles.tenantId, context.tenantId))
      .groupBy(userUnitRoles.roleId),
  ]);

  const permissionsByRole = new Map(permissionCounts.map((row) => [row.roleId, row.total]));
  const assignmentsByRole = new Map<string, number>();
  for (const row of [...tenantAssignments, ...unitAssignments]) {
    assignmentsByRole.set(row.roleId, (assignmentsByRole.get(row.roleId) ?? 0) + row.total);
  }

  return roleRows.map((role) => ({
    ...role,
    permissionCount: permissionsByRole.get(role.id) ?? 0,
    assignmentCount: assignmentsByRole.get(role.id) ?? 0,
  }));
}

export async function listRolePermissions(
  context: TenantContext,
  roleId: string,
): Promise<PermissionKey[]> {
  await findRoleInTenant(context, roleId);
  const rows = await getDb()
    .select({ permissionKey: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((row) => row.permissionKey as PermissionKey);
}

import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { NotFoundError } from '@/core/errors';
import { assertTenantKeepsAdmin } from '@/modules/access-control/application/admin-guard';
import { userUnitRoles } from '@/modules/access-control/infrastructure/schema';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { units } from '@/modules/tenancy/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { userUnits } from '@/modules/users/infrastructure/schema';
import { findUserInTenant } from '@/modules/users/application/user-service';

/**
 * Vinculo de usuarios a unidades — MEMBERSHIP (Prompt 03, itens 5, 20 e 21).
 *
 * Membership responde "em quais unidades esta pessoa pode operar". NAO e
 * permissao: conceder unidade nao concede nenhuma capacidade, e revogar
 * unidade nao remove papeis de tenant.
 */

async function findUnitInTenant(context: TenantContext, unitId: string) {
  const rows = await getDb()
    .select({ id: units.id, name: units.name })
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.tenantId, context.tenantId)))
    .limit(1);

  const unit = rows[0];
  if (!unit) throw new NotFoundError('Unidade nao encontrada.');
  return unit;
}

export async function grantUnitMembership(
  context: TenantContext,
  userId: string,
  unitId: string,
): Promise<void> {
  const user = await findUserInTenant(context, userId);
  const unit = await findUnitInTenant(context, unitId);

  const existing = await getDb()
    .select({ userId: userUnits.userId })
    .from(userUnits)
    .where(and(eq(userUnits.userId, user.id), eq(userUnits.unitId, unit.id)))
    .limit(1);

  if (existing[0]) return; // idempotente

  await runInTransaction(async (tx, emit) => {
    await tx.insert(userUnits).values({
      userId: user.id,
      unitId: unit.id,
      tenantId: context.tenantId,
      createdBy: context.userId,
      createdAt: new Date(),
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.USER_UNIT_GRANTED,
        entityType: 'user_unit',
        entityId: user.id,
        tenantId: context.tenantId,
        unitId: unit.id,
        userId: context.userId,
        after: { userId: user.id, unitId: unit.id, unitName: unit.name },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.USER_UNIT_GRANTED,
      tenantId: context.tenantId,
      payload: { userId: user.id, unitId: unit.id },
    });
  });
}

/**
 * Revoga o vinculo com uma unidade.
 *
 * COMPORTAMENTO EXPLICITO (item 21): papeis atribuidos NAQUELA unidade sao
 * removidos na mesma transacao, e a remocao e auditada. Deixá-los seria pior
 * do que inutil — ficariam concedendo acesso a uma unidade que a pessoa nao
 * pode mais acessar.
 *
 * A FK `fk_user_unit_roles_membership` tambem cascateia, mas a remocao
 * explicita existe para que a auditoria registre O QUE foi retirado.
 * Papeis de escopo TENANT nao sao tocados — eles nao pertencem a esta unidade.
 */
export async function revokeUnitMembership(
  context: TenantContext,
  userId: string,
  unitId: string,
): Promise<void> {
  const user = await findUserInTenant(context, userId);
  const unit = await findUnitInTenant(context, unitId);

  const existing = await getDb()
    .select({ userId: userUnits.userId })
    .from(userUnits)
    .where(and(eq(userUnits.userId, user.id), eq(userUnits.unitId, unit.id)))
    .limit(1);

  if (!existing[0]) return; // idempotente

  const affectedRoles = await getDb()
    .select({ roleId: userUnitRoles.roleId })
    .from(userUnitRoles)
    .where(and(eq(userUnitRoles.userId, user.id), eq(userUnitRoles.unitId, unit.id)));

  await runInTransaction(async (tx, emit) => {
    await tx
      .delete(userUnitRoles)
      .where(and(eq(userUnitRoles.userId, user.id), eq(userUnitRoles.unitId, unit.id)));

    await tx
      .delete(userUnits)
      .where(and(eq(userUnits.userId, user.id), eq(userUnits.unitId, unit.id)));

    await assertTenantKeepsAdmin(tx, context.tenantId, { operation: 'revokeUnitMembership' });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.USER_UNIT_REVOKED,
        entityType: 'user_unit',
        entityId: user.id,
        tenantId: context.tenantId,
        unitId: unit.id,
        userId: context.userId,
        before: {
          userId: user.id,
          unitId: unit.id,
          unitName: unit.name,
          removedUnitRoles: affectedRoles.map((role) => role.roleId),
        },
        after: null,
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.USER_UNIT_REVOKED,
      tenantId: context.tenantId,
      payload: { userId: user.id, unitId: unit.id, removedUnitRoles: affectedRoles.length },
    });
  });
}

/** Unidades a que o usuario esta vinculado, dentro do tenant da sessao. */
export async function listUserMemberships(
  context: TenantContext,
  userId: string,
): Promise<Array<{ unitId: string; unitName: string; unitStatus: string }>> {
  return getDb()
    .select({ unitId: units.id, unitName: units.name, unitStatus: units.status })
    .from(userUnits)
    .innerJoin(units, eq(units.id, userUnits.unitId))
    .where(and(eq(userUnits.userId, userId), eq(userUnits.tenantId, context.tenantId)))
    .orderBy(units.name);
}

/** Util para as telas: impede oferecer unidade de outro tenant. */
export async function assertUnitBelongsToTenant(
  context: TenantContext,
  unitId: string,
): Promise<void> {
  await findUnitInTenant(context, unitId);
}

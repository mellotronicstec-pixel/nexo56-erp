import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { newId } from '@/core/ids/id';
import { logger } from '@/core/logging/logger';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import {
  STARTER_ROLE_DEFINITIONS,
  SYSTEM_ROLE_DEFINITIONS,
} from '@/modules/access-control/domain/permissions';
import { rolePermissions, roles, userRoles } from '@/modules/access-control/infrastructure/schema';
import { hashPassword } from '@/modules/auth/domain/password';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { users, userUnits } from '@/modules/users/infrastructure/schema';

/**
 * Provisionamento de tenant (Prompt 01, item 16).
 *
 * Usado pelo bootstrap e pelos testes. Idempotente por slug: se o tenant ja
 * existe, NAO recria e NAO sobrescreve nada — devolve o que encontrou. Isso
 * evita que uma execucao acidental do comando destrua dados existentes.
 */

export interface ProvisionTenantInput {
  tenantName: string;
  tenantSlug: string;
  timezone: string;
  planId: string;
  unitName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

export interface ProvisionTenantResult {
  created: boolean;
  tenantId: string;
  unitId: string;
  adminUserId: string;
}

export async function provisionTenant(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
  const db = getDb();

  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, input.tenantSlug))
    .limit(1);

  if (existing[0]) {
    const tenantId = existing[0].id;
    const unit = await db
      .select({ id: units.id })
      .from(units)
      .where(eq(units.tenantId, tenantId))
      .limit(1);
    const admin = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, input.adminEmail.toLowerCase())))
      .limit(1);

    return {
      created: false,
      tenantId,
      unitId: unit[0]?.id ?? '',
      adminUserId: admin[0]?.id ?? '',
    };
  }

  const emailInUse = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.adminEmail.toLowerCase()))
    .limit(1);

  const now = new Date();
  const tenantId = newId();
  const unitId = newId();
  const adminUserId = newId();
  const passwordHash = await hashPassword(input.adminPassword);

  await runInTransaction(async (tx, emit) => {
    await tx.insert(tenants).values({
      id: tenantId,
      slug: input.tenantSlug,
      name: input.tenantName,
      status: 'active',
      timezone: input.timezone,
      planId: input.planId,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(units).values({
      id: unitId,
      tenantId,
      name: input.unitName,
      status: 'active',
      timezone: null,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(users).values({
      id: adminUserId,
      tenantId,
      email: input.adminEmail.toLowerCase(),
      name: input.adminName,
      passwordHash,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(userUnits).values({ userId: adminUserId, unitId, tenantId, createdAt: now });

    for (const definition of SYSTEM_ROLE_DEFINITIONS) {
      const roleId = newId();
      await tx.insert(roles).values({
        id: roleId,
        tenantId,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        isSystem: true,
        createdAt: now,
        updatedAt: now,
      });

      for (const permissionKey of definition.permissions) {
        await tx.insert(rolePermissions).values({ roleId, permissionKey, createdAt: now });
      }

      await tx.insert(userRoles).values({ userId: adminUserId, roleId, tenantId, createdAt: now });
    }

    /**
     * Perfis iniciais oferecidos a empresa (Prompt 03, item 12).
     * Nascem sem permissoes — as capacidades reais chegam com os modulos de
     * negocio. Nao sao `is_system`: a empresa pode ajustar ou excluir.
     */
    for (const starter of STARTER_ROLE_DEFINITIONS) {
      await tx.insert(roles).values({
        id: newId(),
        tenantId,
        key: starter.key,
        name: starter.name,
        description: starter.description,
        isSystem: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.TENANT_CREATED,
        entityType: 'tenant',
        entityId: tenantId,
        tenantId,
        userId: adminUserId,
        after: { slug: input.tenantSlug, name: input.tenantName, timezone: input.timezone },
        metadata: { via: 'bootstrap' },
      },
      tx,
    );

    await recordAudit(
      {
        action: AUDIT_ACTIONS.USER_CREATED,
        entityType: 'user',
        entityId: adminUserId,
        tenantId,
        userId: adminUserId,
        after: { email: input.adminEmail.toLowerCase(), name: input.adminName, role: 'admin' },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.TENANT_CREATED,
      tenantId,
      payload: { tenantId, slug: input.tenantSlug },
    });
    await emit({
      type: EVENT_TYPES.UNIT_CREATED,
      tenantId,
      payload: { unitId, name: input.unitName },
    });
    await emit({
      type: EVENT_TYPES.USER_CREATED,
      tenantId,
      payload: { userId: adminUserId, role: 'admin' },
    });
  });

  if (emailInUse[0]) {
    // E-mail unico POR tenant: isto e permitido, mas a pessoa passara a ter
    // de informar a empresa no login (ver login-service).
    logger.warn('E-mail ja usado em outra empresa — login exigira o identificador da empresa', {
      module: 'tenancy',
      operation: 'provisionTenant',
    });
  }

  return { created: true, tenantId, unitId, adminUserId };
}

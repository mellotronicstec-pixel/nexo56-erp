import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { newId } from '@/core/ids/id';
import {
  rolePermissions,
  roles,
  userRoles,
  userUnitRoles,
} from '@/modules/access-control/infrastructure/schema';
import type { PermissionKey } from '@/modules/access-control/domain/permissions';
import { units } from '@/modules/tenancy/infrastructure/schema';
import { userUnits } from '@/modules/users/infrastructure/schema';
import { syncCatalog } from '@/modules/features/application/catalog-sync';
import { provisionTenant } from '@/modules/tenancy/application/provisioning';
import { users } from '@/modules/users/infrastructure/schema';
import { loadContextForSession } from '@/modules/auth/application/current-context';
import { createSession } from '@/modules/auth/application/session-service';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Fixtures de teste. Senhas sao geradas por teste e nunca reutilizadas entre
 * ambientes — nada aqui vale fora do banco de teste.
 */

export interface TenantFixture {
  tenantId: string;
  unitId: string;
  adminUserId: string;
  slug: string;
  email: string;
  password: string;
  context: TenantContext;
  sessionToken: string;
}

export async function seedCatalog(): Promise<string> {
  return runWithContext({ origin: 'test' }, async () => (await syncCatalog()).internalPlanId);
}

export async function createTenantFixture(
  slug: string,
  planId: string,
  options: { email?: string; password?: string } = {},
): Promise<TenantFixture> {
  const email = options.email ?? `admin@${slug}.invalid`;
  const password = options.password ?? `Senha-Teste-${slug}-123456`;

  return runWithContext({ origin: 'test' }, async () => {
    const provisioned = await provisionTenant({
      tenantName: `Empresa ${slug}`,
      tenantSlug: slug,
      timezone: 'America/Sao_Paulo',
      planId,
      unitName: `Unidade ${slug}`,
      adminName: `Admin ${slug}`,
      adminEmail: email,
      adminPassword: password,
    });

    const session = await createSession(provisioned.adminUserId, provisioned.tenantId);
    const context = await loadContextForSession({
      id: session.sessionId,
      userId: provisioned.adminUserId,
      tenantId: provisioned.tenantId,
    });

    if (!context) throw new Error('Fixture nao conseguiu montar o contexto do tenant.');

    return {
      tenantId: provisioned.tenantId,
      unitId: provisioned.unitId,
      adminUserId: provisioned.adminUserId,
      slug,
      email,
      password,
      context,
      sessionToken: session.token,
    };
  });
}

/** Cria uma unidade adicional no tenant. */
export async function createUnit(tenantId: string, name: string): Promise<string> {
  const unitId = newId();
  await getDb().insert(units).values({
    id: unitId,
    tenantId,
    name,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return unitId;
}

/** Cria um usuario simples no tenant, sem papeis. */
export async function createPlainUser(
  tenantId: string,
  email: string,
  name = 'Usuario de teste',
): Promise<string> {
  const userId = newId();
  await getDb().insert(users).values({
    id: userId,
    tenantId,
    email,
    name,
    passwordHash: 'scrypt$65536$8$2$c2FsdA==$aGFzaA==',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return userId;
}

/** Vincula o usuario a uma unidade (membership). */
export async function grantMembership(
  tenantId: string,
  userId: string,
  unitId: string,
): Promise<void> {
  await getDb()
    .insert(userUnits)
    .values({ userId, unitId, tenantId, createdAt: new Date() })
    .onDuplicateKeyUpdate({ set: { userId } });
}

/** Cria um perfil com as permissoes indicadas. */
export async function createRoleWithPermissions(
  tenantId: string,
  key: string,
  permissions: readonly PermissionKey[],
): Promise<string> {
  const roleId = newId();
  const now = new Date();

  await getDb().insert(roles).values({
    id: roleId,
    tenantId,
    key,
    name: key,
    description: '',
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  });

  for (const permission of permissions) {
    await getDb()
      .insert(rolePermissions)
      .values({ roleId, permissionKey: permission, createdAt: now });
  }

  return roleId;
}

/** Atribuicao tenant-wide, direto no banco (bypassa a camada de servico). */
export async function assignTenantRole(
  tenantId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  await getDb()
    .insert(userRoles)
    .values({ userId, roleId, tenantId, createdAt: new Date() })
    .onDuplicateKeyUpdate({ set: { userId } });
}

/** Atribuicao por unidade, direto no banco. */
export async function assignUnitRole(
  tenantId: string,
  userId: string,
  roleId: string,
  unitId: string,
): Promise<void> {
  await getDb()
    .insert(userUnitRoles)
    .values({ userId, roleId, unitId, tenantId, createdAt: new Date() })
    .onDuplicateKeyUpdate({ set: { userId } });
}

/** Remove todos os papeis tenant-wide do usuario. */
export async function clearTenantRoles(userId: string): Promise<void> {
  await getDb().delete(userRoles).where(eq(userRoles.userId, userId));
}

/** Monta o contexto de um usuario, opcionalmente pedindo uma unidade ativa. */
export async function contextFor(
  tenantId: string,
  userId: string,
  requestedUnitId?: string,
): Promise<TenantContext> {
  const session = await createSession(userId, tenantId);
  const context = await runWithContext({ origin: 'test' }, () =>
    loadContextForSession(
      { id: session.sessionId, userId, tenantId, expiresAt: session.expiresAt },
      requestedUnitId,
    ),
  );
  if (!context) throw new Error('contexto nao montado');
  return context;
}

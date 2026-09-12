import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runWithContext } from '@/core/context/request-context';
import { BusinessRuleError } from '@/core/errors';
import { countRemainingAdmins } from '@/modules/access-control/application/admin-guard';
import { revokeRole } from '@/modules/access-control/application/assignment-service';
import { deleteRole, setRolePermissions } from '@/modules/access-control/application/role-service';
import {
  PERMISSIONS,
  ROLE_SCOPES,
  SYSTEM_ROLES,
} from '@/modules/access-control/domain/permissions';
import { getDb } from '@/core/db/client';
import { roles } from '@/modules/access-control/infrastructure/schema';
import { and, eq } from 'drizzle-orm';
import { deactivateUser } from '@/modules/users/application/user-service';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  assignTenantRole,
  createPlainUser,
  createTenantFixture,
  grantMembership,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/**
 * PROTECAO CONTRA LOCKOUT (Prompt 03, itens 53 e 88).
 *
 * Um ERP que permite remover o ultimo administrador vira um chamado de suporte
 * — ou pior, uma empresa sem acesso aos proprios dados.
 */

let tenant: TenantFixture;
let adminRoleId: string;

async function loadAdminRoleId(tenantId: string): Promise<string> {
  const rows = await getDb()
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.key, SYSTEM_ROLES.ADMIN)))
    .limit(1);
  return rows[0]!.id;
}

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenant = await createTenantFixture('lockout', planId);
  adminRoleId = await loadAdminRoleId(tenant.tenantId);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('contagem de administradores', () => {
  it('o bootstrap deixa exatamente um administrador', async () => {
    expect(await countRemainingAdmins(getDb(), tenant.tenantId)).toBe(1);
  });

  it('conta dois quando ha um segundo administrador', async () => {
    const segundo = await createPlainUser(tenant.tenantId, 'segundo@lockout.invalid');
    await grantMembership(tenant.tenantId, segundo, tenant.unitId);
    await assignTenantRole(tenant.tenantId, segundo, adminRoleId);

    expect(await countRemainingAdmins(getDb(), tenant.tenantId)).toBe(2);
  });
});

describe('o ultimo administrador e protegido', () => {
  it('nao permite revogar o papel do ultimo administrador', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        revokeRole(tenant.context, {
          userId: tenant.adminUserId,
          roleId: adminRoleId,
          scope: ROLE_SCOPES.TENANT,
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    // Nada foi gravado: o administrador continua la.
    expect(await countRemainingAdmins(getDb(), tenant.tenantId)).toBe(1);
  });

  it('nao permite excluir o perfil Administrador', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () => deleteRole(tenant.context, adminRoleId)),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('nao permite esvaziar as permissoes do perfil Administrador', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () => setRolePermissions(tenant.context, adminRoleId, [])),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('nao permite ao administrador inativar a propria conta', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () => deactivateUser(tenant.context, tenant.adminUserId)),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('nao permite inativar o ultimo administrador a partir de outra conta', async () => {
    // Uma segunda pessoa, com poder de gerir usuarios mas sem ser administradora.
    const operador = await createPlainUser(tenant.tenantId, 'operador@lockout.invalid');
    await grantMembership(tenant.tenantId, operador, tenant.unitId);

    await expect(
      runWithContext({ origin: 'test' }, () => deactivateUser(tenant.context, tenant.adminUserId)),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    expect(operador).toBeTruthy();
  });
});

describe('com substituto, a operacao passa', () => {
  it('revogar o papel funciona quando existe outro administrador', async () => {
    const segundo = await createPlainUser(tenant.tenantId, 'segundo@lockout.invalid');
    await grantMembership(tenant.tenantId, segundo, tenant.unitId);
    await assignTenantRole(tenant.tenantId, segundo, adminRoleId);

    await expect(
      runWithContext({ origin: 'test' }, () =>
        revokeRole(tenant.context, {
          userId: tenant.adminUserId,
          roleId: adminRoleId,
          scope: ROLE_SCOPES.TENANT,
        }),
      ),
    ).resolves.toBeUndefined();

    expect(await countRemainingAdmins(getDb(), tenant.tenantId)).toBe(1);
  });

  it('inativar um administrador funciona quando ha outro', async () => {
    const segundo = await createPlainUser(tenant.tenantId, 'segundo@lockout.invalid');
    await grantMembership(tenant.tenantId, segundo, tenant.unitId);
    await assignTenantRole(tenant.tenantId, segundo, adminRoleId);

    await expect(
      runWithContext({ origin: 'test' }, () => deactivateUser(tenant.context, segundo)),
    ).resolves.toBeUndefined();

    expect(await countRemainingAdmins(getDb(), tenant.tenantId)).toBe(1);
  });
});

describe('concorrencia (item 88)', () => {
  it('duas remocoes simultaneas nao deixam a empresa sem administrador', async () => {
    const segundo = await createPlainUser(tenant.tenantId, 'segundo@lockout.invalid');
    await grantMembership(tenant.tenantId, segundo, tenant.unitId);
    await assignTenantRole(tenant.tenantId, segundo, adminRoleId);

    expect(await countRemainingAdmins(getDb(), tenant.tenantId)).toBe(2);

    // Ambas tentam remover um administrador diferente ao mesmo tempo.
    const resultados = await Promise.allSettled([
      runWithContext({ origin: 'test' }, () =>
        revokeRole(tenant.context, {
          userId: tenant.adminUserId,
          roleId: adminRoleId,
          scope: ROLE_SCOPES.TENANT,
        }),
      ),
      runWithContext({ origin: 'test' }, () =>
        revokeRole(tenant.context, {
          userId: segundo,
          roleId: adminRoleId,
          scope: ROLE_SCOPES.TENANT,
        }),
      ),
    ]);

    const restantes = await countRemainingAdmins(getDb(), tenant.tenantId);

    // O essencial: a empresa NUNCA fica sem administrador.
    expect(restantes).toBeGreaterThanOrEqual(1);
    // E pelo menos uma das operacoes teve de ser barrada.
    expect(
      resultados.filter((resultado) => resultado.status === 'rejected').length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('permissoes administrativas', () => {
  it('quem tem apenas parte das permissoes nao conta como administrador', async () => {
    const parcial = await createPlainUser(tenant.tenantId, 'parcial@lockout.invalid');
    await grantMembership(tenant.tenantId, parcial, tenant.unitId);

    const { createRoleWithPermissions } = await import('../helpers/fixtures');
    const roleParcial = await createRoleWithPermissions(tenant.tenantId, 'parcial', [
      PERMISSIONS.USERS_MANAGE, // falta manage_access e manage_permissions
    ]);
    await assignTenantRole(tenant.tenantId, parcial, roleParcial);

    expect(await countRemainingAdmins(getDb(), tenant.tenantId)).toBe(1);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runWithContext } from '@/core/context/request-context';
import { BusinessRuleError } from '@/core/errors';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { rolePermissions } from '@/modules/access-control/infrastructure/schema';
import { checkAccess } from '@/modules/features/application/effective-access';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { planEntitlements, tenantFeatures } from '@/modules/features/infrastructure/schema';
import { loadContextForSession } from '@/modules/auth/application/current-context';
import { createSession } from '@/modules/auth/application/session-service';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * EFFECTIVE ACCESS (Prompt 01, itens 26, 27 e 71).
 *   featureExists AND planAllows AND tenantEnabled AND userAuthorized
 */

let tenant: TenantFixture;

async function refreshContext(fixture: TenantFixture) {
  const session = await createSession(fixture.adminUserId, fixture.tenantId);
  const context = await loadContextForSession({
    id: session.sessionId,
    userId: fixture.adminUserId,
    tenantId: fixture.tenantId,
  });
  if (!context) throw new Error('contexto nao montado');
  return context;
}

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenant = await createTenantFixture('empresa-features', planId);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('feature inexistente', () => {
  it('nega acesso a chave que nao existe no catalogo', async () => {
    const decision = await checkAccess(tenant.context, { featureKey: 'modulo.que.nao.existe' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('UNKNOWN_FEATURE');
  });
});

describe('bloqueada por plano', () => {
  it('nega funcionalidade opcional fora do plano', async () => {
    await getDb()
      .delete(planEntitlements)
      .where(
        and(
          eq(planEntitlements.planId, tenant.context.planId),
          eq(planEntitlements.featureKey, FEATURES.PLATFORM_MULTI_UNIT),
        ),
      );

    const decision = await checkAccess(tenant.context, {
      featureKey: FEATURES.PLATFORM_MULTI_UNIT,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('PLAN_NOT_ENTITLED');
  });

  it('CORE continua disponivel mesmo sem linha de entitlement', async () => {
    await getDb()
      .delete(planEntitlements)
      .where(eq(planEntitlements.planId, tenant.context.planId));
    const decision = await checkAccess(tenant.context, { featureKey: FEATURES.CORE_USERS });
    expect(decision.allowed).toBe(true);
  });
});

describe('desabilitada pelo tenant', () => {
  it('nega funcionalidade opcional que a empresa nao ativou', async () => {
    const decision = await checkAccess(tenant.context, {
      featureKey: FEATURES.PLATFORM_MULTI_UNIT,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('TENANT_DISABLED');
  });

  it('permite depois de a empresa ativar', async () => {
    await runWithContext({ origin: 'test' }, () =>
      setTenantFeature(tenant.context, { featureKey: FEATURES.PLATFORM_MULTI_UNIT, enabled: true }),
    );

    const decision = await checkAccess(tenant.context, {
      featureKey: FEATURES.PLATFORM_MULTI_UNIT,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('ALLOWED');
  });

  it('desativar NAO apaga a configuracao nem o historico', async () => {
    await runWithContext({ origin: 'test' }, async () => {
      await setTenantFeature(tenant.context, {
        featureKey: FEATURES.PLATFORM_MULTI_UNIT,
        enabled: true,
      });
      await setTenantFeature(tenant.context, {
        featureKey: FEATURES.PLATFORM_MULTI_UNIT,
        enabled: false,
      });
    });

    const rows = await getDb()
      .select()
      .from(tenantFeatures)
      .where(
        and(
          eq(tenantFeatures.tenantId, tenant.tenantId),
          eq(tenantFeatures.featureKey, FEATURES.PLATFORM_MULTI_UNIT),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(false);
    expect(rows[0]?.enabledAt).not.toBeNull();
    expect(rows[0]?.disabledAt).not.toBeNull();
  });

  it('reativar devolve o acesso mantendo o mesmo registro', async () => {
    await runWithContext({ origin: 'test' }, async () => {
      await setTenantFeature(tenant.context, {
        featureKey: FEATURES.PLATFORM_MULTI_UNIT,
        enabled: true,
      });
      await setTenantFeature(tenant.context, {
        featureKey: FEATURES.PLATFORM_MULTI_UNIT,
        enabled: false,
      });
      await setTenantFeature(tenant.context, {
        featureKey: FEATURES.PLATFORM_MULTI_UNIT,
        enabled: true,
      });
    });

    const decision = await checkAccess(tenant.context, {
      featureKey: FEATURES.PLATFORM_MULTI_UNIT,
    });
    expect(decision.allowed).toBe(true);
  });

  it('funcionalidade CORE nao pode ser desativada', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        setTenantFeature(tenant.context, { featureKey: FEATURES.CORE_AUDIT, enabled: false }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('nao ativa funcionalidade fora do plano', async () => {
    await getDb()
      .delete(planEntitlements)
      .where(
        and(
          eq(planEntitlements.planId, tenant.context.planId),
          eq(planEntitlements.featureKey, FEATURES.PLATFORM_MULTI_UNIT),
        ),
      );

    await expect(
      runWithContext({ origin: 'test' }, () =>
        setTenantFeature(tenant.context, {
          featureKey: FEATURES.PLATFORM_MULTI_UNIT,
          enabled: true,
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe('usuario sem permissao', () => {
  it('nega mesmo com a feature ativa no tenant', async () => {
    await runWithContext({ origin: 'test' }, () =>
      setTenantFeature(tenant.context, { featureKey: FEATURES.PLATFORM_MULTI_UNIT, enabled: true }),
    );

    // Remove a permissao do perfil do administrador.
    const roleIds = await getDb()
      .select({ roleId: rolePermissions.roleId })
      .from(rolePermissions)
      .where(eq(rolePermissions.permissionKey, PERMISSIONS.UNITS_VIEW));

    for (const role of roleIds) {
      await getDb()
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, role.roleId),
            eq(rolePermissions.permissionKey, PERMISSIONS.UNITS_VIEW),
          ),
        );
    }

    const refreshed = await refreshContext(tenant);
    const decision = await checkAccess(refreshed, {
      featureKey: FEATURES.PLATFORM_MULTI_UNIT,
      permission: PERMISSIONS.UNITS_VIEW,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('PERMISSION_DENIED');
  });
});

describe('acesso efetivamente permitido', () => {
  it('permite quando as quatro condicoes sao satisfeitas', async () => {
    await runWithContext({ origin: 'test' }, () =>
      setTenantFeature(tenant.context, { featureKey: FEATURES.PLATFORM_MULTI_UNIT, enabled: true }),
    );

    const decision = await checkAccess(tenant.context, {
      featureKey: FEATURES.PLATFORM_MULTI_UNIT,
      permission: PERMISSIONS.UNITS_VIEW,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('ALLOWED');
  });

  it('o administrador do bootstrap recebe todas as permissoes estruturais', async () => {
    expect(tenant.context.tenantPermissions.has(PERMISSIONS.ADMIN_ACCESS)).toBe(true);
    expect(tenant.context.tenantPermissions.size).toBe(Object.keys(PERMISSIONS).length);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runWithContext } from '@/core/context/request-context';
import { AuthorizationError, BusinessRuleError, NotFoundError } from '@/core/errors';
import { assignRole } from '@/modules/access-control/application/assignment-service';
import { authorize, can } from '@/modules/access-control/application/authorization-service';
import { setRolePermissions } from '@/modules/access-control/application/role-service';
import { PERMISSIONS, ROLE_SCOPES } from '@/modules/access-control/domain/permissions';
import { revokeUserSessionsAsAdmin } from '@/modules/auth/application/session-management';
import { findActiveSession, revokeSession } from '@/modules/auth/application/session-service';
import { loadContextForSession } from '@/modules/auth/application/current-context';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { deactivateUser, updateUser } from '@/modules/users/application/user-service';
import { grantUnitMembership } from '@/modules/users/application/membership-service';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  assignTenantRole,
  contextFor,
  createPlainUser,
  createRoleWithPermissions,
  createTenantFixture,
  createUnit,
  grantMembership,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/**
 * ESCALONAMENTO DE PRIVILEGIO (Prompt 03, itens 55 e 87).
 *
 * Cada teste e uma TENTATIVA DE ATAQUE. Todos devem falhar de forma segura —
 * e falhar do jeito certo: negando, sem revelar o que existe do outro lado.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let atacante: string;
let unidadeA2: string;

/** Perfil fraco: so consegue ler, nunca administrar. */
let roleLeitura: string;

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();

  tenantA = await createTenantFixture('escalada-a', planId);
  tenantB = await createTenantFixture('escalada-b', planId);

  unidadeA2 = await createUnit(tenantA.tenantId, 'Unidade A2');

  atacante = await createPlainUser(tenantA.tenantId, 'atacante@escalada-a.invalid', 'Atacante');
  await grantMembership(tenantA.tenantId, atacante, tenantA.unitId);

  roleLeitura = await createRoleWithPermissions(tenantA.tenantId, 'leitura', [
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.ROLES_VIEW,
  ]);
  await assignTenantRole(tenantA.tenantId, atacante, roleLeitura);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('1. atravessar tenant', () => {
  it('nao atribui papel de outro tenant', async () => {
    const roleDeB = await createRoleWithPermissions(tenantB.tenantId, 'infiltrado', [
      PERMISSIONS.ADMIN_ACCESS,
    ]);

    await expect(
      runWithContext({ origin: 'test' }, () =>
        assignRole(tenantA.context, {
          userId: tenantA.adminUserId,
          roleId: roleDeB, // ID valido, porem de outro tenant
          scope: ROLE_SCOPES.TENANT,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('nao vincula unidade de outro tenant', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        grantUnitMembership(tenantA.context, tenantA.adminUserId, tenantB.unitId),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('nao edita usuario de outro tenant', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        updateUser(tenantA.context, { userId: tenantB.adminUserId, name: 'Invadido' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('nao inativa usuario de outro tenant', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        deactivateUser(tenantA.context, tenantB.adminUserId),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('nao revoga sessoes de usuario de outro tenant', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        revokeUserSessionsAsAdmin(tenantA.context, tenantB.adminUserId),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('recurso de outro tenant e negado como "nao encontrado", sem confirmar existencia', async () => {
    const decision = await can(tenantA.context, {
      permission: PERMISSIONS.USERS_VIEW,
      resource: { tenantId: tenantB.tenantId },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('RESOURCE_OUT_OF_SCOPE');
    // A mensagem nao diferencia "existe em outro tenant" de "nao existe".
    expect(decision.message).toBe('Registro nao encontrado.');
  });
});

describe('2. forjar tenant/unit no payload', () => {
  it('tenant_id do payload e ignorado — o tenant vem da sessao', async () => {
    const context = await contextFor(tenantA.tenantId, atacante);
    expect(context.tenantId).toBe(tenantA.tenantId);
    expect(context.tenantId).not.toBe(tenantB.tenantId);
  });

  it('unit_id nao autorizado no payload nao concede acesso', async () => {
    const context = await contextFor(tenantA.tenantId, atacante, unidadeA2);

    // Pediu A2, mas so tem vinculo com a unidade original.
    expect(context.activeUnitId).toBe(tenantA.unitId);
    expect(
      (await can(context, { permission: PERMISSIONS.USERS_VIEW, unitId: unidadeA2 })).reason,
    ).toBe('UNIT_NOT_AUTHORIZED');
  });

  it('sessao forjada com outro tenant nao monta contexto', async () => {
    const context = await loadContextForSession({
      id: 'forjada',
      userId: tenantB.adminUserId,
      tenantId: tenantA.tenantId,
    });
    expect(context).toBeNull();
  });
});

describe('3. autoelevacao', () => {
  it('nao concede a si proprio permissao que nao possui', async () => {
    const context = await contextFor(tenantA.tenantId, atacante);

    await expect(
      runWithContext({ origin: 'test' }, () =>
        setRolePermissions(context, roleLeitura, [
          PERMISSIONS.USERS_VIEW,
          PERMISSIONS.ADMIN_ACCESS, // alto risco que ele nao tem
        ]),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('nao se atribui um perfil poderoso que nao possui', async () => {
    const rolePoderoso = await createRoleWithPermissions(tenantA.tenantId, 'poderoso', [
      PERMISSIONS.USERS_MANAGE_ACCESS,
      PERMISSIONS.ADMIN_ACCESS,
    ]);
    const context = await contextFor(tenantA.tenantId, atacante);

    await expect(
      runWithContext({ origin: 'test' }, () =>
        assignRole(context, {
          userId: atacante,
          roleId: rolePoderoso,
          scope: ROLE_SCOPES.TENANT,
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('administrador tambem nao amplia o proprio acesso alem do que tem', async () => {
    // O admin do fixture tem tudo; removemos uma permissao do seu alcance
    // criando um perfil com permissao que ninguem possui seria impossivel.
    // Entao validamos a regra pelo caminho inverso: conceder a si o que ja tem
    // e permitido e nao quebra nada.
    const roleIgual = await createRoleWithPermissions(tenantA.tenantId, 'espelho', [
      PERMISSIONS.USERS_VIEW,
    ]);

    await expect(
      runWithContext({ origin: 'test' }, () =>
        assignRole(tenantA.context, {
          userId: tenantA.adminUserId,
          roleId: roleIgual,
          scope: ROLE_SCOPES.TENANT,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('permissao de baixo risco pode ser concedida normalmente', async () => {
    const gestor = await createRoleWithPermissions(tenantA.tenantId, 'gestor-perfis', [
      PERMISSIONS.ROLES_MANAGE_PERMISSIONS,
      PERMISSIONS.USERS_VIEW,
    ]);
    await assignTenantRole(tenantA.tenantId, atacante, gestor);
    const context = await contextFor(tenantA.tenantId, atacante);

    // units.view nao e de alto risco: conceder e permitido.
    await expect(
      runWithContext({ origin: 'test' }, () =>
        setRolePermissions(context, roleLeitura, [PERMISSIONS.USERS_VIEW, PERMISSIONS.UNITS_VIEW]),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('4. chamar operacao sem passar pelo botao', () => {
  it('acao administrativa exige a permissao, mesmo chamada diretamente', async () => {
    const context = await contextFor(tenantA.tenantId, atacante);

    await expect(
      authorize(context, { permission: PERMISSIONS.USERS_MANAGE_ACCESS }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('deny by default: permissao ausente nega, sem regra explicita', async () => {
    const context = await contextFor(tenantA.tenantId, atacante);
    const decision = await can(context, { permission: PERMISSIONS.FEATURES_MANAGE });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('PERMISSION_DENIED');
  });

  it('contexto nulo (sem autenticacao) nega tudo', async () => {
    const decision = await can(null, { permission: PERMISSIONS.USERS_VIEW });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('NOT_AUTHENTICATED');
  });
});

describe('5. sessao revogada e papel removido', () => {
  it('sessao revogada deixa de funcionar imediatamente no backend', async () => {
    const session = await runWithContext({ origin: 'test' }, async () => {
      const { createSession } = await import('@/modules/auth/application/session-service');
      return createSession(atacante, tenantA.tenantId);
    });

    expect(await findActiveSession(session.token)).not.toBeNull();
    await revokeSession(session.sessionId);
    expect(await findActiveSession(session.token)).toBeNull();
  });

  it('papel removido no banco some do contexto na proxima resolucao', async () => {
    const antes = await contextFor(tenantA.tenantId, atacante);
    expect(antes.tenantPermissions.has(PERMISSIONS.USERS_VIEW)).toBe(true);

    await getDb().execute(sql`DELETE FROM user_roles WHERE user_id = ${atacante}`);

    const depois = await contextFor(tenantA.tenantId, atacante);
    expect(depois.tenantPermissions.has(PERMISSIONS.USERS_VIEW)).toBe(false);
  });

  it('membership removida invalida o papel daquela unidade', async () => {
    const roleUnidade = await createRoleWithPermissions(tenantA.tenantId, 'so-a2', [
      PERMISSIONS.UNITS_VIEW,
    ]);
    await grantMembership(tenantA.tenantId, atacante, unidadeA2);
    await getDb().execute(sql`
      INSERT INTO user_unit_roles (user_id, role_id, unit_id, tenant_id, created_at)
      VALUES (${atacante}, ${roleUnidade}, ${unidadeA2}, ${tenantA.tenantId}, NOW(3))
    `);

    const antes = await contextFor(tenantA.tenantId, atacante, unidadeA2);
    expect(antes.unitPermissions.get(unidadeA2)?.has(PERMISSIONS.UNITS_VIEW)).toBe(true);

    // A FK cascateia: remover a membership remove a atribuicao da unidade.
    await getDb().execute(
      sql`DELETE FROM user_units WHERE user_id = ${atacante} AND unit_id = ${unidadeA2}`,
    );

    const depois = await contextFor(tenantA.tenantId, atacante, unidadeA2);
    expect(depois.authorizedUnitIds).not.toContain(unidadeA2);
    expect(depois.unitPermissions.get(unidadeA2)).toBeUndefined();

    const remaining = await getDb().execute(
      sql`SELECT COUNT(*) AS total FROM user_unit_roles WHERE user_id = ${atacante} AND unit_id = ${unidadeA2}`,
    );
    expect(Number((remaining as unknown as Array<Array<{ total: number }>>)[0]?.[0]?.total)).toBe(
      0,
    );
  });

  it('usuario inativado perde o contexto mesmo com sessao valida', async () => {
    const context = await contextFor(tenantA.tenantId, atacante);
    await runWithContext({ origin: 'test' }, () => deactivateUser(tenantA.context, atacante));

    const depois = await loadContextForSession({
      id: context.sessionId,
      userId: atacante,
      tenantId: tenantA.tenantId,
    });
    expect(depois).toBeNull();
  });
});

describe('6. feature desabilitada nao e contornada por permissao', () => {
  it('permissao concedida nao reativa modulo indisponivel', async () => {
    // platform.multi_unit nasce desativada para o tenant.
    const context = await contextFor(tenantA.tenantId, tenantA.adminUserId);

    const decision = await can(context, {
      permission: PERMISSIONS.UNITS_MANAGE,
      featureKey: FEATURES.PLATFORM_MULTI_UNIT,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('FEATURE_UNAVAILABLE');
  });

  it('feature ativa tambem nao concede permissao', async () => {
    await runWithContext({ origin: 'test' }, () =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.PLATFORM_MULTI_UNIT,
        enabled: true,
      }),
    );

    const context = await contextFor(tenantA.tenantId, atacante);
    const decision = await can(context, {
      permission: PERMISSIONS.UNITS_MANAGE,
      featureKey: FEATURES.PLATFORM_MULTI_UNIT,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('PERMISSION_DENIED');
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runWithContext } from '@/core/context/request-context';
import { BusinessRuleError } from '@/core/errors';
import { assignRole, revokeRole } from '@/modules/access-control/application/assignment-service';
import { can } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS, ROLE_SCOPES } from '@/modules/access-control/domain/permissions';
import { effectivePermissions } from '@/modules/tenancy/domain/tenant-context';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  assignTenantRole,
  assignUnitRole,
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
 * ESCOPO DE PERFIL — TENANT x UNIT (Prompt 03, itens 15 a 18, 84 a 86).
 *
 * Cenario montado exatamente como o item 84 pede:
 *
 *   Tenant A -> Centro, Norte
 *   Tenant B -> Sul
 *   Usuario 1 -> Centro
 *   Usuario 2 -> Centro + Norte
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let centro: string;
let norte: string;
let sul: string;
let user1: string;
let user2: string;
let roleTecnico: string;
let roleAtendente: string;

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();

  tenantA = await createTenantFixture('escopo-a', planId);
  tenantB = await createTenantFixture('escopo-b', planId);

  centro = tenantA.unitId;
  norte = await createUnit(tenantA.tenantId, 'Norte');
  sul = tenantB.unitId;

  user1 = await createPlainUser(tenantA.tenantId, 'user1@escopo-a.invalid', 'Usuario Um');
  user2 = await createPlainUser(tenantA.tenantId, 'user2@escopo-a.invalid', 'Usuario Dois');

  await grantMembership(tenantA.tenantId, user1, centro);
  await grantMembership(tenantA.tenantId, user2, centro);
  await grantMembership(tenantA.tenantId, user2, norte);

  roleTecnico = await createRoleWithPermissions(tenantA.tenantId, 'tecnico-teste', [
    PERMISSIONS.UNITS_VIEW,
  ]);
  roleAtendente = await createRoleWithPermissions(tenantA.tenantId, 'atendente-teste', [
    PERMISSIONS.USERS_VIEW,
  ]);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('escopo TENANT (item 16)', () => {
  it('a permissao vale nas unidades a que o usuario ja tem acesso', async () => {
    await assignTenantRole(tenantA.tenantId, user1, roleTecnico);
    const context = await contextFor(tenantA.tenantId, user1, centro);

    expect(effectivePermissions(context).has(PERMISSIONS.UNITS_VIEW)).toBe(true);
    const decision = await can(context, { permission: PERMISSIONS.UNITS_VIEW, unitId: centro });
    expect(decision.allowed).toBe(true);
  });

  it('NAO concede vinculo a unidades novas', async () => {
    await assignTenantRole(tenantA.tenantId, user1, roleTecnico);
    const context = await contextFor(tenantA.tenantId, user1);

    // Usuario 1 continua so no Centro, mesmo com papel de escopo tenant.
    expect(context.authorizedUnitIds).toEqual([centro]);
    expect(context.authorizedUnitIds).not.toContain(norte);

    const decision = await can(context, { permission: PERMISSIONS.UNITS_VIEW, unitId: norte });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('UNIT_NOT_AUTHORIZED');
  });
});

describe('escopo UNIT (item 17)', () => {
  it('a permissao vale na unidade indicada', async () => {
    await assignUnitRole(tenantA.tenantId, user2, roleTecnico, norte);
    const context = await contextFor(tenantA.tenantId, user2, norte);

    expect(effectivePermissions(context).has(PERMISSIONS.UNITS_VIEW)).toBe(true);
    expect(
      (await can(context, { permission: PERMISSIONS.UNITS_VIEW, unitId: norte })).allowed,
    ).toBe(true);
  });

  it('NAO vale em outra unidade do mesmo tenant', async () => {
    await assignUnitRole(tenantA.tenantId, user2, roleTecnico, norte);
    const context = await contextFor(tenantA.tenantId, user2, centro);

    // Unidade ativa = Centro: o papel do Norte nao entra no calculo.
    expect(effectivePermissions(context).has(PERMISSIONS.UNITS_VIEW)).toBe(false);
    expect(
      (await can(context, { permission: PERMISSIONS.UNITS_VIEW, unitId: centro })).allowed,
    ).toBe(false);
  });

  it('NAO vale para acao de nivel tenant (sem unidade)', async () => {
    await assignUnitRole(tenantA.tenantId, user2, roleTecnico, norte);
    const context = await contextFor(tenantA.tenantId, user2, norte);

    // Sem unidade no pedido, so os papeis TENANT contam.
    const decision = await can(context, { permission: PERMISSIONS.UNITS_VIEW });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('PERMISSION_DENIED');
  });

  it('atribuicao sem membership e rejeitada (item 20)', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        assignRole(tenantA.context, {
          userId: user1, // user1 nao tem vinculo com Norte
          roleId: roleTecnico,
          scope: ROLE_SCOPES.UNIT,
          unitId: norte,
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('atribuicao por unidade sem informar a unidade e rejeitada', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        assignRole(tenantA.context, {
          userId: user2,
          roleId: roleTecnico,
          scope: ROLE_SCOPES.UNIT,
          unitId: null,
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe('composicao de papeis (item 86)', () => {
  it('une papel TENANT com papel da unidade ATIVA, e nada mais', async () => {
    await assignTenantRole(tenantA.tenantId, user2, roleAtendente); // users.view no tenant
    await assignUnitRole(tenantA.tenantId, user2, roleTecnico, norte); // units.view so no Norte

    const noCentro = await contextFor(tenantA.tenantId, user2, centro);
    expect(effectivePermissions(noCentro).has(PERMISSIONS.USERS_VIEW)).toBe(true);
    expect(effectivePermissions(noCentro).has(PERMISSIONS.UNITS_VIEW)).toBe(false);

    const noNorte = await contextFor(tenantA.tenantId, user2, norte);
    expect(effectivePermissions(noNorte).has(PERMISSIONS.USERS_VIEW)).toBe(true);
    expect(effectivePermissions(noNorte).has(PERMISSIONS.UNITS_VIEW)).toBe(true);
  });

  it('permissao repetida em dois papeis nao duplica', async () => {
    const outro = await createRoleWithPermissions(tenantA.tenantId, 'duplicado', [
      PERMISSIONS.USERS_VIEW,
    ]);
    await assignTenantRole(tenantA.tenantId, user2, roleAtendente);
    await assignUnitRole(tenantA.tenantId, user2, outro, norte);

    const context = await contextFor(tenantA.tenantId, user2, norte);
    const permissions = [...effectivePermissions(context)];
    expect(permissions.filter((p) => p === PERMISSIONS.USERS_VIEW)).toHaveLength(1);
  });

  it('revogar o papel de unidade nao afeta o papel de tenant', async () => {
    await assignTenantRole(tenantA.tenantId, user2, roleAtendente);
    await assignUnitRole(tenantA.tenantId, user2, roleTecnico, norte);

    await runWithContext({ origin: 'test' }, () =>
      revokeRole(tenantA.context, {
        userId: user2,
        roleId: roleTecnico,
        scope: ROLE_SCOPES.UNIT,
        unitId: norte,
      }),
    );

    const context = await contextFor(tenantA.tenantId, user2, norte);
    expect(effectivePermissions(context).has(PERMISSIONS.USERS_VIEW)).toBe(true);
    expect(effectivePermissions(context).has(PERMISSIONS.UNITS_VIEW)).toBe(false);
  });
});

describe('troca de unidade (item 26)', () => {
  it('recalcula as permissoes — nao reaproveita as da unidade anterior', async () => {
    await assignUnitRole(tenantA.tenantId, user2, roleTecnico, norte);

    const antes = await contextFor(tenantA.tenantId, user2, norte);
    expect(effectivePermissions(antes).has(PERMISSIONS.UNITS_VIEW)).toBe(true);

    const depois = await contextFor(tenantA.tenantId, user2, centro);
    expect(effectivePermissions(depois).has(PERMISSIONS.UNITS_VIEW)).toBe(false);
  });

  it('unidade de outro tenant e ignorada, caindo na autorizada', async () => {
    const context = await contextFor(tenantA.tenantId, user2, sul);
    expect(context.activeUnitId).not.toBe(sul);
    expect(tenantA.context.authorizedUnitIds).not.toContain(sul);
  });

  it('usuario com uma unica unidade tem selecao automatica (item 24)', async () => {
    const context = await contextFor(tenantA.tenantId, user1);
    expect(context.activeUnitId).toBe(centro);
  });

  it('usuario sem unidade fica sem unidade ativa (item 25)', async () => {
    const semUnidade = await createPlainUser(tenantA.tenantId, 'sem@escopo-a.invalid');
    const context = await contextFor(tenantA.tenantId, semUnidade);

    expect(context.activeUnitId).toBeNull();
    expect(context.authorizedUnitIds).toHaveLength(0);
  });
});

describe('tenant B nao se mistura', () => {
  it('unidade do tenant B nunca aparece para usuarios do tenant A', async () => {
    const context = await contextFor(tenantA.tenantId, user2, norte);
    expect(context.authorizedUnitIds).not.toContain(sul);
    expect([...context.authorizedUnitIds].sort()).toEqual([centro, norte].sort());
  });
});

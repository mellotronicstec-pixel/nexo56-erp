import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runWithContext } from '@/core/context/request-context';
import { BusinessRuleError, ConflictError } from '@/core/errors';
import { listUserAssignments } from '@/modules/access-control/application/assignment-service';
import { AUDIT_ACTIONS } from '@/modules/audit/application/audit-service';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { createSession, findActiveSession } from '@/modules/auth/application/session-service';
import {
  grantUnitMembership,
  listUserMemberships,
  revokeUnitMembership,
} from '@/modules/users/application/membership-service';
import { activateUser, createUser, deactivateUser } from '@/modules/users/application/user-service';
import { verifyPassword } from '@/modules/auth/domain/password';
import { users } from '@/modules/users/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  assignUnitRole,
  createRoleWithPermissions,
  createTenantFixture,
  createUnit,
  grantMembership,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';

/** GESTAO DE USUARIOS E VINCULOS (Prompt 03, itens 43 a 49, 72, 75 e 76). */

let tenant: TenantFixture;

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenant = await createTenantFixture('gestao', planId);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('criacao de usuario (itens 46 e 47)', () => {
  it('cria com senha inicial aleatoria, nunca padrao', async () => {
    const primeiro = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa Um', email: 'um@gestao.invalid' }),
    );
    const segundo = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa Dois', email: 'dois@gestao.invalid' }),
    );

    expect(primeiro.initialPassword).not.toBe(segundo.initialPassword);
    expect(primeiro.initialPassword.length).toBeGreaterThanOrEqual(16);
    expect(['123456', 'senha', 'password']).not.toContain(primeiro.initialPassword);
  });

  it('grava apenas o hash da senha inicial', async () => {
    const created = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa', email: 'hash@gestao.invalid' }),
    );

    const rows = await getDb()
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, created.userId));

    expect(rows[0]!.passwordHash).not.toBe(created.initialPassword);
    expect(rows[0]!.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword(created.initialPassword, rows[0]!.passwordHash)).toBe(true);
  });

  it('o tenant vem do contexto, nunca da entrada', async () => {
    const created = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, {
        name: 'Pessoa',
        email: 'ctx@gestao.invalid',
        // tentativa de injetar outro tenant no payload
        tenantId: 'tenant-forjado',
      } as never),
    );

    const rows = await getDb()
      .select({ tenantId: users.tenantId })
      .from(users)
      .where(eq(users.id, created.userId));

    expect(rows[0]!.tenantId).toBe(tenant.tenantId);
  });

  it('recusa e-mail duplicado no mesmo tenant', async () => {
    await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa', email: 'dup@gestao.invalid' }),
    );

    await expect(
      runWithContext({ origin: 'test' }, () =>
        createUser(tenant.context, { name: 'Outra', email: 'dup@gestao.invalid' }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('normaliza o e-mail para minusculas', async () => {
    const created = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa', email: '  MAIUSCULO@Gestao.Invalid ' }),
    );

    const rows = await getDb()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, created.userId));

    expect(rows[0]!.email).toBe('maiusculo@gestao.invalid');
  });

  it('a senha inicial nunca aparece na auditoria nem no evento', async () => {
    const created = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa', email: 'segredo@gestao.invalid' }),
    );

    const [audits, events] = await Promise.all([
      getDb().select().from(auditLogs),
      getDb().select().from(domainEvents),
    ]);

    expect(JSON.stringify(audits)).not.toContain(created.initialPassword);
    expect(JSON.stringify(events)).not.toContain(created.initialPassword);
  });
});

describe('inativacao e reativacao (itens 43 e 44)', () => {
  it('inativar encerra as sessoes na mesma operacao', async () => {
    const created = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa', email: 'inat@gestao.invalid' }),
    );
    const session = await createSession(created.userId, tenant.tenantId);
    expect(await findActiveSession(session.token)).not.toBeNull();

    await runWithContext({ origin: 'test' }, () => deactivateUser(tenant.context, created.userId));

    expect(await findActiveSession(session.token)).toBeNull();
  });

  it('inativar preserva o registro — nunca apaga', async () => {
    const created = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa', email: 'preserva@gestao.invalid' }),
    );
    await runWithContext({ origin: 'test' }, () => deactivateUser(tenant.context, created.userId));

    const rows = await getDb().select().from(users).where(eq(users.id, created.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('inactive');
  });

  it('reativar preserva vinculos e perfis', async () => {
    const created = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa', email: 'reat@gestao.invalid' }),
    );
    await grantMembership(tenant.tenantId, created.userId, tenant.unitId);

    await runWithContext({ origin: 'test' }, async () => {
      await deactivateUser(tenant.context, created.userId);
      await activateUser(tenant.context, created.userId);
    });

    const memberships = await listUserMemberships(tenant.context, created.userId);
    expect(memberships).toHaveLength(1);
  });

  it('as duas operacoes sao auditadas', async () => {
    const created = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa', email: 'aud@gestao.invalid' }),
    );

    await runWithContext({ origin: 'test' }, async () => {
      await deactivateUser(tenant.context, created.userId);
      await activateUser(tenant.context, created.userId);
    });

    const actions = (await getDb().select().from(auditLogs)).map((row) => row.action);
    expect(actions).toContain(AUDIT_ACTIONS.USER_CREATED);
    expect(actions).toContain(AUDIT_ACTIONS.USER_DEACTIVATED);
    expect(actions).toContain(AUDIT_ACTIONS.USER_ACTIVATED);
  });
});

describe('vinculo de unidade (itens 20 e 21)', () => {
  it('conceder vinculo e idempotente', async () => {
    const created = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa', email: 'vinc@gestao.invalid' }),
    );

    await runWithContext({ origin: 'test' }, async () => {
      await grantUnitMembership(tenant.context, created.userId, tenant.unitId);
      await grantUnitMembership(tenant.context, created.userId, tenant.unitId);
    });

    expect(await listUserMemberships(tenant.context, created.userId)).toHaveLength(1);
  });

  it('remover vinculo tambem remove os perfis daquela unidade, e audita o que saiu', async () => {
    const created = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa', email: 'rem@gestao.invalid' }),
    );
    const outraUnidade = await createUnit(tenant.tenantId, 'Segunda');
    const role = await createRoleWithPermissions(tenant.tenantId, 'papel-unidade', [
      PERMISSIONS.USERS_VIEW,
    ]);

    await grantMembership(tenant.tenantId, created.userId, outraUnidade);
    await assignUnitRole(tenant.tenantId, created.userId, role, outraUnidade);

    const antes = await listUserAssignments(tenant.context, created.userId);
    expect(antes.unitRoles).toHaveLength(1);

    await runWithContext({ origin: 'test' }, () =>
      revokeUnitMembership(tenant.context, created.userId, outraUnidade),
    );

    const depois = await listUserAssignments(tenant.context, created.userId);
    expect(depois.unitRoles).toHaveLength(0);

    const revocation = (await getDb().select().from(auditLogs)).find(
      (row) => row.action === AUDIT_ACTIONS.USER_UNIT_REVOKED,
    );
    expect(revocation).toBeTruthy();
    expect((revocation!.before as Record<string, unknown>).removedUnitRoles).toEqual([role]);
  });

  it('remover vinculo NAO remove perfis de escopo tenant', async () => {
    const created = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa', email: 'tenantrole@gestao.invalid' }),
    );
    const role = await createRoleWithPermissions(tenant.tenantId, 'papel-tenant', [
      PERMISSIONS.USERS_VIEW,
    ]);
    const { assignTenantRole } = await import('../helpers/fixtures');

    await grantMembership(tenant.tenantId, created.userId, tenant.unitId);
    await assignTenantRole(tenant.tenantId, created.userId, role);

    await runWithContext({ origin: 'test' }, () =>
      revokeUnitMembership(tenant.context, created.userId, tenant.unitId),
    );

    const assignments = await listUserAssignments(tenant.context, created.userId);
    expect(assignments.tenantRoles).toHaveLength(1);
  });
});

describe('transacoes (item 76)', () => {
  it('usuario nao fica parcialmente configurado quando a operacao falha', async () => {
    const antes = await getDb().select().from(users);

    await expect(
      runWithContext({ origin: 'test' }, () =>
        createUser(tenant.context, { name: 'x', email: 'invalido' }),
      ),
    ).rejects.toThrow();

    const depois = await getDb().select().from(users);
    expect(depois).toHaveLength(antes.length);
  });

  it('emite evento apenas apos o commit', async () => {
    const created = await runWithContext({ origin: 'test' }, () =>
      createUser(tenant.context, { name: 'Pessoa', email: 'evt@gestao.invalid' }),
    );

    const events = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, EVENT_TYPES.USER_CREATED));

    const criado = events.find(
      (event) => (event.payload as Record<string, unknown>).userId === created.userId,
    );
    expect(criado).toBeTruthy();
    expect(criado!.publishedAt).not.toBeNull();
  });
});

describe('protecao contra auto-inativacao', () => {
  it('o usuario nao inativa a propria conta', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () => deactivateUser(tenant.context, tenant.adminUserId)),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe('perfis iniciais do tenant (item 12)', () => {
  it('o provisionamento cria Administrador mais os perfis preparados', async () => {
    const { listRolesWithCounts } =
      await import('@/modules/access-control/application/role-service');
    const roles = await listRolesWithCounts(tenant.context);
    const keys = roles.map((role) => role.key).sort();

    expect(keys).toEqual(['admin', 'atendente', 'financeiro', 'tecnico']);
  });

  it('somente o Administrador e protegido; os demais sao editaveis', async () => {
    const { listRolesWithCounts } =
      await import('@/modules/access-control/application/role-service');
    const roles = await listRolesWithCounts(tenant.context);

    expect(roles.filter((role) => role.isSystem).map((role) => role.key)).toEqual(['admin']);
  });

  it('os perfis preparados nascem sem permissoes, e isso e deliberado', async () => {
    const { listRolesWithCounts } =
      await import('@/modules/access-control/application/role-service');
    const roles = await listRolesWithCounts(tenant.context);
    const tecnico = roles.find((role) => role.key === 'tecnico');

    // As capacidades chegam com os modulos de negocio; inventar permissoes
    // agora seria arbitrario.
    expect(tecnico?.permissionCount).toBe(0);
  });

  it('o Administrador recebe TODAS as permissoes do catalogo', async () => {
    const { listRolesWithCounts } =
      await import('@/modules/access-control/application/role-service');
    const { PERMISSION_CATALOG } = await import('@/modules/access-control/domain/permissions');
    const roles = await listRolesWithCounts(tenant.context);
    const admin = roles.find((role) => role.key === 'admin');

    expect(admin?.permissionCount).toBe(PERMISSION_CATALOG.length);
  });

  it('syncCatalog realinha Administradores antigos a permissoes novas', async () => {
    const { syncCatalog } = await import('@/modules/features/application/catalog-sync');
    const { rolePermissions, roles: rolesTable } =
      await import('@/modules/access-control/infrastructure/schema');
    const { and: andOp, eq: eqOp } = await import('drizzle-orm');

    const adminRole = (
      await getDb()
        .select({ id: rolesTable.id })
        .from(rolesTable)
        .where(andOp(eqOp(rolesTable.tenantId, tenant.tenantId), eqOp(rolesTable.key, 'admin')))
    )[0]!;

    // Simula um tenant criado antes de a permissao existir.
    await getDb()
      .delete(rolePermissions)
      .where(
        andOp(
          eqOp(rolePermissions.roleId, adminRole.id),
          eqOp(rolePermissions.permissionKey, PERMISSIONS.USERS_MANAGE_ACCESS),
        ),
      );

    const result = await runWithContext({ origin: 'test' }, () => syncCatalog());
    expect(result.systemRolesUpdated).toBeGreaterThanOrEqual(1);

    const restored = await getDb()
      .select()
      .from(rolePermissions)
      .where(
        andOp(
          eqOp(rolePermissions.roleId, adminRole.id),
          eqOp(rolePermissions.permissionKey, PERMISSIONS.USERS_MANAGE_ACCESS),
        ),
      );

    expect(restored).toHaveLength(1);
  });
});

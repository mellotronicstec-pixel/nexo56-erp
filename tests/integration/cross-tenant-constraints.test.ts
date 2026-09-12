import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { newId } from '@/core/ids/id';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * CONSTRAINTS CROSS-TENANT NO BANCO (Prompt 02, itens 34 e 73).
 *
 * Estes testes atacam o banco DIRETAMENTE, por SQL cru, ignorando de proposito
 * toda a camada de aplicacao (TenantScope, repositories, guards). O que se
 * prova aqui nao e que a aplicacao filtra bem — isso ja e coberto por
 * tenant-isolation.test.ts — e sim que o proprio InnoDB recusa a associacao
 * incoerente, que era possivel antes do Prompt 02.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenantA = await createTenantFixture('constraint-a', planId);
  tenantB = await createTenantFixture('constraint-b', planId);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('user_units', () => {
  it('recusa vincular usuario do Tenant A a unidade do Tenant B', async () => {
    await expect(
      getDb().execute(sql`
        INSERT INTO user_units (user_id, unit_id, tenant_id, created_at)
        VALUES (${tenantA.adminUserId}, ${tenantB.unitId}, ${tenantA.tenantId}, NOW(3))
      `),
    ).rejects.toThrow();
  });

  it('recusa tambem quando o tenant_id e forjado com o do Tenant B', async () => {
    await expect(
      getDb().execute(sql`
        INSERT INTO user_units (user_id, unit_id, tenant_id, created_at)
        VALUES (${tenantA.adminUserId}, ${tenantB.unitId}, ${tenantB.tenantId}, NOW(3))
      `),
    ).rejects.toThrow();
  });

  it('aceita o vinculo coerente dentro do mesmo tenant', async () => {
    const secondUnitId = newId();
    await getDb().execute(sql`
      INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
      VALUES (${secondUnitId}, ${tenantA.tenantId}, 'Segunda unidade', 'active', NOW(3), NOW(3))
    `);

    await expect(
      getDb().execute(sql`
        INSERT INTO user_units (user_id, unit_id, tenant_id, created_at)
        VALUES (${tenantA.adminUserId}, ${secondUnitId}, ${tenantA.tenantId}, NOW(3))
      `),
    ).resolves.toBeDefined();
  });
});

describe('user_roles', () => {
  it('recusa atribuir a usuario do Tenant A um papel do Tenant B', async () => {
    const roleRows = await getDb().execute(sql`
      SELECT id FROM roles WHERE tenant_id = ${tenantB.tenantId} LIMIT 1
    `);
    const roleOfB = (roleRows as unknown as Array<Array<{ id: string }>>)[0]?.[0]?.id;
    expect(roleOfB).toBeTruthy();

    await expect(
      getDb().execute(sql`
        INSERT INTO user_roles (user_id, role_id, tenant_id, created_at)
        VALUES (${tenantA.adminUserId}, ${roleOfB}, ${tenantA.tenantId}, NOW(3))
      `),
    ).rejects.toThrow();
  });
});

describe('sessions', () => {
  it('recusa sessao de usuario do Tenant A carimbada com o Tenant B', async () => {
    await expect(
      getDb().execute(sql`
        INSERT INTO sessions (id, user_id, tenant_id, token_hash, expires_at, last_used_at, created_at)
        VALUES (${newId()}, ${tenantA.adminUserId}, ${tenantB.tenantId}, ${newId()}, NOW(3), NOW(3), NOW(3))
      `),
    ).rejects.toThrow();
  });

  it('aceita sessao coerente', async () => {
    await expect(
      getDb().execute(sql`
        INSERT INTO sessions (id, user_id, tenant_id, token_hash, expires_at, last_used_at, created_at)
        VALUES (${newId()}, ${tenantA.adminUserId}, ${tenantA.tenantId}, ${newId()}, NOW(3), NOW(3), NOW(3))
      `),
    ).resolves.toBeDefined();
  });
});

describe('unidade nao atravessa tenant', () => {
  it('recusa unidade apontando para tenant inexistente', async () => {
    await expect(
      getDb().execute(sql`
        INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
        VALUES (${newId()}, ${newId()}, 'Unidade fantasma', 'active', NOW(3), NOW(3))
      `),
    ).rejects.toThrow();
  });

  it('recusa usuario apontando para tenant inexistente', async () => {
    await expect(
      getDb().execute(sql`
        INSERT INTO users (id, tenant_id, email, name, password_hash, status, created_at, updated_at)
        VALUES (${newId()}, ${newId()}, 'x@y.invalid', 'X', 'hash', 'active', NOW(3), NOW(3))
      `),
    ).rejects.toThrow();
  });
});

describe('historico nao cascateia', () => {
  it('recusa apagar um tenant que ainda possui auditoria e dados', async () => {
    // ON DELETE RESTRICT protege o historico: apagar empresa com dados falha.
    await expect(
      getDb().execute(sql`DELETE FROM tenants WHERE id = ${tenantA.tenantId}`),
    ).rejects.toThrow();
  });
});

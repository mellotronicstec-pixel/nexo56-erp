import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runWithContext } from '@/core/context/request-context';
import { newId } from '@/core/ids/id';
import { loadContextForSession } from '@/modules/auth/application/current-context';
import { createSession } from '@/modules/auth/application/session-service';
import { findUnitById, listUnits } from '@/modules/tenancy/application/tenancy-queries';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * MULTIUNIDADE (Prompt 02, itens 10, 46 e 74).
 *
 * Cenario:
 *   Tenant A -> unidades A1 (criada no provisionamento) e A2
 *   Tenant B -> unidade B1
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let unitA2: string;

async function contextFor(fixture: TenantFixture, requestedUnitId?: string) {
  const session = await createSession(fixture.adminUserId, fixture.tenantId);
  return runWithContext({ origin: 'test' }, () =>
    loadContextForSession(
      { id: session.sessionId, userId: fixture.adminUserId, tenantId: fixture.tenantId },
      requestedUnitId,
    ),
  );
}

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenantA = await createTenantFixture('multi-a', planId);
  tenantB = await createTenantFixture('multi-b', planId);

  unitA2 = newId();
  await getDb().execute(sql`
    INSERT INTO units (id, tenant_id, name, status, created_at, updated_at)
    VALUES (${unitA2}, ${tenantA.tenantId}, 'Unidade A2', 'active', NOW(3), NOW(3))
  `);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('o tenant opera entre as proprias unidades', () => {
  it('lista as duas unidades do Tenant A', async () => {
    const units = await listUnits(tenantA.context);
    expect(units).toHaveLength(2);
    expect(units.map((unit) => unit.id)).toEqual(expect.arrayContaining([tenantA.unitId, unitA2]));
  });

  it('alcanca A2 por ID usando o contexto de A', async () => {
    const unit = await findUnitById(tenantA.context, unitA2);
    expect(unit?.name).toBe('Unidade A2');
  });
});

describe('o tenant nao alcanca unidade de outro tenant', () => {
  it('a listagem de A nunca inclui B1', async () => {
    const units = await listUnits(tenantA.context);
    expect(units.map((unit) => unit.id)).not.toContain(tenantB.unitId);
  });

  it('buscar B1 com contexto de A devolve null', async () => {
    expect(await findUnitById(tenantA.context, tenantB.unitId)).toBeNull();
  });

  it('o banco recusa mover uma unidade de A para o tenant B', async () => {
    // A unidade esta referenciada por user_units com FK composta: trocar o
    // tenant da unidade quebraria a coerencia e o InnoDB impede.
    await expect(
      getDb().execute(
        sql`UPDATE units SET tenant_id = ${tenantB.tenantId} WHERE id = ${tenantA.unitId}`,
      ),
    ).rejects.toThrow();
  });
});

describe('unidade autorizada do usuario', () => {
  it('o usuario so enxerga as unidades a que foi vinculado', async () => {
    // O provisionamento vinculou o admin apenas a A1; A2 foi criada depois.
    const context = await contextFor(tenantA);
    expect(context?.authorizedUnitIds).toEqual([tenantA.unitId]);
    expect(context?.authorizedUnitIds).not.toContain(unitA2);
  });

  it('pedir A2 sem vinculo nao concede acesso — cai na unidade autorizada', async () => {
    const context = await contextFor(tenantA, unitA2);
    expect(context?.activeUnitId).toBe(tenantA.unitId);
  });

  it('pedir a unidade de outro tenant e ignorado', async () => {
    const context = await contextFor(tenantA, tenantB.unitId);
    expect(context?.activeUnitId).toBe(tenantA.unitId);
    expect(context?.authorizedUnitIds).not.toContain(tenantB.unitId);
  });

  it('depois de vinculado a A2, o usuario passa a poder seleciona-la', async () => {
    await getDb().execute(sql`
      INSERT INTO user_units (user_id, unit_id, tenant_id, created_at)
      VALUES (${tenantA.adminUserId}, ${unitA2}, ${tenantA.tenantId}, NOW(3))
    `);

    const context = await contextFor(tenantA, unitA2);
    expect(context?.authorizedUnitIds).toHaveLength(2);
    expect(context?.activeUnitId).toBe(unitA2);
  });
});

/**
 * LIMITE CONHECIDO — NAO E PROTECAO EXISTENTE.
 *
 * O escopo de unidade hoje controla QUAL UNIDADE o usuario pode selecionar
 * (`authorizedUnitIds`), e nao quais REGISTROS ele enxerga dentro do tenant.
 * Como ainda nao existe entidade de negocio com `unit_id` (OS, estoque), nao
 * ha o que filtrar — e seria desonesto afirmar protecao que nao existe
 * (Prompt 02, item 74).
 *
 * O teste abaixo registra o comportamento ATUAL, para que a mudanca apareca
 * quando o escopo por unidade for implementado no modulo que precisar dele.
 */
describe('escopo por unidade nos registros (ainda nao implementado)', () => {
  it('hoje a permissao vale no tenant inteiro, nao por unidade', async () => {
    const context = await contextFor(tenantA);
    // Nenhuma permissao carrega escopo de unidade nesta etapa.
    expect(context?.tenantPermissions.size).toBeGreaterThan(0);
    expect(Object.keys(context ?? {})).not.toContain('unitScopedPermissions');
  });
});

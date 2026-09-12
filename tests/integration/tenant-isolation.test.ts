import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runWithContext } from '@/core/context/request-context';
import { AuthorizationError } from '@/core/errors';
import { TenantScope } from '@/core/db/tenant-scoped';
import { listRecentAudit } from '@/modules/audit/application/audit-queries';
import { loadContextForSession } from '@/modules/auth/application/current-context';
import { createSession, findActiveSession } from '@/modules/auth/application/session-service';
import { findUnitById, listUnits } from '@/modules/tenancy/application/tenancy-queries';
import { units } from '@/modules/tenancy/infrastructure/schema';
import { findUserById, listUsers } from '@/modules/users/application/user-queries';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * ISOLAMENTO MULTI-TENANT (Prompt 01, item 22).
 * Testes obrigatorios para a fundacao ser considerada concluida.
 */

let planId: string;
let tenantA: TenantFixture;
let tenantB: TenantFixture;

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  planId = await seedCatalog();
  tenantA = await createTenantFixture('empresa-a', planId);
  tenantB = await createTenantFixture('empresa-b', planId);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('1. usuario do Tenant A acessa recurso permitido do Tenant A', () => {
  it('lista as proprias unidades e usuarios', async () => {
    const unitsOfA = await listUnits(tenantA.context);
    const usersOfA = await listUsers(tenantA.context);

    expect(unitsOfA).toHaveLength(1);
    expect(unitsOfA[0]?.id).toBe(tenantA.unitId);
    expect(usersOfA.map((user) => user.id)).toContain(tenantA.adminUserId);
  });
});

describe('2. usuario do Tenant A nao acessa recurso equivalente do Tenant B', () => {
  it('a listagem de unidades nunca inclui unidades de outro tenant', async () => {
    const unitsOfA = await listUnits(tenantA.context);
    expect(unitsOfA.map((unit) => unit.id)).not.toContain(tenantB.unitId);
  });

  it('a listagem de usuarios nunca inclui usuarios de outro tenant', async () => {
    const usersOfA = await listUsers(tenantA.context);
    expect(usersOfA.map((user) => user.id)).not.toContain(tenantB.adminUserId);
  });

  it('a auditoria de A nao contem registros de B', async () => {
    const entriesOfA = await listRecentAudit(tenantA.context, 200);
    const db = getDb();
    const unitRowsOfB = await db.select().from(units).where(eq(units.tenantId, tenantB.tenantId));

    expect(unitRowsOfB.length).toBeGreaterThan(0); // B realmente tem dados
    expect(entriesOfA.length).toBeGreaterThan(0); // A realmente tem auditoria
    for (const entry of entriesOfA) {
      expect(entry.entityId).not.toBe(tenantB.unitId);
      expect(entry.entityId).not.toBe(tenantB.adminUserId);
    }
  });
});

describe('3. manipulacao de ID nao permite atravessar tenant', () => {
  it('buscar unidade de B pelo ID, com contexto de A, retorna null', async () => {
    const found = await findUnitById(tenantA.context, tenantB.unitId);
    expect(found).toBeNull();
  });

  it('buscar usuario de B pelo ID, com contexto de A, retorna null', async () => {
    const found = await findUserById(tenantA.context, tenantB.adminUserId);
    expect(found).toBeNull();
  });

  it('o ID existe de fato — a consulta so nao o alcanca pelo escopo de tenant', async () => {
    const withOwnContext = await findUnitById(tenantB.context, tenantB.unitId);
    expect(withOwnContext?.id).toBe(tenantB.unitId);
  });

  it('assertOwnership rejeita registro de outro tenant', () => {
    const scope = TenantScope.from(tenantA.context);
    expect(() => scope.assertOwnership({ tenantId: tenantB.tenantId }, 'unidade')).toThrow(
      AuthorizationError,
    );
    expect(() => scope.assertOwnership({ tenantId: tenantA.tenantId })).not.toThrow();
  });

  it('TenantScope.values ignora tentativa de injetar outro tenantId', () => {
    const scope = TenantScope.from(tenantA.context);
    const values = scope.values({ name: 'Unidade forjada', tenantId: tenantB.tenantId });
    expect(values.tenantId).toBe(tenantA.tenantId);
  });
});

describe('4. o tenant vem da sessao, nunca do cliente', () => {
  it('a sessao determina o tenant do contexto', async () => {
    const session = await findActiveSession(tenantB.sessionToken);
    expect(session?.tenantId).toBe(tenantB.tenantId);

    const context = await loadContextForSession({
      id: session!.id,
      userId: session!.userId,
      tenantId: session!.tenantId,
    });

    expect(context?.tenantId).toBe(tenantB.tenantId);
  });

  it('sessao de A com userId de B nao monta contexto', async () => {
    // Simula adulteracao: token valido de A apontado para o usuario de B.
    const context = await loadContextForSession({
      id: 'sessao-forjada',
      userId: tenantB.adminUserId,
      tenantId: tenantA.tenantId,
    });

    expect(context).toBeNull();
  });

  it('unidade pedida fora das autorizadas e ignorada', async () => {
    const session = await createSession(tenantA.adminUserId, tenantA.tenantId);
    const context = await runWithContext({ origin: 'test' }, () =>
      loadContextForSession(
        { id: session.sessionId, userId: tenantA.adminUserId, tenantId: tenantA.tenantId },
        tenantB.unitId, // unidade de outro tenant
      ),
    );

    expect(context?.unitId).toBe(tenantA.unitId);
    expect(context?.authorizedUnitIds).not.toContain(tenantB.unitId);
  });
});

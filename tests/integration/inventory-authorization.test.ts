import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runWithContext } from '@/core/context/request-context';
import { AuthorizationError } from '@/core/errors';
import { NotFoundError } from '@/core/errors';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { createPart } from '@/modules/inventory/application/part-service';
import {
  adjustStock,
  issueStock,
  loadBalance,
  receiveStock,
} from '@/modules/inventory/application/stock-service';
import { listParts } from '@/modules/inventory/application/inventory-queries';
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
 * RBAC E EFFECTIVE ACCESS NO ESTOQUE (Prompt 10, itens 78 a 82, 90 e 137).
 *
 * O BACKEND E A AUTORIDADE (item 90). Esconder o menu nao e seguranca: todos
 * os testes deste arquivo chamam os casos de uso DIRETAMENTE, sem passar por
 * tela nenhuma — e e assim que um atacante chamaria.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let partId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenantA = await createTenantFixture('rbac-estoque-a', planId);
  tenantB = await createTenantFixture('rbac-estoque-b', planId);

  for (const fixture of [tenantA, tenantB]) {
    await run(() =>
      setTenantFeature(fixture.context, {
        featureKey: FEATURES.OPERATIONS_INVENTORY,
        enabled: true,
      }),
    );
  }

  partId = await run(() =>
    createPart(tenantA.context, {
      code: 'TELA-RBAC',
      name: 'Tela LCD',
      unitOfMeasure: 'unit',
    }),
  );
  await run(() =>
    receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '10' }),
  );
});

describe('permissoes separam capacidades, e nao botoes (itens 78 e 79)', () => {
  it('quem so consulta nao da entrada nem ajusta', async () => {
    const userId = await createPlainUser(tenantA.tenantId, 'consulta@rbac.invalid');
    await grantMembership(tenantA.tenantId, userId, tenantA.unitId);
    const roleId = await createRoleWithPermissions(tenantA.tenantId, 'consulta-estoque', [
      PERMISSIONS.INVENTORY_VIEW,
    ]);
    await assignTenantRole(tenantA.tenantId, userId, roleId);
    const contexto = await contextFor(tenantA.tenantId, userId, tenantA.unitId);

    // Consultar, pode.
    const pagina = await run(() => listParts(contexto, {}));
    expect(pagina.items.length).toBeGreaterThan(0);

    await expect(
      run(() => receiveStock(contexto, { unitId: tenantA.unitId, partId, quantity: '1' })),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      run(() =>
        adjustStock(contexto, {
          unitId: tenantA.unitId,
          partId,
          direction: 'in',
          quantity: '1',
          reason: 'contagem fisica',
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('quem da saida nao ajusta: ajuste tem permissao propria (item 55)', async () => {
    const userId = await createPlainUser(tenantA.tenantId, 'balcao@rbac.invalid');
    await grantMembership(tenantA.tenantId, userId, tenantA.unitId);
    const roleId = await createRoleWithPermissions(tenantA.tenantId, 'balcao-estoque', [
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.INVENTORY_ISSUE,
    ]);
    await assignTenantRole(tenantA.tenantId, userId, roleId);
    const contexto = await contextFor(tenantA.tenantId, userId, tenantA.unitId);

    await expect(
      run(() => issueStock(contexto, { unitId: tenantA.unitId, partId, quantity: '1' })),
    ).resolves.toBeTruthy();

    await expect(
      run(() =>
        adjustStock(contexto, {
          unitId: tenantA.unitId,
          partId,
          direction: 'out',
          quantity: '1',
          reason: 'sumiu da prateleira',
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('o catalogo e capacidade de TENANT: nao se administra peca sem ela (item 81)', async () => {
    const userId = await createPlainUser(tenantA.tenantId, 'sem-catalogo@rbac.invalid');
    await grantMembership(tenantA.tenantId, userId, tenantA.unitId);
    const roleId = await createRoleWithPermissions(tenantA.tenantId, 'operacao-estoque', [
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.INVENTORY_RECEIVE,
    ]);
    await assignTenantRole(tenantA.tenantId, userId, roleId);
    const contexto = await contextFor(tenantA.tenantId, userId, tenantA.unitId);

    await expect(
      run(() =>
        createPart(contexto, { code: 'NOVA-01', name: 'Peca nova', unitOfMeasure: 'unit' }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('permissao por unidade nao vaza para outra unidade (itens 80 e 82)', () => {
  it('quem recebe na unidade A nao recebe na unidade B', async () => {
    const unidadeB = await createUnit(tenantA.tenantId, 'Unidade Bairro');

    const userId = await createPlainUser(tenantA.tenantId, 'unidade-a@rbac.invalid');
    await grantMembership(tenantA.tenantId, userId, tenantA.unitId);
    await grantMembership(tenantA.tenantId, userId, unidadeB);

    const roleId = await createRoleWithPermissions(tenantA.tenantId, 'recebe-na-a', [
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.INVENTORY_RECEIVE,
    ]);
    /** Papel de UNIDADE, valido so na unidade A. */
    await assignUnitRole(tenantA.tenantId, userId, roleId, tenantA.unitId);

    const contextoNaA = await contextFor(tenantA.tenantId, userId, tenantA.unitId);
    await expect(
      run(() => receiveStock(contextoNaA, { unitId: tenantA.unitId, partId, quantity: '1' })),
    ).resolves.toBeTruthy();

    const contextoNaB = await contextFor(tenantA.tenantId, userId, unidadeB);
    await expect(
      run(() => receiveStock(contextoNaB, { unitId: unidadeB, partId, quantity: '1' })),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('unidade sem vinculo responde "nao encontrada", nunca "sem permissao"', async () => {
    const unidadeSemVinculo = await createUnit(tenantA.tenantId, 'Unidade Distante');

    await expect(
      run(() =>
        receiveStock(tenantA.context, { unitId: unidadeSemVinculo, partId, quantity: '1' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('isolamento entre empresas (item 137)', () => {
  it('o administrador da empresa B nao enxerga nem move a peca da empresa A', async () => {
    await expect(
      run(() => receiveStock(tenantB.context, { unitId: tenantB.unitId, partId, quantity: '1' })),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      run(() => loadBalance(tenantB.context, tenantA.unitId, partId)),
    ).rejects.toBeInstanceOf(NotFoundError);

    const pagina = await run(() => listParts(tenantB.context, {}));
    expect(pagina.items).toHaveLength(0);
  });
});

describe('modulo desligado bloqueia a operacao, mesmo com permissao (itens 87 e 90)', () => {
  it('com Estoque desativado, o administrador tambem e recusado', async () => {
    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.OPERATIONS_INVENTORY,
        enabled: false,
      }),
    );

    await expect(
      run(() => receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '1' })),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

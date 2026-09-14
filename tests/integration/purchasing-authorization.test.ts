import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { AuthorizationError, NotFoundError } from '@/core/errors';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { createPart } from '@/modules/inventory/application/part-service';
import { loadBalance } from '@/modules/inventory/application/stock-service';
import {
  createPurchaseOrder,
  savePurchaseOrderDraft,
  transitionPurchaseOrder,
} from '@/modules/purchasing/application/purchase-order-service';
import { createPurchaseNeed } from '@/modules/purchasing/application/purchase-need-service';
import { receivePurchase } from '@/modules/purchasing/application/purchase-receipt-service';
import { createSupplier, updateSupplier } from '@/modules/purchasing/application/supplier-service';
import {
  findPurchaseOrderDetail,
  listSuppliers,
} from '@/modules/purchasing/application/purchasing-queries';
import { purchaseOrders } from '@/modules/purchasing/infrastructure/schema';
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
 * RBAC DE FORNECEDORES E COMPRAS (Prompt 11, itens 44 a 47 e 82).
 *
 * O BACKEND E A AUTORIDADE. Esconder o botao nao e seguranca: todos os testes
 * deste arquivo chamam os casos de uso DIRETAMENTE, sem passar por tela
 * nenhuma — e e assim que um atacante chamaria.
 *
 * As permissoes de Compras nao sao uma unica chave "compras": quem monta o
 * pedido nao e necessariamente quem autoriza a despesa, e quem recebe a
 * mercadoria no balcao nao e necessariamente nenhum dos dois (item 17).
 */

let tenant: TenantFixture;
let partId: string;
let supplierId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

let sequencial = 0;

/** Cria um usuario com exatamente as permissoes pedidas, e nada mais. */
async function usuarioCom(
  permissoes: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][],
  unitId = tenant.unitId,
) {
  sequencial += 1;
  const userId = await createPlainUser(tenant.tenantId, `perfil-${sequencial}@rbac.invalid`);
  await grantMembership(tenant.tenantId, userId, unitId);
  const roleId = await createRoleWithPermissions(
    tenant.tenantId,
    `perfil-compras-${sequencial}`,
    permissoes,
  );
  await assignTenantRole(tenant.tenantId, userId, roleId);
  return { userId, contexto: await contextFor(tenant.tenantId, userId, unitId) };
}

/** Pedido REALIZADO, montado pelo administrador, pronto para receber. */
async function pedidoRealizado(): Promise<{ purchaseOrderId: string; itemId: string }> {
  const { purchaseOrderId } = await run(() =>
    createPurchaseOrder(tenant.context, { unitId: tenant.unitId, supplierId }),
  );
  await run(() =>
    savePurchaseOrderDraft(tenant.context, purchaseOrderId, {
      items: [{ partId, quantity: '5', unitCost: '25.00' }],
    }),
  );
  await run(() => transitionPurchaseOrder(tenant.context, purchaseOrderId, 'approved'));
  await run(() => transitionPurchaseOrder(tenant.context, purchaseOrderId, 'placed'));

  const detalhe = await run(() => findPurchaseOrderDetail(tenant.context, purchaseOrderId));
  return { purchaseOrderId, itemId: detalhe?.items[0]?.id ?? '' };
}

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenant = await createTenantFixture('rbac-compras', planId);

  await run(() =>
    setTenantFeature(tenant.context, { featureKey: FEATURES.OPERATIONS_INVENTORY, enabled: true }),
  );
  await run(() =>
    setTenantFeature(tenant.context, { featureKey: FEATURES.OPERATIONS_PURCHASING, enabled: true }),
  );

  partId = await run(() =>
    createPart(tenant.context, { code: 'TELA-RBAC', name: 'Tela LCD', unitOfMeasure: 'unit' }),
  );
  supplierId = await run(() =>
    createSupplier(tenant.context, { kind: 'company', name: 'Distribuidora RBAC' }),
  );
});

// ---------------------------------------------------------------------------
// Fornecedores (itens 44 e 45)
// ---------------------------------------------------------------------------

describe('fornecedores: consultar nao e cadastrar', () => {
  it('quem so consulta ve a lista e nao cria fornecedor', async () => {
    const { contexto } = await usuarioCom([PERMISSIONS.SUPPLIERS_VIEW]);

    const pagina = await run(() => listSuppliers(contexto, {}));
    expect(pagina.items.length).toBeGreaterThan(0);

    await expect(
      run(() => createSupplier(contexto, { kind: 'company', name: 'Clandestina' })),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      run(() => updateSupplier(contexto, supplierId, { name: 'Renomeada' })),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('quem cuida de fornecedor nao abre pedido de compra', async () => {
    const { contexto } = await usuarioCom([
      PERMISSIONS.SUPPLIERS_VIEW,
      PERMISSIONS.SUPPLIERS_MANAGE,
    ]);

    await expect(
      run(() => createSupplier(contexto, { kind: 'company', name: 'Outra distribuidora' })),
    ).resolves.toBeTruthy();

    await expect(
      run(() => createPurchaseOrder(contexto, { unitId: tenant.unitId, supplierId })),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

// ---------------------------------------------------------------------------
// Pedido: montar, aprovar, receber e cancelar sao capacidades distintas
// ---------------------------------------------------------------------------

describe('compras: montar o pedido nao e autorizar a despesa (item 17)', () => {
  it('quem cria e edita o rascunho NAO aprova', async () => {
    const { contexto } = await usuarioCom([
      PERMISSIONS.PURCHASES_VIEW,
      PERMISSIONS.PURCHASES_CREATE,
      PERMISSIONS.PURCHASES_UPDATE,
    ]);

    const { purchaseOrderId } = await run(() =>
      createPurchaseOrder(contexto, { unitId: tenant.unitId, supplierId }),
    );
    await run(() =>
      savePurchaseOrderDraft(contexto, purchaseOrderId, {
        items: [{ partId, quantity: '2', unitCost: '25.00' }],
      }),
    );

    await expect(
      run(() => transitionPurchaseOrder(contexto, purchaseOrderId, 'approved')),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // O pedido continua exatamente onde estava: a recusa nao gravou nada.
    const [linha] = await getDb()
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId));
    expect(linha?.status).toBe('draft');
  });

  it('quem aprova nao recebe mercadoria', async () => {
    const { contexto } = await usuarioCom([
      PERMISSIONS.PURCHASES_VIEW,
      PERMISSIONS.PURCHASES_APPROVE,
    ]);
    const { purchaseOrderId, itemId } = await pedidoRealizado();

    await expect(
      run(() =>
        receivePurchase(contexto, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '5' }],
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect((await run(() => loadBalance(tenant.context, tenant.unitId, partId))).onHand).toBe(
      '0.0000',
    );
  });

  it('quem recebe nao cancela, e quem cancela nao recebe', async () => {
    const recebedor = await usuarioCom([PERMISSIONS.PURCHASES_VIEW, PERMISSIONS.PURCHASES_RECEIVE]);
    const cancelador = await usuarioCom([PERMISSIONS.PURCHASES_VIEW, PERMISSIONS.PURCHASES_CANCEL]);

    const primeiro = await pedidoRealizado();
    await expect(
      run(() =>
        transitionPurchaseOrder(recebedor.contexto, primeiro.purchaseOrderId, 'cancelled', {
          reason: 'Nao quero mais.',
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const segundo = await pedidoRealizado();
    await expect(
      run(() =>
        receivePurchase(cancelador.contexto, segundo.purchaseOrderId, {
          lines: [{ purchaseOrderItemId: segundo.itemId, quantity: '5' }],
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('receber mercadoria NAO exige permissao de estoque: exige a de recebimento (item 47)', async () => {
    const { contexto } = await usuarioCom([
      PERMISSIONS.PURCHASES_VIEW,
      PERMISSIONS.PURCHASES_RECEIVE,
    ]);
    const { purchaseOrderId, itemId } = await pedidoRealizado();

    // A pessoa nao tem `inventory.receive`, e mesmo assim a entrada acontece:
    // quem autoriza aqui e a permissao de COMPRAS, na unidade DO PEDIDO. A
    // entrada e feita pela primitiva oficial do Estoque, que nao reautoriza.
    await expect(
      run(() =>
        receivePurchase(contexto, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '5' }],
        }),
      ),
    ).resolves.toMatchObject({ status: 'received' });

    expect((await run(() => loadBalance(tenant.context, tenant.unitId, partId))).onHand).toBe(
      '5.0000',
    );
  });

  it('necessidade de compra exige permissao de compras, nao de estoque', async () => {
    const { contexto } = await usuarioCom([PERMISSIONS.INVENTORY_VIEW]);

    await expect(
      run(() => createPurchaseNeed(contexto, { unitId: tenant.unitId, partId, quantity: '2' })),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

// ---------------------------------------------------------------------------
// Permissao POR UNIDADE (item 46)
// ---------------------------------------------------------------------------

describe('a permissao vale na unidade em que foi concedida (item 46)', () => {
  it('receber na unidade Norte nao autoriza receber na unidade principal', async () => {
    const norte = await createUnit(tenant.tenantId, 'Unidade Norte');
    await grantMembership(tenant.tenantId, tenant.adminUserId, norte);
    tenant.context = await contextFor(tenant.tenantId, tenant.adminUserId, tenant.unitId);

    sequencial += 1;
    const userId = await createPlainUser(tenant.tenantId, `norte-${sequencial}@rbac.invalid`);
    await grantMembership(tenant.tenantId, userId, norte);
    await grantMembership(tenant.tenantId, userId, tenant.unitId);
    const roleId = await createRoleWithPermissions(tenant.tenantId, `so-norte-${sequencial}`, [
      PERMISSIONS.PURCHASES_VIEW,
      PERMISSIONS.PURCHASES_RECEIVE,
    ]);
    /** Papel concedido SO na unidade Norte, nao no tenant inteiro. */
    await assignUnitRole(tenant.tenantId, userId, roleId, norte);
    const contexto = await contextFor(tenant.tenantId, userId, norte);

    const { purchaseOrderId, itemId } = await pedidoRealizado(); // unidade principal

    await expect(
      run(() =>
        receivePurchase(contexto, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '5' }],
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect((await run(() => loadBalance(tenant.context, tenant.unitId, partId))).onHand).toBe(
      '0.0000',
    );
  });

  it('quem nao e membro da unidade do pedido nem sabe que ele existe', async () => {
    const norte = await createUnit(tenant.tenantId, 'Unidade Norte');
    await grantMembership(tenant.tenantId, tenant.adminUserId, norte);
    tenant.context = await contextFor(tenant.tenantId, tenant.adminUserId, tenant.unitId);

    const { purchaseOrderId } = await pedidoRealizado(); // unidade principal

    sequencial += 1;
    const userId = await createPlainUser(tenant.tenantId, `alheio-${sequencial}@rbac.invalid`);
    await grantMembership(tenant.tenantId, userId, norte);
    const roleId = await createRoleWithPermissions(tenant.tenantId, `alheio-${sequencial}`, [
      PERMISSIONS.PURCHASES_VIEW,
      PERMISSIONS.PURCHASES_RECEIVE,
    ]);
    await assignTenantRole(tenant.tenantId, userId, roleId);
    const contexto = await contextFor(tenant.tenantId, userId, norte);

    // NAO ENCONTRADO, e nao "sem permissao": quem nao alcanca a unidade nao
    // recebe a confirmacao de que o pedido existe.
    await expect(run(() => findPurchaseOrderDetail(contexto, purchaseOrderId))).resolves.toBeNull();
    await expect(
      run(() => createPurchaseNeed(contexto, { unitId: tenant.unitId, partId, quantity: '1' })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Modulo desligado (item 82)
// ---------------------------------------------------------------------------

describe('modulo desligado recusa mesmo quem tem a permissao (item 82)', () => {
  it('com Compras desligado, nem o administrador abre pedido', async () => {
    await run(() =>
      setTenantFeature(tenant.context, {
        featureKey: FEATURES.OPERATIONS_PURCHASING,
        enabled: false,
      }),
    );

    await expect(
      run(() => createPurchaseOrder(tenant.context, { unitId: tenant.unitId, supplierId })),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      run(() =>
        createPurchaseNeed(tenant.context, { unitId: tenant.unitId, partId, quantity: '1' }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('com Compras desligado, recebimento de pedido antigo tambem para', async () => {
    const { purchaseOrderId, itemId } = await pedidoRealizado();

    await run(() =>
      setTenantFeature(tenant.context, {
        featureKey: FEATURES.OPERATIONS_PURCHASING,
        enabled: false,
      }),
    );

    await expect(
      run(() =>
        receivePurchase(tenant.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '5' }],
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect((await run(() => loadBalance(tenant.context, tenant.unitId, partId))).onHand).toBe(
      '0.0000',
    );
  });
});

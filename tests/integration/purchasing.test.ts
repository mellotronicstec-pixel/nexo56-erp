import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import {
  AuthorizationError,
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from '@/core/errors';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { createLocation } from '@/modules/inventory/application/location-service';
import { createPart } from '@/modules/inventory/application/part-service';
import { issueStock, loadBalance } from '@/modules/inventory/application/stock-service';
import { listMovements } from '@/modules/inventory/application/inventory-queries';
import { stockMovements } from '@/modules/inventory/infrastructure/schema';
import {
  createPurchaseNeed,
  cancelPurchaseNeed,
  loadPurchaseNeed,
} from '@/modules/purchasing/application/purchase-need-service';
import {
  createPurchaseOrder,
  loadPurchaseOrder,
  savePurchaseOrderDraft,
  transitionPurchaseOrder,
} from '@/modules/purchasing/application/purchase-order-service';
import { receivePurchase } from '@/modules/purchasing/application/purchase-receipt-service';
import {
  createSupplier,
  changeSupplierStatus,
  loadSupplier,
  updateSupplier,
} from '@/modules/purchasing/application/supplier-service';
import {
  findPurchaseOrderDetail,
  listLowStockSuggestions,
  listPriceHistoryForPart,
  listPurchaseNeeds,
  listPurchaseOrders,
  listSuppliers,
} from '@/modules/purchasing/application/purchasing-queries';
import {
  purchaseNeeds,
  purchaseOrderItems,
  purchaseOrders,
  purchasePriceHistory,
  purchaseReceiptItems,
  supplierParts,
  suppliers as suppliersTable,
} from '@/modules/purchasing/infrastructure/schema';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  contextFor,
  createTenantFixture,
  createUnit,
  grantMembership,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/**
 * FORNECEDORES E COMPRAS — CICLO COMPLETO (Prompt 11, itens 73, 78, 79 e 80).
 *
 * O eixo destes testes: comprar nao e receber, receber nao e pagar, e o saldo
 * so muda quando a mercadoria chega. Nada aqui atravessa a fronteira da
 * empresa nem da unidade, e nenhum caminho deste modulo escreve saldo com a
 * propria mao — a entrada passa sempre pela primitiva do Estoque.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let planId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

let sequencial = 0;

/** Liga os dois modulos OPCIONAIS: Compras depende de Estoque (item 81). */
async function habilitarCompras(fixture: TenantFixture): Promise<void> {
  await run(() =>
    setTenantFeature(fixture.context, {
      featureKey: FEATURES.OPERATIONS_INVENTORY,
      enabled: true,
    }),
  );
  await run(() =>
    setTenantFeature(fixture.context, {
      featureKey: FEATURES.OPERATIONS_PURCHASING,
      enabled: true,
    }),
  );
}

async function criarPeca(
  fixture: TenantFixture,
  overrides: Partial<{ code: string; name: string; unitOfMeasure: string }> = {},
): Promise<string> {
  sequencial += 1;
  return run(() =>
    createPart(fixture.context, {
      code: overrides.code ?? `PECA-${sequencial}`,
      name: overrides.name ?? 'Tela LCD 32 polegadas',
      unitOfMeasure: overrides.unitOfMeasure ?? 'unit',
      brand: 'Generica',
    }),
  );
}

async function criarFornecedor(
  fixture: TenantFixture,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  sequencial += 1;
  return run(() =>
    createSupplier(fixture.context, {
      kind: 'company',
      name: `Distribuidora ${sequencial}`,
      leadTimeDays: 5,
      ...overrides,
    }),
  );
}

/**
 * Cria uma unidade nova, vincula o admin a ela e REFRESCA o contexto do
 * fixture. O contexto e uma fotografia: sem recarregar, a unidade recem-criada
 * nao esta em `authorizedUnitIds` e tudo que a mencionar sera recusado.
 */
async function criarUnidade(fixture: TenantFixture, nome: string): Promise<string> {
  const unitId = await createUnit(fixture.tenantId, nome);
  await grantMembership(fixture.tenantId, fixture.adminUserId, unitId);
  fixture.context = await contextFor(fixture.tenantId, fixture.adminUserId, fixture.unitId);
  return unitId;
}

async function abrirOrdem(fixture: TenantFixture, contexto = fixture.context): Promise<string> {
  sequencial += 1;
  const telefone = `11${String(900000000 + sequencial * 43)}`.slice(0, 11);

  const { customerId } = await run(() =>
    createCustomer(contexto, {
      kind: 'individual',
      name: 'Cliente das compras',
      contacts: [{ type: 'phone', value: telefone, isWhatsapp: false }],
    }),
  );
  const { equipmentId } = await run(() =>
    createEquipment(contexto, { customerId, kind: 'Televisor' }),
  );
  const { serviceOrderId } = await run(() =>
    createServiceOrder(contexto, { equipmentId, customerReport: 'Nao liga.' }),
  );
  return serviceOrderId;
}

/**
 * Atalho para o caminho que quase todo teste precisa percorrer antes do ponto
 * que ele realmente quer testar: pedido REALIZADO, com um item, pronto para
 * receber.
 */
async function pedidoRealizado(
  fixture: TenantFixture,
  options: {
    quantity?: string;
    unitCost?: string;
    partId?: string;
    supplierId?: string;
    unitId?: string;
    purchaseNeedId?: string;
  } = {},
): Promise<{ purchaseOrderId: string; partId: string; itemId: string; supplierId: string }> {
  const partId = options.partId ?? (await criarPeca(fixture));
  const supplierId = options.supplierId ?? (await criarFornecedor(fixture));
  const unitId = options.unitId ?? fixture.unitId;

  const { purchaseOrderId } = await run(() =>
    createPurchaseOrder(fixture.context, { unitId, supplierId }),
  );

  await run(() =>
    savePurchaseOrderDraft(fixture.context, purchaseOrderId, {
      items: [
        {
          partId,
          quantity: options.quantity ?? '10',
          unitCost: options.unitCost ?? '25.00',
          ...(options.purchaseNeedId ? { purchaseNeedId: options.purchaseNeedId } : {}),
        },
      ],
    }),
  );

  await run(() => transitionPurchaseOrder(fixture.context, purchaseOrderId, 'approved'));
  await run(() => transitionPurchaseOrder(fixture.context, purchaseOrderId, 'placed'));

  const detalhe = await run(() => findPurchaseOrderDetail(fixture.context, purchaseOrderId));
  const itemId = detalhe?.items[0]?.id ?? '';

  return { purchaseOrderId, partId, itemId, supplierId };
}

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  planId = await seedCatalog();
  tenantA = await createTenantFixture('compras-a', planId);
  tenantB = await createTenantFixture('compras-b', planId);
  await habilitarCompras(tenantA);
  await habilitarCompras(tenantB);
});

// ---------------------------------------------------------------------------
// Cadastro de fornecedores (itens 4, 5 e 6)
// ---------------------------------------------------------------------------

describe('cadastro de fornecedores', () => {
  it('o fornecedor e da EMPRESA e nao da unidade (item 3.1)', async () => {
    await criarFornecedor(tenantA);

    const colunas = (await getDb().execute(
      sql`SELECT column_name AS name FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'suppliers'`,
    )) as unknown as Array<Array<{ name: string }>>;
    const nomes = (colunas[0] ?? []).map((linha) => linha.name);

    expect(nomes).toContain('tenant_id');
    expect(nomes).not.toContain('unit_id');
  });

  it('fornecedor sem documento e legitimo (item 4)', async () => {
    const supplierId = await criarFornecedor(tenantA, { name: 'Balcao da esquina' });
    const fornecedor = await run(() => loadSupplier(tenantA.context, supplierId));
    expect(fornecedor.documentDigits).toBeNull();
    expect(fornecedor.documentType).toBeNull();
  });

  it('documento informado e validado: mascara certa com digito errado nao passa', async () => {
    await expect(criarFornecedor(tenantA, { document: '111.111.111-11' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('o mesmo CNPJ nao se repete na empresa, mas e legitimo em outra (item 78)', async () => {
    const cnpj = '11.222.333/0001-81';
    await criarFornecedor(tenantA, { document: cnpj });

    await expect(criarFornecedor(tenantA, { document: cnpj })).rejects.toThrow();
    await expect(criarFornecedor(tenantB, { document: cnpj })).resolves.toBeTruthy();
  });

  it('inativar NAO apaga: o fornecedor some da escolha, o historico fica (item 6)', async () => {
    const { purchaseOrderId, supplierId } = await pedidoRealizado(tenantA);

    await run(() => changeSupplierStatus(tenantA.context, supplierId, 'inactive'));

    const pedido = await run(() => loadPurchaseOrder(tenantA.context, purchaseOrderId));
    expect(pedido.supplierId).toBe(supplierId);

    // Fornecedor inativo nao abre pedido novo...
    await expect(
      run(() => createPurchaseOrder(tenantA.context, { unitId: tenantA.unitId, supplierId })),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    // ...e o recebimento do pedido que ja existia continua possivel.
    const detalhe = await run(() => findPurchaseOrderDetail(tenantA.context, purchaseOrderId));
    await expect(
      run(() =>
        receivePurchase(tenantA.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: detalhe?.items[0]?.id ?? '', quantity: '10' }],
        }),
      ),
    ).resolves.toMatchObject({ status: 'received' });
  });

  it('fornecedor de outra empresa nao existe para quem consulta (item 78)', async () => {
    const supplierId = await criarFornecedor(tenantB);
    await expect(run(() => loadSupplier(tenantA.context, supplierId))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('a listagem nunca mostra fornecedor de outra empresa', async () => {
    await criarFornecedor(tenantA, { name: 'Visivel' });
    await criarFornecedor(tenantB, { name: 'Invisivel' });

    const pagina = await run(() => listSuppliers(tenantA.context, {}));
    expect(pagina.items.map((item) => item.name)).toEqual(['Visivel']);
  });
});

// ---------------------------------------------------------------------------
// Necessidade de compra (itens 8, 9, 29 e 30)
// ---------------------------------------------------------------------------

describe('necessidade de compra', () => {
  it('"precisamos comprar" nasce aberta e sem nada pedido (ADR-048)', async () => {
    const partId = await criarPeca(tenantA);
    const needId = await run(() =>
      createPurchaseNeed(tenantA.context, {
        unitId: tenantA.unitId,
        partId,
        quantity: '4',
        justification: 'Fim do estoque.',
      }),
    );

    const need = await run(() => loadPurchaseNeed(tenantA.context, needId));
    expect(need.status).toBe('open');
    expect(need.orderedQuantity).toBe('0.0000');
    expect(need.receivedQuantity).toBe('0.0000');
  });

  it('a necessidade da OS precisa ser da MESMA unidade da OS (item 79)', async () => {
    const outraUnidade = await criarUnidade(tenantA, 'Unidade Norte');
    const contexto = await contextFor(tenantA.tenantId, tenantA.adminUserId, outraUnidade);

    const ordem = await abrirOrdem(tenantA); // OS da unidade principal
    const partId = await criarPeca(tenantA);

    await expect(
      run(() =>
        createPurchaseNeed(contexto, {
          unitId: outraUnidade,
          partId,
          quantity: '1',
          serviceOrderId: ordem,
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('a necessidade vinda de OS guarda o vinculo e NAO mexe na OS (itens 29 e 84)', async () => {
    const ordem = await abrirOrdem(tenantA);
    const partId = await criarPeca(tenantA);

    const [antes] = await getDb()
      .select({ status: serviceOrders.status, version: serviceOrders.version })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordem));

    const needId = await run(() =>
      createPurchaseNeed(tenantA.context, {
        unitId: tenantA.unitId,
        partId,
        quantity: '2',
        serviceOrderId: ordem,
      }),
    );

    const need = await run(() => loadPurchaseNeed(tenantA.context, needId));
    expect(need.serviceOrderId).toBe(ordem);

    const [depois] = await getDb()
      .select({ status: serviceOrders.status, version: serviceOrders.version })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordem));

    // A OS continua exatamente onde estava: Compras nao decide o fluxo dela.
    expect(depois).toEqual(antes);
  });

  it('necessidade que ja recebeu mercadoria nao pode ser cancelada', async () => {
    const partId = await criarPeca(tenantA);
    const needId = await run(() =>
      createPurchaseNeed(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '4' }),
    );

    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, {
      partId,
      quantity: '4',
      purchaseNeedId: needId,
    });

    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '4' }],
      }),
    );

    await expect(run(() => cancelPurchaseNeed(tenantA.context, needId))).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('estoque baixo apenas SUGERE: nenhuma necessidade nasce sozinha (item 32)', async () => {
    const partId = await criarPeca(tenantA);

    const sugestoes = await run(() => listLowStockSuggestions(tenantA.context));
    expect(Array.isArray(sugestoes)).toBe(true);

    const criadas = await getDb()
      .select({ id: purchaseNeeds.id })
      .from(purchaseNeeds)
      .where(eq(purchaseNeeds.partId, partId));
    expect(criadas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// O CICLO COMPLETO (item 73)
// ---------------------------------------------------------------------------

describe('ciclo completo do item 73', () => {
  it('fornecedor -> peca -> necessidade -> pedido -> aprovacao -> recebimento parcial -> restante', async () => {
    const supplierId = await criarFornecedor(tenantA, { name: 'Distribuidora Central' });
    const partId = await criarPeca(tenantA, { code: 'TELA-73' });

    const needId = await run(() =>
      createPurchaseNeed(tenantA.context, {
        unitId: tenantA.unitId,
        partId,
        quantity: '10',
        justification: 'Reposicao.',
      }),
    );

    const { purchaseOrderId, formattedNumber } = await run(() =>
      createPurchaseOrder(tenantA.context, { unitId: tenantA.unitId, supplierId }),
    );
    expect(formattedNumber).toMatch(/^PC \d{6}$/);

    // RASCUNHO: nada aconteceu no estoque ainda.
    let pedido = await run(() => loadPurchaseOrder(tenantA.context, purchaseOrderId));
    expect(pedido.status).toBe('draft');
    expect((await run(() => loadBalance(tenantA.context, tenantA.unitId, partId))).onHand).toBe(
      '0.0000',
    );

    const totais = await run(() =>
      savePurchaseOrderDraft(tenantA.context, purchaseOrderId, {
        items: [{ partId, quantity: '10', unitCost: '25.00', purchaseNeedId: needId }],
        freight: '30.00',
      }),
    );
    expect(totais.subtotal).toBe('250.00');
    // O frete entra no total do pedido e NAO no custo da peca (ADR-051).
    expect(totais.total).toBe('280.00');

    await run(() => transitionPurchaseOrder(tenantA.context, purchaseOrderId, 'approved'));
    // Aprovar marca a necessidade como PEDIDA, nunca como atendida (item 30).
    let need = await run(() => loadPurchaseNeed(tenantA.context, needId));
    expect(need.orderedQuantity).toBe('10.0000');
    expect(need.receivedQuantity).toBe('0.0000');
    expect(need.status).toBe('ordered');

    await run(() => transitionPurchaseOrder(tenantA.context, purchaseOrderId, 'placed'));

    // Pedido realizado e mercadoria ainda nao chegada: saldo continua zero.
    expect((await run(() => loadBalance(tenantA.context, tenantA.unitId, partId))).onHand).toBe(
      '0.0000',
    );

    const detalhe = await run(() => findPurchaseOrderDetail(tenantA.context, purchaseOrderId));
    const itemId = detalhe?.items[0]?.id ?? '';

    // RECEBIMENTO PARCIAL: 4 das 10.
    const parcial = await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '4' }],
        documentNumber: 'NF 1234',
      }),
    );
    expect(parcial.status).toBe('partially_received');

    let saldo = await run(() => loadBalance(tenantA.context, tenantA.unitId, partId));
    expect(saldo.onHand).toBe('4.0000');
    expect(saldo.averageCost).toBe('25.00');

    need = await run(() => loadPurchaseNeed(tenantA.context, needId));
    expect(need.receivedQuantity).toBe('4.0000');
    expect(need.status).toBe('ordered');

    // RESTANTE: as outras 6.
    const final = await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '6' }],
      }),
    );
    expect(final.status).toBe('received');

    saldo = await run(() => loadBalance(tenantA.context, tenantA.unitId, partId));
    expect(saldo.onHand).toBe('10.0000');

    pedido = await run(() => loadPurchaseOrder(tenantA.context, purchaseOrderId));
    expect(pedido.status).toBe('received');

    need = await run(() => loadPurchaseNeed(tenantA.context, needId));
    expect(need.receivedQuantity).toBe('10.0000');
    expect(need.status).toBe('fulfilled');

    // DOIS movimentos de entrada, cada um com a referencia humana do pedido.
    const movimentos = await getDb()
      .select({
        id: stockMovements.id,
        type: stockMovements.type,
        quantity: stockMovements.quantity,
        origin: stockMovements.originKind,
        reference: stockMovements.reference,
      })
      .from(stockMovements)
      .where(eq(stockMovements.partId, partId));

    expect(movimentos).toHaveLength(2);
    expect(movimentos.every((linha) => linha.origin === 'purchase_order')).toBe(true);
    expect(movimentos.every((linha) => linha.reference === formattedNumber)).toBe(true);
  });

  it('cada recebimento grava uma linha no historico de preco pago (itens 7 e 28)', async () => {
    const { purchaseOrderId, itemId, partId } = await pedidoRealizado(tenantA, {
      quantity: '10',
      unitCost: '25.00',
    });

    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '4' }],
      }),
    );
    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '6' }],
      }),
    );

    const historico = await run(() => listPriceHistoryForPart(tenantA.context, partId));
    expect(historico).toHaveLength(2);
    expect(historico.map((linha) => linha.quantity)).toEqual(
      expect.arrayContaining(['4.0000', '6.0000']),
    );
  });

  it('o preco anterior nunca e sobrescrito: o historico e append-only (item 28)', async () => {
    const partId = await criarPeca(tenantA);
    const supplierId = await criarFornecedor(tenantA);

    const primeiro = await pedidoRealizado(tenantA, {
      partId,
      supplierId,
      quantity: '2',
      unitCost: '25.00',
    });
    await run(() =>
      receivePurchase(tenantA.context, primeiro.purchaseOrderId, {
        lines: [{ purchaseOrderItemId: primeiro.itemId, quantity: '2' }],
      }),
    );

    const segundo = await pedidoRealizado(tenantA, {
      partId,
      supplierId,
      quantity: '2',
      unitCost: '40.00',
    });
    await run(() =>
      receivePurchase(tenantA.context, segundo.purchaseOrderId, {
        lines: [{ purchaseOrderItemId: segundo.itemId, quantity: '2' }],
      }),
    );

    const linhas = await getDb()
      .select({ unitCost: purchasePriceHistory.unitCost })
      .from(purchasePriceHistory)
      .where(eq(purchasePriceHistory.partId, partId));

    // As DUAS compras estao la. A de 25,00 nao virou 40,00.
    expect(linhas.map((linha) => linha.unitCost).sort()).toEqual(['25.00', '40.00']);

    // O `last_unit_cost` do vinculo fornecedor-peca e conveniencia, nao
    // autoridade: ele aponta para o ultimo, e o historico guarda todos.
    const [vinculo] = await getDb()
      .select({ lastUnitCost: supplierParts.lastUnitCost })
      .from(supplierParts)
      .where(and(eq(supplierParts.partId, partId), eq(supplierParts.supplierId, supplierId)));
    expect(vinculo?.lastUnitCost).toBe('40.00');
  });

  it('o recebimento aponta para o movimento de estoque que ele gerou (item 48)', async () => {
    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, { quantity: '3' });

    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '3' }],
      }),
    );

    const [linha] = await getDb()
      .select({ movementId: purchaseReceiptItems.stockMovementId })
      .from(purchaseReceiptItems);

    expect(linha?.movementId).toBeTruthy();

    const [movimento] = await getDb()
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.id, linha?.movementId ?? ''));
    expect(movimento?.id).toBe(linha?.movementId);
  });

  it('a mercadoria pode entrar numa localizacao escolhida (item 39)', async () => {
    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, { quantity: '5' });
    const locationId = await run(() =>
      createLocation(tenantA.context, tenantA.unitId, { name: 'Prateleira A', code: 'A1' }),
    );

    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '5', locationId }],
      }),
    );

    const [linha] = await getDb()
      .select({ locationId: purchaseReceiptItems.locationId })
      .from(purchaseReceiptItems);
    expect(linha?.locationId).toBe(locationId);
  });
});

// ---------------------------------------------------------------------------
// Recusas: excesso, situacao errada e correcao destrutiva (itens 22, 24 e 26)
// ---------------------------------------------------------------------------

describe('o que o recebimento recusa', () => {
  it('receber mais do que foi pedido e recusado (item 22)', async () => {
    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, { quantity: '10' });

    await expect(
      run(() =>
        receivePurchase(tenantA.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '11' }],
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    const [item] = await getDb()
      .select({ received: purchaseOrderItems.receivedQuantity })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.id, itemId));
    expect(item?.received).toBe('0.0000');
  });

  it('receber o restante depois de um parcial respeita o que ja entrou', async () => {
    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, { quantity: '10' });

    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '7' }],
      }),
    );

    await expect(
      run(() =>
        receivePurchase(tenantA.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '4' }],
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('pedido em rascunho nao recebe mercadoria (item 16)', async () => {
    const partId = await criarPeca(tenantA);
    const supplierId = await criarFornecedor(tenantA);
    const { purchaseOrderId } = await run(() =>
      createPurchaseOrder(tenantA.context, { unitId: tenantA.unitId, supplierId }),
    );
    await run(() =>
      savePurchaseOrderDraft(tenantA.context, purchaseOrderId, {
        items: [{ partId, quantity: '2', unitCost: '10.00' }],
      }),
    );
    const detalhe = await run(() => findPurchaseOrderDetail(tenantA.context, purchaseOrderId));

    await expect(
      run(() =>
        receivePurchase(tenantA.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: detalhe?.items[0]?.id ?? '', quantity: '2' }],
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('pedido aprovado ainda nao recebe: falta registrar que foi feito (item 17)', async () => {
    const partId = await criarPeca(tenantA);
    const supplierId = await criarFornecedor(tenantA);
    const { purchaseOrderId } = await run(() =>
      createPurchaseOrder(tenantA.context, { unitId: tenantA.unitId, supplierId }),
    );
    await run(() =>
      savePurchaseOrderDraft(tenantA.context, purchaseOrderId, {
        items: [{ partId, quantity: '2', unitCost: '10.00' }],
      }),
    );
    await run(() => transitionPurchaseOrder(tenantA.context, purchaseOrderId, 'approved'));
    const detalhe = await run(() => findPurchaseOrderDetail(tenantA.context, purchaseOrderId));

    await expect(
      run(() =>
        receivePurchase(tenantA.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: detalhe?.items[0]?.id ?? '', quantity: '2' }],
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('pedido aprovado nao volta a ser editavel (item 16)', async () => {
    const { purchaseOrderId, partId } = await pedidoRealizado(tenantA);

    await expect(
      run(() =>
        savePurchaseOrderDraft(tenantA.context, purchaseOrderId, {
          items: [{ partId, quantity: '99', unitCost: '1.00' }],
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('nao existe apagar recebimento: a correcao e um ajuste de estoque (item 26)', async () => {
    const { purchaseOrderId, itemId, partId } = await pedidoRealizado(tenantA, { quantity: '5' });

    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '5' }],
      }),
    );

    // O modulo nao exporta nada que desfaca um recebimento.
    const servico = await import('@/modules/purchasing/application/purchase-receipt-service');
    const nomes = Object.keys(servico);
    expect(nomes.some((nome) => /delete|remove|undo|reverse|cancelReceipt/i.test(nome))).toBe(
      false,
    );

    // O caminho legitimo de correcao e o do Estoque, e ele deixa rastro proprio.
    await run(() =>
      issueStock(tenantA.context, {
        unitId: tenantA.unitId,
        partId,
        quantity: '1',
        reason: 'Devolucao ao fornecedor.',
      }),
    );

    const movimentos = await run(() => listMovements(tenantA.context, tenantA.unitId, partId));
    expect(movimentos).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Cancelamento (item 25)
// ---------------------------------------------------------------------------

describe('cancelamento de pedido', () => {
  it('cancelar exige motivo a partir de aprovado', async () => {
    const partId = await criarPeca(tenantA);
    const supplierId = await criarFornecedor(tenantA);
    const { purchaseOrderId } = await run(() =>
      createPurchaseOrder(tenantA.context, { unitId: tenantA.unitId, supplierId }),
    );
    await run(() =>
      savePurchaseOrderDraft(tenantA.context, purchaseOrderId, {
        items: [{ partId, quantity: '2', unitCost: '10.00' }],
      }),
    );
    await run(() => transitionPurchaseOrder(tenantA.context, purchaseOrderId, 'approved'));

    await expect(
      run(() => transitionPurchaseOrder(tenantA.context, purchaseOrderId, 'cancelled')),
    ).rejects.toThrow();

    await expect(
      run(() =>
        transitionPurchaseOrder(tenantA.context, purchaseOrderId, 'cancelled', {
          reason: 'Fornecedor sem a peca.',
        }),
      ),
    ).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('cancelar o que ja recebeu parcialmente NAO desfaz a entrada (item 25)', async () => {
    const { purchaseOrderId, itemId, partId } = await pedidoRealizado(tenantA, { quantity: '10' });

    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '4' }],
      }),
    );

    await run(() =>
      transitionPurchaseOrder(tenantA.context, purchaseOrderId, 'cancelled', {
        reason: 'O resto nao vem mais.',
      }),
    );

    const saldo = await run(() => loadBalance(tenantA.context, tenantA.unitId, partId));
    // As 4 que chegaram continuam na prateleira. Cancelar o pedido nao evapora
    // mercadoria que ja esta fisicamente na loja.
    expect(saldo.onHand).toBe('4.0000');

    const pedido = await run(() => loadPurchaseOrder(tenantA.context, purchaseOrderId));
    expect(pedido.status).toBe('cancelled');
  });

  it('cancelar libera o que estava pedido na necessidade, mas nao o recebido', async () => {
    const partId = await criarPeca(tenantA);
    const needId = await run(() =>
      createPurchaseNeed(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '10' }),
    );
    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, {
      partId,
      quantity: '10',
      purchaseNeedId: needId,
    });

    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '4' }],
      }),
    );

    await run(() =>
      transitionPurchaseOrder(tenantA.context, purchaseOrderId, 'cancelled', {
        reason: 'O resto nao vem mais.',
      }),
    );

    const need = await run(() => loadPurchaseNeed(tenantA.context, needId));
    expect(need.receivedQuantity).toBe('4.0000');
    // Das 10 pedidas, 6 nunca chegaram: a necessidade volta a pedir por elas.
    expect(need.orderedQuantity).toBe('4.0000');
    expect(need.status).toBe('open');
  });

  it('pedido cancelado nao recebe mais nada', async () => {
    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, { quantity: '5' });

    await run(() =>
      transitionPurchaseOrder(tenantA.context, purchaseOrderId, 'cancelled', {
        reason: 'Desistimos.',
      }),
    );

    await expect(
      run(() =>
        receivePurchase(tenantA.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '1' }],
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('pedido recebido nao pode ser cancelado', async () => {
    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, { quantity: '5' });
    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '5' }],
      }),
    );

    await expect(
      run(() =>
        transitionPurchaseOrder(tenantA.context, purchaseOrderId, 'cancelled', {
          reason: 'Mudei de ideia.',
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

// ---------------------------------------------------------------------------
// TENANT e UNIDADE (itens 78 e 79)
// ---------------------------------------------------------------------------

describe('fronteira de empresa e de unidade', () => {
  it('pedido de outra empresa nao existe para quem consulta (item 78)', async () => {
    const { purchaseOrderId } = await pedidoRealizado(tenantB);

    await expect(
      run(() => loadPurchaseOrder(tenantA.context, purchaseOrderId)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      run(() => findPurchaseOrderDetail(tenantA.context, purchaseOrderId)),
    ).resolves.toBeNull();
  });

  it('pedido de outra empresa nao pode ser recebido daqui (item 78)', async () => {
    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantB, { quantity: '5' });

    await expect(
      run(() =>
        receivePurchase(tenantA.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '5' }],
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('peca de outra empresa nao entra em pedido daqui', async () => {
    const pecaDeB = await criarPeca(tenantB);
    const supplierId = await criarFornecedor(tenantA);
    const { purchaseOrderId } = await run(() =>
      createPurchaseOrder(tenantA.context, { unitId: tenantA.unitId, supplierId }),
    );

    await expect(
      run(() =>
        savePurchaseOrderDraft(tenantA.context, purchaseOrderId, {
          items: [{ partId: pecaDeB, quantity: '1', unitCost: '10.00' }],
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a numeracao de pedido e por empresa: as duas comecam do 1 (item 12)', async () => {
    const fornecedorA = await criarFornecedor(tenantA);
    const fornecedorB = await criarFornecedor(tenantB);

    const a = await run(() =>
      createPurchaseOrder(tenantA.context, { unitId: tenantA.unitId, supplierId: fornecedorA }),
    );
    const b = await run(() =>
      createPurchaseOrder(tenantB.context, { unitId: tenantB.unitId, supplierId: fornecedorB }),
    );

    expect(a.number).toBe(1);
    expect(b.number).toBe(1);
  });

  it('a numeracao NAO tem buraco e nao se repete dentro da empresa', async () => {
    const supplierId = await criarFornecedor(tenantA);
    const numeros: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const criado = await run(() =>
        createPurchaseOrder(tenantA.context, { unitId: tenantA.unitId, supplierId }),
      );
      numeros.push(criado.number);
    }
    expect(numeros).toEqual([1, 2, 3, 4, 5]);
  });

  it('quem so enxerga a unidade Norte nao ve nem recebe pedido da principal (item 79)', async () => {
    const norte = await criarUnidade(tenantA, 'Unidade Norte');
    const soNorte = await contextFor(tenantA.tenantId, tenantA.adminUserId, norte);
    // Restringe o alcance a Norte, como faz um usuario de uma unidade so.
    const restrito = { ...soNorte, authorizedUnitIds: [norte], activeUnitId: norte };

    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, { quantity: '5' });

    await expect(run(() => loadPurchaseOrder(restrito, purchaseOrderId))).rejects.toBeInstanceOf(
      NotFoundError,
    );

    await expect(
      run(() =>
        receivePurchase(restrito, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '5' }],
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a entrada acontece na unidade DO PEDIDO, nao na unidade ativa da sessao (item 47)', async () => {
    const norte = await criarUnidade(tenantA, 'Unidade Norte');

    const partId = await criarPeca(tenantA);
    const supplierId = await criarFornecedor(tenantA);

    // Pedido da unidade NORTE.
    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, {
      partId,
      supplierId,
      unitId: norte,
      quantity: '6',
    });

    // Recebido por uma sessao cuja unidade ATIVA e a principal.
    const sessaoPrincipal = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);
    await run(() =>
      receivePurchase(sessaoPrincipal, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '6' }],
      }),
    );

    expect((await run(() => loadBalance(tenantA.context, norte, partId))).onHand).toBe('6.0000');
    expect((await run(() => loadBalance(tenantA.context, tenantA.unitId, partId))).onHand).toBe(
      '0.0000',
    );
  });
});

// ---------------------------------------------------------------------------
// Auditoria e eventos (itens 57, 58 e 88)
// ---------------------------------------------------------------------------

describe('rastreabilidade', () => {
  it('cada passo do pedido deixa auditoria e evento', async () => {
    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, { quantity: '5' });
    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '5' }],
      }),
    );

    const acoes = await getDb()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, tenantA.tenantId));
    const lista = acoes.map((linha) => linha.action);

    expect(lista).toContain('purchase_order.created');
    expect(lista).toContain('purchase_order.approved');
    expect(lista).toContain('purchase_order.placed');
    expect(lista).toContain('purchase_receipt.created');

    const eventos = await getDb()
      .select({ type: domainEvents.type })
      .from(domainEvents)
      .where(eq(domainEvents.tenantId, tenantA.tenantId));
    const tipos = eventos.map((linha) => linha.type);

    expect(tipos).toContain('PURCHASE_ORDER_CREATED');
    expect(tipos).toContain('PURCHASE_ORDER_RECEIVED');
    expect(tipos).toContain('PURCHASE_RECEIPT_CREATED');
  });

  it('o evento de recebimento nao tem consumidor: nenhum titulo financeiro nasce (itens 42 e 88)', async () => {
    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, { quantity: '2' });
    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '2' }],
      }),
    );

    const tabelas = (await getDb().execute(
      sql`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()`,
    )) as unknown as Array<Array<{ name: string }>>;
    const nomes = (tabelas[0] ?? []).map((linha) => String(linha.name).toLowerCase());

    for (const proibida of ['accounts_payable', 'payments', 'financial_entries', 'invoices']) {
      expect(nomes).not.toContain(proibida);
    }
  });

  it('a linha do tempo do pedido conta a historia inteira (item 57)', async () => {
    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, { quantity: '4' });
    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '2' }],
      }),
    );

    const detalhe = await run(() => findPurchaseOrderDetail(tenantA.context, purchaseOrderId));
    const tipos = (detalhe?.timeline ?? []).map((entrada) => entrada.kind);

    expect(tipos).toContain('created');
    expect(tipos).toContain('approved');
    expect(tipos).toContain('placed');
    expect(tipos).toContain('partially_received');
  });
});

// ---------------------------------------------------------------------------
// Modularidade (item 80)
// ---------------------------------------------------------------------------

describe('modularidade', () => {
  it('sem o modulo ligado, Compras nao abre — e o Estoque continua trabalhando', async () => {
    const { purchaseOrderId, partId, itemId } = await pedidoRealizado(tenantA, { quantity: '5' });
    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '5' }],
      }),
    );

    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.OPERATIONS_PURCHASING,
        enabled: false,
      }),
    );

    // Compras fecha a porta.
    await expect(
      run(() => createPurchaseOrder(tenantA.context, { unitId: tenantA.unitId, supplierId: '1' })),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(criarFornecedor(tenantA)).rejects.toBeInstanceOf(AuthorizationError);

    // O Estoque nao percebe diferenca nenhuma.
    const saldo = await run(() => loadBalance(tenantA.context, tenantA.unitId, partId));
    expect(saldo.onHand).toBe('5.0000');
    await expect(
      run(() =>
        issueStock(tenantA.context, {
          unitId: tenantA.unitId,
          partId,
          quantity: '1',
          reason: 'Uso na bancada.',
        }),
      ),
    ).resolves.toBeTruthy();
  });

  it('com Compras desligado, o dado nao some e o movimento continua legivel (item 50)', async () => {
    const { purchaseOrderId, partId, itemId } = await pedidoRealizado(tenantA, { quantity: '5' });
    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '5' }],
      }),
    );

    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.OPERATIONS_PURCHASING,
        enabled: false,
      }),
    );

    const pedidos = await getDb()
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId));
    expect(pedidos).toHaveLength(1);

    // O Estoque mostra "Compra PC 000001" sem consultar tabela de Compras: a
    // referencia viaja como texto dentro do proprio movimento.
    const movimentos = await run(() => listMovements(tenantA.context, tenantA.unitId, partId));
    const entrada = movimentos.find((linha) => linha.originKind === 'purchase_order');
    expect(entrada?.reference).toMatch(/^PC \d{6}$/);
  });
});

// ---------------------------------------------------------------------------
// Consultas (itens 33 e 34)
// ---------------------------------------------------------------------------

describe('consultas de compras', () => {
  it('a lista de pedidos mostra o que falta receber (item 34)', async () => {
    const { purchaseOrderId, itemId } = await pedidoRealizado(tenantA, { quantity: '10' });
    await run(() =>
      receivePurchase(tenantA.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '4' }],
      }),
    );

    const pagina = await run(() => listPurchaseOrders(tenantA.context, {}));
    const pedido = pagina.items.find((item) => item.id === purchaseOrderId);
    expect(pedido?.status).toBe('partially_received');
  });

  it('a lista de necessidades e da unidade ATIVA e nao da empresa inteira (item 79)', async () => {
    const norte = await criarUnidade(tenantA, 'Unidade Norte');

    const partId = await criarPeca(tenantA);
    await run(() =>
      createPurchaseNeed(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '1' }),
    );
    await run(() => createPurchaseNeed(tenantA.context, { unitId: norte, partId, quantity: '2' }));

    const sessaoPrincipal = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);
    const principal = await run(() => listPurchaseNeeds(sessaoPrincipal, {}));
    expect(principal.items).toHaveLength(1);
    expect(principal.items[0]?.quantity).toBe('1.0000');

    const sessaoNorte = await contextFor(tenantA.tenantId, tenantA.adminUserId, norte);
    const doNorte = await run(() => listPurchaseNeeds(sessaoNorte, {}));
    expect(doNorte.items).toHaveLength(1);
    expect(doNorte.items[0]?.quantity).toBe('2.0000');
  });

  it('fornecedor de outra empresa nao aparece nem por id (item 78)', async () => {
    const supplierId = await criarFornecedor(tenantB, { name: 'Fantasma' });
    await expect(
      run(() => updateSupplier(tenantA.context, supplierId, { name: 'Sequestrado' })),
    ).rejects.toBeInstanceOf(NotFoundError);

    const [linha] = await getDb()
      .select({ name: suppliersTable.name })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, supplierId));
    expect(linha?.name).toBe('Fantasma');
  });
});

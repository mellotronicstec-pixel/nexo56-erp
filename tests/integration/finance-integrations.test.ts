import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { BusinessRuleError } from '@/core/errors';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import {
  createFinancialAccount,
  ensureFinanceDefaults,
  listActivePaymentMethods,
} from '@/modules/finance/application/finance-settings-service';
import {
  ensurePurchaseReceiptPayable,
  ensureServiceOrderCharge,
  findServiceOrderCharge,
  listReceiptsWithPayableStatus,
} from '@/modules/finance/application/finance-integration-service';
import {
  listInstallmentsOfTitle,
  loadFinancialTitle,
} from '@/modules/finance/application/title-service';
import { settleFinancialTitle } from '@/modules/finance/application/settlement-service';
import {
  summarizePurchaseOrderFinance,
  summarizeServiceOrderFinance,
} from '@/modules/finance/application/finance-queries';
import { financialTitles } from '@/modules/finance/infrastructure/schema';
import { createPart } from '@/modules/inventory/application/part-service';
import { loadBalance } from '@/modules/inventory/application/stock-service';
import { stockMovements } from '@/modules/inventory/infrastructure/schema';
import { createSupplier } from '@/modules/purchasing/application/supplier-service';
import {
  createPurchaseOrder,
  savePurchaseOrderDraft,
  transitionPurchaseOrder,
} from '@/modules/purchasing/application/purchase-order-service';
import { receivePurchase } from '@/modules/purchasing/application/purchase-receipt-service';
import { findPurchaseOrderDetail } from '@/modules/purchasing/application/purchasing-queries';
import { purchaseOrderItems, purchaseOrders } from '@/modules/purchasing/infrastructure/schema';
import {
  approveQuote,
  createQuote,
  saveQuoteDraft,
  sendQuote,
} from '@/modules/quotes/application/quote-service';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * FINANCEIRO x OS, ORCAMENTO E COMPRAS (Prompt 12, itens 29 a 34, 92 e 93).
 *
 * O eixo: orcamento aprovado NAO e dinheiro recebido, pedido de compra NAO e
 * dinheiro pago, e nenhuma das duas coisas acontece sozinha. E o Financeiro
 * nao escreve na OS nem no estoque — nunca.
 */

let tenant: TenantFixture;
let contaId: string;
let metodoId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

let sequencial = 0;

async function habilitarTudo(): Promise<void> {
  for (const featureKey of [
    FEATURES.OPERATIONS_INVENTORY,
    FEATURES.OPERATIONS_PURCHASING,
    FEATURES.FINANCE_CORE,
  ]) {
    await run(() => setTenantFeature(tenant.context, { featureKey, enabled: true }));
  }
  await run(() => ensureFinanceDefaults(tenant.context));
}

/** OS com orcamento aprovado de um valor conhecido. */
async function osComOrcamentoAprovado(total: string) {
  sequencial += 1;
  const telefone = `11${String(900000000 + sequencial * 67)}`.slice(0, 11);

  const { customerId } = await run(() =>
    createCustomer(tenant.context, {
      kind: 'individual',
      name: `Cliente do financeiro ${sequencial}`,
      contacts: [{ type: 'phone', value: telefone, isWhatsapp: false }],
    }),
  );
  const { equipmentId } = await run(() =>
    createEquipment(tenant.context, { customerId, kind: 'Televisor' }),
  );
  const { serviceOrderId } = await run(() =>
    createServiceOrder(tenant.context, { equipmentId, customerReport: 'Nao liga.' }),
  );

  const { quoteId } = await run(() => createQuote(tenant.context, { serviceOrderId }));
  await run(() =>
    saveQuoteDraft(tenant.context, quoteId, {
      items: [
        { kind: 'service', description: 'Conserto da fonte', quantity: '1', unitPrice: total },
      ],
    }),
  );
  await run(() => sendQuote(tenant.context, quoteId));
  await run(() => approveQuote(tenant.context, quoteId));

  return { serviceOrderId, quoteId, customerId };
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
  tenant = await createTenantFixture('fin-int', planId);
  await habilitarTudo();

  contaId = await run(() =>
    createFinancialAccount(tenant.context, { name: 'Banco', kind: 'bank' }),
  );
  const metodos = await run(() => listActivePaymentMethods(tenant.context));
  metodoId = metodos[0]?.id ?? '';
});

// ---------------------------------------------------------------------------
// Orcamento aprovado NAO e dinheiro (item 29)
// ---------------------------------------------------------------------------

describe('aprovar orcamento nao cria cobranca (item 29)', () => {
  it('depois de aprovar, NAO existe titulo nenhum', async () => {
    const { serviceOrderId } = await osComOrcamentoAprovado('900.00');

    const titulos = await getDb()
      .select({ id: financialTitles.id })
      .from(financialTitles)
      .where(eq(financialTitles.tenantId, tenant.tenantId));

    expect(titulos).toHaveLength(0);

    const cobranca = await run(() => findServiceOrderCharge(tenant.context, serviceOrderId));
    expect(cobranca).toBeNull();
  });

  it('a cobranca nasce por ACAO, e ela usa o total do orcamento aprovado', async () => {
    const { serviceOrderId } = await osComOrcamentoAprovado('900.00');

    const criado = await run(() => ensureServiceOrderCharge(tenant.context, serviceOrderId, {}));
    expect(criado.amount).toBe('900.00');
    expect(criado.reused).toBe(false);

    const titulo = await run(() => loadFinancialTitle(tenant.context, criado.titleId));
    expect(titulo.direction).toBe('receivable');
    expect(titulo.serviceOrderId).toBe(serviceOrderId);
    expect(titulo.origin).toBe('service_order');
  });

  it('OS sem orcamento aprovado exige valor informado', async () => {
    sequencial += 1;
    const telefone = `11${String(900000000 + sequencial * 71)}`.slice(0, 11);
    const { customerId } = await run(() =>
      createCustomer(tenant.context, {
        kind: 'individual',
        name: 'Cliente sem orcamento',
        contacts: [{ type: 'phone', value: telefone, isWhatsapp: false }],
      }),
    );
    const { equipmentId } = await run(() =>
      createEquipment(tenant.context, { customerId, kind: 'Televisor' }),
    );
    const { serviceOrderId } = await run(() =>
      createServiceOrder(tenant.context, { equipmentId, customerReport: 'Sem imagem.' }),
    );

    await expect(
      run(() => ensureServiceOrderCharge(tenant.context, serviceOrderId, {})),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    await expect(
      run(() => ensureServiceOrderCharge(tenant.context, serviceOrderId, { amount: '150.00' })),
    ).resolves.toMatchObject({ amount: '150.00' });
  });
});

describe('a cobranca da OS nao duplica (item 38)', () => {
  it('repetir a acao dez vezes reencontra o mesmo titulo', async () => {
    const { serviceOrderId } = await osComOrcamentoAprovado('900.00');

    const respostas = [];
    for (let i = 0; i < 10; i += 1) {
      respostas.push(await run(() => ensureServiceOrderCharge(tenant.context, serviceOrderId, {})));
    }

    const ids = new Set(respostas.map((r) => r.titleId));
    expect(ids.size).toBe(1);
    expect(respostas.filter((r) => r.reused)).toHaveLength(9);

    const titulos = await getDb()
      .select({ id: financialTitles.id })
      .from(financialTitles)
      .where(eq(financialTitles.tenantId, tenant.tenantId));
    expect(titulos).toHaveLength(1);
  });

  it('cinco acoes SIMULTANEAS ainda produzem um titulo', async () => {
    const { serviceOrderId } = await osComOrcamentoAprovado('900.00');

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() => ensureServiceOrderCharge(tenant.context, serviceOrderId, {})),
      ),
    );

    const titulos = await getDb()
      .select({ id: financialTitles.id })
      .from(financialTitles)
      .where(eq(financialTitles.tenantId, tenant.tenantId));
    expect(titulos).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// O ciclo do item 92
// ---------------------------------------------------------------------------

describe('ciclo completo da OS com parcelamento (item 92)', () => {
  it('R$ 900 em 3x de R$ 300, recebidas uma a uma, sem tocar na OS', async () => {
    const { serviceOrderId } = await osComOrcamentoAprovado('900.00');

    const [antes] = await getDb()
      .select({ status: serviceOrders.status, version: serviceOrders.version })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, serviceOrderId));

    const cobranca = await run(() =>
      ensureServiceOrderCharge(tenant.context, serviceOrderId, {
        installmentCount: 3,
        dueDate: '2026-09-15',
      }),
    );

    const parcelas = await run(() => listInstallmentsOfTitle(tenant.context, cobranca.titleId));
    expect(parcelas.map((p) => p.amount)).toEqual(['300.00', '300.00', '300.00']);
    expect(parcelas.map((p) => p.dueDate)).toEqual(['2026-09-15', '2026-10-15', '2026-11-15']);

    /** Primeira parcela. */
    const primeira = await run(() =>
      settleFinancialTitle(tenant.context, cobranca.titleId, {
        installmentId: parcelas[0]?.id ?? '',
        amount: '300.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );
    expect(primeira.outstanding).toBe('600.00');
    expect(primeira.titleFullySettled).toBe(false);

    /** Segunda. */
    await run(() =>
      settleFinancialTitle(tenant.context, cobranca.titleId, {
        installmentId: parcelas[1]?.id ?? '',
        amount: '300.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    /** Terceira: agora sim o titulo fecha. */
    const terceira = await run(() =>
      settleFinancialTitle(tenant.context, cobranca.titleId, {
        installmentId: parcelas[2]?.id ?? '',
        amount: '300.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );
    expect(terceira.outstanding).toBe('0.00');
    expect(terceira.titleFullySettled).toBe(true);

    const resumo = await run(() => summarizeServiceOrderFinance(tenant.context, serviceOrderId));
    expect(resumo.total).toBe('900.00');
    expect(resumo.settled).toBe('900.00');
    expect(resumo.outstanding).toBe('0.00');

    /**
     * A SITUACAO DA OS NAO MUDOU (itens 30, 32 e 92).
     *
     * Nem a versao: nenhuma escrita passou por perto dela.
     */
    const [depois] = await getDb()
      .select({ status: serviceOrders.status, version: serviceOrders.version })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, serviceOrderId));
    expect(depois).toEqual(antes);
  });

  it('o evento de liquidacao total da OS sai UMA vez, e so no fim (item 79)', async () => {
    const { serviceOrderId } = await osComOrcamentoAprovado('600.00');
    const cobranca = await run(() =>
      ensureServiceOrderCharge(tenant.context, serviceOrderId, { installmentCount: 2 }),
    );
    const parcelas = await run(() => listInstallmentsOfTitle(tenant.context, cobranca.titleId));

    await run(() =>
      settleFinancialTitle(tenant.context, cobranca.titleId, {
        installmentId: parcelas[0]?.id ?? '',
        amount: '300.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    /** Depois do PARCIAL: nenhum evento de liquidacao total ainda. */
    let eventos = await getDb()
      .select({ id: domainEvents.id })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.tenantId, tenant.tenantId),
          eq(domainEvents.type, 'SERVICE_ORDER_FINANCIAL_SETTLED'),
        ),
      );
    expect(eventos).toHaveLength(0);

    await run(() =>
      settleFinancialTitle(tenant.context, cobranca.titleId, {
        installmentId: parcelas[1]?.id ?? '',
        amount: '300.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    eventos = await getDb()
      .select({ id: domainEvents.id })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.tenantId, tenant.tenantId),
          eq(domainEvents.type, 'SERVICE_ORDER_FINANCIAL_SETTLED'),
        ),
      );
    expect(eventos).toHaveLength(1);
  });

  it('com DOIS titulos da OS, o evento so sai quando os dois fecham (item 79)', async () => {
    const { serviceOrderId } = await osComOrcamentoAprovado('500.00');

    const primeiro = await run(() => ensureServiceOrderCharge(tenant.context, serviceOrderId, {}));
    /** Um segundo titulo da mesma OS, criado a mao: servico extra combinado. */
    const { createFinancialTitle } = await import('@/modules/finance/application/title-service');
    const [os] = await getDb()
      .select({ customerId: serviceOrders.customerId, unitId: serviceOrders.unitId })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, serviceOrderId));

    const segundo = await run(() =>
      createFinancialTitle(tenant.context, {
        unitId: os?.unitId ?? tenant.unitId,
        direction: 'receivable',
        customerId: os?.customerId,
        description: 'Servico extra combinado no balcao',
        amount: '100.00',
        dueDate: '2026-10-15',
        serviceOrderId,
      }),
    );

    const p1 = await run(() => listInstallmentsOfTitle(tenant.context, primeiro.titleId));
    const p2 = await run(() => listInstallmentsOfTitle(tenant.context, segundo.titleId));

    await run(() =>
      settleFinancialTitle(tenant.context, primeiro.titleId, {
        installmentId: p1[0]?.id ?? '',
        amount: '500.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    /** O primeiro fechou, mas o segundo continua aberto: nada de evento. */
    let eventos = await getDb()
      .select({ id: domainEvents.id })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.tenantId, tenant.tenantId),
          eq(domainEvents.type, 'SERVICE_ORDER_FINANCIAL_SETTLED'),
        ),
      );
    expect(eventos).toHaveLength(0);

    await run(() =>
      settleFinancialTitle(tenant.context, segundo.titleId, {
        installmentId: p2[0]?.id ?? '',
        amount: '100.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    eventos = await getDb()
      .select({ id: domainEvents.id })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.tenantId, tenant.tenantId),
          eq(domainEvents.type, 'SERVICE_ORDER_FINANCIAL_SETTLED'),
        ),
      );
    expect(eventos).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Compras (itens 33, 34, 37 e 93)
// ---------------------------------------------------------------------------

/** Pedido de compra REALIZADO, pronto para receber mercadoria. */
async function pedidoRealizado(quantidade: string, custoUnitario: string) {
  sequencial += 1;
  const supplierId = await run(() =>
    createSupplier(tenant.context, { kind: 'company', name: `Distribuidora ${sequencial}` }),
  );
  const partId = await run(() =>
    createPart(tenant.context, {
      code: `PECA-FIN-${sequencial}`,
      name: 'Placa principal',
      unitOfMeasure: 'unit',
    }),
  );

  const { purchaseOrderId } = await run(() =>
    createPurchaseOrder(tenant.context, { unitId: tenant.unitId, supplierId }),
  );
  await run(() =>
    savePurchaseOrderDraft(tenant.context, purchaseOrderId, {
      items: [{ partId, quantity: quantidade, unitCost: custoUnitario }],
    }),
  );
  await run(() => transitionPurchaseOrder(tenant.context, purchaseOrderId, 'approved'));
  await run(() => transitionPurchaseOrder(tenant.context, purchaseOrderId, 'placed'));

  const detalhe = await run(() => findPurchaseOrderDetail(tenant.context, purchaseOrderId));
  return { purchaseOrderId, partId, supplierId, itemId: detalhe?.items[0]?.id ?? '' };
}

describe('pedido de compra nao e dinheiro pago (item 33)', () => {
  it('pedido realizado NAO cria conta a pagar', async () => {
    await pedidoRealizado('10', '100.00');

    const titulos = await getDb()
      .select({ id: financialTitles.id })
      .from(financialTitles)
      .where(eq(financialTitles.tenantId, tenant.tenantId));

    expect(titulos).toHaveLength(0);
  });

  it('a conta a pagar nasce do RECEBIMENTO, com o valor da mercadoria que chegou', async () => {
    const pedido = await pedidoRealizado('10', '100.00');

    const recebimento = await run(() =>
      receivePurchase(tenant.context, pedido.purchaseOrderId, {
        lines: [{ purchaseOrderItemId: pedido.itemId, quantity: '6' }],
      }),
    );

    const titulo = await run(() =>
      ensurePurchaseReceiptPayable(tenant.context, recebimento.receiptId, {}),
    );

    expect(titulo.amount).toBe('600.00');
    expect(titulo.formattedNumber).toMatch(/^CP \d{6}$/);

    const carregado = await run(() => loadFinancialTitle(tenant.context, titulo.titleId));
    expect(carregado.direction).toBe('payable');
    expect(carregado.supplierId).toBe(pedido.supplierId);
    expect(carregado.origin).toBe('purchase_receipt');
  });
});

describe('compra parcial nao duplica financeiro (item 34)', () => {
  it('R$ 1.000 em duas entregas gera dois titulos que somam 1.000, nunca 1.600', async () => {
    const pedido = await pedidoRealizado('10', '100.00');

    const primeiro = await run(() =>
      receivePurchase(tenant.context, pedido.purchaseOrderId, {
        lines: [{ purchaseOrderItemId: pedido.itemId, quantity: '6' }],
      }),
    );
    const tituloA = await run(() =>
      ensurePurchaseReceiptPayable(tenant.context, primeiro.receiptId, {}),
    );

    const segundo = await run(() =>
      receivePurchase(tenant.context, pedido.purchaseOrderId, {
        lines: [{ purchaseOrderItemId: pedido.itemId, quantity: '4' }],
      }),
    );
    const tituloB = await run(() =>
      ensurePurchaseReceiptPayable(tenant.context, segundo.receiptId, {}),
    );

    expect(tituloA.amount).toBe('600.00');
    expect(tituloB.amount).toBe('400.00');
    expect(tituloA.titleId).not.toBe(tituloB.titleId);

    const resumo = await run(() =>
      summarizePurchaseOrderFinance(tenant.context, pedido.purchaseOrderId),
    );
    expect(resumo.total).toBe('1000.00');
    expect(resumo.titles).toHaveLength(2);
  });

  it('repetir a acao no mesmo recebimento dez vezes gera UM titulo', async () => {
    const pedido = await pedidoRealizado('10', '100.00');
    const recebimento = await run(() =>
      receivePurchase(tenant.context, pedido.purchaseOrderId, {
        lines: [{ purchaseOrderItemId: pedido.itemId, quantity: '10' }],
      }),
    );

    const respostas = [];
    for (let i = 0; i < 10; i += 1) {
      respostas.push(
        await run(() => ensurePurchaseReceiptPayable(tenant.context, recebimento.receiptId, {})),
      );
    }

    expect(new Set(respostas.map((r) => r.titleId)).size).toBe(1);
    expect(respostas.filter((r) => r.reused)).toHaveLength(9);

    const titulos = await getDb()
      .select({ id: financialTitles.id })
      .from(financialTitles)
      .where(eq(financialTitles.tenantId, tenant.tenantId));
    expect(titulos).toHaveLength(1);
  });

  it('a lista mostra quais recebimentos ja viraram conta a pagar', async () => {
    const pedido = await pedidoRealizado('10', '100.00');
    const primeiro = await run(() =>
      receivePurchase(tenant.context, pedido.purchaseOrderId, {
        lines: [{ purchaseOrderItemId: pedido.itemId, quantity: '6' }],
      }),
    );
    await run(() =>
      receivePurchase(tenant.context, pedido.purchaseOrderId, {
        lines: [{ purchaseOrderItemId: pedido.itemId, quantity: '4' }],
      }),
    );
    await run(() => ensurePurchaseReceiptPayable(tenant.context, primeiro.receiptId, {}));

    const lista = await run(() =>
      listReceiptsWithPayableStatus(tenant.context, pedido.purchaseOrderId),
    );

    expect(lista).toHaveLength(2);
    expect(lista.filter((r) => r.payable !== null)).toHaveLength(1);
  });
});

describe('pagar fornecedor nao mexe em estoque nem no pedido (itens 40 e 93)', () => {
  it('o saldo da peca e o recebido do pedido nao mudam quando se paga', async () => {
    const pedido = await pedidoRealizado('10', '100.00');
    const recebimento = await run(() =>
      receivePurchase(tenant.context, pedido.purchaseOrderId, {
        lines: [{ purchaseOrderItemId: pedido.itemId, quantity: '10' }],
      }),
    );
    const titulo = await run(() =>
      ensurePurchaseReceiptPayable(tenant.context, recebimento.receiptId, {}),
    );
    const parcelas = await run(() => listInstallmentsOfTitle(tenant.context, titulo.titleId));

    const saldoAntes = await run(() => loadBalance(tenant.context, tenant.unitId, pedido.partId));
    const [itemAntes] = await getDb()
      .select({ received: purchaseOrderItems.receivedQuantity })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.id, pedido.itemId));
    const [pedidoAntes] = await getDb()
      .select({ status: purchaseOrders.status, version: purchaseOrders.version })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, pedido.purchaseOrderId));
    const movimentosAntes = await getDb()
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.partId, pedido.partId));

    /** Paga metade, depois o resto. */
    await run(() =>
      settleFinancialTitle(tenant.context, titulo.titleId, {
        installmentId: parcelas[0]?.id ?? '',
        amount: '500.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );
    await run(() =>
      settleFinancialTitle(tenant.context, titulo.titleId, {
        installmentId: parcelas[0]?.id ?? '',
        amount: '500.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    const saldoDepois = await run(() => loadBalance(tenant.context, tenant.unitId, pedido.partId));
    const [itemDepois] = await getDb()
      .select({ received: purchaseOrderItems.receivedQuantity })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.id, pedido.itemId));
    const [pedidoDepois] = await getDb()
      .select({ status: purchaseOrders.status, version: purchaseOrders.version })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, pedido.purchaseOrderId));
    const movimentosDepois = await getDb()
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.partId, pedido.partId));

    expect(saldoDepois).toEqual(saldoAntes);
    expect(itemDepois?.received).toBe(itemAntes?.received);
    expect(pedidoDepois).toEqual(pedidoAntes);
    expect(movimentosDepois).toHaveLength(movimentosAntes.length);
  });
});

describe('cancelar o pedido nao apaga a divida da mercadoria recebida (item 37)', () => {
  it('a conta a pagar do que ja chegou permanece', async () => {
    const pedido = await pedidoRealizado('10', '100.00');
    const recebimento = await run(() =>
      receivePurchase(tenant.context, pedido.purchaseOrderId, {
        lines: [{ purchaseOrderItemId: pedido.itemId, quantity: '6' }],
      }),
    );
    const titulo = await run(() =>
      ensurePurchaseReceiptPayable(tenant.context, recebimento.receiptId, {}),
    );

    await run(() =>
      transitionPurchaseOrder(tenant.context, pedido.purchaseOrderId, 'cancelled', {
        reason: 'O resto nao vem mais.',
      }),
    );

    /** O titulo continua la, com o valor da mercadoria que chegou. */
    const carregado = await run(() => loadFinancialTitle(tenant.context, titulo.titleId));
    expect(carregado.status).toBe('open');
    expect(carregado.amount).toBe('600.00');
  });

  it('cancelar o pedido tambem nao estorna pagamento ja feito', async () => {
    const pedido = await pedidoRealizado('10', '100.00');
    const recebimento = await run(() =>
      receivePurchase(tenant.context, pedido.purchaseOrderId, {
        lines: [{ purchaseOrderItemId: pedido.itemId, quantity: '6' }],
      }),
    );
    const titulo = await run(() =>
      ensurePurchaseReceiptPayable(tenant.context, recebimento.receiptId, {}),
    );
    const parcelas = await run(() => listInstallmentsOfTitle(tenant.context, titulo.titleId));

    await run(() =>
      settleFinancialTitle(tenant.context, titulo.titleId, {
        installmentId: parcelas[0]?.id ?? '',
        amount: '600.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    await run(() =>
      transitionPurchaseOrder(tenant.context, pedido.purchaseOrderId, 'cancelled', {
        reason: 'O resto nao vem mais.',
      }),
    );

    const carregado = await run(() => loadFinancialTitle(tenant.context, titulo.titleId));
    expect(carregado.status).toBe('settled');
    expect(carregado.settledAmount).toBe('600.00');
  });
});

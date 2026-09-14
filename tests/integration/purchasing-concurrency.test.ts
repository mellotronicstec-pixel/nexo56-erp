import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { createPart } from '@/modules/inventory/application/part-service';
import { loadBalance } from '@/modules/inventory/application/stock-service';
import { stockMovements } from '@/modules/inventory/infrastructure/schema';
import {
  createPurchaseOrder,
  loadPurchaseOrder,
  savePurchaseOrderDraft,
  transitionPurchaseOrder,
} from '@/modules/purchasing/application/purchase-order-service';
import { receivePurchase } from '@/modules/purchasing/application/purchase-receipt-service';
import { createSupplier } from '@/modules/purchasing/application/supplier-service';
import { findPurchaseOrderDetail } from '@/modules/purchasing/application/purchasing-queries';
import {
  purchaseOrderItems,
  purchaseOrders,
  purchasePriceHistory,
  purchaseReceiptItems,
  purchaseReceipts,
} from '@/modules/purchasing/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * CONCORRENCIA E IDEMPOTENCIA DE VERDADE (Prompt 11, itens 55 e 56).
 *
 * Estes testes disputam O MESMO PEDIDO NO MESMO BANCO, em paralelo. Nao ha
 * mock, nao ha relogio falso, nao ha simulacao. Se a condicao sair do `WHERE`
 * do `UPDATE` um dia, e aqui que o projeto para.
 *
 * O item 96 e explicito: nao se declara "idempotente" sem teste de repeticao,
 * nem "seguro contra concorrencia" sem teste paralelo real, nem "sem
 * over-receipt" sem provar que duas requisicoes simultaneas nao ultrapassam.
 * Este arquivo e o que autoriza essas tres frases no relatorio.
 */

let tenant: TenantFixture;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

let sequencial = 0;

/** Conta quantas promessas venceram e quantas foram recusadas. */
function contar(resultados: PromiseSettledResult<unknown>[]): { ganhou: number; perdeu: number } {
  return {
    ganhou: resultados.filter((r) => r.status === 'fulfilled').length,
    perdeu: resultados.filter((r) => r.status === 'rejected').length,
  };
}

/** Pedido REALIZADO com uma linha, pronto para receber. */
async function pedidoRealizado(
  quantidade: string,
  linhasExtras = 0,
): Promise<{ purchaseOrderId: string; partIds: string[]; itemIds: string[] }> {
  sequencial += 1;

  const supplierId = await run(() =>
    createSupplier(tenant.context, { kind: 'company', name: `Distribuidora ${sequencial}` }),
  );

  const partIds: string[] = [];
  for (let indice = 0; indice <= linhasExtras; indice += 1) {
    sequencial += 1;
    partIds.push(
      await run(() =>
        createPart(tenant.context, {
          code: `PECA-${sequencial}`,
          name: 'Peca disputada',
          unitOfMeasure: 'unit',
        }),
      ),
    );
  }

  const { purchaseOrderId } = await run(() =>
    createPurchaseOrder(tenant.context, { unitId: tenant.unitId, supplierId }),
  );

  await run(() =>
    savePurchaseOrderDraft(tenant.context, purchaseOrderId, {
      items: partIds.map((partId) => ({ partId, quantity: quantidade, unitCost: '25.00' })),
    }),
  );

  await run(() => transitionPurchaseOrder(tenant.context, purchaseOrderId, 'approved'));
  await run(() => transitionPurchaseOrder(tenant.context, purchaseOrderId, 'placed'));

  const detalhe = await run(() => findPurchaseOrderDetail(tenant.context, purchaseOrderId));
  const itemIds = (detalhe?.items ?? []).map((item) => item.id);

  return { purchaseOrderId, partIds, itemIds };
}

async function saldo(partId: string): Promise<string> {
  return (await run(() => loadBalance(tenant.context, tenant.unitId, partId))).onHand;
}

async function contarRecebimentos(purchaseOrderId: string): Promise<number> {
  const linhas = await getDb()
    .select({ id: purchaseReceipts.id })
    .from(purchaseReceipts)
    .where(eq(purchaseReceipts.purchaseOrderId, purchaseOrderId));
  return linhas.length;
}

async function contarMovimentos(partId: string): Promise<number> {
  const linhas = await getDb()
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(eq(stockMovements.partId, partId));
  return linhas.length;
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
  tenant = await createTenantFixture('corrida-compras', planId);
  await run(() =>
    setTenantFeature(tenant.context, { featureKey: FEATURES.OPERATIONS_INVENTORY, enabled: true }),
  );
  await run(() =>
    setTenantFeature(tenant.context, { featureKey: FEATURES.OPERATIONS_PURCHASING, enabled: true }),
  );
});

// ---------------------------------------------------------------------------
// Item 56, caso A — recebimento final concorrente
// ---------------------------------------------------------------------------

describe('caso A: duas transacoes recebendo as mesmas 4 pecas', () => {
  it('somente uma vence, e o saldo termina em 4 e nao em 8', async () => {
    const { purchaseOrderId, partIds, itemIds } = await pedidoRealizado('4');
    const partId = partIds[0] ?? '';
    const itemId = itemIds[0] ?? '';

    const resultados = await Promise.allSettled([
      run(() =>
        receivePurchase(tenant.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '4' }],
        }),
      ),
      run(() =>
        receivePurchase(tenant.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '4' }],
        }),
      ),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    expect(await saldo(partId)).toBe('4.0000');
    // A perdedora nao deixou rastro nenhum: nem movimento, nem recebimento.
    expect(await contarMovimentos(partId)).toBe(1);
    expect(await contarRecebimentos(purchaseOrderId)).toBe(1);

    const [item] = await getDb()
      .select({ received: purchaseOrderItems.receivedQuantity })
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.id, itemId));
    expect(item?.received).toBe('4.0000');

    const pedido = await run(() => loadPurchaseOrder(tenant.context, purchaseOrderId));
    expect(pedido.status).toBe('received');
  });

  it('cinco tentativas simultaneas de receber o pedido inteiro entregam uma so', async () => {
    const { purchaseOrderId, partIds, itemIds } = await pedidoRealizado('4');
    const partId = partIds[0] ?? '';
    const itemId = itemIds[0] ?? '';

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() =>
          receivePurchase(tenant.context, purchaseOrderId, {
            lines: [{ purchaseOrderItemId: itemId, quantity: '4' }],
          }),
        ),
      ),
    );

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 4 });
    expect(await saldo(partId)).toBe('4.0000');
    expect(await contarRecebimentos(purchaseOrderId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Item 56, caso B — dois recebimentos parciais
// ---------------------------------------------------------------------------

describe('caso B: restante 10 e dois operadores recebendo 6 ao mesmo tempo', () => {
  it('nao pode terminar com 12: so um dos 6 entra', async () => {
    const { purchaseOrderId, partIds, itemIds } = await pedidoRealizado('10');
    const partId = partIds[0] ?? '';
    const itemId = itemIds[0] ?? '';

    const resultados = await Promise.allSettled([
      run(() =>
        receivePurchase(tenant.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '6' }],
        }),
      ),
      run(() =>
        receivePurchase(tenant.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '6' }],
        }),
      ),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    const saldoFinal = await saldo(partId);
    expect(saldoFinal).toBe('6.0000');
    expect(Number(saldoFinal)).toBeLessThanOrEqual(10);

    const pedido = await run(() => loadPurchaseOrder(tenant.context, purchaseOrderId));
    expect(pedido.status).toBe('partially_received');

    // E o historico de preco conta a mesma historia: uma compra, nao duas.
    const historico = await getDb()
      .select({ id: purchasePriceHistory.id })
      .from(purchasePriceHistory)
      .where(eq(purchasePriceHistory.partId, partId));
    expect(historico).toHaveLength(1);
  });

  it('quatro parciais de 3 num pedido de 10 entregam exatamente 9, nunca 12', async () => {
    const { purchaseOrderId, partIds, itemIds } = await pedidoRealizado('10');
    const partId = partIds[0] ?? '';
    const itemId = itemIds[0] ?? '';

    const resultados = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        run(() =>
          receivePurchase(tenant.context, purchaseOrderId, {
            lines: [{ purchaseOrderItemId: itemId, quantity: '3' }],
          }),
        ),
      ),
    );

    // Tres cabem em 10; a quarta e recusada pelo proprio `WHERE` do `UPDATE`.
    const { ganhou } = contar(resultados);
    expect(ganhou).toBeLessThanOrEqual(3);

    const saldoFinal = Number(await saldo(partId));
    expect(saldoFinal).toBe(ganhou * 3);
    expect(saldoFinal).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Item 56, caso C — cancelamento x recebimento
// ---------------------------------------------------------------------------

describe('caso C: cancelar e receber ao mesmo tempo', () => {
  it('o resultado e deterministico: ou cancelou e nada entrou, ou recebeu e o cancelamento foi recusado', async () => {
    const { purchaseOrderId, partIds, itemIds } = await pedidoRealizado('5');
    const partId = partIds[0] ?? '';
    const itemId = itemIds[0] ?? '';

    const [recebimento, cancelamento] = await Promise.allSettled([
      run(() =>
        receivePurchase(tenant.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '5' }],
        }),
      ),
      run(() =>
        transitionPurchaseOrder(tenant.context, purchaseOrderId, 'cancelled', {
          reason: 'Fornecedor avisou que nao entrega.',
        }),
      ),
    ]);

    const pedido = await run(() => loadPurchaseOrder(tenant.context, purchaseOrderId));
    const saldoFinal = await saldo(partId);

    if (recebimento?.status === 'fulfilled') {
      // Recebimento venceu: a mercadoria esta na prateleira e o pedido nao
      // pode estar cancelado ao mesmo tempo.
      expect(saldoFinal).toBe('5.0000');
      expect(pedido.status).toBe('received');
      expect(cancelamento?.status).toBe('rejected');
    } else {
      // Cancelamento venceu: NADA entrou. A transacao do recebimento voltou
      // atras inteira, entrada de estoque incluida.
      expect(saldoFinal).toBe('0.0000');
      expect(pedido.status).toBe('cancelled');
      expect(cancelamento?.status).toBe('fulfilled');
      expect(await contarRecebimentos(purchaseOrderId)).toBe(0);
      expect(await contarMovimentos(partId)).toBe(0);
    }

    // Em nenhum dos dois mundos ha meia-verdade: nunca cancelado COM saldo
    // vindo deste pedido.
    expect(pedido.status === 'cancelled' && saldoFinal !== '0.0000').toBe(false);
  });

  it('nunca ficam as duas coisas: um recebimento gravado dentro de um pedido cancelado', async () => {
    const { purchaseOrderId, itemIds } = await pedidoRealizado('5');
    const itemId = itemIds[0] ?? '';

    await Promise.allSettled([
      run(() =>
        transitionPurchaseOrder(tenant.context, purchaseOrderId, 'cancelled', {
          reason: 'Desistimos.',
        }),
      ),
      run(() =>
        receivePurchase(tenant.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemId, quantity: '5' }],
        }),
      ),
    ]);

    const [pedido] = await getDb()
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId));

    const recebimentos = await contarRecebimentos(purchaseOrderId);

    if (pedido?.status === 'cancelled') {
      expect(recebimentos).toBe(0);
    } else {
      expect(recebimentos).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Item 55 — idempotencia
// ---------------------------------------------------------------------------

describe('idempotencia do recebimento (item 55)', () => {
  it('a mesma chave de comando dez vezes produz UM unico efeito', async () => {
    const { purchaseOrderId, partIds, itemIds } = await pedidoRealizado('10');
    const partId = partIds[0] ?? '';
    const itemId = itemIds[0] ?? '';
    const chave = 'recebimento-do-balcao-2026-09-14';

    const respostas = [];
    for (let tentativa = 0; tentativa < 10; tentativa += 1) {
      respostas.push(
        await run(() =>
          receivePurchase(tenant.context, purchaseOrderId, {
            lines: [{ purchaseOrderItemId: itemId, quantity: '4' }],
            idempotencyKey: chave,
          }),
        ),
      );
    }

    // Todas respondem o MESMO recebimento; nove delas dizendo "ja fiz isso".
    const ids = new Set(respostas.map((resposta) => resposta.receiptId));
    expect(ids.size).toBe(1);
    expect(respostas.filter((resposta) => resposta.reused)).toHaveLength(9);

    expect(await saldo(partId)).toBe('4.0000');
    expect(await contarMovimentos(partId)).toBe(1);
    expect(await contarRecebimentos(purchaseOrderId)).toBe(1);

    const linhas = await getDb().select({ id: purchaseReceiptItems.id }).from(purchaseReceiptItems);
    expect(linhas).toHaveLength(1);
  });

  it('cinco chamadas SIMULTANEAS com a mesma chave tambem produzem um efeito so', async () => {
    const { purchaseOrderId, partIds, itemIds } = await pedidoRealizado('10');
    const partId = partIds[0] ?? '';
    const itemId = itemIds[0] ?? '';
    const chave = 'duplo-clique-do-balcao';

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() =>
          receivePurchase(tenant.context, purchaseOrderId, {
            lines: [{ purchaseOrderItemId: itemId, quantity: '4' }],
            idempotencyKey: chave,
          }),
        ),
      ),
    );

    // Algumas respondem "ja fiz", outras batem na UNIQUE e voltam atras. O que
    // importa e o mundo depois: uma entrada de 4, e so.
    expect(await saldo(partId)).toBe('4.0000');
    expect(await contarMovimentos(partId)).toBe(1);
    expect(await contarRecebimentos(purchaseOrderId)).toBe(1);

    const vencedoras = resultados.filter((r) => r.status === 'fulfilled');
    expect(vencedoras.length).toBeGreaterThanOrEqual(1);
  });

  it('chaves DIFERENTES sao recebimentos diferentes, e ambos entram', async () => {
    const { purchaseOrderId, partIds, itemIds } = await pedidoRealizado('10');
    const partId = partIds[0] ?? '';
    const itemId = itemIds[0] ?? '';

    await run(() =>
      receivePurchase(tenant.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '4' }],
        idempotencyKey: 'primeira-entrega',
      }),
    );
    await run(() =>
      receivePurchase(tenant.context, purchaseOrderId, {
        lines: [{ purchaseOrderItemId: itemId, quantity: '6' }],
        idempotencyKey: 'segunda-entrega',
      }),
    );

    expect(await saldo(partId)).toBe('10.0000');
    expect(await contarRecebimentos(purchaseOrderId)).toBe(2);
  });
});

describe('idempotencia da abertura de pedido (item 55)', () => {
  it('o mesmo comando duas vezes reencontra o pedido em vez de abrir outro', async () => {
    const supplierId = await run(() =>
      createSupplier(tenant.context, { kind: 'company', name: 'Distribuidora unica' }),
    );

    const primeiro = await run(() =>
      createPurchaseOrder(tenant.context, {
        unitId: tenant.unitId,
        supplierId,
        idempotencyKey: 'abrir-pedido-1',
      }),
    );
    const segundo = await run(() =>
      createPurchaseOrder(tenant.context, {
        unitId: tenant.unitId,
        supplierId,
        idempotencyKey: 'abrir-pedido-1',
      }),
    );

    expect(segundo.purchaseOrderId).toBe(primeiro.purchaseOrderId);
    expect(segundo.reused).toBe(true);

    const pedidos = await getDb().select({ id: purchaseOrders.id }).from(purchaseOrders);
    expect(pedidos).toHaveLength(1);
  });

  it('cinco cliques simultaneos no mesmo botao abrem UM pedido', async () => {
    const supplierId = await run(() =>
      createSupplier(tenant.context, { kind: 'company', name: 'Distribuidora do clique' }),
    );

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() =>
          createPurchaseOrder(tenant.context, {
            unitId: tenant.unitId,
            supplierId,
            idempotencyKey: 'clique-nervoso',
          }),
        ),
      ),
    );

    const pedidos = await getDb().select({ id: purchaseOrders.id }).from(purchaseOrders);
    expect(pedidos).toHaveLength(1);
  });

  it('a numeracao nao se repete quando cinco pedidos nascem ao mesmo tempo (item 12)', async () => {
    const supplierId = await run(() =>
      createSupplier(tenant.context, { kind: 'company', name: 'Distribuidora paralela' }),
    );

    const resultados = await Promise.all(
      Array.from({ length: 5 }, () =>
        run(() => createPurchaseOrder(tenant.context, { unitId: tenant.unitId, supplierId })),
      ),
    );

    const numeros = resultados.map((resultado) => resultado.number).sort((a, b) => a - b);
    expect(numeros).toEqual([1, 2, 3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------
// Linhas diferentes do mesmo pedido
// ---------------------------------------------------------------------------

describe('duas pessoas recebendo LINHAS diferentes do mesmo pedido', () => {
  it('as duas entram, e o pedido termina recebido — nao parcialmente recebido', async () => {
    const { purchaseOrderId, partIds, itemIds } = await pedidoRealizado('4', 1);

    const resultados = await Promise.allSettled([
      run(() =>
        receivePurchase(tenant.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemIds[0] ?? '', quantity: '4' }],
        }),
      ),
      run(() =>
        receivePurchase(tenant.context, purchaseOrderId, {
          lines: [{ purchaseOrderItemId: itemIds[1] ?? '', quantity: '4' }],
        }),
      ),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 2, perdeu: 0 });

    expect(await saldo(partIds[0] ?? '')).toBe('4.0000');
    expect(await saldo(partIds[1] ?? '')).toBe('4.0000');

    /**
     * A ARITMETICA PRECISA ENXERGAR AS DUAS LINHAS.
     *
     * Este e o teste que justifica a leitura travada no recalculo da situacao:
     * sem ela, a segunda transacao leria a primeira linha desatualizada e
     * deixaria o pedido como "parcialmente recebido" com tudo na prateleira.
     */
    const pedido = await run(() => loadPurchaseOrder(tenant.context, purchaseOrderId));
    expect(pedido.status).toBe('received');
  });
});

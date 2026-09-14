import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { createPart } from '@/modules/inventory/application/part-service';
import {
  consumeReservation,
  issueStock,
  loadBalance,
  receiveStock,
  reservePart,
  transferStock,
} from '@/modules/inventory/application/stock-service';
import { stockMovements, stockTransfers } from '@/modules/inventory/infrastructure/schema';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
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
 * CONCORRENCIA E IDEMPOTENCIA DE VERDADE (Prompt 10, itens 32, 135 e 136).
 *
 * Estes testes disputam o MESMO SALDO NO MESMO BANCO, em paralelo. Nao ha
 * mock, nao ha relogio falso e nao ha simulacao: se a trava do `UPDATE` for
 * removida um dia, e aqui que o projeto para.
 *
 * O item 175 e explicito: nao se declara "saldo seguro" sem teste concorrente.
 * Este arquivo e o que autoriza essa frase no relatorio.
 */

let tenant: TenantFixture;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

let sequencial = 0;

async function abrirOrdem(contexto = tenant.context): Promise<string> {
  sequencial += 1;
  const telefone = `11${String(900000000 + sequencial * 41)}`.slice(0, 11);

  const { customerId } = await run(() =>
    createCustomer(contexto, {
      kind: 'individual',
      name: 'Cliente da corrida',
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

async function pecaComSaldo(quantidade: string, unitId = tenant.unitId): Promise<string> {
  sequencial += 1;
  const partId = await run(() =>
    createPart(tenant.context, {
      code: `PECA-${sequencial}`,
      name: 'Peca disputada',
      unitOfMeasure: 'unit',
    }),
  );
  await run(() => receiveStock(tenant.context, { unitId, partId, quantity: quantidade }));
  return partId;
}

/** Conta quantas promessas venceram e quantas foram recusadas por regra. */
function contar(resultados: PromiseSettledResult<unknown>[]): {
  ganhou: number;
  perdeu: number;
} {
  return {
    ganhou: resultados.filter((r) => r.status === 'fulfilled').length,
    perdeu: resultados.filter((r) => r.status === 'rejected').length,
  };
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
  tenant = await createTenantFixture('corrida', planId);
  await run(() =>
    setTenantFeature(tenant.context, {
      featureKey: FEATURES.OPERATIONS_INVENTORY,
      enabled: true,
    }),
  );
});

describe('duas saidas disputando o mesmo saldo (item 32)', () => {
  it('com disponivel 1, so uma das duas saidas simultaneas vence', async () => {
    const partId = await pecaComSaldo('1');

    const resultados = await Promise.allSettled([
      run(() => issueStock(tenant.context, { unitId: tenant.unitId, partId, quantity: '1' })),
      run(() => issueStock(tenant.context, { unitId: tenant.unitId, partId, quantity: '1' })),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    const saldo = await run(() => loadBalance(tenant.context, tenant.unitId, partId));
    expect(saldo.onHand).toBe('0.0000');

    const movimentos = await getDb()
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.partId, partId));
    // A entrada e UMA saida. A perdedora nao deixou rastro.
    expect(movimentos).toHaveLength(2);
  });

  it('com disponivel 3, cinco saidas simultaneas de 1 entregam exatamente 3', async () => {
    const partId = await pecaComSaldo('3');

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() => issueStock(tenant.context, { unitId: tenant.unitId, partId, quantity: '1' })),
      ),
    );

    expect(contar(resultados)).toEqual({ ganhou: 3, perdeu: 2 });

    const saldo = await run(() => loadBalance(tenant.context, tenant.unitId, partId));
    expect(saldo.onHand).toBe('0.0000');
  });
});

describe('duas reservas disputando o mesmo saldo (item 135)', () => {
  it('com disponivel 1, so uma das duas reservas simultaneas vence', async () => {
    const partId = await pecaComSaldo('1');
    const ordemA = await abrirOrdem();
    const ordemB = await abrirOrdem();

    const resultados = await Promise.allSettled([
      run(() => reservePart(tenant.context, { serviceOrderId: ordemA, partId, quantity: '1' })),
      run(() => reservePart(tenant.context, { serviceOrderId: ordemB, partId, quantity: '1' })),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    const saldo = await run(() => loadBalance(tenant.context, tenant.unitId, partId));
    expect(saldo.reserved).toBe('1.0000');
    expect(saldo.available).toBe('0.0000');
  });
});

describe('reserva contra saida (item 135)', () => {
  it('com disponivel 1, reservar e dar saida ao mesmo tempo: so uma passa', async () => {
    const partId = await pecaComSaldo('1');
    const ordem = await abrirOrdem();

    const resultados = await Promise.allSettled([
      run(() => reservePart(tenant.context, { serviceOrderId: ordem, partId, quantity: '1' })),
      run(() => issueStock(tenant.context, { unitId: tenant.unitId, partId, quantity: '1' })),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    const saldo = await run(() => loadBalance(tenant.context, tenant.unitId, partId));
    // Ou saiu (0 fisico, 0 reservado) ou foi reservada (1 fisico, 1 reservado).
    // Em nenhum dos dois o disponivel fica negativo.
    expect(saldo.available).toBe('0.0000');
    expect(Number(saldo.onHand)).toBeGreaterThanOrEqual(0);
  });
});

describe('consumo de reserva atomico (item 105)', () => {
  it('duas tentativas simultaneas de consumir a mesma reserva: so uma vence', async () => {
    const partId = await pecaComSaldo('1');
    const ordem = await abrirOrdem();

    const { reservationId } = await run(() =>
      reservePart(tenant.context, { serviceOrderId: ordem, partId, quantity: '1' }),
    );

    const resultados = await Promise.allSettled([
      run(() => consumeReservation(tenant.context, reservationId, { quantity: '1' })),
      run(() => consumeReservation(tenant.context, reservationId, { quantity: '1' })),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    const saldo = await run(() => loadBalance(tenant.context, tenant.unitId, partId));
    expect(saldo.onHand).toBe('0.0000');
    expect(saldo.reserved).toBe('0.0000');
  });

  it('a peca reservada nao volta ao disponivel durante o consumo', async () => {
    /**
     * A PROVA DE QUE O CONSUMO E UMA INSTRUCAO SO.
     *
     * Se `consumeReservation` liberasse a reserva e depois retirasse o saldo,
     * a saida avulsa simultanea encontraria disponivel 1 e levaria a peca — e
     * o consumo legitimo falharia. Com a instrucao unica, a saida avulsa nao
     * ve disponivel nenhum e e recusada.
     */
    const partId = await pecaComSaldo('1');
    const ordem = await abrirOrdem();

    const { reservationId } = await run(() =>
      reservePart(tenant.context, { serviceOrderId: ordem, partId, quantity: '1' }),
    );

    const resultados = await Promise.allSettled([
      run(() => consumeReservation(tenant.context, reservationId, { quantity: '1' })),
      run(() => issueStock(tenant.context, { unitId: tenant.unitId, partId, quantity: '1' })),
    ]);

    // O consumo vence; a saida avulsa e recusada porque o disponivel era zero.
    expect(resultados[0]?.status).toBe('fulfilled');
    expect(resultados[1]?.status).toBe('rejected');

    const saldo = await run(() => loadBalance(tenant.context, tenant.unitId, partId));
    expect(saldo.onHand).toBe('0.0000');
    expect(saldo.reserved).toBe('0.0000');
  });
});

describe('transferencia sob concorrencia (item 135)', () => {
  it('com saldo 1 na origem, duas transferencias simultaneas: so uma vence', async () => {
    const unidadeB = await createUnit(tenant.tenantId, 'Unidade Bairro');
    await grantMembership(tenant.tenantId, tenant.adminUserId, unidadeB);
    const contexto = await contextFor(tenant.tenantId, tenant.adminUserId, tenant.unitId);

    sequencial += 1;
    const partId = await run(() =>
      createPart(tenant.context, {
        code: `TRANSF-${sequencial}`,
        name: 'Peca transferida',
        unitOfMeasure: 'unit',
      }),
    );
    await run(() => receiveStock(contexto, { unitId: tenant.unitId, partId, quantity: '1' }));

    const resultados = await Promise.allSettled([
      run(() =>
        transferStock(contexto, {
          fromUnitId: tenant.unitId,
          toUnitId: unidadeB,
          partId,
          quantity: '1',
        }),
      ),
      run(() =>
        transferStock(contexto, {
          fromUnitId: tenant.unitId,
          toUnitId: unidadeB,
          partId,
          quantity: '1',
        }),
      ),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    const origem = await run(() => loadBalance(contexto, tenant.unitId, partId));
    const destino = await run(() => loadBalance(contexto, unidadeB, partId));
    expect(origem.onHand).toBe('0.0000');
    expect(destino.onHand).toBe('1.0000');

    const transferencias = await getDb()
      .select({ id: stockTransfers.id })
      .from(stockTransfers)
      .where(eq(stockTransfers.partId, partId));
    expect(transferencias).toHaveLength(1);
  });
});

describe('idempotencia: retry nao lanca duas vezes (itens 118 a 121 e 136)', () => {
  it('a mesma chave de entrada, repetida, nao soma duas vezes', async () => {
    sequencial += 1;
    const partId = await run(() =>
      createPart(tenant.context, {
        code: `IDEM-${sequencial}`,
        name: 'Peca de retry',
        unitOfMeasure: 'unit',
      }),
    );

    const comando = {
      unitId: tenant.unitId,
      partId,
      quantity: '5',
      idempotencyKey: 'entrada-do-duplo-clique',
    };

    const primeira = await run(() => receiveStock(tenant.context, comando));
    const segunda = await run(() => receiveStock(tenant.context, comando));

    expect(primeira.reused).toBe(false);
    expect(segunda.reused).toBe(true);
    expect(segunda.movementId).toBe(primeira.movementId);

    const saldo = await run(() => loadBalance(tenant.context, tenant.unitId, partId));
    expect(saldo.onHand).toBe('5.0000');
  });

  it('duplo clique SIMULTANEO tambem produz uma entrada so', async () => {
    sequencial += 1;
    const partId = await run(() =>
      createPart(tenant.context, {
        code: `IDEM2-${sequencial}`,
        name: 'Peca de duplo clique',
        unitOfMeasure: 'unit',
      }),
    );

    const comando = {
      unitId: tenant.unitId,
      partId,
      quantity: '5',
      idempotencyKey: 'entrada-simultanea',
    };

    /**
     * A consulta previa nao basta para o caso simultaneo: as duas leem "nao
     * existe". Quem decide e a UNIQUE `(tenant_id, idempotency_key)` — a
     * segunda transacao quebra no INSERT e faz rollback inteira, saldo
     * incluido.
     */
    const resultados = await Promise.allSettled([
      run(() => receiveStock(tenant.context, comando)),
      run(() => receiveStock(tenant.context, comando)),
    ]);

    const vencedoras = resultados.filter((r) => r.status === 'fulfilled');
    expect(vencedoras.length).toBeGreaterThanOrEqual(1);

    const movimentos = await getDb()
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.partId, partId));
    expect(movimentos).toHaveLength(1);

    const saldo = await run(() => loadBalance(tenant.context, tenant.unitId, partId));
    expect(saldo.onHand).toBe('5.0000');
  });

  it('retry de transferencia nao transfere duas vezes (item 121)', async () => {
    const unidadeB = await createUnit(tenant.tenantId, 'Unidade Bairro');
    await grantMembership(tenant.tenantId, tenant.adminUserId, unidadeB);
    const contexto = await contextFor(tenant.tenantId, tenant.adminUserId, tenant.unitId);

    sequencial += 1;
    const partId = await run(() =>
      createPart(tenant.context, {
        code: `IDEM3-${sequencial}`,
        name: 'Peca transferida duas vezes',
        unitOfMeasure: 'unit',
      }),
    );
    await run(() => receiveStock(contexto, { unitId: tenant.unitId, partId, quantity: '5' }));

    const comando = {
      fromUnitId: tenant.unitId,
      toUnitId: unidadeB,
      partId,
      quantity: '2',
      idempotencyKey: 'transferencia-com-retry',
    };

    const primeira = await run(() => transferStock(contexto, comando));
    const segunda = await run(() => transferStock(contexto, comando));

    expect(primeira.reused).toBe(false);
    expect(segunda.reused).toBe(true);
    expect(segunda.transferId).toBe(primeira.transferId);

    const origem = await run(() => loadBalance(contexto, tenant.unitId, partId));
    const destino = await run(() => loadBalance(contexto, unidadeB, partId));
    expect(origem.onHand).toBe('3.0000');
    expect(destino.onHand).toBe('2.0000');
  });

  it('retry de consumo de reserva nao consome duas vezes', async () => {
    const partId = await pecaComSaldo('5');
    const ordem = await abrirOrdem();

    const { reservationId } = await run(() =>
      reservePart(tenant.context, { serviceOrderId: ordem, partId, quantity: '3' }),
    );

    const comando = { quantity: '2', idempotencyKey: 'consumo-com-retry' };

    const primeira = await run(() => consumeReservation(tenant.context, reservationId, comando));
    const segunda = await run(() => consumeReservation(tenant.context, reservationId, comando));

    expect(primeira.reused).toBe(false);
    expect(segunda.reused).toBe(true);

    const saldo = await run(() => loadBalance(tenant.context, tenant.unitId, partId));
    expect(saldo.onHand).toBe('3.0000');
    expect(saldo.reserved).toBe('1.0000');
  });
});

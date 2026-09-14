import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/core/errors';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { createPart } from '@/modules/inventory/application/part-service';
import { createLocation } from '@/modules/inventory/application/location-service';
import {
  adjustStock,
  consumeReservation,
  issueStock,
  loadBalance,
  receiveStock,
  releaseReservation,
  reservePart,
  setMinimumQuantity,
  transferStock,
} from '@/modules/inventory/application/stock-service';
import {
  listMovements,
  listParts,
  listReservationsForServiceOrder,
  reconcileBalance,
} from '@/modules/inventory/application/inventory-queries';
import { sweepLowStock } from '@/modules/inventory/application/low-stock-job';
import {
  stockBalances,
  stockMovements,
  stockReservations,
  stockTransfers,
} from '@/modules/inventory/infrastructure/schema';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import {
  serviceOrderTimeline,
  serviceOrders,
} from '@/modules/service-orders/infrastructure/schema';
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
 * ESTOQUE E PECAS — CICLO COMPLETO (Prompt 10, itens 134, 137, 138 e 139).
 *
 * O eixo destes testes: o saldo e a soma do que aconteceu, a reserva e um
 * compromisso e nao uma saida, e nada disso atravessa a fronteira da empresa
 * nem da unidade.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let planId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

let telefoneSequencial = 0;

async function abrirOrdem(fixture: TenantFixture, contexto = fixture.context): Promise<string> {
  telefoneSequencial += 1;
  const telefone = `11${String(900000000 + telefoneSequencial * 37)}`.slice(0, 11);

  const { customerId } = await run(() =>
    createCustomer(contexto, {
      kind: 'individual',
      name: 'Cliente do estoque',
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

let codigoSequencial = 0;

async function criarPeca(
  fixture: TenantFixture,
  overrides: Partial<{ code: string; name: string; unitOfMeasure: string }> = {},
): Promise<string> {
  codigoSequencial += 1;
  return run(() =>
    createPart(fixture.context, {
      code: overrides.code ?? `TELA-${codigoSequencial}`,
      name: overrides.name ?? 'Tela LCD 32 polegadas',
      unitOfMeasure: overrides.unitOfMeasure ?? 'unit',
      brand: 'Generica',
    }),
  );
}

/** Liga o modulo OPCIONAL de estoque para o tenant (itens 84 e 87). */
async function habilitarEstoque(fixture: TenantFixture): Promise<void> {
  await run(() =>
    setTenantFeature(fixture.context, {
      featureKey: FEATURES.OPERATIONS_INVENTORY,
      enabled: true,
    }),
  );
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
  tenantA = await createTenantFixture('estoque-a', planId);
  tenantB = await createTenantFixture('estoque-b', planId);
  await habilitarEstoque(tenantA);
  await habilitarEstoque(tenantB);
});

describe('catalogo de pecas', () => {
  it('a peca e do TENANT e nao tem quantidade (itens 5 e 6)', async () => {
    const partId = await criarPeca(tenantA);

    const colunas = (await getDb().execute(
      sql`SELECT column_name AS name FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'parts'`,
    )) as unknown as Array<Array<{ name: string }>>;
    const nomes = (colunas[0] ?? []).map((linha) => linha.name);

    expect(nomes).toContain('tenant_id');
    expect(nomes).not.toContain('unit_id');
    expect(nomes).not.toContain('quantity');
    expect(nomes).not.toContain('on_hand');
    expect(partId).toBeTruthy();
  });

  it('o codigo interno e unico na empresa, mesmo escrito de outro jeito', async () => {
    await criarPeca(tenantA, { code: 'TELA-01' });
    await expect(criarPeca(tenantA, { code: 'tela 01' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('o mesmo codigo em OUTRA empresa e legitimo (item 137)', async () => {
    await criarPeca(tenantA, { code: 'TELA-01' });
    await expect(criarPeca(tenantB, { code: 'TELA-01' })).resolves.toBeTruthy();
  });

  it('peca de outra empresa nao existe para quem consulta', async () => {
    const partId = await criarPeca(tenantB);
    await expect(
      run(() => receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '1' })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ciclo completo: entrada, reserva, consumo e liberacao (item 142)', () => {
  it('5 -> reservar 2 -> consumir 1 -> liberar 1, com os numeros do item 142', async () => {
    const partId = await criarPeca(tenantA);
    const ordemId = await abrirOrdem(tenantA);

    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '5' }),
    );

    let saldo = await run(() => loadBalance(tenantA.context, tenantA.unitId, partId));
    expect(saldo.onHand).toBe('5.0000');
    expect(saldo.reserved).toBe('0.0000');
    expect(saldo.available).toBe('5.0000');

    const { reservationId } = await run(() =>
      reservePart(tenantA.context, { serviceOrderId: ordemId, partId, quantity: '2' }),
    );

    saldo = await run(() => loadBalance(tenantA.context, tenantA.unitId, partId));
    // A peca NAO saiu da prateleira: o fisico continua 5.
    expect(saldo.onHand).toBe('5.0000');
    expect(saldo.reserved).toBe('2.0000');
    expect(saldo.available).toBe('3.0000');

    await run(() => consumeReservation(tenantA.context, reservationId, { quantity: '1' }));

    saldo = await run(() => loadBalance(tenantA.context, tenantA.unitId, partId));
    expect(saldo.onHand).toBe('4.0000');
    expect(saldo.reserved).toBe('1.0000');
    expect(saldo.available).toBe('3.0000');

    await run(() => releaseReservation(tenantA.context, reservationId, '1'));

    saldo = await run(() => loadBalance(tenantA.context, tenantA.unitId, partId));
    expect(saldo.onHand).toBe('4.0000');
    expect(saldo.reserved).toBe('0.0000');
    expect(saldo.available).toBe('4.0000');

    const [reserva] = await getDb()
      .select()
      .from(stockReservations)
      .where(eq(stockReservations.id, reservationId));
    expect(reserva?.status).toBe('closed');
  });

  it('o saldo materializado bate com o ledger (item 25)', async () => {
    const partId = await criarPeca(tenantA);

    await run(() =>
      receiveStock(tenantA.context, {
        unitId: tenantA.unitId,
        partId,
        quantity: '10',
        unitCost: '5.00',
      }),
    );
    await run(() =>
      receiveStock(tenantA.context, {
        unitId: tenantA.unitId,
        partId,
        quantity: '10',
        unitCost: '7.00',
      }),
    );
    await run(() => issueStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '3' }));

    const conciliacao = await run(() => reconcileBalance(tenantA.context, tenantA.unitId, partId));

    expect(conciliacao.onHandMatches).toBe(true);
    expect(conciliacao.ledgerOnHand).toBe('17.0000');
    expect(conciliacao.movementCount).toBe(3);
    // 10 a R$ 5,00 + 10 a R$ 7,00 = R$ 6,00 de media, e a saida nao mexe nela.
    expect(conciliacao.materializedAverageCost).toBe('6.00');
    expect(conciliacao.averageCostMatches).toBe(true);
  });

  it('o ledger grava a quantidade com sinal e o saldo resultante', async () => {
    const partId = await criarPeca(tenantA);

    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '5' }),
    );
    await run(() => issueStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '2' }));

    const movimentos = await run(() =>
      listMovements(tenantA.context, tenantA.unitId, partId, { limit: 10 }),
    );

    expect(movimentos).toHaveLength(2);
    expect(movimentos[0]?.type).toBe('issue');
    expect(movimentos[0]?.quantity).toBe('-2.0000');
    expect(movimentos[0]?.resultingOnHand).toBe('3.0000');
    expect(movimentos[1]?.quantity).toBe('5.0000');
  });
});

describe('estoque negativo e impedido (itens 29 e 30)', () => {
  it('saida maior que o disponivel e recusada', async () => {
    const partId = await criarPeca(tenantA);
    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '2' }),
    );

    await expect(
      run(() => issueStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '3' })),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    const saldo = await run(() => loadBalance(tenantA.context, tenantA.unitId, partId));
    expect(saldo.onHand).toBe('2.0000');
  });

  it('reserva alem do disponivel e recusada', async () => {
    const partId = await criarPeca(tenantA);
    const ordemId = await abrirOrdem(tenantA);
    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '2' }),
    );

    await expect(
      run(() => reservePart(tenantA.context, { serviceOrderId: ordemId, partId, quantity: '3' })),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('saida avulsa nao come o que esta reservado para outra OS', async () => {
    const partId = await criarPeca(tenantA);
    const ordemId = await abrirOrdem(tenantA);

    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '3' }),
    );
    await run(() =>
      reservePart(tenantA.context, { serviceOrderId: ordemId, partId, quantity: '3' }),
    );

    await expect(
      run(() => issueStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '1' })),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('o banco recusa saldo negativo mesmo por SQL direto (item 123)', async () => {
    const partId = await criarPeca(tenantA);
    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '1' }),
    );

    await expect(
      getDb()
        .update(stockBalances)
        .set({ onHand: '-1.0000' })
        .where(and(eq(stockBalances.tenantId, tenantA.tenantId), eq(stockBalances.partId, partId))),
    ).rejects.toThrow();
  });

  it('o banco recusa reservado maior que o fisico (item 123)', async () => {
    const partId = await criarPeca(tenantA);
    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '1' }),
    );

    await expect(
      getDb()
        .update(stockBalances)
        .set({ reserved: '5.0000' })
        .where(and(eq(stockBalances.tenantId, tenantA.tenantId), eq(stockBalances.partId, partId))),
    ).rejects.toThrow();
  });
});

describe('ajuste (itens 55 e 56)', () => {
  it('exige motivo, gera movimentacao e registra auditoria', async () => {
    const partId = await criarPeca(tenantA);
    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '5' }),
    );

    await run(() =>
      adjustStock(tenantA.context, {
        unitId: tenantA.unitId,
        partId,
        direction: 'out',
        quantity: '1',
        reason: 'peca quebrada na bancada',
      }),
    );

    const saldo = await run(() => loadBalance(tenantA.context, tenantA.unitId, partId));
    expect(saldo.onHand).toBe('4.0000');

    const movimentos = await run(() =>
      listMovements(tenantA.context, tenantA.unitId, partId, { limit: 5 }),
    );
    expect(movimentos[0]?.type).toBe('adjustment_out');
    expect(movimentos[0]?.reason).toBe('peca quebrada na bancada');

    const trilha = await getDb()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.action, 'stock.adjusted'));
    expect(trilha.length).toBe(1);
  });

  it('recusa ajuste sem motivo de verdade', async () => {
    const partId = await criarPeca(tenantA);
    await expect(
      run(() =>
        adjustStock(tenantA.context, {
          unitId: tenantA.unitId,
          partId,
          direction: 'in',
          quantity: '1',
          reason: 'ok',
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('transferencia entre unidades (itens 50 a 54)', () => {
  it('retira da origem, adiciona ao destino e correlaciona os dois movimentos', async () => {
    const unidadeB = await createUnit(tenantA.tenantId, 'Unidade Bairro');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, unidadeB);
    const contexto = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    const partId = await criarPeca(tenantA);
    await run(() => receiveStock(contexto, { unitId: tenantA.unitId, partId, quantity: '5' }));

    const resultado = await run(() =>
      transferStock(contexto, {
        fromUnitId: tenantA.unitId,
        toUnitId: unidadeB,
        partId,
        quantity: '2',
      }),
    );

    const origem = await run(() => loadBalance(contexto, tenantA.unitId, partId));
    const destino = await run(() => loadBalance(contexto, unidadeB, partId));
    expect(origem.onHand).toBe('3.0000');
    expect(destino.onHand).toBe('2.0000');

    const movimentos = await getDb()
      .select({ type: stockMovements.type, transferId: stockMovements.transferId })
      .from(stockMovements)
      .where(eq(stockMovements.transferId, resultado.transferId));

    expect(movimentos).toHaveLength(2);
    expect(movimentos.map((m) => m.type).sort()).toEqual(['transfer_in', 'transfer_out']);
    expect(resultado.formattedNumber).toMatch(/^TRF \d{6}$/);
  });

  it('recusa transferir para a mesma unidade', async () => {
    const partId = await criarPeca(tenantA);
    await expect(
      run(() =>
        transferStock(tenantA.context, {
          fromUnitId: tenantA.unitId,
          toUnitId: tenantA.unitId,
          partId,
          quantity: '1',
        }),
      ),
    ).rejects.toThrow();
  });

  it('recusa transferir para unidade de OUTRA empresa (item 54)', async () => {
    const partId = await criarPeca(tenantA);
    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '5' }),
    );

    await expect(
      run(() =>
        transferStock(tenantA.context, {
          fromUnitId: tenantA.unitId,
          toUnitId: tenantB.unitId,
          partId,
          quantity: '1',
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    const transferencias = await getDb().select().from(stockTransfers);
    expect(transferencias).toHaveLength(0);
  });

  it('o banco recusa uma transferencia cruzando empresas, mesmo por SQL direto (item 126)', async () => {
    const partId = await criarPeca(tenantA);

    await expect(
      getDb().insert(stockTransfers).values({
        id: 'transferencia-invalida-0001',
        tenantId: tenantA.tenantId,
        number: 9999,
        fromUnitId: tenantA.unitId,
        toUnitId: tenantB.unitId,
        partId,
        quantity: '1.0000',
        status: 'completed',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});

describe('isolamento por unidade (itens 35, 127 e 138)', () => {
  it('a OS da unidade A nao consome o estoque da unidade B', async () => {
    const unidadeB = await createUnit(tenantA.tenantId, 'Unidade Bairro');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, unidadeB);
    const contexto = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    const partId = await criarPeca(tenantA);
    const ordemNaUnidadeA = await abrirOrdem(tenantA, contexto);

    await run(() => receiveStock(contexto, { unitId: unidadeB, partId, quantity: '5' }));

    await expect(
      run(() =>
        issueStock(contexto, {
          unitId: unidadeB,
          partId,
          quantity: '1',
          serviceOrderId: ordemNaUnidadeA,
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('reservar usa a unidade DA OS, nunca a do formulario (item 34)', async () => {
    const partId = await criarPeca(tenantA);
    const ordemId = await abrirOrdem(tenantA);

    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '2' }),
    );
    const { reservationId } = await run(() =>
      reservePart(tenantA.context, { serviceOrderId: ordemId, partId, quantity: '1' }),
    );

    const [reserva] = await getDb()
      .select({ unitId: stockReservations.unitId })
      .from(stockReservations)
      .where(eq(stockReservations.id, reservationId));

    const [ordem] = await getDb()
      .select({ unitId: serviceOrders.unitId })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId));

    expect(reserva?.unitId).toBe(ordem?.unitId);
  });

  it('o banco recusa um movimento apontando para OS de outra unidade (item 127)', async () => {
    const unidadeB = await createUnit(tenantA.tenantId, 'Unidade Bairro');
    const partId = await criarPeca(tenantA);
    const ordemNaUnidadeA = await abrirOrdem(tenantA);

    await expect(
      getDb().insert(stockMovements).values({
        id: 'movimento-invalido-0001',
        tenantId: tenantA.tenantId,
        unitId: unidadeB,
        partId,
        type: 'issue',
        quantity: '-1.0000',
        resultingOnHand: '0.0000',
        originKind: 'service_order',
        serviceOrderId: ordemNaUnidadeA,
        occurredAt: new Date(),
        createdAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});

describe('a Ordem de Servico recebe o FATO, nunca a mudanca de estado (itens 46, 47 e 69)', () => {
  it('consumir peca registra na linha do tempo e NAO muda a situacao da OS', async () => {
    const partId = await criarPeca(tenantA);
    const ordemId = await abrirOrdem(tenantA);

    const [antes] = await getDb()
      .select({ status: serviceOrders.status, version: serviceOrders.version })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId));

    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '5' }),
    );
    await run(() =>
      issueStock(tenantA.context, {
        unitId: tenantA.unitId,
        partId,
        quantity: '1',
        serviceOrderId: ordemId,
      }),
    );

    const [depois] = await getDb()
      .select({ status: serviceOrders.status, version: serviceOrders.version })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId));

    expect(depois?.status).toBe(antes?.status);
    expect(depois?.version).toBe(antes?.version);

    const linha = await getDb()
      .select({ kind: serviceOrderTimeline.kind })
      .from(serviceOrderTimeline)
      .where(
        and(
          eq(serviceOrderTimeline.serviceOrderId, ordemId),
          eq(serviceOrderTimeline.kind, 'part_consumed'),
        ),
      );
    expect(linha).toHaveLength(1);
  });

  it('reservar aparece na ficha da OS', async () => {
    const partId = await criarPeca(tenantA);
    const ordemId = await abrirOrdem(tenantA);

    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '5' }),
    );
    await run(() =>
      reservePart(tenantA.context, { serviceOrderId: ordemId, partId, quantity: '2' }),
    );

    const reservas = await run(() => listReservationsForServiceOrder(tenantA.context, ordemId));
    expect(reservas).toHaveLength(1);
    expect(reservas[0]?.remaining).toBe('2.0000');
  });
});

describe('estoque minimo e alerta (itens 59 a 63)', () => {
  it('marca o saldo abaixo do minimo e emite UM evento por queda', async () => {
    const partId = await criarPeca(tenantA);
    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '5' }),
    );
    await run(() => setMinimumQuantity(tenantA.context, tenantA.unitId, partId, '4'));
    await run(() => issueStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '2' }));

    const primeira = await run(() => sweepLowStock());
    expect(primeira.flagged).toBe(1);

    // Rodar de novo NAO republica o alerta (item 63).
    const segunda = await run(() => sweepLowStock());
    expect(segunda.flagged).toBe(0);

    const eventos = await getDb()
      .select({ type: domainEvents.type })
      .from(domainEvents)
      .where(eq(domainEvents.type, 'LOW_STOCK_DETECTED'));
    expect(eventos).toHaveLength(1);
  });

  it('minimo zero nao alerta nunca', async () => {
    const partId = await criarPeca(tenantA);
    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '1' }),
    );
    await run(() => issueStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '1' }));

    expect((await run(() => sweepLowStock())).flagged).toBe(0);
  });

  it('quando o estoque se recupera, um novo alerta volta a ser possivel', async () => {
    const partId = await criarPeca(tenantA);
    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '5' }),
    );
    await run(() => setMinimumQuantity(tenantA.context, tenantA.unitId, partId, '4'));
    await run(() => issueStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '2' }));

    expect((await run(() => sweepLowStock())).flagged).toBe(1);

    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '5' }),
    );
    await run(() => issueStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '5' }));

    expect((await run(() => sweepLowStock())).flagged).toBe(1);
  });

  it('a listagem marca a peca abaixo do minimo', async () => {
    const partId = await criarPeca(tenantA);
    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '1' }),
    );
    await run(() => setMinimumQuantity(tenantA.context, tenantA.unitId, partId, '5'));

    const pagina = await run(() => listParts(tenantA.context, {}));
    const item = pagina.items.find((linha) => linha.id === partId);
    expect(item?.belowMinimum).toBe(true);
    expect(item?.available).toBe('1.0000');
  });
});

describe('localizacoes (itens 8 a 10 e 125)', () => {
  it('a localizacao pertence a unidade e nao serve para outra', async () => {
    const unidadeB = await createUnit(tenantA.tenantId, 'Unidade Bairro');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, unidadeB);
    const contexto = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    const prateleira = await run(() =>
      createLocation(contexto, tenantA.unitId, { name: 'Prateleira A', code: 'A1' }),
    );
    const partId = await criarPeca(tenantA);

    await expect(
      run(() =>
        receiveStock(contexto, {
          unitId: unidadeB,
          partId,
          quantity: '1',
          locationId: prateleira,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('o mesmo codigo de prateleira pode existir em unidades diferentes', async () => {
    const unidadeB = await createUnit(tenantA.tenantId, 'Unidade Bairro');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, unidadeB);
    const contexto = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    await run(() => createLocation(contexto, tenantA.unitId, { name: 'Prateleira A', code: 'A1' }));
    await expect(
      run(() => createLocation(contexto, unidadeB, { name: 'Prateleira A', code: 'A1' })),
    ).resolves.toBeTruthy();
  });
});

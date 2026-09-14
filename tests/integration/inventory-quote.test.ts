import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { createPart, updatePart } from '@/modules/inventory/application/part-service';
import {
  loadBalance,
  receiveStock,
  reservePart,
} from '@/modules/inventory/application/stock-service';
import { stockMovements, stockReservations } from '@/modules/inventory/infrastructure/schema';
import {
  approveQuote,
  createQuote,
  reviseQuote,
  saveQuoteDraft,
  sendQuote,
} from '@/modules/quotes/application/quote-service';
import { findQuoteDetail } from '@/modules/quotes/application/quote-queries';
import { quoteItems } from '@/modules/quotes/infrastructure/schema';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * ORCAMENTO x ESTOQUE (Prompt 10, itens 36 a 44, 108 a 110 e 139).
 *
 * A pergunta que estes testes respondem, e que o relatorio final precisa
 * responder com prova: salvar, enviar ou aprovar um orcamento movimenta
 * estoque? A resposta e NAO, e esta escrita aqui em forma de assercao.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

let sequencial = 0;

async function abrirOrdem(fixture: TenantFixture): Promise<string> {
  sequencial += 1;
  const telefone = `11${String(900000000 + sequencial * 53)}`.slice(0, 11);

  const { customerId } = await run(() =>
    createCustomer(fixture.context, {
      kind: 'individual',
      name: 'Cliente do orcamento com peca',
      contacts: [{ type: 'phone', value: telefone, isWhatsapp: false }],
    }),
  );
  const { equipmentId } = await run(() =>
    createEquipment(fixture.context, { customerId, kind: 'Televisor' }),
  );
  const { serviceOrderId } = await run(() =>
    createServiceOrder(fixture.context, { equipmentId, customerReport: 'Nao liga.' }),
  );
  return serviceOrderId;
}

async function criarPeca(fixture: TenantFixture, nome = 'Tela LCD 32'): Promise<string> {
  sequencial += 1;
  return run(() =>
    createPart(fixture.context, {
      code: `ORC-${sequencial}`,
      name: nome,
      unitOfMeasure: 'unit',
      suggestedPrice: '450.00',
    }),
  );
}

async function contarMovimentos(): Promise<number> {
  return (await getDb().select({ id: stockMovements.id }).from(stockMovements)).length;
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
  tenantA = await createTenantFixture('orc-estoque-a', planId);
  tenantB = await createTenantFixture('orc-estoque-b', planId);
  for (const fixture of [tenantA, tenantB]) {
    await run(() =>
      setTenantFeature(fixture.context, {
        featureKey: FEATURES.OPERATIONS_INVENTORY,
        enabled: true,
      }),
    );
  }
});

describe('linha PART manual continua valida para sempre (item 40)', () => {
  it('orcamento sem peca cadastrada funciona igual ao Prompt 09', async () => {
    const ordemId = await abrirOrdem(tenantA);
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));

    await run(() =>
      saveQuoteDraft(tenantA.context, quoteId, {
        items: [
          { kind: 'part', description: 'Tela comprada avulsa', quantity: '1', unitPrice: '500.00' },
        ],
      }),
    );

    const detalhe = await run(() => findQuoteDetail(tenantA.context, quoteId));
    expect(detalhe?.items[0]?.partId).toBeNull();
    expect(detalhe?.items[0]?.description).toBe('Tela comprada avulsa');
    expect(detalhe?.quote.total).toBe('500.00');
  });
});

describe('vinculo opcional com o catalogo (itens 39, 108 e 109)', () => {
  it('a linha guarda o vinculo e continua guardando os proprios numeros', async () => {
    const partId = await criarPeca(tenantA);
    const ordemId = await abrirOrdem(tenantA);
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));

    await run(() =>
      saveQuoteDraft(tenantA.context, quoteId, {
        items: [
          {
            kind: 'part',
            description: 'Tela LCD 32',
            quantity: '1',
            unitPrice: '450.00',
            partId,
          },
        ],
      }),
    );

    const detalhe = await run(() => findQuoteDetail(tenantA.context, quoteId));
    expect(detalhe?.items[0]?.partId).toBe(partId);
    expect(detalhe?.items[0]?.unitPrice).toBe('450.00');
  });

  it('o banco recusa vincular peca de OUTRA empresa (itens 124 e 137)', async () => {
    const pecaDeOutraEmpresa = await criarPeca(tenantB);
    const ordemId = await abrirOrdem(tenantA);
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));

    await expect(
      run(() =>
        saveQuoteDraft(tenantA.context, quoteId, {
          items: [
            {
              kind: 'part',
              description: 'Tela de outra empresa',
              quantity: '1',
              unitPrice: '450.00',
              partId: pecaDeOutraEmpresa,
            },
          ],
        }),
      ),
    ).rejects.toThrow();

    const linhas = await getDb()
      .select({ id: quoteItems.id })
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, quoteId));
    expect(linhas).toHaveLength(0);
  });

  it('mudar a peca depois NAO muda o orcamento aprovado (itens 41 e 42)', async () => {
    const partId = await criarPeca(tenantA, 'Tela LCD 32');
    const ordemId = await abrirOrdem(tenantA);
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));

    await run(() =>
      saveQuoteDraft(tenantA.context, quoteId, {
        items: [
          {
            kind: 'part',
            description: 'Tela LCD 32',
            quantity: '2',
            unitPrice: '450.00',
            partId,
          },
        ],
      }),
    );
    await run(() => sendQuote(tenantA.context, quoteId));
    await run(() => approveQuote(tenantA.context, quoteId));

    // A peca muda de nome, de codigo e de preco sugerido.
    await run(() =>
      updatePart(tenantA.context, partId, {
        code: 'TELA-NOVA',
        name: 'Tela LCD 32 (revisada)',
        unitOfMeasure: 'unit',
        suggestedPrice: '999.00',
      }),
    );

    const detalhe = await run(() => findQuoteDetail(tenantA.context, quoteId));
    expect(detalhe?.items[0]?.description).toBe('Tela LCD 32');
    expect(detalhe?.items[0]?.unitPrice).toBe('450.00');
    expect(detalhe?.items[0]?.quantity).toBe('2.0000');
    expect(detalhe?.quote.total).toBe('900.00');
    // O vinculo continua, para quem quiser abrir a ficha da peca.
    expect(detalhe?.items[0]?.partId).toBe(partId);
  });

  it('a revisao herda o vinculo', async () => {
    const partId = await criarPeca(tenantA);
    const ordemId = await abrirOrdem(tenantA);
    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));

    await run(() =>
      saveQuoteDraft(tenantA.context, quoteId, {
        items: [{ kind: 'part', description: 'Tela', quantity: '1', unitPrice: '450.00', partId }],
      }),
    );
    await run(() => sendQuote(tenantA.context, quoteId));

    const revisao = await run(() => reviseQuote(tenantA.context, quoteId));
    const detalhe = await run(() => findQuoteDetail(tenantA.context, revisao.quoteId));
    expect(detalhe?.items[0]?.partId).toBe(partId);
  });
});

describe('NENHUM estoque se move por causa de orcamento (itens 36 a 38 e 44)', () => {
  it('salvar, enviar e aprovar nao geram movimentacao nem reserva', async () => {
    const partId = await criarPeca(tenantA);
    const ordemId = await abrirOrdem(tenantA);

    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '10' }),
    );
    const movimentosAposEntrada = await contarMovimentos();

    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));
    await run(() =>
      saveQuoteDraft(tenantA.context, quoteId, {
        items: [{ kind: 'part', description: 'Tela', quantity: '3', unitPrice: '450.00', partId }],
      }),
    );
    await run(() => sendQuote(tenantA.context, quoteId));
    await run(() => approveQuote(tenantA.context, quoteId));

    expect(await contarMovimentos()).toBe(movimentosAposEntrada);

    const reservas = await getDb().select({ id: stockReservations.id }).from(stockReservations);
    expect(reservas).toHaveLength(0);

    const saldo = await run(() => loadBalance(tenantA.context, tenantA.unitId, partId));
    expect(saldo.onHand).toBe('10.0000');
    expect(saldo.reserved).toBe('0.0000');
    expect(saldo.available).toBe('10.0000');
  });

  it('depois da aprovacao, reservar continua sendo um ato explicito (item 38)', async () => {
    const partId = await criarPeca(tenantA);
    const ordemId = await abrirOrdem(tenantA);

    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '10' }),
    );

    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));
    await run(() =>
      saveQuoteDraft(tenantA.context, quoteId, {
        items: [{ kind: 'part', description: 'Tela', quantity: '3', unitPrice: '450.00', partId }],
      }),
    );
    await run(() => sendQuote(tenantA.context, quoteId));
    await run(() => approveQuote(tenantA.context, quoteId));

    // Alguem clica em reservar. So entao o disponivel muda.
    await run(() =>
      reservePart(tenantA.context, { serviceOrderId: ordemId, partId, quantity: '3' }),
    );

    const saldo = await run(() => loadBalance(tenantA.context, tenantA.unitId, partId));
    expect(saldo.onHand).toBe('10.0000');
    expect(saldo.reserved).toBe('3.0000');
    expect(saldo.available).toBe('7.0000');

    // E o snapshot comercial continua exatamente o mesmo (item 143).
    const detalhe = await run(() => findQuoteDetail(tenantA.context, quoteId));
    expect(detalhe?.items[0]?.unitPrice).toBe('450.00');
    expect(detalhe?.quote.total).toBe('1350.00');
  });
});

describe('orcamento sobrevive ao modulo de estoque desligado (itens 86, 87 e 110)', () => {
  it('desativar Estoque nao apaga peca, movimentacao nem reserva, e o orcamento continua legivel', async () => {
    const partId = await criarPeca(tenantA);
    const ordemId = await abrirOrdem(tenantA);

    await run(() =>
      receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '5' }),
    );
    await run(() =>
      reservePart(tenantA.context, { serviceOrderId: ordemId, partId, quantity: '1' }),
    );

    const { quoteId } = await run(() => createQuote(tenantA.context, { serviceOrderId: ordemId }));
    await run(() =>
      saveQuoteDraft(tenantA.context, quoteId, {
        items: [{ kind: 'part', description: 'Tela', quantity: '1', unitPrice: '450.00', partId }],
      }),
    );

    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.OPERATIONS_INVENTORY,
        enabled: false,
      }),
    );

    // Os dados continuam la.
    expect(await contarMovimentos()).toBe(1);
    const reservas = await getDb().select({ id: stockReservations.id }).from(stockReservations);
    expect(reservas).toHaveLength(1);

    // O orcamento continua legivel, com peca vinculada e tudo.
    const detalhe = await run(() => findQuoteDetail(tenantA.context, quoteId));
    expect(detalhe?.items[0]?.partId).toBe(partId);
    expect(detalhe?.quote.total).toBe('450.00');

    // E ainda aceita edicao com linha PART manual.
    await run(() =>
      saveQuoteDraft(tenantA.context, quoteId, {
        items: [
          { kind: 'part', description: 'Tela comprada avulsa', quantity: '1', unitPrice: '500.00' },
        ],
      }),
    );
    const depois = await run(() => findQuoteDetail(tenantA.context, quoteId));
    expect(depois?.items[0]?.partId).toBeNull();
    expect(depois?.quote.total).toBe('500.00');
  });

  it('com Estoque desligado, nenhuma operacao nova de estoque e aceita (item 87)', async () => {
    const partId = await criarPeca(tenantA);
    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.OPERATIONS_INVENTORY,
        enabled: false,
      }),
    );

    await expect(
      run(() => receiveStock(tenantA.context, { unitId: tenantA.unitId, partId, quantity: '1' })),
    ).rejects.toThrow();
  });
});

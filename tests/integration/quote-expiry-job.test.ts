import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { todayIn } from '@/core/time/civil-date';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import {
  findJobHandler,
  listJobNames,
  RECURRING_JOBS,
} from '@/modules/jobs/application/job-registry';
import { expireOverdueQuotes } from '@/modules/quotes/application/quote-expiry-job';
import {
  createQuote,
  reviseQuote,
  saveQuoteDraft,
  sendQuote,
} from '@/modules/quotes/application/quote-service';
import { quotes } from '@/modules/quotes/infrastructure/schema';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { tenants } from '@/modules/tenancy/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * EXPIRACAO DE ORCAMENTOS (Prompt 09, itens 23 e 24).
 *
 * O QUE O JOB E: um marcador de prazo vencido que publica evento.
 * O QUE ELE NAO E: uma automacao que decide o destino do aparelho.
 */

let tenant: TenantFixture;
let ordemId: string;
let quoteId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

async function abrirOrdem(): Promise<string> {
  const customerId = (
    await run(() =>
      createCustomer(tenant.context, {
        kind: 'individual',
        name: 'Cliente',
        contacts: [
          {
            type: 'phone',
            value: `1196${Math.floor(1000000 + Math.random() * 8999999)}`,
            isWhatsapp: false,
          },
        ],
      }),
    )
  ).customerId;
  const equipmentId = (
    await run(() => createEquipment(tenant.context, { customerId, kind: 'Televisor' }))
  ).equipmentId;
  return (
    await run(() =>
      createServiceOrder(tenant.context, { equipmentId, customerReport: 'Nao liga.' }),
    )
  ).serviceOrderId;
}

async function quoteRow(id: string) {
  const [row] = await getDb().select().from(quotes).where(eq(quotes.id, id)).limit(1);
  return row!;
}

async function eventosExpirados() {
  return getDb().select().from(domainEvents).where(eq(domainEvents.type, 'QUOTE_EXPIRED'));
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
  tenant = await createTenantFixture('orc-job', planId);
  ordemId = await abrirOrdem();

  const created = await run(() => createQuote(tenant.context, { serviceOrderId: ordemId }));
  quoteId = created.quoteId;
  await run(() =>
    saveQuoteDraft(tenant.context, quoteId, {
      items: [{ kind: 'service', description: 'Bancada', quantity: '1', unitPrice: '100.00' }],
      validUntil: '2020-01-01',
    }),
  );
  await run(() => sendQuote(tenant.context, quoteId));
});

describe('o que o job expira', () => {
  it('marca o orcamento vencido e publica UM evento', async () => {
    const resultado = await run(() => expireOverdueQuotes());
    expect(resultado.expired).toBe(1);

    const row = await quoteRow(quoteId);
    expect(row.status).toBe('expired');
    // Sai do lugar de proposta viva: a OS volta a poder receber uma revisao.
    expect(row.activeMarker).toBeNull();

    expect(await eventosExpirados()).toHaveLength(1);
  });

  it('rodar de novo NAO expira duas vezes', async () => {
    await run(() => expireOverdueQuotes());
    const segunda = await run(() => expireOverdueQuotes());

    expect(segunda.expired).toBe(0);
    expect(await eventosExpirados()).toHaveLength(1);
  });

  it('duas execucoes SIMULTANEAS produzem um evento so', async () => {
    await Promise.all([run(() => expireOverdueQuotes()), run(() => expireOverdueQuotes())]);
    expect(await eventosExpirados()).toHaveLength(1);
  });

  it('NAO cancela nem move a Ordem de Servico (item 23)', async () => {
    const antes = (
      await getDb().select().from(serviceOrders).where(eq(serviceOrders.id, ordemId)).limit(1)
    )[0]!;

    await run(() => expireOverdueQuotes());

    const depois = (
      await getDb().select().from(serviceOrders).where(eq(serviceOrders.id, ordemId)).limit(1)
    )[0]!;

    // O prazo comercial venceu; o aparelho continua na bancada.
    expect(depois.status).toBe(antes.status);
    expect(depois.status).toBe('awaiting_approval');
    expect(depois.version).toBe(antes.version);
  });

  it('depois de expirar, cabe uma revisao', async () => {
    await run(() => expireOverdueQuotes());
    const revisao = await run(() => reviseQuote(tenant.context, quoteId));
    expect(revisao.revision).toBe(2);
    // A versao expirada permanece expirada: o prazo venceu de verdade.
    expect((await quoteRow(quoteId)).status).toBe('expired');
  });
});

describe('o que o job NAO expira', () => {
  it('orcamento SEM validade fica de fora (item 22)', async () => {
    await getDb().update(quotes).set({ validUntil: null }).where(eq(quotes.id, quoteId));
    expect((await run(() => expireOverdueQuotes())).expired).toBe(0);
  });

  it('validade no futuro fica de fora', async () => {
    await getDb().update(quotes).set({ validUntil: '2099-01-01' }).where(eq(quotes.id, quoteId));
    expect((await run(() => expireOverdueQuotes())).expired).toBe(0);
  });

  it('vence HOJE ainda nao venceu: o prazo vale o dia inteiro', async () => {
    const hoje = todayIn(tenant.context.tenantTimezone);
    await getDb().update(quotes).set({ validUntil: hoje }).where(eq(quotes.id, quoteId));
    expect((await run(() => expireOverdueQuotes())).expired).toBe(0);
  });

  it('rascunho nao expira: so o que foi proposto ao cliente tem prazo', async () => {
    await getDb().update(quotes).set({ status: 'draft' }).where(eq(quotes.id, quoteId));
    expect((await run(() => expireOverdueQuotes())).expired).toBe(0);
  });

  it('ja aprovado nao expira: a decisao da pessoa vence a do relogio', async () => {
    await getDb()
      .update(quotes)
      .set({ status: 'approved', activeMarker: null, approvedMarker: 1 })
      .where(eq(quotes.id, quoteId));

    expect((await run(() => expireOverdueQuotes())).expired).toBe(0);
    expect((await quoteRow(quoteId)).status).toBe('approved');
  });

  it('empresa inativa nao e varrida', async () => {
    await getDb()
      .update(tenants)
      .set({ status: 'suspended' })
      .where(eq(tenants.id, tenant.tenantId));
    const resultado = await run(() => expireOverdueQuotes());
    expect(resultado.tenants).toBe(0);
    expect(resultado.expired).toBe(0);
  });
});

describe('cada empresa no SEU fuso', () => {
  it('o dia civil usado e o da empresa, nao o do servidor', async () => {
    await getDb()
      .update(tenants)
      .set({ timezone: 'Pacific/Honolulu' })
      .where(eq(tenants.id, tenant.tenantId));

    const agora = new Date();
    const hojeEmKiritimati = todayIn('Pacific/Kiritimati', agora);
    const hojeEmHonolulu = todayIn('Pacific/Honolulu', agora);

    // Ontem em Kiritimati pode ainda ser hoje em Honolulu: 24h de diferenca.
    await getDb()
      .update(quotes)
      .set({ validUntil: hojeEmKiritimati })
      .where(eq(quotes.id, quoteId));

    const resultado = await run(() => expireOverdueQuotes(agora));
    expect(resultado.expired).toBe(hojeEmKiritimati < hojeEmHonolulu ? 1 : 0);
  });
});

describe('registro do job (item 24)', () => {
  it('esta registrado com periodicidade declarada', () => {
    expect(listJobNames()).toContain('quote.expire-overdue');
    expect(findJobHandler('quote.expire-overdue')).toBeDefined();
    expect(RECURRING_JOBS.find((job) => job.name === 'quote.expire-overdue')?.everyMinutes).toBe(
      60,
    );
  });

  it('rodar pelo executor produz o mesmo efeito', async () => {
    const handler = findJobHandler('quote.expire-overdue');
    const resultado = await run(() =>
      handler!.handle(undefined as never, {
        jobId: 'teste',
        attempt: 1,
        correlationId: 'teste',
        tenantId: null,
      }),
    );

    expect(resultado).toMatchObject({ affected: 1 });
    expect(await eventosExpirados()).toHaveLength(1);
  });
});

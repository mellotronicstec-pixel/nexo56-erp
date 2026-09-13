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
import { sweepOverdueFollowUps } from '@/modules/service-orders/application/follow-up-job';
import { rescheduleFollowUp } from '@/modules/service-orders/application/service-order-actions';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { tenants } from '@/modules/tenancy/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * VARREDURA DE FOLLOW-UPS VENCIDOS (Prompt 08, itens 44 a 46 e 100 a 103).
 *
 * O QUE ESTE JOB E: um emissor de EVENTO, uma vez por prazo vencido.
 * O QUE ELE NAO E: o canal que avisa alguem (nao existe — Prompt 16), nem a
 * fonte das pendencias da tela (que consulta o banco direto).
 *
 * A idempotencia e o ponto sensivel: rodando de hora em hora, o job passa
 * varias vezes pela mesma ordem vencida. Um evento por passagem entupiria o
 * outbox e, quando houvesse canal, mandaria o mesmo aviso vinte vezes.
 */

let tenant: TenantFixture;
let ordemId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

async function abrirOrdem(fixture: TenantFixture): Promise<string> {
  const customerId = (
    await run(() =>
      createCustomer(fixture.context, {
        kind: 'individual',
        name: 'Cliente do acompanhamento',
        contacts: [{ type: 'phone', value: '11988887777', isWhatsapp: false }],
      }),
    )
  ).customerId;

  const equipmentId = (
    await run(() => createEquipment(fixture.context, { customerId, kind: 'Televisor' }))
  ).equipmentId;

  return (
    await run(() =>
      createServiceOrder(fixture.context, { equipmentId, customerReport: 'Nao liga.' }),
    )
  ).serviceOrderId;
}

async function eventosDeVencimento() {
  return getDb()
    .select()
    .from(domainEvents)
    .where(eq(domainEvents.type, 'SERVICE_ORDER_FOLLOW_UP_OVERDUE'));
}

async function ordemDe(id: string) {
  const [row] = await getDb().select().from(serviceOrders).where(eq(serviceOrders.id, id)).limit(1);
  return row!;
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
  tenant = await createTenantFixture('fu-job', planId);
  ordemId = await abrirOrdem(tenant);
});

describe('o que o job marca', () => {
  it('marca a ordem vencida e publica UM evento', async () => {
    await run(() => rescheduleFollowUp(tenant.context, ordemId, { followUpAt: '2020-01-01' }));

    const resultado = await run(() => sweepOverdueFollowUps());
    expect(resultado.flagged).toBe(1);

    const ordem = await ordemDe(ordemId);
    expect(ordem.followUpAlertedFor).toBe('2020-01-01');

    const eventos = await eventosDeVencimento();
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.payload).toMatchObject({ serviceOrderId: ordemId });
  });

  it('rodar de novo NAO emite um segundo evento (item 101)', async () => {
    await run(() => rescheduleFollowUp(tenant.context, ordemId, { followUpAt: '2020-01-01' }));

    await run(() => sweepOverdueFollowUps());
    const segunda = await run(() => sweepOverdueFollowUps());
    const terceira = await run(() => sweepOverdueFollowUps());

    expect(segunda.flagged).toBe(0);
    expect(terceira.flagged).toBe(0);
    expect(await eventosDeVencimento()).toHaveLength(1);
  });

  it('duas execucoes SIMULTANEAS produzem um evento so', async () => {
    await run(() => rescheduleFollowUp(tenant.context, ordemId, { followUpAt: '2020-01-01' }));

    // A condicao vai no proprio WHERE do UPDATE: a segunda nao acha linha.
    await Promise.all([run(() => sweepOverdueFollowUps()), run(() => sweepOverdueFollowUps())]);

    expect(await eventosDeVencimento()).toHaveLength(1);
  });

  it('prazo NOVO merece alerta NOVO', async () => {
    await run(() => rescheduleFollowUp(tenant.context, ordemId, { followUpAt: '2020-01-01' }));
    await run(() => sweepOverdueFollowUps());

    // Reagendar limpa a marca; o novo prazo tambem ja esta vencido.
    await run(() => rescheduleFollowUp(tenant.context, ordemId, { followUpAt: '2020-06-01' }));
    expect((await ordemDe(ordemId)).followUpAlertedFor).toBeNull();

    const resultado = await run(() => sweepOverdueFollowUps());
    expect(resultado.flagged).toBe(1);
    expect(await eventosDeVencimento()).toHaveLength(2);
  });

  it('prazo que vence HOJE ja conta como vencido', async () => {
    const hoje = todayIn(tenant.context.tenantTimezone);
    await run(() => rescheduleFollowUp(tenant.context, ordemId, { followUpAt: hoje }));

    const resultado = await run(() => sweepOverdueFollowUps());
    expect(resultado.flagged).toBe(1);
  });
});

describe('o que o job NAO marca', () => {
  it('ordem com prazo no futuro fica de fora', async () => {
    await run(() => rescheduleFollowUp(tenant.context, ordemId, { followUpAt: '2099-01-01' }));

    const resultado = await run(() => sweepOverdueFollowUps());
    expect(resultado.flagged).toBe(0);
    expect(await eventosDeVencimento()).toHaveLength(0);
  });

  it('ordem sem acompanhamento fica de fora', async () => {
    await run(() => rescheduleFollowUp(tenant.context, ordemId, { followUpAt: '' }));

    expect((await run(() => sweepOverdueFollowUps())).flagged).toBe(0);
  });

  it('ordem finalizada ou cancelada fica de fora (itens 127 e 128)', async () => {
    await run(() => rescheduleFollowUp(tenant.context, ordemId, { followUpAt: '2020-01-01' }));

    // A transicao para terminal ja limpa o prazo; forcamos o pior caso: uma
    // ordem terminal que ainda carrega um prazo antigo no banco.
    await getDb()
      .update(serviceOrders)
      .set({ status: 'cancelled', followUpAt: '2020-01-01' })
      .where(eq(serviceOrders.id, ordemId));

    expect((await run(() => sweepOverdueFollowUps())).flagged).toBe(0);
    expect(await eventosDeVencimento()).toHaveLength(0);
  });

  it('empresa inativa nao e varrida', async () => {
    await run(() => rescheduleFollowUp(tenant.context, ordemId, { followUpAt: '2020-01-01' }));
    await getDb()
      .update(tenants)
      .set({ status: 'suspended' })
      .where(eq(tenants.id, tenant.tenantId));

    const resultado = await run(() => sweepOverdueFollowUps());
    expect(resultado.tenants).toBe(0);
    expect(resultado.flagged).toBe(0);
  });
});

describe('cada empresa no SEU fuso (itens 46 e 103)', () => {
  it('o dia civil usado e o da empresa, nao o do servidor', async () => {
    /**
     * Em Kiritimati (UTC+14) o dia ja virou quando em Honolulu (UTC-10) ainda
     * e o dia anterior — 24 horas de diferenca. Um prazo marcado para o "hoje"
     * de Kiritimati ainda nao venceu para uma empresa em Honolulu.
     */
    await getDb()
      .update(tenants)
      .set({ timezone: 'Pacific/Honolulu' })
      .where(eq(tenants.id, tenant.tenantId));

    const agora = new Date();
    const hojeEmKiritimati = todayIn('Pacific/Kiritimati', agora);
    const hojeEmHonolulu = todayIn('Pacific/Honolulu', agora);

    await getDb()
      .update(serviceOrders)
      .set({ followUpAt: hojeEmKiritimati })
      .where(eq(serviceOrders.id, ordemId));

    const resultado = await run(() => sweepOverdueFollowUps(agora));

    // Se as datas coincidirem no instante do teste, vence nos dois; quando
    // diferem, Honolulu ainda nao chegou la.
    expect(resultado.flagged).toBe(hojeEmKiritimati === hojeEmHonolulu ? 1 : 0);
  });
});

describe('registro do job (item 45)', () => {
  it('o job esta registrado e tem periodicidade declarada, nao cron espalhado', () => {
    expect(listJobNames()).toContain('service-order.follow-up-sweep');
    expect(findJobHandler('service-order.follow-up-sweep')).toBeDefined();

    const agendado = RECURRING_JOBS.find((job) => job.name === 'service-order.follow-up-sweep');
    // De hora em hora: empresas viram a data em horas diferentes.
    expect(agendado?.everyMinutes).toBe(60);
  });

  it('rodar pelo executor de jobs produz o mesmo efeito', async () => {
    await run(() => rescheduleFollowUp(tenant.context, ordemId, { followUpAt: '2020-01-01' }));

    const handler = findJobHandler('service-order.follow-up-sweep');
    const resultado = await run(() =>
      handler!.handle(undefined as never, {
        jobId: 'teste',
        attempt: 1,
        correlationId: 'teste',
        tenantId: null,
      }),
    );

    expect(resultado).toMatchObject({ affected: 1 });
    expect(await eventosDeVencimento()).toHaveLength(1);
  });
});

describe('a transicao alimenta o job', () => {
  it('ir para Aguardando Conserto agenda +3 dias, e esse prazo nao esta vencido hoje', async () => {
    await run(() =>
      transitionServiceOrder(tenant.context, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
    );

    expect((await run(() => sweepOverdueFollowUps())).flagged).toBe(0);
  });
});

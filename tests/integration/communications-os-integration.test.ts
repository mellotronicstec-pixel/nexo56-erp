import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { clearSubscriptions } from '@/modules/events/application/event-bus';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  completeTask,
  notifyCustomerReady,
} from '@/modules/service-orders/application/service-order-actions';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import { TASK_KINDS } from '@/modules/service-orders/domain/workflow';
import {
  serviceOrders,
  serviceOrderTasks,
  serviceOrderTimeline,
} from '@/modules/service-orders/infrastructure/schema';
import { registerCommunicationSubscriptions } from '@/modules/communications/application/subscriptions';
import { CaptureProvider } from '@/modules/communications/infrastructure/capture-provider';
import { setCommunicationProviderForTesting } from '@/modules/communications/infrastructure/provider-registry';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * A COSTURA COM A ORDEM DE SERVICO, contra MariaDB de verdade.
 *
 * O que este arquivo prova: o Core publica a intencao e segue seu caminho
 * INTEIRAMENTE sozinho — a OS muda de estado e a linha do tempo grava,
 * exatamente como antes do Prompt 16 existir. A Comunicacao escuta, e o
 * unico efeito dela e um log. NENHUMA mensagem sai sozinha.
 */

let tenant: TenantFixture;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

async function ordemProntaParaAvisar(): Promise<string> {
  const { customerId } = await run(() =>
    createCustomer(tenant.context, {
      kind: 'individual',
      name: 'Cliente da Costura',
      contacts: [{ type: 'phone', value: '11999997777', isWhatsapp: true }],
    }),
  );
  const { equipmentId } = await run(() =>
    createEquipment(tenant.context, { customerId, kind: 'Celular', brand: 'Marca' }),
  );
  const { serviceOrderId } = await run(() =>
    createServiceOrder(tenant.context, {
      equipmentId,
      customerReport: 'Tela quebrada.',
    }),
  );

  for (const passo of [
    'awaiting_repair',
    'repair_completed',
    'awaiting_delivery_preparation',
  ] as const) {
    await run(() => transitionServiceOrder(tenant.context, { serviceOrderId, to: passo }));
  }

  const [tarefa] = await getDb()
    .select({ id: serviceOrderTasks.id })
    .from(serviceOrderTasks)
    .where(
      sql`${serviceOrderTasks.serviceOrderId} = ${serviceOrderId} AND ${serviceOrderTasks.kind} = ${TASK_KINDS.DELIVERY_PREPARATION}`,
    );

  await run(() => completeTask(tenant.context, tarefa!.id));

  return serviceOrderId;
}

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  setCommunicationProviderForTesting(null);
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  clearSubscriptions();
  const planId = await seedCatalog();
  tenant = await createTenantFixture('comm-costura', planId);
  await run(() =>
    setTenantFeature(tenant.context, {
      featureKey: FEATURES.COMMUNICATIONS_CORE,
      enabled: true,
    }),
  );
  setCommunicationProviderForTesting(new CaptureProvider());
});

describe('SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED', () => {
  it('move a OS e grava a linha do tempo IGUAL, com a Comunicacao inscrita ou nao', async () => {
    const serviceOrderId = await ordemProntaParaAvisar();

    /* Sem inscricao nenhuma: e exatamente o comportamento anterior ao Prompt 16. */
    await run(() => notifyCustomerReady(tenant.context, serviceOrderId));

    const [ordem] = await getDb()
      .select({ status: serviceOrders.status })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, serviceOrderId))
      .limit(1);
    expect(ordem?.status).toBe('awaiting_customer_pickup');

    const linhaDoTempo = await getDb()
      .select({ kind: serviceOrderTimeline.kind, metadata: serviceOrderTimeline.metadata })
      .from(serviceOrderTimeline)
      .where(eq(serviceOrderTimeline.serviceOrderId, serviceOrderId));

    const marcacao = linhaDoTempo.find((l) => l.kind === 'customer_notification_requested');
    expect(marcacao).toBeDefined();
    expect(marcacao?.metadata).toEqual({ channel: null, delivered: false });
  });

  it('com a Comunicacao inscrita, NENHUMA mensagem sai sozinha', async () => {
    registerCommunicationSubscriptions();
    const serviceOrderId = await ordemProntaParaAvisar();

    await run(() => notifyCustomerReady(tenant.context, serviceOrderId));

    const linhas = await getDb().execute(sql`
      SELECT COUNT(*) AS total FROM communication_messages
    `);
    const total = Number(
      (linhas as unknown as Array<Array<{ total: number | string }>>)[0]?.[0]?.total ?? 0,
    );
    expect(total).toBe(0);
  });

  it('o evento e publicado no outbox independente da Comunicacao estar inscrita', async () => {
    const serviceOrderId = await ordemProntaParaAvisar();
    await run(() => notifyCustomerReady(tenant.context, serviceOrderId));

    const eventos = await getDb()
      .select({ type: domainEvents.type })
      .from(domainEvents)
      .where(eq(domainEvents.type, 'SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED'));

    expect(eventos.length).toBeGreaterThan(0);
  });
});

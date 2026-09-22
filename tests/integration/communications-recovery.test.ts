import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { createMessage } from '@/modules/communications/application/message-service';
import { findMessage } from '@/modules/communications/application/message-queries';
import { sweepStuckMessages } from '@/modules/communications/application/stuck-message-job';
import { CaptureProvider } from '@/modules/communications/infrastructure/capture-provider';
import { setCommunicationProviderForTesting } from '@/modules/communications/infrastructure/provider-registry';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * O JOB DE RECUPERACAO (itens 46, 50 e 51).
 *
 * Prova as duas metades da mesma decisao: uma `queued` orfa e segura para
 * tentar de novo; uma `sending` orfa NAO E — porque ninguem sabe se o
 * provedor ja aceitou antes do processo cair.
 */

let tenant: TenantFixture;
let captura: CaptureProvider;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

async function montarCenario(): Promise<{ customerId: string; telefone: string }> {
  const telefone = '11999998888';
  const { customerId } = await run(() =>
    createCustomer(tenant.context, {
      kind: 'individual',
      name: 'Cliente Recuperacao',
      contacts: [{ type: 'phone', value: telefone, isWhatsapp: true }],
    }),
  );
  return { customerId, telefone };
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
  const planId = await seedCatalog();
  tenant = await createTenantFixture('comm-recovery', planId);
  await run(() =>
    setTenantFeature(tenant.context, {
      featureKey: FEATURES.COMMUNICATIONS_CORE,
      enabled: true,
    }),
  );
  captura = new CaptureProvider();
  setCommunicationProviderForTesting(captura);
});

describe('mensagem `queued` abandonada', () => {
  it('e tentada com seguranca pelo job', async () => {
    const cenario = await montarCenario();
    const { messageId } = await run(() =>
      createMessage(tenant.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem que ficou parada.',
      }),
    );

    /* `createMessage` ja processou; volta ao estado que o job encontraria. */
    const antiga = new Date(Date.now() - 20 * 60_000);
    await getDb().execute(sql`
      UPDATE communication_messages
         SET status = 'queued', attempt_count = 0, sent_at = NULL,
             sent_provider = NULL, provider_message_id = NULL, created_at = ${antiga}
       WHERE id = ${messageId}
    `);
    await getDb().execute(sql`DELETE FROM communication_attempts WHERE message_id = ${messageId}`);
    captura.reset();

    const resultado = await sweepStuckMessages(10);
    expect(resultado.processed).toBe(1);

    const mensagem = await run(() => findMessage(tenant.context, messageId));
    expect(mensagem.status).toBe('sent');
  });

  it('nao toca em `queued` recente — a janela util nao mexe em envio em curso', async () => {
    const cenario = await montarCenario();
    const { messageId } = await run(() =>
      createMessage(tenant.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem recente.',
      }),
    );
    await getDb().execute(sql`
      UPDATE communication_messages SET status = 'queued', attempt_count = 0, sent_at = NULL
       WHERE id = ${messageId}
    `);
    captura.reset();

    const resultado = await sweepStuckMessages(10);
    expect(resultado.processed).toBe(0);

    const mensagem = await run(() => findMessage(tenant.context, messageId));
    expect(mensagem.status).toBe('queued');
  });
});

describe('mensagem `sending` abandonada', () => {
  it('vira falha explicita, e NUNCA e reprocessada automaticamente', async () => {
    const cenario = await montarCenario();
    const { messageId } = await run(() =>
      createMessage(tenant.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem interrompida no meio do envio.',
      }),
    );

    const antiga = new Date(Date.now() - 20 * 60_000);
    await getDb().execute(sql`
      UPDATE communication_messages
         SET status = 'sending', sent_at = NULL, sent_provider = NULL,
             provider_message_id = NULL, updated_at = ${antiga}
       WHERE id = ${messageId}
    `);
    captura.reset();

    const resultado = await sweepStuckMessages(10);
    expect(resultado.abandoned).toBe(1);
    expect(resultado.processed).toBe(0);

    const mensagem = await run(() => findMessage(tenant.context, messageId));
    expect(mensagem.status).toBe('failed');
    expect(mensagem.lastErrorCode).toBe('unknown');

    /*
      NENHUMA tentativa nova foi feita: o provedor de captura continua vazio.
      Reprocessar automaticamente uma `sending` orfa arrisca mandar a mensagem
      pela segunda vez para um cliente que ja a recebeu.
    */
    expect(captura.messages()).toHaveLength(0);
  });

  it('nao toca em `sending` recente — o envio pode estar em curso de verdade', async () => {
    const cenario = await montarCenario();
    const { messageId } = await run(() =>
      createMessage(tenant.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem em processamento agora.',
      }),
    );
    /* `sent_at` some junto: o CHECK do banco exige isso fora do estado `sent`. */
    await getDb().execute(sql`
      UPDATE communication_messages
         SET status = 'sending', sent_at = NULL, sent_provider = NULL, provider_message_id = NULL
       WHERE id = ${messageId}
    `);

    const resultado = await sweepStuckMessages(10);
    expect(resultado.abandoned).toBe(0);

    const linhas = await getDb().execute(sql`
      SELECT status FROM communication_messages WHERE id = ${messageId}
    `);
    expect((linhas as unknown as Array<Array<{ status: string }>>)[0]?.[0]?.status).toBe('sending');
  });
});

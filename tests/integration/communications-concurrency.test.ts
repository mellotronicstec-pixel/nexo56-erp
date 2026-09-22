import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  createMessage,
  processMessage,
  retryMessage,
} from '@/modules/communications/application/message-service';
import { findMessage } from '@/modules/communications/application/message-queries';
import { CaptureProvider } from '@/modules/communications/infrastructure/capture-provider';
import { setCommunicationProviderForTesting } from '@/modules/communications/infrastructure/provider-registry';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * CONCORRENCIA DE VERDADE (itens 44 a 49, 96).
 *
 * Sem mock, sem relogio falso, sem simulacao: disputa o MESMO registro no
 * MESMO banco, em paralelo. E aqui que se prova — ou se derruba — cada frase
 * "exatamente uma vez" ou "seguro contra concorrencia" do relatorio final.
 */

let tenant: TenantFixture;
let captura: CaptureProvider;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

async function montarCenario(): Promise<{ customerId: string; telefone: string }> {
  const telefone = '11999998888';
  const { customerId } = await run(() =>
    createCustomer(tenant.context, {
      kind: 'individual',
      name: 'Cliente Concorrencia',
      contacts: [{ type: 'phone', value: telefone, isWhatsapp: true }],
    }),
  );
  return { customerId, telefone };
}

function contar(resultados: PromiseSettledResult<unknown>[]) {
  return {
    ganhou: resultados.filter((r) => r.status === 'fulfilled').length,
    perdeu: resultados.filter((r) => r.status === 'rejected').length,
  };
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
  tenant = await createTenantFixture('comm-concurrency', planId);
  await run(() =>
    setTenantFeature(tenant.context, {
      featureKey: FEATURES.COMMUNICATIONS_CORE,
      enabled: true,
    }),
  );
  captura = new CaptureProvider();
  setCommunicationProviderForTesting(captura);
});

describe('cinco criacoes com a mesma chave de intencao', () => {
  it('produzem UMA mensagem so, mesmo disparadas ao mesmo tempo', async () => {
    const cenario = await montarCenario();
    const chave = 'clique-quintuplo';

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() =>
          createMessage(tenant.context, {
            customerId: cenario.customerId,
            channel: 'sms',
            contactValue: cenario.telefone,
            body: 'Mensagem disputada.',
            idempotencyKey: chave,
          }),
        ),
      ),
    );

    /*
      A trava e a UNIQUE(tenant_id, idempotency_key) do banco, nao um SELECT
      antes do INSERT: as cinco chegam a mesma conclusao mesmo que nenhuma
      delas veja a outra antes de escrever.
    */
    const sucessos = resultados.filter(
      (r): r is PromiseFulfilledResult<{ messageId: string; reused: boolean }> =>
        r.status === 'fulfilled',
    );
    expect(sucessos).toHaveLength(5);

    const ids = new Set(sucessos.map((r) => r.value.messageId));
    expect(ids.size).toBe(1);

    const linhas = await getDb().execute(sql`
      SELECT COUNT(*) AS total FROM communication_messages
       WHERE tenant_id = ${tenant.tenantId} AND idempotency_key = ${chave}
    `);
    const total = Number(
      (linhas as unknown as Array<Array<{ total: number | string }>>)[0]?.[0]?.total ?? 0,
    );
    expect(total).toBe(1);

    /* E o provedor de captura recebeu a mensagem uma unica vez. */
    expect(captura.messages()).toHaveLength(1);
  });
});

describe('cinco reivindicacoes da mesma mensagem', () => {
  it('no maximo uma processa; as outras saem sem afetar linha', async () => {
    const cenario = await montarCenario();

    const { messageId } = await run(() =>
      createMessage(tenant.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem para reivindicar.',
      }),
    );

    /*
      `createMessage` ja processa a mensagem uma vez (e ela fica `sent`, com uma
      tentativa gravada). Este teste quer o cenario que o job de recuperacao
      encontra de verdade — uma mensagem `queued` disputada por varios
      processos — entao a devolve a esse estado antes de disparar as cinco
      reivindicacoes.
    */
    await getDb().execute(sql`
      UPDATE communication_messages SET status = 'queued', attempt_count = 0, sent_at = NULL,
             sent_provider = NULL, provider_message_id = NULL
       WHERE id = ${messageId}
    `);
    await getDb().execute(sql`DELETE FROM communication_attempts WHERE message_id = ${messageId}`);
    captura.reset();

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        processMessage({ messageId, tenantId: tenant.tenantId, context: tenant.context }),
      ),
    );

    const reivindicaram = resultados.filter((r) => r.status === 'fulfilled' && r.value.claimed);
    /* O `UPDATE ... WHERE status = 'queued'` so deixa uma vencer a corrida. */
    expect(reivindicaram).toHaveLength(1);

    /* E so uma tentativa foi de fato gravada — nunca cinco. */
    const tentativas = await getDb().execute(sql`
      SELECT COUNT(*) AS total FROM communication_attempts WHERE message_id = ${messageId}
    `);
    const total = Number(
      (tentativas as unknown as Array<Array<{ total: number | string }>>)[0]?.[0]?.total ?? 0,
    );
    expect(total).toBe(1);
    expect(captura.messages()).toHaveLength(1);
  });
});

describe('reenvio concorrente', () => {
  it('so um dos dois cliques simultaneos vence', async () => {
    const cenario = await montarCenario();
    captura.failNext('timeout', 'Falhou de proposito.');

    const { messageId } = await run(() =>
      createMessage(tenant.context, {
        customerId: cenario.customerId,
        channel: 'sms',
        contactValue: cenario.telefone,
        body: 'Mensagem que vai falhar.',
      }),
    );

    const mensagem = await run(() => findMessage(tenant.context, messageId));
    expect(mensagem.status).toBe('failed');

    const resultados = await Promise.allSettled([
      run(() => retryMessage(tenant.context, messageId)),
      run(() => retryMessage(tenant.context, messageId)),
    ]);

    /*
      O `UPDATE ... WHERE status = 'failed'` do reenvio garante que o segundo
      clique encontre a mensagem ja `queued`/`sent` e seja recusado — nunca
      as duas tentativas simultaneas escrevendo por cima uma da outra.
    */
    const { ganhou } = contar(resultados);
    expect(ganhou).toBe(1);

    const final = await run(() => findMessage(tenant.context, messageId));
    /* Uma tentativa nova (a de `createMessage`, que falhou) + uma do reenvio vencedor. */
    expect(final.attempts.length).toBe(2);
  });
});

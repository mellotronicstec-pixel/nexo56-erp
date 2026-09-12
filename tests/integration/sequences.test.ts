import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runWithContext } from '@/core/context/request-context';
import { runInTransaction } from '@/core/db/unit-of-work';
import {
  allocateSequenceNumber,
  formatSequence,
  peekSequence,
  SEQUENCE_TYPES,
} from '@/modules/tenancy/application/sequence-service';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * NUMERACAO HUMANA POR TENANT (Prompt 02, itens 15, 17 e 18).
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;

async function allocate(
  tenantId: string,
  type: string = SEQUENCE_TYPES.SERVICE_ORDER,
  prefix = 'OS',
) {
  return runWithContext({ origin: 'test' }, () =>
    runInTransaction(async (tx) => allocateSequenceNumber(tx, tenantId, type, { prefix })),
  );
}

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenantA = await createTenantFixture('seq-a', planId);
  tenantB = await createTenantFixture('seq-b', planId);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('alocacao sequencial', () => {
  it('comeca em 1 e avanca de um em um', async () => {
    const first = await allocate(tenantA.tenantId);
    const second = await allocate(tenantA.tenantId);
    const third = await allocate(tenantA.tenantId);

    expect(first.value).toBe(1);
    expect(second.value).toBe(2);
    expect(third.value).toBe(3);
  });

  it('formata com prefixo e zeros a esquerda', async () => {
    const allocated = await allocate(tenantA.tenantId);
    expect(allocated.formatted).toBe('OS 000001');
  });

  it('formata corretamente numeros grandes', () => {
    expect(formatSequence(1, 'OS', 6)).toBe('OS 000001');
    expect(formatSequence(123456, 'OS', 6)).toBe('OS 123456');
    expect(formatSequence(1234567, 'OS', 6)).toBe('OS 1234567');
    expect(formatSequence(7, '', 4)).toBe('0007');
  });
});

describe('a sequencia e por tenant', () => {
  it('tenants diferentes possuem contadores independentes', async () => {
    await allocate(tenantA.tenantId);
    await allocate(tenantA.tenantId);
    const firstOfB = await allocate(tenantB.tenantId);

    expect(firstOfB.value).toBe(1);
    expect((await peekSequence(tenantA.tenantId, SEQUENCE_TYPES.SERVICE_ORDER))?.currentValue).toBe(
      2,
    );
  });

  it('NAO reinicia por unidade — o numero e unico na empresa', async () => {
    // Mesmo tenant, unidades diferentes: a sequencia continua avancando.
    const first = await allocate(tenantA.tenantId);
    const second = await allocate(tenantA.tenantId);
    expect([first.value, second.value]).toEqual([1, 2]);
  });

  it('tipos de sequencia sao independentes entre si', async () => {
    await allocate(tenantA.tenantId, SEQUENCE_TYPES.SERVICE_ORDER);
    await allocate(tenantA.tenantId, SEQUENCE_TYPES.SERVICE_ORDER);
    const quote = await allocate(tenantA.tenantId, SEQUENCE_TYPES.QUOTE, 'ORC');

    expect(quote.value).toBe(1);
    expect(quote.formatted).toBe('ORC 000001');
  });

  it('normaliza o tipo da sequencia (maiusculas nao criam contador paralelo)', async () => {
    await allocate(tenantA.tenantId, 'SERVICE_ORDER');
    const second = await allocate(tenantA.tenantId, 'service_order');
    expect(second.value).toBe(2);
  });
});

describe('concorrencia real', () => {
  it('20 alocacoes simultaneas produzem numeros unicos e sem colisao', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => allocate(tenantA.tenantId)));

    const values = results.map((result) => result.value).sort((a, b) => a - b);
    const unique = new Set(values);

    expect(unique.size).toBe(20);
    expect(values).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });

  it('concorrencia entre tenants nao mistura contadores', async () => {
    const results = await Promise.all([
      ...Array.from({ length: 10 }, () => allocate(tenantA.tenantId)),
      ...Array.from({ length: 10 }, () => allocate(tenantB.tenantId)),
    ]);

    expect(results).toHaveLength(20);
    expect((await peekSequence(tenantA.tenantId, SEQUENCE_TYPES.SERVICE_ORDER))?.currentValue).toBe(
      10,
    );
    expect((await peekSequence(tenantB.tenantId, SEQUENCE_TYPES.SERVICE_ORDER))?.currentValue).toBe(
      10,
    );
  });

  it('o contador final corresponde exatamente ao numero de alocacoes', async () => {
    await Promise.all(Array.from({ length: 15 }, () => allocate(tenantA.tenantId)));
    expect((await peekSequence(tenantA.tenantId, SEQUENCE_TYPES.SERVICE_ORDER))?.currentValue).toBe(
      15,
    );
  });
});

describe('transacao', () => {
  it('rollback do chamador nao grava o numero, mas consome o valor (lacuna aceita)', async () => {
    await allocate(tenantA.tenantId); // 1

    await expect(
      runWithContext({ origin: 'test' }, () =>
        runInTransaction(async (tx) => {
          await allocateSequenceNumber(tx, tenantA.tenantId, SEQUENCE_TYPES.SERVICE_ORDER);
          throw new Error('falha proposital do chamador');
        }),
      ),
    ).rejects.toThrow('falha proposital');

    // O incremento foi revertido junto com a transacao do chamador.
    const state = await peekSequence(tenantA.tenantId, SEQUENCE_TYPES.SERVICE_ORDER);
    expect(state?.currentValue).toBe(1);

    const next = await allocate(tenantA.tenantId);
    expect(next.value).toBe(2);
  });

  it('a sequencia pertence ao tenant informado, nunca a outro', async () => {
    await allocate(tenantA.tenantId);
    const rows = await getDb().execute(sql`SELECT tenant_id FROM tenant_sequences`);
    const list = (rows as unknown as Array<Array<{ tenant_id: string }>>)[0] ?? [];
    expect(list.every((row) => row.tenant_id === tenantA.tenantId)).toBe(true);
  });
});

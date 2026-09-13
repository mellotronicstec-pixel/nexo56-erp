import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { SEQUENCE_TYPES, peekSequence } from '@/modules/tenancy/application/sequence-service';
import { tenantSequences } from '@/modules/tenancy/infrastructure/schema';
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
 * NUMERACAO DA ORDEM DE SERVICO (Prompt 07, itens 14 a 17 e 94 a 97).
 *
 * A pergunta que estes testes respondem e uma so: duas pessoas abrindo OS ao
 * mesmo tempo, em lojas diferentes da mesma empresa, recebem numeros
 * diferentes? Se a resposta falhar aqui, ela falha no balcao — e duas ordens
 * com o mesmo numero significam dois aparelhos com a mesma etiqueta.
 *
 * Nao ha mecanismo novo de sequencia: e o `tenant_sequences` do Prompt 02
 * (item 14), com o idioma atomico `LAST_INSERT_ID` que ja foi testado sob
 * concorrencia la. O que se testa aqui e o uso dele pela OS.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let equipamentoA: string;
let equipamentoB: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

/**
 * Concatena mensagem e causas do erro.
 *
 * O Drizzle embrulha o erro do driver em "Failed query: ...", entao o codigo
 * real do MySQL (`ER_DUP_ENTRY`, 1062) so aparece descendo a cadeia de
 * `cause`. Sem isso o teste passaria com qualquer falha, inclusive uma de
 * sintaxe — e nao e falhar que se quer provar, e falhar PELA restricao.
 */
function causesOf(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const candidate = current as { message?: string; code?: string; cause?: unknown };
    if (candidate.message) parts.push(candidate.message);
    if (candidate.code) parts.push(candidate.code);
    current = candidate.cause;
  }
  return parts.join(' | ');
}

const clienteBase = {
  kind: 'individual' as const,
  name: 'Cliente Numeracao',
  contacts: [{ type: 'phone' as const, value: '11988887777', isWhatsapp: false }],
};

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenantA = await createTenantFixture('seq-a', planId);
  tenantB = await createTenantFixture('seq-b', planId);

  const clienteA = (await run(() => createCustomer(tenantA.context, clienteBase))).customerId;
  const clienteB = (await run(() => createCustomer(tenantB.context, clienteBase))).customerId;

  equipamentoA = (
    await run(() => createEquipment(tenantA.context, { customerId: clienteA, kind: 'Televisor' }))
  ).equipmentId;
  equipamentoB = (
    await run(() => createEquipment(tenantB.context, { customerId: clienteB, kind: 'Televisor' }))
  ).equipmentId;
});

function abrir(context: TenantFixture['context'], equipmentId: string, extra = {}) {
  return run(() =>
    createServiceOrder(context, { equipmentId, customerReport: 'Nao liga.', ...extra }),
  );
}

// ---------------------------------------------------------------------------

describe('reutilizacao do tenant_sequences (itens 14 e 16)', () => {
  it('usa a sequencia `service_order`, sem criar um segundo mecanismo', async () => {
    await abrir(tenantA.context, equipamentoA);

    const sequencia = await peekSequence(tenantA.tenantId, SEQUENCE_TYPES.SERVICE_ORDER);
    expect(sequencia).toEqual({ currentValue: 1, prefix: 'OS', padding: 6 });

    // Nenhuma outra linha de sequencia foi inventada para a OS.
    const linhas = await getDb()
      .select({ type: tenantSequences.sequenceType })
      .from(tenantSequences)
      .where(eq(tenantSequences.tenantId, tenantA.tenantId));
    expect(linhas.map((l) => l.type)).toEqual(['service_order']);
  });

  it('a numeracao comeca em 1 e avanca de um em um', async () => {
    const numeros: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      numeros.push((await abrir(tenantA.context, equipamentoA)).number);
    }
    expect(numeros).toEqual([1, 2, 3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------

describe('concorrencia (item 94)', () => {
  it('20 aberturas SIMULTANEAS produzem 20 numeros distintos', async () => {
    const resultados = await Promise.all(
      Array.from({ length: 20 }, () => abrir(tenantA.context, equipamentoA)),
    );

    const numeros = resultados.map((r) => r.number);
    expect(new Set(numeros).size).toBe(20);
    // A sequencia comeca em 1 e nao pula sob esta carga.
    expect([...numeros].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('o banco nao aceita duas ordens com o mesmo numero na empresa (item 106)', async () => {
    await abrir(tenantA.context, equipamentoA);

    const erro = await getDb()
      .execute(
        sql`INSERT INTO service_orders
              (id, tenant_id, unit_id, number, customer_id, equipment_id,
               status, customer_report, opened_at, created_at, updated_at)
            SELECT 'so-numero-repetido', tenant_id, unit_id, number, customer_id, equipment_id,
                   status, customer_report, NOW(3), NOW(3), NOW(3)
              FROM service_orders LIMIT 1`,
      )
      .catch((e: unknown) => e);

    expect(causesOf(erro)).toMatch(/duplicate|1062|ER_DUP_ENTRY/i);
  });

  it('as ordens criadas em paralelo existem todas, uma por numero', async () => {
    await Promise.all(Array.from({ length: 10 }, () => abrir(tenantA.context, equipamentoA)));

    const [agregado] = await getDb()
      .select({
        total: sql<number>`count(*)`,
        distintos: sql<number>`count(distinct number)`,
      })
      .from(serviceOrders)
      .where(eq(serviceOrders.tenantId, tenantA.tenantId));

    expect(Number(agregado!.total)).toBe(10);
    expect(Number(agregado!.distintos)).toBe(10);
  });
});

// ---------------------------------------------------------------------------

describe('sequencias independentes por TENANT (item 95)', () => {
  it('cada empresa tem a sua contagem', async () => {
    await abrir(tenantA.context, equipamentoA);
    await abrir(tenantA.context, equipamentoA);
    const primeiraB = await abrir(tenantB.context, equipamentoB);

    expect(primeiraB.number).toBe(1);
    expect((await peekSequence(tenantA.tenantId, SEQUENCE_TYPES.SERVICE_ORDER))?.currentValue).toBe(
      2,
    );
    expect((await peekSequence(tenantB.tenantId, SEQUENCE_TYPES.SERVICE_ORDER))?.currentValue).toBe(
      1,
    );
  });

  it('concorrencia cruzada entre tenants nao mistura as contagens', async () => {
    await Promise.all([
      ...Array.from({ length: 8 }, () => abrir(tenantA.context, equipamentoA)),
      ...Array.from({ length: 8 }, () => abrir(tenantB.context, equipamentoB)),
    ]);

    for (const fixture of [tenantA, tenantB]) {
      const numeros = await getDb()
        .select({ number: serviceOrders.number })
        .from(serviceOrders)
        .where(eq(serviceOrders.tenantId, fixture.tenantId));

      expect(numeros).toHaveLength(8);
      expect([...numeros.map((n) => n.number)].sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ]);
    }
  });
});

// ---------------------------------------------------------------------------

describe('sequencia COMPARTILHADA entre unidades do mesmo tenant (itens 15 e 96)', () => {
  it('a unidade A abre a 1 e a unidade B abre a 2 — nunca duas "OS 1"', async () => {
    const unidadeNorte = await createUnit(tenantA.tenantId, 'Norte');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, unidadeNorte);
    const naNorte = await contextFor(tenantA.tenantId, tenantA.adminUserId, unidadeNorte);

    const primeira = await abrir(tenantA.context, equipamentoA);
    const segunda = await abrir(naNorte, equipamentoA);

    expect(primeira.number).toBe(1);
    expect(segunda.number).toBe(2);

    // E cada uma ficou na sua unidade.
    const linhas = await getDb()
      .select({ number: serviceOrders.number, unitId: serviceOrders.unitId })
      .from(serviceOrders)
      .where(eq(serviceOrders.tenantId, tenantA.tenantId));

    expect(linhas.find((l) => l.number === 1)!.unitId).toBe(tenantA.unitId);
    expect(linhas.find((l) => l.number === 2)!.unitId).toBe(unidadeNorte);
  });

  it('aberturas simultaneas em DUAS unidades nao colidem', async () => {
    const unidadeNorte = await createUnit(tenantA.tenantId, 'Norte 2');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, unidadeNorte);
    const naNorte = await contextFor(tenantA.tenantId, tenantA.adminUserId, unidadeNorte);

    const resultados = await Promise.all([
      ...Array.from({ length: 6 }, () => abrir(tenantA.context, equipamentoA)),
      ...Array.from({ length: 6 }, () => abrir(naNorte, equipamentoA)),
    ]);

    const numeros = resultados.map((r) => r.number);
    expect(new Set(numeros).size).toBe(12);
    expect([...numeros].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });
});

// ---------------------------------------------------------------------------

describe('lacunas (item 17)', () => {
  it('a transacao que falha devolve o numero — nao sobra documento fantasma', async () => {
    await abrir(tenantA.context, equipamentoA);

    // Equipamento inexistente: a criacao falha ANTES de abrir a transacao.
    await expect(abrir(tenantA.context, '00000000-0000-7000-8000-000000000000')).rejects.toThrow();

    const segunda = await abrir(tenantA.context, equipamentoA);
    expect(segunda.number).toBe(2);

    const [agregado] = await getDb()
      .select({ total: sql<number>`count(*)` })
      .from(serviceOrders)
      .where(eq(serviceOrders.tenantId, tenantA.tenantId));
    expect(Number(agregado!.total)).toBe(2);
  });
});

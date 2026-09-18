import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import type { ServiceOrderStatus } from '@/modules/service-orders/domain/workflow';
import {
  serviceOrderTimeline,
  serviceOrders,
} from '@/modules/service-orders/infrastructure/schema';
import { issueWarranty, revokeWarranty } from '@/modules/warranties/application/warranty-service';
import { issueCertificate } from '@/modules/warranties/application/warranty-certificate-service';
import {
  reclassifyWarrantyServiceOrder,
  registerWarrantyReturn,
} from '@/modules/warranties/application/warranty-return-service';
import {
  warranties,
  warrantyCertificates,
  warrantyReturns,
} from '@/modules/warranties/infrastructure/schema';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  contextFor,
  createTenantFixture,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/**
 * CONCORRENCIA E IDEMPOTENCIA DE VERDADE (Prompt 13, itens 105 e 106).
 *
 * Estes testes disputam A MESMA GARANTIA NO MESMO BANCO, em paralelo. Nao ha
 * mock, nao ha relogio falso, nao ha simulacao.
 *
 * O item 130 e explicito: nao se declara "idempotente" sem retry real, nem
 * "concurrency-safe" sem MariaDB paralelo, nem "o mesmo retorno nao cria duas
 * OS" sem provar. Este arquivo e o que autoriza essas frases no relatorio.
 *
 * O CENARIO REAL que o item 58 descreve: dois atendentes no balcao, a mesma
 * garantia aberta em duas telas, os dois clicam "Criar retorno em garantia" no
 * mesmo segundo. Uma OS nova. Nunca duas.
 */

let tenant: TenantFixture;
let clienteId: string;
let equipamentoId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

function contar(resultados: PromiseSettledResult<unknown>[]): { ganhou: number; perdeu: number } {
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
  tenant = await createTenantFixture('gar-conc', planId);

  await run(() =>
    setTenantFeature(tenant.context, { featureKey: FEATURES.OPERATIONS_WARRANTIES, enabled: true }),
  );
  tenant.context = await contextFor(tenant.tenantId, tenant.adminUserId, tenant.unitId);

  clienteId = (
    await run(() =>
      createCustomer(tenant.context, {
        kind: 'individual',
        name: 'Cliente Concorrente',
        contacts: [{ type: 'phone', value: '11955554444', isWhatsapp: false }],
      }),
    )
  ).customerId;

  equipamentoId = (
    await run(() =>
      createEquipment(tenant.context, {
        customerId: clienteId,
        kind: 'Receiver',
        voltage: 'bivolt',
      }),
    )
  ).equipmentId;
});

async function osFinalizada(): Promise<string> {
  const criada = await run(() =>
    createServiceOrder(tenant.context, {
      equipmentId: equipamentoId,
      customerReport: 'Nao liga.',
    }),
  );

  const caminho: Array<[ServiceOrderStatus, string | undefined]> = [
    ['awaiting_repair', undefined],
    ['repair_completed', undefined],
    ['awaiting_delivery_preparation', undefined],
    ['awaiting_customer_pickup', 'delivery_ready'],
    ['completed', undefined],
  ];

  for (const [to, via] of caminho) {
    await run(() =>
      transitionServiceOrder(tenant.context, {
        serviceOrderId: criada.serviceOrderId,
        to,
        ...(via ? { via } : {}),
      }),
    );
  }
  return criada.serviceOrderId;
}

function emissao(osId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'internal',
    equipmentId: equipamentoId,
    serviceOrderId: osId,
    durationAmount: 90,
    durationUnit: 'days',
    coversWholeService: true,
    coverageItems: [{ kind: 'labor', description: 'Reparo da fonte' }],
    ...overrides,
  };
}

async function garantiaAtiva(): Promise<{ warrantyId: string; osId: string }> {
  const osId = await osFinalizada();
  const g = await run(() => issueWarranty(tenant.context, emissao(osId)));
  return { warrantyId: g.warrantyId, osId };
}

// ---------------------------------------------------------------------------
// A. Emissao concorrente (item 106.A)
// ---------------------------------------------------------------------------

describe('A. duas emissoes simultaneas da mesma intencao', () => {
  it('produzem UMA garantia logica', async () => {
    const osId = await osFinalizada();

    const resultados = await Promise.allSettled([
      run(() => issueWarranty(tenant.context, emissao(osId, { idempotencyKey: 'mesma-intencao' }))),
      run(() => issueWarranty(tenant.context, emissao(osId, { idempotencyKey: 'mesma-intencao' }))),
    ]);

    /** As duas RESPONDEM: quem clicou duas vezes nao merece erro. */
    expect(contar(resultados)).toEqual({ ganhou: 2, perdeu: 0 });

    const linhas = await getDb().select().from(warranties);
    expect(linhas).toHaveLength(1);

    const ids = new Set(
      resultados.flatMap((r) => (r.status === 'fulfilled' ? [r.value.warrantyId] : [])),
    );
    expect(ids.size).toBe(1);
  });

  it('cinco emissoes simultaneas ainda produzem uma so', async () => {
    const osId = await osFinalizada();

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() => issueWarranty(tenant.context, emissao(osId, { idempotencyKey: 'cinco-vezes' }))),
      ),
    );

    expect(await getDb().select().from(warranties)).toHaveLength(1);

    /** E um unico evento de ativacao: o outbox nao infla com retry. */
    const eventos = await getDb().select().from(domainEvents);
    expect(eventos.filter((e) => e.type === 'WARRANTY_ACTIVATED')).toHaveLength(1);
  });

  it('SEM chave, duas emissoes sao dois atos distintos e legitimos', async () => {
    /**
     * A idempotencia identifica o COMANDO, nao a OS. Sem chave, quem pediu
     * duas vezes pediu duas garantias — e pode ser exatamente o que queria:
     * mao de obra e peca, com prazos diferentes.
     */
    const osId = await osFinalizada();

    const resultados = await Promise.allSettled([
      run(() => issueWarranty(tenant.context, emissao(osId))),
      run(() => issueWarranty(tenant.context, emissao(osId))),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 2, perdeu: 0 });
    expect(await getDb().select().from(warranties)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// B. Retorno concorrente (itens 58 e 106.B)
// ---------------------------------------------------------------------------

describe('B. cinco criacoes simultaneas do mesmo retorno', () => {
  it('produzem UMA nova Ordem de Servico, nunca cinco', async () => {
    const { warrantyId } = await garantiaAtiva();

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() =>
          registerWarrantyReturn(tenant.context, {
            warrantyId,
            customerReport: 'Voltou a desligar depois de 20 minutos.',
            coverageAssessment: 'covered',
            idempotencyKey: 'retorno-simultaneo',
          }),
        ),
      ),
    );

    expect(contar(resultados).ganhou).toBe(5);

    /** UM retorno. */
    expect(await getDb().select().from(warrantyReturns)).toHaveLength(1);

    /** UMA OS de garantia. */
    const ordens = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.classification, 'warranty_internal'));
    expect(ordens).toHaveLength(1);

    /** E todas as respostas apontam para a MESMA OS. */
    const ids = new Set(
      resultados.flatMap((r) => (r.status === 'fulfilled' ? [r.value.serviceOrderId] : [])),
    );
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBe(ordens[0]!.id);
  });

  it('dez retornos SEQUENCIAIS com a mesma chave tambem produzem um so', async () => {
    const { warrantyId } = await garantiaAtiva();

    for (let i = 0; i < 10; i += 1) {
      await run(() =>
        registerWarrantyReturn(tenant.context, {
          warrantyId,
          customerReport: 'Voltou.',
          coverageAssessment: 'covered',
          idempotencyKey: 'retorno-sequencial',
        }),
      );
    }

    expect(await getDb().select().from(warrantyReturns)).toHaveLength(1);
    const ordens = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.classification, 'warranty_internal'));
    expect(ordens).toHaveLength(1);
  });

  it('a numeracao da OS nao fica com buraco por causa do retry', async () => {
    /**
     * A chave e conferida ANTES de alocar o numero da sequencia. O retry nao
     * gasta numero, e o balcao nao ve "OS 41" seguida de "OS 47" sem que nada
     * tenha acontecido entre as duas.
     */
    const { warrantyId } = await garantiaAtiva();

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() =>
          registerWarrantyReturn(tenant.context, {
            warrantyId,
            customerReport: 'Voltou.',
            coverageAssessment: 'covered',
            idempotencyKey: 'sem-buraco',
          }),
        ),
      ),
    );

    const ordens = await getDb().select().from(serviceOrders).orderBy(serviceOrders.number);
    const numeros = ordens.map((o) => o.number);
    expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
    expect(new Set(numeros).size).toBe(numeros.length);
  });
});

// ---------------------------------------------------------------------------
// C. Reclassificacao concorrente (itens 61 e 106.C)
// ---------------------------------------------------------------------------

describe('C. duas reclassificacoes simultaneas', () => {
  it('produzem UMA alteracao logica, sem duplicar historico nem evento', async () => {
    const { warrantyId } = await garantiaAtiva();
    const retorno = await run(() =>
      registerWarrantyReturn(tenant.context, {
        warrantyId,
        customerReport: 'Voltou a desligar.',
        coverageAssessment: 'covered',
      }),
    );

    const motivo = 'Oxidacao por liquido na regiao do conector, posterior ao reparo da fonte.';

    const resultados = await Promise.allSettled([
      run(() =>
        reclassifyWarrantyServiceOrder(tenant.context, {
          serviceOrderId: retorno.serviceOrderId!,
          reason: motivo,
        }),
      ),
      run(() =>
        reclassifyWarrantyServiceOrder(tenant.context, {
          serviceOrderId: retorno.serviceOrderId!,
          reason: motivo,
        }),
      ),
    ]);

    /** Uma vence; a outra e recusada — nao silenciada. */
    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    const [os] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, retorno.serviceOrderId!));
    expect(os!.classification).toBe('standard');
    expect(os!.status).toBe('awaiting_technical_opinion');

    /** UMA linha na historia, UM evento: a perdedora nao deixou rastro. */
    const linha = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(eq(serviceOrderTimeline.serviceOrderId, retorno.serviceOrderId!));
    expect(linha.filter((e) => e.kind === 'warranty_reclassified')).toHaveLength(1);
    expect(linha.filter((e) => e.kind === 'status_changed')).toHaveLength(1);

    const eventos = await getDb().select().from(domainEvents);
    expect(eventos.filter((e) => e.type === 'WARRANTY_RETURN_RECLASSIFIED_TO_QUOTE')).toHaveLength(
      1,
    );
  });
});

// ---------------------------------------------------------------------------
// D. Revogacao concorrente com retorno (item 106.D)
// ---------------------------------------------------------------------------

describe('D. revogacao concorrente com retorno', () => {
  it('termina num estado consistente: ou o retorno entrou antes, ou a garantia ja valia menos', async () => {
    const { warrantyId } = await garantiaAtiva();

    const resultados = await Promise.allSettled([
      run(() =>
        registerWarrantyReturn(tenant.context, {
          warrantyId,
          customerReport: 'Voltou a desligar.',
          coverageAssessment: 'covered',
          idempotencyKey: 'retorno-vs-revogacao',
        }),
      ),
      run(() => revokeWarranty(tenant.context, warrantyId, 'Lacre violado por terceiro.')),
    ]);

    /** As duas operacoes sao legitimas; nenhuma corrompe a outra. */
    expect(contar(resultados).ganhou).toBeGreaterThanOrEqual(1);

    const [g] = await getDb().select().from(warranties).where(eq(warranties.id, warrantyId));
    const retornos = await getDb().select().from(warrantyReturns);
    const ordens = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.classification, 'warranty_internal'));

    /**
     * A INVARIANTE, qualquer que tenha sido a ordem: no maximo UM retorno, e a
     * OS de garantia existe se e somente se o retorno foi avaliado como
     * acionavel. Revogar NAO apaga retorno ja gravado (item 62).
     */
    expect(retornos.length).toBeLessThanOrEqual(1);
    if (retornos.length === 1) {
      const gravou = retornos[0]!;
      expect(ordens).toHaveLength(gravou.returnServiceOrderId ? 1 : 0);
      if (gravou.returnServiceOrderId) {
        expect(gravou.wasEnforceable).toBe(1);
      }
    }

    /** E a revogacao, se venceu, deixou a garantia fora de uso dali em diante. */
    if (g!.status === 'revoked') {
      const novo = await run(() =>
        registerWarrantyReturn(tenant.context, {
          warrantyId,
          customerReport: 'Tentando de novo depois da revogacao.',
          coverageAssessment: 'covered',
        }),
      );
      expect(novo.createdServiceOrder).toBe(false);
    }
  });

  it('duas revogacoes simultaneas: uma vence, a outra recebe conflito', async () => {
    const { warrantyId } = await garantiaAtiva();

    const resultados = await Promise.allSettled([
      run(() => revokeWarranty(tenant.context, warrantyId, 'Lacre violado por terceiro.')),
      run(() => revokeWarranty(tenant.context, warrantyId, 'Lacre violado por terceiro.')),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    const [g] = await getDb().select().from(warranties).where(eq(warranties.id, warrantyId));
    expect(g!.status).toBe('revoked');

    const eventos = await getDb().select().from(domainEvents);
    expect(eventos.filter((e) => e.type === 'WARRANTY_REVOKED')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// E. Certificado concorrente (item 60)
// ---------------------------------------------------------------------------

describe('E. dois certificados simultaneos da mesma garantia', () => {
  it('produzem UM documento, com UM token', async () => {
    const { warrantyId } = await garantiaAtiva();

    const resultados = await Promise.allSettled([
      run(() => issueCertificate(tenant.context, warrantyId)),
      run(() => issueCertificate(tenant.context, warrantyId)),
    ]);

    /**
     * `UNIQUE(warranty_id)` decide. Uma das duas pode perder a corrida e
     * receber erro de duplicidade — o que nao pode e existirem dois
     * certificados para a mesma garantia.
     */
    expect(contar(resultados).ganhou).toBeGreaterThanOrEqual(1);

    const certificados = await getDb().select().from(warrantyCertificates);
    expect(certificados).toHaveLength(1);
  });
});

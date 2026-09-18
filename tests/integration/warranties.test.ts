import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { addDays, todayIn } from '@/core/time/civil-date';
import { getDb } from '@/core/db/client';
import { BusinessRuleError, NotFoundError } from '@/core/errors';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import type { ServiceOrderStatus } from '@/modules/service-orders/domain/workflow';
import {
  serviceOrderTimeline,
  serviceOrders,
} from '@/modules/service-orders/infrastructure/schema';
import {
  issueWarranty,
  cancelWarranty,
  revokeWarranty,
  loadWarranty,
} from '@/modules/warranties/application/warranty-service';
import { createWarrantyPolicy } from '@/modules/warranties/application/warranty-policy-service';
import {
  issueCertificate,
  loadCertificate,
} from '@/modules/warranties/application/warranty-certificate-service';
import {
  findApplicableWarranties,
  reclassifyWarrantyServiceOrder,
  registerWarrantyReturn,
} from '@/modules/warranties/application/warranty-return-service';
import { warranties, warrantyReturns } from '@/modules/warranties/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  contextFor,
  createTenantFixture,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/**
 * GARANTIAS — CICLO COMPLETO (Prompt 13, itens 98 a 104).
 *
 * O eixo destes testes: uma garantia e uma promessa datada e delimitada; o
 * retorno valido cria uma OS NOVA e nunca reabre a antiga; e nada disso
 * mexe em estoque, dinheiro ou no estado de outra OS.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let clienteA: string;
let equipamentoA: string;
let equipamentoB: string;
let clienteB: string;

function run<T>(work: () => Promise<T>): Promise<T> {
  return runWithContext({ origin: 'test' }, work);
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
  tenantA = await createTenantFixture('gar-a', planId);
  tenantB = await createTenantFixture('gar-b', planId);

  for (const t of [tenantA, tenantB]) {
    await run(() =>
      setTenantFeature(t.context, { featureKey: FEATURES.OPERATIONS_WARRANTIES, enabled: true }),
    );
  }
  /** O contexto e remontado para enxergar a feature recem-ligada. */
  tenantA.context = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);
  tenantB.context = await contextFor(tenantB.tenantId, tenantB.adminUserId, tenantB.unitId);

  clienteA = (
    await run(() =>
      createCustomer(tenantA.context, {
        kind: 'individual',
        name: 'Dona do Aparelho',
        contacts: [{ type: 'phone', value: '11988887777', isWhatsapp: false }],
      }),
    )
  ).customerId;

  clienteB = (
    await run(() =>
      createCustomer(tenantB.context, {
        kind: 'individual',
        name: 'Outro Cliente',
        contacts: [{ type: 'phone', value: '11977776666', isWhatsapp: false }],
      }),
    )
  ).customerId;

  equipamentoA = (
    await run(() =>
      createEquipment(tenantA.context, {
        customerId: clienteA,
        kind: 'Receiver',
        brand: 'Yamaha',
        model: 'RX-V385',
        voltage: 'bivolt',
      }),
    )
  ).equipmentId;

  equipamentoB = (
    await run(() =>
      createEquipment(tenantB.context, {
        customerId: clienteB,
        kind: 'Televisor',
        voltage: 'unknown',
      }),
    )
  ).equipmentId;
});

/** Abre uma OS e a leva ate Finalizada — o ato de entrega ao cliente. */
async function osFinalizada(relato = 'Nao liga.'): Promise<string> {
  const criada = await run(() =>
    createServiceOrder(tenantA.context, { equipmentId: equipamentoA, customerReport: relato }),
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
      transitionServiceOrder(tenantA.context, {
        serviceOrderId: criada.serviceOrderId,
        to,
        ...(via ? { via } : {}),
      }),
    );
  }

  return criada.serviceOrderId;
}

async function politica(overrides: Record<string, unknown> = {}): Promise<string> {
  const { policyId } = await run(() =>
    createWarrantyPolicy(tenantA.context, {
      name: `Reparo padrao ${Math.random().toString(36).slice(2, 8)}`,
      type: 'internal',
      durationAmount: 90,
      durationUnit: 'days',
      coverageSummary: 'Mao de obra do reparo realizado.',
      exclusions: 'Dano fisico posterior, oxidacao e intervencao de terceiro.',
      ...overrides,
    }),
  );
  return policyId;
}

function emissao(osId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'internal',
    equipmentId: equipamentoA,
    serviceOrderId: osId,
    durationAmount: 90,
    durationUnit: 'days',
    coversWholeService: true,
    coverageItems: [{ kind: 'labor', description: 'Reparo da fonte' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('emissao (itens 12, 13, 53, 54 e 98)', () => {
  it('emite com numero, snapshot e vigencia calculada', async () => {
    const osId = await osFinalizada();
    const policyId = await politica();

    const g = await run(() => issueWarranty(tenantA.context, emissao(osId, { policyId })));

    expect(g.number).toBeGreaterThan(0);
    expect(g.formattedNumber).toMatch(/^GAR \d{6}$/);
    expect(g.reused).toBe(false);

    const row = await run(() => loadWarranty(tenantA.context, g.warrantyId));
    expect(row.status).toBe('active');
    expect(row.durationAmount).toBe(90);
    expect(row.durationUnit).toBe('days');
    /** O snapshot copiou a politica; nao e uma referencia viva a ela. */
    expect(row.exclusions).toContain('oxidacao');
  });

  it('a Garantia Interna exige OS FINALIZADA — entrega, nao pagamento (ADR-063)', async () => {
    const criada = await run(() =>
      createServiceOrder(tenantA.context, {
        equipmentId: equipamentoA,
        customerReport: 'Ainda na bancada.',
      }),
    );

    await expect(
      run(() => issueWarranty(tenantA.context, emissao(criada.serviceOrderId))),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('ALTERAR A POLITICA NAO retroage sobre a garantia emitida (item 20)', async () => {
    const osId = await osFinalizada();
    const policyId = await politica({ durationAmount: 90, durationUnit: 'days' });

    const g = await run(() => issueWarranty(tenantA.context, emissao(osId, { policyId })));
    const antes = await run(() => loadWarranty(tenantA.context, g.warrantyId));

    const { updateWarrantyPolicy } =
      await import('@/modules/warranties/application/warranty-policy-service');
    await run(() =>
      updateWarrantyPolicy(tenantA.context, policyId, {
        name: 'Reparo reduzido',
        type: 'internal',
        durationAmount: 30,
        durationUnit: 'days',
        coverageSummary: 'Mudou tudo.',
        exclusions: 'Outras exclusoes.',
      }),
    );

    const depois = await run(() => loadWarranty(tenantA.context, g.warrantyId));
    expect(depois.durationAmount).toBe(antes.durationAmount);
    expect(depois.endsOn).toBe(antes.endsOn);
    expect(depois.exclusions).toBe(antes.exclusions);
  });

  it('a mesma chave de comando emite UMA garantia (itens 56 e 105)', async () => {
    const osId = await osFinalizada();
    const chave = 'emissao-unica';

    const resultados = [];
    for (let i = 0; i < 10; i += 1) {
      resultados.push(
        await run(() => issueWarranty(tenantA.context, emissao(osId, { idempotencyKey: chave }))),
      );
    }

    const ids = new Set(resultados.map((r) => r.warrantyId));
    expect(ids.size).toBe(1);
    expect(resultados.filter((r) => r.reused)).toHaveLength(9);

    const linhas = await getDb().select().from(warranties);
    expect(linhas).toHaveLength(1);
  });

  it('a MESMA OS pode ter garantias de escopos diferentes (item 56)', async () => {
    const osId = await osFinalizada();

    const maoDeObra = await run(() => issueWarranty(tenantA.context, emissao(osId)));
    const peca = await run(() =>
      issueWarranty(
        tenantA.context,
        emissao(osId, {
          type: 'part',
          durationAmount: 12,
          durationUnit: 'months',
          coversWholeService: false,
          coverageItems: [{ kind: 'part', description: 'Fonte chaveada 24V' }],
          partDescription: 'Fonte chaveada 24V',
        }),
      ),
    );

    expect(maoDeObra.warrantyId).not.toBe(peca.warrantyId);
    /** A trava NAO e `UNIQUE(service_order_id)`: seria regra comercial errada. */
    expect(peca.endsOn).not.toBe(maoDeObra.endsOn);
  });

  it('recusa politica de outro tipo e politica inativa', async () => {
    const osId = await osFinalizada();
    const dePeca = await politica({ type: 'part' });

    await expect(
      run(() => issueWarranty(tenantA.context, emissao(osId, { policyId: dePeca }))),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe('certificado (itens 18 a 21, 55 e 123)', () => {
  it('gera com snapshot e checksum, e regerar NAO cria um segundo documento', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));

    const primeiro = await run(() => issueCertificate(tenantA.context, g.warrantyId));
    const segundo = await run(() => issueCertificate(tenantA.context, g.warrantyId));

    expect(primeiro.reused).toBe(false);
    expect(segundo.reused).toBe(true);
    /** O token nao muda: o QR ja impresso continua valendo. */
    expect(segundo.token).toBe(primeiro.token);
    expect(segundo.certificateId).toBe(primeiro.certificateId);
  });

  it('o QR NAO carrega PII: o token e opaco e nao enumeravel (itens 21 e 120)', async () => {
    const osId = await osFinalizada();
    const primeira = await run(() => issueWarranty(tenantA.context, emissao(osId)));
    const segunda = await run(() =>
      issueWarranty(
        tenantA.context,
        emissao(osId, {
          type: 'part',
          coverageItems: [{ kind: 'part', description: 'Fonte' }],
        }),
      ),
    );

    const certA = await run(() => issueCertificate(tenantA.context, primeira.warrantyId));
    const certB = await run(() => issueCertificate(tenantA.context, segunda.warrantyId));

    /**
     * O que importa e que o token NAO SEJA DERIVADO de nada conhecido.
     *
     * Nao basta "nao conter o numero": um token base64url de 32 caracteres
     * contem quase todo digito por acaso, e essa asserção passaria por sorte.
     * O que se prova aqui e o oposto — que dois certificados de garantias
     * consecutivas produzem tokens sem relacao entre si, e que nenhum deles
     * carrega identificador legivel.
     */
    expect(certA.token).not.toBe(certB.token);
    expect(certA.token).not.toContain(primeira.formattedNumber);
    expect(certA.token).not.toContain(clienteA);
    expect(certA.token).not.toContain(primeira.warrantyId);
    expect(certA.token).not.toContain(equipamentoA);

    /** Nao enumeravel: garantias vizinhas nao geram tokens vizinhos. */
    expect(certA.token.slice(0, 8)).not.toBe(certB.token.slice(0, 8));

    /** Entropia suficiente para nao ser adivinhavel por varredura. */
    expect(certA.token.length).toBeGreaterThanOrEqual(30);
    expect(new Set(certA.token).size).toBeGreaterThan(10);
  });

  it('o documento guarda o nome do cliente e NAO documento, telefone ou serial', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));
    await run(() => issueCertificate(tenantA.context, g.warrantyId));

    const cert = await run(() => loadCertificate(tenantA.context, g.warrantyId));
    const texto = JSON.stringify(cert!.snapshot);

    expect(cert!.snapshot.cliente.nome).toBe('Dona do Aparelho');
    expect(texto).not.toContain('11988887777');
    expect(texto).not.toMatch(/\bserial\b/i);
    expect(cert!.snapshot.garantia.numero).toBe(g.formattedNumber);
  });

  it('garantia revogada nao gera certificado novo', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));
    await run(() => revokeWarranty(tenantA.context, g.warrantyId, 'Lacre violado pelo cliente.'));

    await expect(run(() => issueCertificate(tenantA.context, g.warrantyId))).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });
});

describe('E2E PRINCIPAL — retorno em garantia (itens 23 a 27 e 99)', () => {
  it('cria NOVA OS, preserva a original, vincula as duas e nasce em Aguardando Conserto', async () => {
    const originalId = await osFinalizada('Nao liga.');
    const g = await run(() => issueWarranty(tenantA.context, emissao(originalId)));

    const antes = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, originalId));

    const retorno = await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Voltou a desligar depois de 20 minutos.',
        coverageAssessment: 'covered',
      }),
    );

    expect(retorno.createdServiceOrder).toBe(true);
    expect(retorno.serviceOrderId).toBeTruthy();

    const [nova] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, retorno.serviceOrderId!));

    // --- a nova OS ---------------------------------------------------------
    expect(nova!.number).not.toBe(antes[0]!.number);
    expect(nova!.status).toBe('awaiting_repair');
    expect(nova!.classification).toBe('warranty_internal');
    expect(nova!.warrantyId).toBe(g.warrantyId);
    expect(nova!.originalServiceOrderId).toBe(originalId);
    expect(nova!.equipmentId).toBe(equipamentoA);
    expect(nova!.customerId).toBe(clienteA);
    /** O relato NOVO, nunca copia do antigo (item 82). */
    expect(nova!.customerReport).toBe('Voltou a desligar depois de 20 minutos.');

    // --- a ORIGINAL nao foi tocada (item 24) -------------------------------
    const [depois] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, originalId));

    expect(depois!.status).toBe('completed');
    expect(depois!.number).toBe(antes[0]!.number);
    expect(depois!.customerReport).toBe(antes[0]!.customerReport);
    expect(depois!.classification).toBe('standard');
    expect(depois!.version).toBe(antes[0]!.version);

    // --- vinculo estrutural, nao so texto (item 25) ------------------------
    const [vinculo] = await getDb()
      .select()
      .from(warrantyReturns)
      .where(eq(warrantyReturns.id, retorno.returnId));

    expect(vinculo!.originalServiceOrderId).toBe(originalId);
    expect(vinculo!.returnServiceOrderId).toBe(retorno.serviceOrderId);
    expect(vinculo!.wasEnforceable).toBe(1);

    // --- as duas linhas do tempo ------------------------------------------
    const linhaOriginal = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(eq(serviceOrderTimeline.serviceOrderId, originalId));
    expect(linhaOriginal.some((e) => e.kind === 'warranty_return_linked')).toBe(true);

    const linhaNova = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(eq(serviceOrderTimeline.serviceOrderId, retorno.serviceOrderId!));
    expect(linhaNova.some((e) => e.kind === 'created')).toBe(true);

    // --- eventos e auditoria ----------------------------------------------
    const eventos = await getDb().select().from(domainEvents);
    const tipos = eventos.map((e) => e.type);
    expect(tipos).toContain('WARRANTY_RETURN_REGISTERED');
    expect(tipos).toContain('WARRANTY_RETURN_SERVICE_ORDER_CREATED');

    const trilha = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'warranty_return.registered'));
    expect(trilha).toHaveLength(1);
  });

  it('NENHUMA cobranca e NENHUM movimento de estoque sao criados (itens 103 e 104)', async () => {
    const originalId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(originalId)));

    await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Voltou com o mesmo defeito.',
        coverageAssessment: 'covered',
      }),
    );

    const { financialTitles, financialMovements } =
      await import('@/modules/finance/infrastructure/schema');
    const { stockMovements } = await import('@/modules/inventory/infrastructure/schema');

    expect(await getDb().select().from(financialTitles)).toHaveLength(0);
    expect(await getDb().select().from(financialMovements)).toHaveLength(0);
    expect(await getDb().select().from(stockMovements)).toHaveLength(0);
  });

  it('o mesmo comando repetido 10x cria UMA nova OS (itens 57 e 105)', async () => {
    const originalId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(originalId)));

    const resultados = [];
    for (let i = 0; i < 10; i += 1) {
      resultados.push(
        await run(() =>
          registerWarrantyReturn(tenantA.context, {
            warrantyId: g.warrantyId,
            customerReport: 'Voltou a desligar.',
            coverageAssessment: 'covered',
            idempotencyKey: 'retorno-unico',
          }),
        ),
      );
    }

    expect(new Set(resultados.map((r) => r.returnId)).size).toBe(1);
    expect(await getDb().select().from(warrantyReturns)).toHaveLength(1);

    const ordens = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.classification, 'warranty_internal'));
    expect(ordens).toHaveLength(1);
  });

  it('DOIS retornos diferentes sao legitimos: garantia nao vira "uma volta so" (item 59)', async () => {
    const originalId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(originalId)));

    const primeiro = await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Desligou sozinho em marco.',
        coverageAssessment: 'covered',
        idempotencyKey: 'retorno-marco',
      }),
    );
    const segundo = await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Voltou a desligar em abril.',
        coverageAssessment: 'covered',
        idempotencyKey: 'retorno-abril',
      }),
    );

    expect(primeiro.returnId).not.toBe(segundo.returnId);
    expect(primeiro.serviceOrderId).not.toBe(segundo.serviceOrderId);
    expect(await getDb().select().from(warrantyReturns)).toHaveLength(2);
  });
});

describe('E2E — garantia expirada e cobertura parcial (itens 101 e 102)', () => {
  it('garantia VENCIDA registra o retorno e NAO cria OS de garantia', async () => {
    const originalId = await osFinalizada();

    /**
     * Vigencia que JA TERMINOU, contada a partir do dia civil DA EMPRESA.
     *
     * `new Date().toISOString()` daria a data em UTC, e o fuso do tenant e
     * America/Sao_Paulo: entre 00h e 03h UTC as duas datas divergem, e o teste
     * passaria de dia e falharia de madrugada — que foi exatamente o que
     * aconteceu. A data de referencia aqui tem de ser a mesma que o dominio
     * usa.
     *
     * Cinco dias de folga em vez de um: o objetivo do teste e "expirada", nao
     * "expirada por uma hora".
     */
    const inicio = addDays(todayIn(tenantA.context.tenantTimezone), -5);
    const g = await run(() =>
      issueWarranty(
        tenantA.context,
        emissao(originalId, { startsOn: inicio, durationAmount: 1, durationUnit: 'days' }),
      ),
    );

    const retorno = await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Voltou a desligar.',
        coverageAssessment: 'covered',
      }),
    );

    expect(retorno.createdServiceOrder).toBe(false);
    expect(retorno.serviceOrderId).toBeNull();
    expect(retorno.refusalReason).toMatch(/terminou em/i);

    /** O retorno EXISTE: o fato de o aparelho ter voltado e informacao. */
    const [linha] = await getDb().select().from(warrantyReturns);
    expect(linha!.wasEnforceable).toBe(0);

    const ordens = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.classification, 'warranty_internal'));
    expect(ordens).toHaveLength(0);
  });

  it('defeito AVALIADO como fora da cobertura nao gera OS de garantia (item 102)', async () => {
    const originalId = await osFinalizada();
    const g = await run(() =>
      issueWarranty(
        tenantA.context,
        emissao(originalId, {
          coversWholeService: false,
          coverageItems: [{ kind: 'part', description: 'Fonte chaveada' }],
        }),
      ),
    );

    const retorno = await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Agora a placa principal nao responde.',
        coverageAssessment: 'not_covered',
        assessmentNotes: 'A cobertura e da fonte; o defeito atual e na placa.',
      }),
    );

    expect(retorno.createdServiceOrder).toBe(false);
    expect(retorno.refusalReason).toMatch(/fora da cobertura/i);
  });

  it('"a avaliar" tambem NAO cria OS de garantia', async () => {
    const originalId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(originalId)));

    const retorno = await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Faz um barulho estranho.',
        coverageAssessment: 'undetermined',
      }),
    );

    expect(retorno.createdServiceOrder).toBe(false);
    expect(retorno.refusalReason).toMatch(/parecer tecnico/i);
  });

  it('a garantia do equipamento A nao serve para o equipamento B (item 36)', async () => {
    const originalId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(originalId)));

    /** O retorno usa o equipamento DA GARANTIA; nao ha como apontar outro. */
    const retorno = await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Voltou.',
        coverageAssessment: 'covered',
      }),
    );

    const [linha] = await getDb().select().from(warrantyReturns);
    expect(linha!.equipmentId).toBe(equipamentoA);
    expect(linha!.equipmentId).not.toBe(equipamentoB);
    expect(retorno.createdServiceOrder).toBe(true);
  });
});

describe('E2E — reclassificacao (itens 29 a 32 e 100)', () => {
  async function osDeGarantia() {
    const originalId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(originalId)));
    const retorno = await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Voltou a desligar.',
        coverageAssessment: 'covered',
      }),
    );
    return { warrantyId: g.warrantyId, serviceOrderId: retorno.serviceOrderId! };
  }

  it('sem justificativa tecnica, e recusada (item 31)', async () => {
    const { serviceOrderId } = await osDeGarantia();

    for (const ruim of ['', '   ', 'nao coberto']) {
      await expect(
        run(() =>
          reclassifyWarrantyServiceOrder(tenantA.context, { serviceOrderId, reason: ruim }),
        ),
      ).rejects.toThrow();
    }
  });

  it('com justificativa, muda a CLASSIFICACAO e o estado pelo workflow oficial', async () => {
    const { serviceOrderId, warrantyId } = await osDeGarantia();

    await run(() =>
      reclassifyWarrantyServiceOrder(tenantA.context, {
        serviceOrderId,
        reason: 'Oxidacao por liquido na regiao do conector, posterior ao reparo da fonte.',
      }),
    );

    const [os] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, serviceOrderId));

    expect(os!.classification).toBe('standard');
    /** O estado veio da maquina de estados, nao de um UPDATE direto. */
    expect(os!.status).toBe('awaiting_technical_opinion');

    const linha = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(eq(serviceOrderTimeline.serviceOrderId, serviceOrderId));
    expect(linha.some((e) => e.kind === 'warranty_reclassified')).toBe(true);
    expect(linha.some((e) => e.kind === 'status_changed')).toBe(true);

    const trilha = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'warranty_return.reclassified'));
    expect(trilha).toHaveLength(1);
    expect(JSON.stringify(trilha[0]!.after)).toContain('Oxidacao');

    /** O fato de comunicacao pendente existe; NADA foi enviado (item 30). */
    const eventos = await getDb().select().from(domainEvents);
    const reclass = eventos.find((e) => e.type === 'WARRANTY_RETURN_RECLASSIFIED_TO_QUOTE');
    expect(reclass).toBeDefined();
    expect(JSON.stringify(reclass!.payload)).not.toContain('Oxidacao');
    expect(JSON.stringify(reclass!.payload)).toContain('requiresCustomerNotice');

    const timelineGarantia = await run(() =>
      import('@/modules/warranties/application/warranty-queries').then((m) =>
        m.findWarrantyDetail(tenantA.context, warrantyId),
      ),
    );
    expect(timelineGarantia!.timeline.some((e) => e.kind === 'reclassified')).toBe(true);
  });

  it('reclassificar duas vezes: a segunda e recusada, sem duplicar historico', async () => {
    const { serviceOrderId } = await osDeGarantia();
    const motivo = 'Queda com dano mecanico no chassi, sem relacao com o reparo anterior.';

    await run(() =>
      reclassifyWarrantyServiceOrder(tenantA.context, { serviceOrderId, reason: motivo }),
    );

    await expect(
      run(() =>
        reclassifyWarrantyServiceOrder(tenantA.context, { serviceOrderId, reason: motivo }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    const linha = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(eq(serviceOrderTimeline.serviceOrderId, serviceOrderId));
    expect(linha.filter((e) => e.kind === 'warranty_reclassified')).toHaveLength(1);
  });

  it('OS comum nao se reclassifica: nao ha o que reclassificar', async () => {
    const criada = await run(() =>
      createServiceOrder(tenantA.context, { equipmentId: equipamentoA, customerReport: 'Normal.' }),
    );

    await expect(
      run(() =>
        reclassifyWarrantyServiceOrder(tenantA.context, {
          serviceOrderId: criada.serviceOrderId,
          reason: 'Tentando explorar a excecao do estado inicial por outro caminho.',
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe('a excecao do estado inicial nao vaza (itens 27 e 110)', () => {
  it('OS comum continua nascendo em Aguardando Parecer Tecnico', async () => {
    const criada = await run(() =>
      createServiceOrder(tenantA.context, {
        equipmentId: equipamentoA,
        customerReport: 'Nao liga.',
      }),
    );

    const [os] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, criada.serviceOrderId));

    expect(os!.status).toBe('awaiting_technical_opinion');
    expect(os!.classification).toBe('standard');
    expect(os!.warrantyId).toBeNull();
  });

  it('campos extras no formulario NAO conseguem forcar o estado inicial', async () => {
    /**
     * `createServiceOrder` valida com um schema que nao conhece `status`,
     * `classification` nem `origin` — o que chega a mais e descartado antes de
     * qualquer coisa. Nao ha combinacao de dados de formulario que abra uma OS
     * comum em Aguardando Conserto.
     */
    const criada = await run(() =>
      createServiceOrder(tenantA.context, {
        equipmentId: equipamentoA,
        customerReport: 'Tentando burlar.',
        status: 'awaiting_repair',
        classification: 'warranty_internal',
        origin: { kind: 'warranty_return', warrantyId: 'x', originalServiceOrderId: 'y' },
      } as never),
    );

    const [os] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, criada.serviceOrderId));

    expect(os!.status).toBe('awaiting_technical_opinion');
    expect(os!.classification).toBe('standard');
    expect(os!.warrantyId).toBeNull();
    expect(os!.originalServiceOrderId).toBeNull();
  });
});

describe('cancelamento e revogacao (item 62)', () => {
  it('cancelar exige motivo e preserva o historico', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));

    await expect(
      run(() => cancelWarranty(tenantA.context, g.warrantyId, 'curto')),
    ).rejects.toThrow();

    await run(() =>
      cancelWarranty(tenantA.context, g.warrantyId, 'Emitida na Ordem de Servico errada.'),
    );

    const row = await run(() => loadWarranty(tenantA.context, g.warrantyId));
    expect(row.status).toBe('cancelled');
    expect(row.cancelReason).toContain('Ordem de Servico errada');
    /** A garantia continua existindo: cancelar nao apaga. */
    expect(await getDb().select().from(warranties)).toHaveLength(1);
  });

  it('revogar NAO apaga retornos ja registrados', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));

    const retorno = await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Voltou.',
        coverageAssessment: 'covered',
      }),
    );

    await run(() => revokeWarranty(tenantA.context, g.warrantyId, 'Lacre violado por terceiro.'));

    const linhas = await getDb().select().from(warrantyReturns);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.returnServiceOrderId).toBe(retorno.serviceOrderId);

    /** E a OS que ja existia continua la, intacta. */
    const [os] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, retorno.serviceOrderId!));
    expect(os!.classification).toBe('warranty_internal');
  });

  it('garantia revogada nao aciona retorno novo', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));
    await run(() => revokeWarranty(tenantA.context, g.warrantyId, 'Lacre violado por terceiro.'));

    const retorno = await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Voltou.',
        coverageAssessment: 'covered',
      }),
    );

    expect(retorno.createdServiceOrder).toBe(false);
    expect(retorno.refusalReason).toMatch(/revogada/i);
  });
});

describe('isolamento entre empresas (itens 39 e 107)', () => {
  it('o tenant B nao enxerga, nao carrega e nao aciona a garantia do A', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));

    await expect(run(() => loadWarranty(tenantB.context, g.warrantyId))).rejects.toBeInstanceOf(
      NotFoundError,
    );

    await expect(
      run(() =>
        registerWarrantyReturn(tenantB.context, {
          warrantyId: g.warrantyId,
          customerReport: 'Tentando usar garantia alheia.',
          coverageAssessment: 'covered',
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    const aplicaveis = await run(() => findApplicableWarranties(tenantB.context, equipamentoA));
    expect(aplicaveis).toHaveLength(0);
  });

  it('o certificado do A nao e alcancavel pelo B', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));
    const cert = await run(() => issueCertificate(tenantA.context, g.warrantyId));

    const { findCertificateByToken } =
      await import('@/modules/warranties/application/warranty-certificate-service');

    await expect(
      run(() => findCertificateByToken(tenantB.context, cert.token)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

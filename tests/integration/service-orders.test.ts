import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { BusinessRuleError, NotFoundError, ValidationError } from '@/core/errors';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { createIntake } from '@/modules/equipment/application/intake-service';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import {
  findServiceOrderByNumber,
  findServiceOrderDetail,
  getServiceOrderNumberFormat,
  listServiceOrders,
  mapServiceOrdersByIntake,
} from '@/modules/service-orders/application/service-order-queries';
import {
  createServiceOrder,
  updateServiceOrder,
} from '@/modules/service-orders/application/service-order-service';
import {
  SERVICE_ORDER_INITIAL_STATUS,
  TIMELINE_KINDS,
} from '@/modules/service-orders/domain/service-order';
import {
  serviceOrderTimeline,
  serviceOrders,
} from '@/modules/service-orders/infrastructure/schema';
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
 * ORDEM DE SERVICO — FUNDACAO (Prompt 07, itens 123 a 127).
 *
 * O eixo destes testes e a identidade da OS: ela e de uma UNIDADE, referencia
 * cliente e equipamento do TENANT, nasce de um recebimento coerente e recebe
 * um numero unico por empresa.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let clienteA: string;
let clienteB: string;
let equipamentoA: string;
let equipamentoB: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

/** Concatena mensagem e causas, para inspecionar o motivo real do banco. */
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
  name: 'Dona do Aparelho',
  contacts: [{ type: 'phone' as const, value: '11988887777', isWhatsapp: false }],
};

function ordem(overrides: Record<string, unknown> = {}) {
  return {
    equipmentId: equipamentoA,
    customerReport: 'Cliente informa que o aparelho nao liga.',
    ...overrides,
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
  tenantA = await createTenantFixture('os-a', planId);
  tenantB = await createTenantFixture('os-b', planId);

  clienteA = (await run(() => createCustomer(tenantA.context, clienteBase))).customerId;
  clienteB = (await run(() => createCustomer(tenantB.context, clienteBase))).customerId;

  equipamentoA = (
    await run(() =>
      createEquipment(tenantA.context, {
        customerId: clienteA,
        kind: 'Receiver',
        brand: 'Yamaha',
        model: 'RX-V385',
        serial: 'Y12345678',
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

// ---------------------------------------------------------------------------

describe('abertura (itens 20, 34 e 39)', () => {
  it('abre com numero, unidade, cliente, equipamento e autor', async () => {
    const created = await run(() => createServiceOrder(tenantA.context, ordem()));

    expect(created.number).toBe(1);
    expect(created.reused).toBe(false);

    const detail = await findServiceOrderDetail(tenantA.context, created.serviceOrderId);
    expect(detail).not.toBeNull();
    expect(detail!.order.unitId).toBe(tenantA.unitId);
    expect(detail!.customer.id).toBe(clienteA);
    expect(detail!.equipmentItem.id).toBe(equipamentoA);
    expect(detail!.openedByName).toBe(tenantA.context.userName);
    expect(detail!.order.customerReport).toBe('Cliente informa que o aparelho nao liga.');
  });

  it('nasce no estado inicial formal, e so nele (itens 25 e 26)', async () => {
    const created = await run(() => createServiceOrder(tenantA.context, ordem()));
    const detail = await findServiceOrderDetail(tenantA.context, created.serviceOrderId);
    expect(detail!.order.status).toBe(SERVICE_ORDER_INITIAL_STATUS);
  });

  it('o cliente vem do EQUIPAMENTO, nao da entrada — nao ha como forjar', async () => {
    const created = await run(() =>
      createServiceOrder(tenantA.context, { ...ordem(), customerId: clienteB }),
    );
    const detail = await findServiceOrderDetail(tenantA.context, created.serviceOrderId);
    expect(detail!.customer.id).toBe(clienteA);
  });

  it('exige relato do cliente', async () => {
    await expect(
      run(() => createServiceOrder(tenantA.context, ordem({ customerReport: '   ' }))),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('SEM UNIDADE ATIVA a abertura e recusada com explicacao (item 40)', async () => {
    const semUnidade = { ...tenantA.context, activeUnitId: null };
    await expect(run(() => createServiceOrder(semUnidade, ordem()))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('equipamento de outro tenant nao abre OS aqui', async () => {
    await expect(
      run(() => createServiceOrder(tenantA.context, ordem({ equipmentId: equipamentoB }))),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('grava observacao interna separada do relato (item 24)', async () => {
    const created = await run(() =>
      createServiceOrder(tenantA.context, ordem({ internalNotes: 'Cliente e apressado.' })),
    );
    const detail = await findServiceOrderDetail(tenantA.context, created.serviceOrderId);
    expect(detail!.order.internalNotes).toBe('Cliente e apressado.');
    expect(detail!.order.customerReport).not.toContain('apressado');
  });
});

// ---------------------------------------------------------------------------

describe('vinculo com o recebimento (itens 10, 11 e 33)', () => {
  async function recebimento(context = tenantA.context, equipmentId = equipamentoA) {
    return (await run(() => createIntake(context, { equipmentId, powerCable: 'yes' }))).intakeId;
  }

  it('guarda o vinculo historico e LE os dados de la, sem copiar', async () => {
    const intakeId = await recebimento();
    const created = await run(() => createServiceOrder(tenantA.context, ordem({ intakeId })));

    const detail = await findServiceOrderDetail(tenantA.context, created.serviceOrderId);
    expect(detail!.order.intakeId).toBe(intakeId);
    expect(detail!.intake).not.toBeNull();
    expect(detail!.intake!.powerCable).toBe('yes');

    // A OS nao ganhou colunas de acessorio/inspecao: a fonte e o recebimento.
    const [row] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, created.serviceOrderId));
    expect(Object.keys(row!)).not.toContain('powerCable');
    expect(Object.keys(row!)).not.toContain('accessories');
  });

  it('UM recebimento origina UMA ordem principal', async () => {
    const intakeId = await recebimento();
    await run(() => createServiceOrder(tenantA.context, ordem({ intakeId })));

    await expect(
      run(() => createServiceOrder(tenantA.context, ordem({ intakeId }))),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    const [agregado] = await getDb()
      .select({ total: sql<number>`count(*)` })
      .from(serviceOrders)
      .where(eq(serviceOrders.intakeId, intakeId));
    expect(Number(agregado!.total)).toBe(1);
  });

  it('o BANCO tambem recusa a segunda ordem para o mesmo recebimento', async () => {
    const intakeId = await recebimento();
    const first = await run(() => createServiceOrder(tenantA.context, ordem({ intakeId })));

    const erro = await getDb()
      .execute(
        sql`INSERT INTO service_orders
              (id, tenant_id, unit_id, number, customer_id, equipment_id, intake_id,
               status, customer_report, opened_at, created_at, updated_at)
            VALUES ('so-dup', ${tenantA.tenantId}, ${tenantA.unitId}, 9999, ${clienteA},
                    ${equipamentoA}, ${intakeId}, 'awaiting_technical_opinion', 'x',
                    NOW(3), NOW(3), NOW(3))`,
      )
      .catch((e: unknown) => e);

    expect(causesOf(erro)).toMatch(/duplicate|1062|ER_DUP_ENTRY/i);
    expect(first.serviceOrderId).toBeTruthy();
  });

  it('CROSS-UNIT: recebimento de outra unidade nao abre OS aqui (item 11)', async () => {
    const unidadeNorte = await createUnit(tenantA.tenantId, 'Norte');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, unidadeNorte);

    const contextoNorte = await contextFor(tenantA.tenantId, tenantA.adminUserId, unidadeNorte);
    const intakeNorte = (
      await run(() => createIntake(contextoNorte, { equipmentId: equipamentoA }))
    ).intakeId;

    // Contexto na unidade original tentando usar o recebimento da Norte.
    await expect(
      run(() => createServiceOrder(tenantA.context, ordem({ intakeId: intakeNorte }))),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('o BANCO recusa a incoerencia de unidade, nao so o servico (item 11)', async () => {
    const unidadeNorte = await createUnit(tenantA.tenantId, 'Norte 2');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, unidadeNorte);
    const contextoNorte = await contextFor(tenantA.tenantId, tenantA.adminUserId, unidadeNorte);
    const intakeNorte = (
      await run(() => createIntake(contextoNorte, { equipmentId: equipamentoA }))
    ).intakeId;

    const erro = await getDb()
      .execute(
        sql`INSERT INTO service_orders
              (id, tenant_id, unit_id, number, customer_id, equipment_id, intake_id,
               status, customer_report, opened_at, created_at, updated_at)
            VALUES ('so-cross-unit', ${tenantA.tenantId}, ${tenantA.unitId}, 8888, ${clienteA},
                    ${equipamentoA}, ${intakeNorte}, 'awaiting_technical_opinion', 'x',
                    NOW(3), NOW(3), NOW(3))`,
      )
      .catch((e: unknown) => e);

    expect(causesOf(erro)).toMatch(/foreign key|1452|ER_NO_REFERENCED_ROW/i);
  });

  it('recusa recebimento que nao e deste equipamento', async () => {
    const outro = (
      await run(() =>
        createEquipment(tenantA.context, { customerId: clienteA, kind: 'Micro-ondas' }),
      )
    ).equipmentId;
    const intakeOutro = await recebimento(tenantA.context, outro);

    await expect(
      run(() => createServiceOrder(tenantA.context, ordem({ intakeId: intakeOutro }))),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('SEM recebimento tambem abre — e o caso documentado do item 12', async () => {
    const created = await run(() => createServiceOrder(tenantA.context, ordem()));
    const detail = await findServiceOrderDetail(tenantA.context, created.serviceOrderId);
    expect(detail!.order.intakeId).toBeNull();
    expect(detail!.intake).toBeNull();
  });

  it('varias ordens sem recebimento convivem — NULL nao colide no UNIQUE', async () => {
    await run(() => createServiceOrder(tenantA.context, ordem()));
    await run(() => createServiceOrder(tenantA.context, ordem()));
    const page = await listServiceOrders(tenantA.context, {});
    expect(page.total).toBe(2);
  });

  it('mapeia ordens por recebimento em uma consulta', async () => {
    const intakeId = await recebimento();
    const created = await run(() => createServiceOrder(tenantA.context, ordem({ intakeId })));

    const mapa = await mapServiceOrdersByIntake(tenantA.context, [intakeId, 'inexistente']);
    expect(mapa.get(intakeId)).toEqual({ id: created.serviceOrderId, number: created.number });
    expect(mapa.has('inexistente')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('FKs compostas no banco (itens 105 e 124)', () => {
  it('recusa OS do tenant A apontando para cliente do tenant B', async () => {
    const erro = await getDb()
      .execute(
        sql`INSERT INTO service_orders
              (id, tenant_id, unit_id, number, customer_id, equipment_id,
               status, customer_report, opened_at, created_at, updated_at)
            VALUES ('so-x1', ${tenantA.tenantId}, ${tenantA.unitId}, 7001, ${clienteB},
                    ${equipamentoA}, 'awaiting_technical_opinion', 'x', NOW(3), NOW(3), NOW(3))`,
      )
      .catch((e: unknown) => e);

    expect(causesOf(erro)).toMatch(/foreign key|1452|ER_NO_REFERENCED_ROW/i);
  });

  it('recusa OS do tenant A apontando para equipamento do tenant B', async () => {
    const erro = await getDb()
      .execute(
        sql`INSERT INTO service_orders
              (id, tenant_id, unit_id, number, customer_id, equipment_id,
               status, customer_report, opened_at, created_at, updated_at)
            VALUES ('so-x2', ${tenantA.tenantId}, ${tenantA.unitId}, 7002, ${clienteA},
                    ${equipamentoB}, 'awaiting_technical_opinion', 'x', NOW(3), NOW(3), NOW(3))`,
      )
      .catch((e: unknown) => e);

    expect(causesOf(erro)).toMatch(/foreign key|1452|ER_NO_REFERENCED_ROW/i);
  });

  it('recusa OS do tenant A carimbada na unidade do tenant B', async () => {
    const erro = await getDb()
      .execute(
        sql`INSERT INTO service_orders
              (id, tenant_id, unit_id, number, customer_id, equipment_id,
               status, customer_report, opened_at, created_at, updated_at)
            VALUES ('so-x3', ${tenantA.tenantId}, ${tenantB.unitId}, 7003, ${clienteA},
                    ${equipamentoA}, 'awaiting_technical_opinion', 'x', NOW(3), NOW(3), NOW(3))`,
      )
      .catch((e: unknown) => e);

    expect(causesOf(erro)).toMatch(/foreign key|1452|ER_NO_REFERENCED_ROW/i);
  });

  it('recusa autor de outro tenant (item 108)', async () => {
    const erro = await getDb()
      .execute(
        sql`INSERT INTO service_orders
              (id, tenant_id, unit_id, number, customer_id, equipment_id, created_by,
               status, customer_report, opened_at, created_at, updated_at)
            VALUES ('so-x4', ${tenantA.tenantId}, ${tenantA.unitId}, 7004, ${clienteA},
                    ${equipamentoA}, ${tenantB.adminUserId}, 'awaiting_technical_opinion', 'x',
                    NOW(3), NOW(3), NOW(3))`,
      )
      .catch((e: unknown) => e);

    expect(causesOf(erro)).toMatch(/foreign key|1452|ER_NO_REFERENCED_ROW/i);
  });

  it('cliente com OS nao pode simplesmente sumir (ON DELETE RESTRICT)', async () => {
    await run(() => createServiceOrder(tenantA.context, ordem()));
    const erro = await getDb()
      .execute(sql`DELETE FROM customers WHERE id = ${clienteA}`)
      .catch((e: unknown) => e);
    expect(causesOf(erro)).toMatch(/foreign key|1451|ER_ROW_IS_REFERENCED/i);
  });
});

// ---------------------------------------------------------------------------

describe('idempotencia (itens 32, 93 e 127)', () => {
  it('o MESMO comando nao cria duas ordens', async () => {
    const primeiro = await run(() =>
      createServiceOrder(tenantA.context, ordem({ idempotencyKey: 'cmd-1' })),
    );
    const segundo = await run(() =>
      createServiceOrder(tenantA.context, ordem({ idempotencyKey: 'cmd-1' })),
    );

    expect(segundo.serviceOrderId).toBe(primeiro.serviceOrderId);
    expect(segundo.number).toBe(primeiro.number);
    expect(segundo.reused).toBe(true);

    const page = await listServiceOrders(tenantA.context, {});
    expect(page.total).toBe(1);
  });

  it('nao gasta numero da sequencia ao reencontrar o comando', async () => {
    await run(() => createServiceOrder(tenantA.context, ordem({ idempotencyKey: 'cmd-2' })));
    await run(() => createServiceOrder(tenantA.context, ordem({ idempotencyKey: 'cmd-2' })));
    const terceiro = await run(() =>
      createServiceOrder(tenantA.context, ordem({ idempotencyKey: 'cmd-3' })),
    );
    expect(terceiro.number).toBe(2);
  });

  it('comandos DIFERENTES criam ordens distintas', async () => {
    const a = await run(() => createServiceOrder(tenantA.context, ordem({ idempotencyKey: 'x' })));
    const b = await run(() => createServiceOrder(tenantA.context, ordem({ idempotencyKey: 'y' })));
    expect(a.serviceOrderId).not.toBe(b.serviceOrderId);
    expect(a.number).not.toBe(b.number);
  });

  it('a chave NAO e compartilhada entre tenants', async () => {
    const a = await run(() => createServiceOrder(tenantA.context, ordem({ idempotencyKey: 'k' })));
    const b = await run(() =>
      createServiceOrder(tenantB.context, {
        equipmentId: equipamentoB,
        customerReport: 'Nao liga.',
        idempotencyKey: 'k',
      }),
    );

    expect(b.serviceOrderId).not.toBe(a.serviceOrderId);
    expect(b.reused).toBe(false);
    // Cada empresa tem a sua sequencia: as duas comecam em 1.
    expect(a.number).toBe(1);
    expect(b.number).toBe(1);
  });

  it('envios SIMULTANEOS com a mesma chave produzem UMA ordem', async () => {
    const resultados = await Promise.all(
      Array.from({ length: 5 }, () =>
        run(() => createServiceOrder(tenantA.context, ordem({ idempotencyKey: 'corrida' }))),
      ),
    );

    const ids = new Set(resultados.map((r) => r.serviceOrderId));
    expect(ids.size).toBe(1);

    const [agregado] = await getDb()
      .select({ total: sql<number>`count(*)` })
      .from(serviceOrders)
      .where(eq(serviceOrders.tenantId, tenantA.tenantId));
    expect(Number(agregado!.total)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('correcao dos dados de abertura (itens 23, 41 a 43 e 111)', () => {
  it('corrige o relato e registra o texto ANTERIOR na auditoria', async () => {
    const created = await run(() => createServiceOrder(tenantA.context, ordem()));

    await run(() =>
      updateServiceOrder(tenantA.context, created.serviceOrderId, {
        customerReport: 'Cliente informa que o aparelho liga e desliga sozinho.',
      }),
    );

    const detail = await findServiceOrderDetail(tenantA.context, created.serviceOrderId);
    expect(detail!.order.customerReport).toContain('liga e desliga');

    const trilha = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'service_order.customer_report_updated'));

    expect(trilha).toHaveLength(1);
    expect(JSON.stringify(trilha[0]!.before)).toContain('nao liga');
  });

  it('nao gera registro quando nada mudou', async () => {
    const created = await run(() => createServiceOrder(tenantA.context, ordem()));
    await run(() =>
      updateServiceOrder(tenantA.context, created.serviceOrderId, {
        customerReport: 'Cliente informa que o aparelho nao liga.',
      }),
    );

    const trilha = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'service_order.customer_report_updated'));
    expect(trilha).toHaveLength(0);
  });

  it('nao ha caminho para trocar cliente, equipamento ou unidade', async () => {
    const created = await run(() => createServiceOrder(tenantA.context, ordem()));

    await run(() =>
      updateServiceOrder(tenantA.context, created.serviceOrderId, {
        customerReport: 'Outro relato.',
        // Estes campos simplesmente nao existem no schema de entrada.
        customerId: clienteB,
        equipmentId: equipamentoB,
        unitId: tenantB.unitId,
      } as unknown as Record<string, unknown>),
    );

    const detail = await findServiceOrderDetail(tenantA.context, created.serviceOrderId);
    expect(detail!.customer.id).toBe(clienteA);
    expect(detail!.equipmentItem.id).toBe(equipamentoA);
    expect(detail!.order.unitId).toBe(tenantA.unitId);
  });

  it('ordem de outro tenant nao e editavel nem com o ID em maos', async () => {
    const created = await run(() => createServiceOrder(tenantA.context, ordem()));
    await expect(
      run(() =>
        updateServiceOrder(tenantB.context, created.serviceOrderId, {
          customerReport: 'Invadido.',
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------

describe('historico estrutural (itens 37 e 38)', () => {
  it('a abertura entra na linha do tempo', async () => {
    const created = await run(() => createServiceOrder(tenantA.context, ordem()));
    const detail = await findServiceOrderDetail(tenantA.context, created.serviceOrderId);

    expect(detail!.timeline).toHaveLength(1);
    expect(detail!.timeline[0]!.kind).toBe(TIMELINE_KINDS.CREATED);
    expect(detail!.timeline[0]!.actorName).toBe(tenantA.context.userName);
  });

  it('a correcao do relato entra como fato proprio', async () => {
    const created = await run(() => createServiceOrder(tenantA.context, ordem()));
    await run(() =>
      updateServiceOrder(tenantA.context, created.serviceOrderId, {
        customerReport: 'Novo relato do cliente.',
      }),
    );

    const detail = await findServiceOrderDetail(tenantA.context, created.serviceOrderId);
    expect(detail!.timeline.map((t) => t.kind)).toEqual([
      TIMELINE_KINDS.CUSTOMER_REPORT_UPDATED,
      TIMELINE_KINDS.CREATED,
    ]);
  });

  it('a linha do tempo NAO carrega o relato do cliente (item 114)', async () => {
    const created = await run(() =>
      createServiceOrder(
        tenantA.context,
        ordem({ customerReport: 'Cliente informa que caiu na piscina da casa dele.' }),
      ),
    );

    const linhas = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(eq(serviceOrderTimeline.serviceOrderId, created.serviceOrderId));

    expect(JSON.stringify(linhas)).not.toContain('piscina');
  });
});

// ---------------------------------------------------------------------------

describe('auditoria e eventos (itens 35 e 36)', () => {
  it('registra a abertura sem copiar o relato para a trilha', async () => {
    const created = await run(() =>
      createServiceOrder(tenantA.context, ordem({ customerReport: 'Caiu da escada de casa.' })),
    );

    const trilha = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'service_order.created'));

    expect(trilha).toHaveLength(1);
    expect(trilha[0]!.entityId).toBe(created.serviceOrderId);
    expect(trilha[0]!.unitId).toBe(tenantA.unitId);
    expect(JSON.stringify(trilha[0]!.after)).not.toContain('escada');
    expect(JSON.stringify(trilha[0]!.after)).toContain('customerReportLength');
  });

  it('publica SERVICE_ORDER_CREATED no outbox', async () => {
    const created = await run(() => createServiceOrder(tenantA.context, ordem()));

    const eventos = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'SERVICE_ORDER_CREATED'));

    expect(eventos).toHaveLength(1);
    expect(JSON.stringify(eventos[0]!.payload)).toContain(created.serviceOrderId);
  });

  it('publica SERVICE_ORDER_UPDATED na correcao', async () => {
    const created = await run(() => createServiceOrder(tenantA.context, ordem()));
    await run(() =>
      updateServiceOrder(tenantA.context, created.serviceOrderId, {
        customerReport: 'Relato corrigido.',
      }),
    );

    const eventos = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'SERVICE_ORDER_UPDATED'));
    expect(eventos).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('busca e listagem (itens 45 a 50)', () => {
  beforeEach(async () => {
    await run(() => createServiceOrder(tenantA.context, ordem()));
    const outro = (
      await run(() =>
        createEquipment(tenantA.context, {
          customerId: clienteA,
          kind: 'Micro-ondas',
          brand: 'Electrolux',
          model: 'MEF33',
          serial: 'EL-99-88',
        }),
      )
    ).equipmentId;
    await run(() =>
      createServiceOrder(tenantA.context, {
        equipmentId: outro,
        customerReport: 'Nao esquenta.',
      }),
    );
  });

  it('encontra pelo numero exato, digitado como aparece impresso', async () => {
    for (const termo of ['1', 'OS 1', 'OS #000001']) {
      const page = await listServiceOrders(tenantA.context, { query: termo });
      expect(page.items.map((i) => i.number)).toContain(1);
    }
  });

  it('encontra por cliente, marca, modelo e serie', async () => {
    for (const termo of ['Dona do Aparelho', 'Electrolux', 'MEF33', 'el9988']) {
      const page = await listServiceOrders(tenantA.context, { query: termo });
      expect(page.items.length).toBeGreaterThan(0);
    }
  });

  it('a busca direta pelo numero e escopada na unidade ativa', async () => {
    const achada = await findServiceOrderByNumber(tenantA.context, 1);
    expect(achada?.number).toBe(1);
    expect(await findServiceOrderByNumber(tenantA.context, 9999)).toBeNull();
  });

  it('ordena da mais recente para a mais antiga', async () => {
    const page = await listServiceOrders(tenantA.context, {});
    expect(page.items.map((i) => i.number)).toEqual([2, 1]);
  });

  it('pagina no servidor com ordenacao deterministica', async () => {
    const p1 = await listServiceOrders(tenantA.context, { page: 1, pageSize: 1 });
    const p2 = await listServiceOrders(tenantA.context, { page: 2, pageSize: 1 });

    expect(p1.items).toHaveLength(1);
    expect(p2.items).toHaveLength(1);
    expect(p1.items[0]!.id).not.toBe(p2.items[0]!.id);
    expect(p1.total).toBe(2);
    expect(p1.totalPages).toBe(2);
  });

  it('filtra por cliente e por periodo', async () => {
    const porCliente = await listServiceOrders(tenantA.context, { customerId: clienteA });
    expect(porCliente.total).toBe(2);

    const hoje = new Date().toISOString().slice(0, 10);
    expect((await listServiceOrders(tenantA.context, { from: hoje, to: hoje })).total).toBe(2);
    expect((await listServiceOrders(tenantA.context, { from: '2099-01-01' })).total).toBe(0);
  });

  it('traz cliente, equipamento e unidade sem consulta por linha', async () => {
    const page = await listServiceOrders(tenantA.context, {});
    for (const item of page.items) {
      expect(item.customerName).toBeTruthy();
      expect(item.equipmentKind).toBeTruthy();
      expect(item.unitName).toBeTruthy();
    }
  });

  it('a listagem de um tenant nunca mostra ordem do outro', async () => {
    await run(() =>
      createServiceOrder(tenantB.context, {
        equipmentId: equipamentoB,
        customerReport: 'Nao liga.',
      }),
    );

    const page = await listServiceOrders(tenantB.context, {});
    expect(page.total).toBe(1);
    expect(page.items[0]!.customerId).toBe(clienteB);
  });

  it('a ficha por ID conhecido de outro tenant devolve nada (item 65)', async () => {
    const page = await listServiceOrders(tenantA.context, {});
    const alvo = page.items[0]!.id;
    expect(await findServiceOrderDetail(tenantB.context, alvo)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('formato do numero (item 18)', () => {
  it('o banco guarda o valor cru; prefixo e padding vem da sequencia', async () => {
    await run(() => createServiceOrder(tenantA.context, ordem()));

    const [row] = await getDb()
      .select({ number: serviceOrders.number })
      .from(serviceOrders)
      .where(eq(serviceOrders.tenantId, tenantA.tenantId));

    expect(row!.number).toBe(1);

    const format = await getServiceOrderNumberFormat(tenantA.tenantId);
    expect(format).toEqual({ prefix: 'OS', padding: 6 });
  });
});

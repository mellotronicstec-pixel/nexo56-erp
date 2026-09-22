import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { addDays, todayIn } from '@/core/time/civil-date';
import { ValidationError } from '@/core/errors';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { loadWorkCenter } from '@/modules/work-center/application/work-center-queries';
import { compareWorkCenterItems } from '@/modules/work-center/domain/work-center';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  assignTenantRole,
  contextFor,
  createPlainUser,
  createRoleWithPermissions,
  createTenantFixture,
  createUnit,
  grantMembership,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/**
 * A CENTRAL DE TRABALHO contra MariaDB de verdade.
 *
 * O eixo: a Central LE e nunca inventa. O que mais se verifica aqui e que ela
 * nao mostra o que nao deve — outra empresa, outra unidade, modulo desligado,
 * permissao ausente — e que CONTAGEM E LISTA contam a mesma historia.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);
const hoje = () => todayIn('America/Sao_Paulo');

async function ligarCentral(fixture: TenantFixture): Promise<void> {
  await run(() =>
    setTenantFeature(fixture.context, {
      featureKey: FEATURES.OPERATIONS_WORK_CENTER,
      enabled: true,
    }),
  );
}

async function abrirOrdem(fixture: TenantFixture, nome = 'Cliente da Central'): Promise<string> {
  const { customerId } = await run(() =>
    createCustomer(fixture.context, {
      kind: 'individual',
      name: nome,
      contacts: [{ type: 'phone', value: '11933332222', isWhatsapp: false }],
    }),
  );
  const { equipmentId } = await run(() =>
    createEquipment(fixture.context, { customerId, kind: 'Televisor', brand: 'Marca' }),
  );
  const { serviceOrderId } = await run(() =>
    createServiceOrder(fixture.context, {
      equipmentId,
      customerReport: 'O aparelho nao liga.',
    }),
  );
  return serviceOrderId;
}

async function levarAte(fixture: TenantFixture, id: string, alvo: string): Promise<void> {
  const caminho: Record<string, string[]> = {
    awaiting_repair: ['awaiting_repair'],
    awaiting_approval: ['awaiting_approval'],
    awaiting_part: ['awaiting_repair', 'awaiting_part'],
    repair_completed: ['awaiting_repair', 'repair_completed'],
    awaiting_delivery_preparation: [
      'awaiting_repair',
      'repair_completed',
      'awaiting_delivery_preparation',
    ],
  };
  for (const passo of caminho[alvo] ?? []) {
    await run(() =>
      transitionServiceOrder(fixture.context, { serviceOrderId: id, to: passo as never }),
    );
  }
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
  tenantA = await createTenantFixture('wc-a', planId);
  tenantB = await createTenantFixture('wc-b', planId);

  for (const t of [tenantA, tenantB]) await ligarCentral(t);

  tenantA.context = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);
  tenantB.context = await contextFor(tenantB.tenantId, tenantB.adminUserId, tenantB.unitId);
});

describe('filas de Ordens de Servico', () => {
  it('conta cada estado na sua fila, e a lista concorda com o cartao', async () => {
    await abrirOrdem(tenantA);
    const emConserto = await abrirOrdem(tenantA);
    await levarAte(tenantA, emConserto, 'awaiting_repair');
    const semPeca = await abrirOrdem(tenantA);
    await levarAte(tenantA, semPeca, 'awaiting_part');

    const central = await run(() => loadWorkCenter(tenantA.context));
    const porFila = Object.fromEntries(central.summary.map((s) => [s.queue, s.total]));

    expect(porFila.awaiting_technical_opinion).toBe(1);
    expect(porFila.awaiting_repair).toBe(1);
    expect(porFila.awaiting_part).toBe(1);

    /** O CARTAO E A LISTA CONTAM A MESMA HISTORIA (item 160). */
    for (const fila of ['awaiting_repair', 'awaiting_part'] as const) {
      const filtrada = await run(() => loadWorkCenter(tenantA.context, { queue: fila }));
      expect(filtrada.items.total).toBe(porFila[fila]);
      expect(filtrada.items.items.every((i) => i.status === fila)).toBe(true);
    }
  });

  it('as sete filas aparecem mesmo vazias, com zero', async () => {
    const central = await run(() => loadWorkCenter(tenantA.context));
    expect(central.summary).toHaveLength(7);
    expect(central.summary.every((s) => s.total === 0)).toBe(true);
  });

  it('OS finalizada e cancelada somem do trabalho ativo', async () => {
    const finalizada = await abrirOrdem(tenantA);
    await levarAte(tenantA, finalizada, 'awaiting_delivery_preparation');

    const antes = await run(() => loadWorkCenter(tenantA.context));
    expect(antes.items.total).toBe(1);

    /** Encerrar pela porta oficial: a Central nao escreve status. */
    await getDb()
      .update(serviceOrders)
      .set({ status: 'completed' })
      .where(eq(serviceOrders.id, finalizada));

    const depois = await run(() => loadWorkCenter(tenantA.context));
    expect(depois.items.total).toBe(0);
    expect(depois.summary.every((s) => s.total === 0)).toBe(true);
  });

  it('recusa fila inventada em vez de ignorar em silencio', async () => {
    await expect(
      run(() => loadWorkCenter(tenantA.context, { queue: 'urgente' })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      run(() => loadWorkCenter(tenantA.context, { queue: 'completed' })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('recusa filtro de atencao inventado', async () => {
    await expect(
      run(() => loadWorkCenter(tenantA.context, { attention: 'urgentissima' })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('visao desconhecida volta ao padrao seguro, sem erro', async () => {
    const central = await run(() => loadWorkCenter(tenantA.context, { view: 'sei-la' }));
    expect(central.view).toBe('unit');
  });
});

// ---------------------------------------------------------------------------
// Isolamento
// ---------------------------------------------------------------------------

describe('isolamento entre empresas', () => {
  it('a Central de uma empresa nao enxerga a outra, nem na lista nem na contagem', async () => {
    await abrirOrdem(tenantA, 'Cliente da empresa A');
    await abrirOrdem(tenantB, 'Cliente da empresa B');
    await abrirOrdem(tenantB, 'Outro da empresa B');

    const centralA = await run(() => loadWorkCenter(tenantA.context));

    expect(centralA.items.total).toBe(1);
    expect(centralA.items.items.map((i) => i.customerName)).toEqual(['Cliente da empresa A']);

    /**
     * O VAZAMENTO POR CONTAGEM E O MAIS FACIL DE ESQUECER (item 90): o cartao
     * nao mostra nome nenhum, mas um numero errado ja conta quanto trabalho a
     * outra empresa tem.
     */
    const soma = centralA.summary.reduce((total, s) => total + s.total, 0);
    expect(soma).toBe(1);
    expect(centralA.attentionSummary.unassigned).toBe(1);
  });

  it('a busca nao atravessa a fronteira da empresa', async () => {
    await abrirOrdem(tenantB, 'Nome exclusivo da B');

    const central = await run(() =>
      loadWorkCenter(tenantA.context, { query: 'Nome exclusivo da B' }),
    );
    expect(central.items.total).toBe(0);
    expect(central.items.items).toHaveLength(0);
  });
});

describe('isolamento entre unidades', () => {
  it('a Central mostra a unidade ATIVA, e nao soma as demais', async () => {
    await abrirOrdem(tenantA, 'Cliente da matriz');

    const filial = await createUnit(tenantA.tenantId, 'Filial');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, filial);
    const naFilial = await contextFor(tenantA.tenantId, tenantA.adminUserId, filial);

    const centralFilial = await run(() => loadWorkCenter(naFilial));

    expect(centralFilial.unitId).toBe(filial);
    expect(centralFilial.items.total).toBe(0);
    expect(centralFilial.summary.reduce((t, s) => t + s.total, 0)).toBe(0);
    expect(centralFilial.attentionSummary.unassigned).toBe(0);

    /** E a matriz continua vendo o que e dela. */
    const centralMatriz = await run(() => loadWorkCenter(tenantA.context));
    expect(centralMatriz.items.total).toBe(1);
  });

  it('sem unidade ativa nao ha o que mostrar, e nada vaza', async () => {
    await abrirOrdem(tenantA);

    const semUnidade = { ...tenantA.context, activeUnitId: null };
    const central = await run(() => loadWorkCenter(semUnidade));

    expect(central.items.total).toBe(0);
    expect(central.canSeeOrders).toBe(false);
    expect(central.summary.every((s) => s.total === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Effective Access
// ---------------------------------------------------------------------------

describe('permissoes: ver a Central nao e ver as Ordens de Servico', () => {
  async function pessoaCom(
    permissoes: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][],
    email: string,
  ) {
    const userId = await createPlainUser(tenantA.tenantId, email);
    await grantMembership(tenantA.tenantId, userId, tenantA.unitId);
    const roleId = await createRoleWithPermissions(tenantA.tenantId, `papel-${email}`, permissoes);
    await assignTenantRole(tenantA.tenantId, userId, roleId);
    return contextFor(tenantA.tenantId, userId, tenantA.unitId);
  }

  it('quem abre a Central sem service_orders.view NAO ve OS nenhuma', async () => {
    await abrirOrdem(tenantA, 'Nao deve vazar');

    const soCentral = await pessoaCom([PERMISSIONS.WORK_CENTER_VIEW], 'so-central@wc-a.invalid');
    const central = await run(() => loadWorkCenter(soCentral));

    expect(central.canSeeOrders).toBe(false);
    expect(central.items.total).toBe(0);
    expect(central.items.items).toHaveLength(0);
    /** Nem pela contagem (item 91). */
    expect(central.summary.every((s) => s.total === 0)).toBe(true);
    expect(central.attentionSummary).toEqual({
      overdueFollowUp: 0,
      followUpToday: 0,
      overdueTask: 0,
      unassigned: 0,
    });
  });

  it('quem tem service_orders.view ve o conteudo', async () => {
    await abrirOrdem(tenantA, 'Deve aparecer');

    const completo = await pessoaCom(
      [PERMISSIONS.WORK_CENTER_VIEW, PERMISSIONS.SERVICE_ORDERS_VIEW],
      'central-e-os@wc-a.invalid',
    );
    const central = await run(() => loadWorkCenter(completo));

    expect(central.canSeeOrders).toBe(true);
    expect(central.items.total).toBe(1);
    expect(central.items.items[0]!.customerName).toBe('Deve aparecer');
  });
});

// ---------------------------------------------------------------------------
// Modularidade
// ---------------------------------------------------------------------------

describe('a Agenda desligada NAO quebra a Central (item 20)', () => {
  it('as filas de OS, o follow-up e as tarefas de fluxo continuam inteiros', async () => {
    const ordem = await abrirOrdem(tenantA, 'Cliente com acompanhamento');
    await levarAte(tenantA, ordem, 'awaiting_delivery_preparation');

    /** Acompanhamento vencido, gravado pelo nucleo no Prompt 08. */
    await getDb()
      .update(serviceOrders)
      .set({ followUpAt: addDays(hoje(), -3) })
      .where(eq(serviceOrders.id, ordem));

    await run(() =>
      setTenantFeature(tenantA.context, { featureKey: FEATURES.OPERATIONS_AGENDA, enabled: false }),
    );
    const semAgenda = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    const central = await run(() => loadWorkCenter(semAgenda));

    expect(central.agendaAvailable).toBe(false);
    /** A OS continua na fila. */
    expect(central.items.total).toBe(1);
    expect(central.items.items[0]!.status).toBe('awaiting_delivery_preparation');
    /** O acompanhamento continua sendo sinalizado. */
    expect(central.items.items[0]!.flags).toContain('overdue_follow_up');
    expect(central.attentionSummary.overdueFollowUp).toBe(1);
    /** E a tarefa de fluxo do Prompt 08 continua sendo contada. */
    expect(central.items.items[0]!.openTaskCount).toBeGreaterThan(0);
  });

  it('com a Agenda ligada, tarefa geral vencida tambem conta como atraso', async () => {
    const ordem = await abrirOrdem(tenantA, 'Cliente com tarefa da agenda');

    await run(() =>
      setTenantFeature(tenantA.context, { featureKey: FEATURES.OPERATIONS_AGENDA, enabled: true }),
    );
    const comAgenda = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    const { createTask } = await import('@/modules/agenda/application/task-service');
    await run(() =>
      createTask(comAgenda, {
        title: 'Ligar para o cliente',
        serviceOrderId: ordem,
        dueDate: addDays(hoje(), -2),
      }),
    );

    const ligada = await run(() => loadWorkCenter(comAgenda));
    expect(ligada.agendaAvailable).toBe(true);
    expect(ligada.attentionSummary.overdueTask).toBe(1);
    expect(ligada.items.items[0]!.flags).toContain('overdue_task');

    /**
     * DESLIGAR A AGENDA NAO APAGA A OS — apaga so o sinal que era dela. A
     * tarefa continua gravada; a Central deixa de considera-la, porque
     * mostrar dado de modulo indisponivel seria vazar o que a empresa
     * escolheu nao ter (item 19).
     */
    await run(() =>
      setTenantFeature(comAgenda, { featureKey: FEATURES.OPERATIONS_AGENDA, enabled: false }),
    );
    const semAgenda = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);
    const desligada = await run(() => loadWorkCenter(semAgenda));

    expect(desligada.agendaAvailable).toBe(false);
    expect(desligada.attentionSummary.overdueTask).toBe(0);
    expect(desligada.items.items[0]!.flags).not.toContain('overdue_task');
    /** A OS em si continua exatamente onde estava. */
    expect(desligada.items.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Sinais de atencao e ordenacao
// ---------------------------------------------------------------------------

describe('sinais de atencao', () => {
  it('conta acompanhamento vencido, de hoje e OS sem responsavel', async () => {
    const vencida = await abrirOrdem(tenantA, 'Vencida');
    const deHoje = await abrirOrdem(tenantA, 'De hoje');
    await abrirOrdem(tenantA, 'Sem acompanhamento');

    await getDb()
      .update(serviceOrders)
      .set({ followUpAt: addDays(hoje(), -5) })
      .where(eq(serviceOrders.id, vencida));
    await getDb()
      .update(serviceOrders)
      .set({ followUpAt: hoje() })
      .where(eq(serviceOrders.id, deHoje));

    const central = await run(() => loadWorkCenter(tenantA.context));

    expect(central.attentionSummary.overdueFollowUp).toBe(1);
    expect(central.attentionSummary.followUpToday).toBe(1);
    /** Nenhuma tem tecnico atribuido. */
    expect(central.attentionSummary.unassigned).toBe(3);
  });

  it('filtrar por atencao devolve exatamente o que o cartao contou', async () => {
    const vencida = await abrirOrdem(tenantA, 'Vencida');
    await abrirOrdem(tenantA, 'Tranquila');

    await getDb()
      .update(serviceOrders)
      .set({ followUpAt: addDays(hoje(), -1) })
      .where(eq(serviceOrders.id, vencida));

    const central = await run(() => loadWorkCenter(tenantA.context));
    const filtrada = await run(() =>
      loadWorkCenter(tenantA.context, { attention: 'overdue_follow_up' }),
    );

    expect(filtrada.items.total).toBe(central.attentionSummary.overdueFollowUp);
    expect(filtrada.items.items).toHaveLength(1);
    expect(filtrada.items.items[0]!.customerName).toBe('Vencida');
  });
});

describe('ordenacao no banco = ordenacao no dominio', () => {
  it('o SQL devolve a mesma ordem que compareWorkCenterItems produziria', async () => {
    const vencidaAntiga = await abrirOrdem(tenantA, 'Vencida antiga');
    const vencidaRecente = await abrirOrdem(tenantA, 'Vencida recente');
    const deHoje = await abrirOrdem(tenantA, 'De hoje');
    await abrirOrdem(tenantA, 'Sem prazo');

    await getDb()
      .update(serviceOrders)
      .set({ followUpAt: addDays(hoje(), -10) })
      .where(eq(serviceOrders.id, vencidaAntiga));
    await getDb()
      .update(serviceOrders)
      .set({ followUpAt: addDays(hoje(), -1) })
      .where(eq(serviceOrders.id, vencidaRecente));
    await getDb()
      .update(serviceOrders)
      .set({ followUpAt: hoje() })
      .where(eq(serviceOrders.id, deHoje));

    const central = await run(() => loadWorkCenter(tenantA.context));
    const doBanco = central.items.items.map((i) => i.customerName);

    expect(doBanco).toEqual(['Vencida antiga', 'Vencida recente', 'De hoje', 'Sem prazo']);

    /** A MESMA regra, aplicada em memoria, chega ao mesmo lugar. */
    const emMemoria = [...central.items.items]
      .reverse()
      .sort(compareWorkCenterItems)
      .map((i) => i.customerName);
    expect(emMemoria).toEqual(doBanco);
  });
});

// ---------------------------------------------------------------------------
// Volume, paginacao e numero de consultas
// ---------------------------------------------------------------------------

describe('volume e paginacao', () => {
  /** Cria muitas OS reaproveitando cliente e aparelho: o foco e o volume de OS. */
  async function abrirVarias(quantidade: number): Promise<void> {
    const { customerId } = await run(() =>
      createCustomer(tenantA.context, {
        kind: 'individual',
        name: 'Cliente de volume',
        contacts: [{ type: 'phone', value: '11911112222', isWhatsapp: false }],
      }),
    );
    const { equipmentId } = await run(() =>
      createEquipment(tenantA.context, { customerId, kind: 'Notebook' }),
    );

    for (let i = 0; i < quantidade; i += 1) {
      await run(() =>
        createServiceOrder(tenantA.context, {
          equipmentId,
          customerReport: `Defeito numero ${i}.`,
        }),
      );
    }
  }

  it('pagina sem repetir nem perder item, com ordem estavel entre paginas', async () => {
    await abrirVarias(60);

    const vistos = new Set<string>();
    const numeros: number[] = [];
    let total = 0;

    for (let pagina = 1; pagina <= 3; pagina += 1) {
      const central = await run(() => loadWorkCenter(tenantA.context, { page: pagina }));
      total = central.items.total;

      for (const item of central.items.items) {
        /** Nenhum item pode aparecer em duas paginas. */
        expect(vistos.has(item.serviceOrderId)).toBe(false);
        vistos.add(item.serviceOrderId);
        numeros.push(item.number);
      }
    }

    expect(total).toBe(60);
    expect(vistos.size).toBe(60);

    /**
     * Sem acompanhamento, todas empatam em urgencia e data — entao a ordem e
     * decidida SO pelo numero da OS. Se a paginacao fosse instavel, esta
     * sequencia sairia embaralhada ou com buracos.
     */
    const ordenados = [...numeros].sort((a, b) => a - b);
    expect(numeros).toEqual(ordenados);
  });

  it('a contagem do cartao bate com a soma das paginas', async () => {
    await abrirVarias(30);

    const central = await run(() => loadWorkCenter(tenantA.context));
    const doCartao = central.summary.reduce((soma, s) => soma + s.total, 0);

    let somadas = 0;
    for (let pagina = 1; pagina <= 2; pagina += 1) {
      const p = await run(() => loadWorkCenter(tenantA.context, { page: pagina }));
      somadas += p.items.items.length;
    }

    expect(doCartao).toBe(30);
    expect(somadas).toBe(30);
    expect(central.items.total).toBe(30);
  });

  it('pagina alem do fim devolve lista vazia, nao erro', async () => {
    await abrirVarias(5);
    const central = await run(() => loadWorkCenter(tenantA.context, { page: 99 }));
    expect(central.items.items).toHaveLength(0);
    expect(central.items.total).toBe(5);
  });

  it('o tamanho da pagina tem teto: a Central nao devolve a carteira inteira', async () => {
    await abrirVarias(40);
    const central = await run(() => loadWorkCenter(tenantA.context));
    /** `resolveOffset` aplica o limite da fundacao (25 por padrao). */
    expect(central.items.items.length).toBeLessThanOrEqual(25);
    expect(central.items.pageSize).toBeLessThanOrEqual(100);
  });

  /**
   * N+1 MEDIDO, NAO PROMETIDO (item 93).
   *
   * A Central faz um numero FIXO de consultas, independente de quantas OS
   * existam: as decisoes de acesso, as contagens, a lista e o total. Se
   * alguem introduzir uma consulta por linha, o numero cresce com o volume e
   * este teste quebra — que e exatamente o ponto.
   */
  it('o numero de consultas nao cresce com o numero de Ordens de Servico', async () => {
    /**
     * O contador e GLOBAL, nao de sessao: o pool entrega conexoes diferentes a
     * cada consulta, e um contador por sessao mediria o nada. A suite roda com
     * `fileParallelism: false`, entao nada mais disputa o banco durante a
     * medicao.
     */
    const contar = async (): Promise<number> => {
      const linhas = await getDb().execute(sql`SHOW GLOBAL STATUS LIKE 'Questions'`);
      return Number((linhas as unknown as Array<Array<{ Value: string }>>)[0]?.[0]?.Value ?? 0);
    };

    await abrirVarias(5);
    const inicio5 = await contar();
    await run(() => loadWorkCenter(tenantA.context));
    const consultasCom5 = (await contar()) - inicio5;

    await abrirVarias(40);
    const inicio45 = await contar();
    await run(() => loadWorkCenter(tenantA.context));
    const consultasCom45 = (await contar()) - inicio45;

    /**
     * NOVE VEZES MAIS ORDENS, O MESMO NUMERO DE CONSULTAS.
     *
     * A folga de duas consultas existe porque o pool pode abrir conexao ou
     * emitir um ping entre as medicoes — ruido de infraestrutura, nao de
     * consulta. Um N+1 de verdade acrescentaria QUARENTA, e nenhuma tolerancia
     * razoavel esconde isso.
     */
    expect(consultasCom45).toBeLessThanOrEqual(consultasCom5 + 2);
    /** E poucas em termos absolutos: nada de dezenas de idas para uma tela. */
    expect(consultasCom5).toBeLessThanOrEqual(12);
  });
});

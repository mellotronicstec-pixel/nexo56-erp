import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { todayIn } from '@/core/time/civil-date';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import {
  assignTechnician,
  cancelServiceOrder,
  completeTask,
  loadPendingWork,
  notifyCustomerReady,
  requestPartPickup,
  rescheduleFollowUp,
} from '@/modules/service-orders/application/service-order-actions';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { findServiceOrderDetail } from '@/modules/service-orders/application/service-order-queries';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import {
  DELIVERY_PREPARATION_TASK_DESCRIPTION,
  DELIVERY_PREPARATION_TASK_TITLE,
  TASK_KINDS,
} from '@/modules/service-orders/domain/workflow';
import {
  serviceOrderTasks,
  serviceOrderTimeline,
  serviceOrders,
} from '@/modules/service-orders/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  contextFor,
  createPlainUser,
  createTenantFixture,
  createUnit,
  grantMembership,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/**
 * WORKFLOW DA ORDEM DE SERVICO (Prompt 08, itens 109 a 135).
 *
 * O eixo destes testes: `status` so muda por `transitionServiceOrder`, toda
 * transicao deixa rastro (linha do tempo, auditoria e evento), acao NAO e
 * estado, e duas pessoas trabalhando ao mesmo tempo na mesma OS nao se
 * sobrescrevem em silencio.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let ordemId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

async function abrirOrdem(fixture: TenantFixture): Promise<string> {
  const customerId = (
    await run(() =>
      createCustomer(fixture.context, {
        kind: 'individual',
        name: 'Cliente da OS',
        contacts: [{ type: 'phone', value: '11988887777', isWhatsapp: false }],
      }),
    )
  ).customerId;

  const equipmentId = (
    await run(() => createEquipment(fixture.context, { customerId, kind: 'Televisor' }))
  ).equipmentId;

  const created = await run(() =>
    createServiceOrder(fixture.context, {
      equipmentId,
      customerReport: 'Cliente informa que o aparelho nao liga.',
    }),
  );

  return created.serviceOrderId;
}

/** Leva a OS ate o estado pedido pelo caminho valido da matriz. */
async function levarAte(alvo: string, fixture: TenantFixture = tenantA, id = ordemId) {
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

async function statusDe(id: string): Promise<string> {
  const [row] = await getDb()
    .select({ status: serviceOrders.status, version: serviceOrders.version })
    .from(serviceOrders)
    .where(eq(serviceOrders.id, id))
    .limit(1);
  return row!.status;
}

async function versaoDe(id: string): Promise<number> {
  const [row] = await getDb()
    .select({ version: serviceOrders.version })
    .from(serviceOrders)
    .where(eq(serviceOrders.id, id))
    .limit(1);
  return row!.version;
}

async function tarefasDe(id: string) {
  return getDb().select().from(serviceOrderTasks).where(eq(serviceOrderTasks.serviceOrderId, id));
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
  tenantA = await createTenantFixture('wf-a', planId);
  tenantB = await createTenantFixture('wf-b', planId);
  ordemId = await abrirOrdem(tenantA);
});

// ---------------------------------------------------------------------------
// Estados e transicoes
// ---------------------------------------------------------------------------

describe('transicoes validas (itens 109 e 110)', () => {
  it('a OS nasce Aguardando Parecer Tecnico com versao 1', async () => {
    expect(await statusDe(ordemId)).toBe('awaiting_technical_opinion');
    expect(await versaoDe(ordemId)).toBe(1);
  });

  it('a transicao grava estado, versao e o instante da mudanca', async () => {
    const resultado = await run(() =>
      transitionServiceOrder(tenantA.context, {
        serviceOrderId: ordemId,
        to: 'awaiting_repair',
      }),
    );

    expect(resultado).toMatchObject({
      from: 'awaiting_technical_opinion',
      to: 'awaiting_repair',
      version: 2,
    });

    const [row] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId))
      .limit(1);

    expect(row!.status).toBe('awaiting_repair');
    expect(row!.version).toBe(2);
    expect(row!.statusChangedAt).toBeInstanceOf(Date);
  });

  it('percorre o fluxo inteiro ate Finalizada', async () => {
    await levarAte('awaiting_delivery_preparation');
    expect(await statusDe(ordemId)).toBe('awaiting_delivery_preparation');

    const [tarefa] = await tarefasDe(ordemId);
    await run(() => completeTask(tenantA.context, tarefa!.id));
    await run(() => notifyCustomerReady(tenantA.context, ordemId));
    expect(await statusDe(ordemId)).toBe('awaiting_customer_pickup');

    await run(() =>
      transitionServiceOrder(tenantA.context, { serviceOrderId: ordemId, to: 'completed' }),
    );
    expect(await statusDe(ordemId)).toBe('completed');
  });
});

describe('transicoes invalidas (itens 110 e 111)', () => {
  it('salto de etapa e recusado com mensagem em portugues, e o estado nao muda', async () => {
    await expect(
      run(() =>
        transitionServiceOrder(tenantA.context, { serviceOrderId: ordemId, to: 'completed' }),
      ),
    ).rejects.toThrow(BusinessRuleError);

    expect(await statusDe(ordemId)).toBe('awaiting_technical_opinion');
    expect(await versaoDe(ordemId)).toBe(1);
  });

  it('estado que nao existe e recusado antes de qualquer gravacao', async () => {
    await expect(
      run(() =>
        transitionServiceOrder(tenantA.context, {
          serviceOrderId: ordemId,
          to: 'aguardando_orcamento' as never,
        }),
      ),
    ).rejects.toThrow(ValidationError);

    expect(await versaoDe(ordemId)).toBe(1);
  });

  it('de um estado terminal nao sai mais nada (itens 112 e 113)', async () => {
    await run(() =>
      cancelServiceOrder(tenantA.context, ordemId, { reason: 'Cliente desistiu do conserto.' }),
    );
    expect(await statusDe(ordemId)).toBe('cancelled');

    for (const destino of ['awaiting_repair', 'completed', 'cancelled'] as const) {
      await expect(
        run(() =>
          transitionServiceOrder(tenantA.context, { serviceOrderId: ordemId, to: destino }),
        ),
      ).rejects.toThrow(BusinessRuleError);
    }

    expect(await statusDe(ordemId)).toBe('cancelled');
  });

  it('Aguardando Cliente Retirar so e alcancada pela ACAO, nunca pelo seletor (item 132)', async () => {
    await levarAte('awaiting_delivery_preparation');

    await expect(
      run(() =>
        transitionServiceOrder(tenantA.context, {
          serviceOrderId: ordemId,
          to: 'awaiting_customer_pickup',
        }),
      ),
    ).rejects.toThrow(BusinessRuleError);

    expect(await statusDe(ordemId)).toBe('awaiting_delivery_preparation');
  });
});

// ---------------------------------------------------------------------------
// Rastro
// ---------------------------------------------------------------------------

describe('rastro de cada transicao (itens 47 a 49 e 114)', () => {
  it('escreve linha do tempo, auditoria e evento na MESMA transacao', async () => {
    await run(() =>
      transitionServiceOrder(tenantA.context, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
    );

    const linha = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(
        and(
          eq(serviceOrderTimeline.serviceOrderId, ordemId),
          eq(serviceOrderTimeline.kind, 'status_changed'),
        ),
      );
    expect(linha).toHaveLength(1);
    expect(linha[0]!.summary).toContain('Aguardando Conserto');
    expect(linha[0]!.actorId).toBe(tenantA.adminUserId);

    const auditoria = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'service_order.status_changed'));
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]!.entityId).toBe(ordemId);

    const eventos = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'SERVICE_ORDER_STATUS_CHANGED'));
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.payload).toMatchObject({
      from: 'awaiting_technical_opinion',
      to: 'awaiting_repair',
    });
  });

  it('o evento NAO carrega relato do cliente nem nome de ninguem', async () => {
    await run(() =>
      transitionServiceOrder(tenantA.context, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
    );

    const [evento] = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'SERVICE_ORDER_STATUS_CHANGED'));

    const texto = JSON.stringify(evento!.payload);
    expect(texto).not.toContain('nao liga');
    expect(texto).not.toContain('Cliente da OS');
  });

  it('a transicao recusada nao deixa rastro nenhum', async () => {
    await expect(
      run(() =>
        transitionServiceOrder(tenantA.context, { serviceOrderId: ordemId, to: 'completed' }),
      ),
    ).rejects.toThrow();

    const linha = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(
        and(
          eq(serviceOrderTimeline.serviceOrderId, ordemId),
          eq(serviceOrderTimeline.kind, 'status_changed'),
        ),
      );
    expect(linha).toHaveLength(0);
  });

  it('o motivo do cancelamento fica na linha do tempo (itens 107 e 108)', async () => {
    await run(() =>
      cancelServiceOrder(tenantA.context, ordemId, {
        reason: 'Cliente retirou o aparelho sem consertar.',
      }),
    );

    const [entrada] = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(
        and(
          eq(serviceOrderTimeline.serviceOrderId, ordemId),
          eq(serviceOrderTimeline.kind, 'status_changed'),
        ),
      );

    expect(entrada!.reason).toBe('Cliente retirou o aparelho sem consertar.');
  });

  it('o motivo chega a FICHA, e nao so ao banco (item 108)', async () => {
    // Exigir a justificativa e nunca mostra-la transformaria a exigencia em
    // burocracia: quem abre a ficha meses depois precisa ler por que a ordem
    // foi encerrada, nao so que foi.
    await run(() =>
      cancelServiceOrder(tenantA.context, ordemId, { reason: 'Aparelho sem conserto viavel.' }),
    );

    const detalhe = await run(() => findServiceOrderDetail(tenantA.context, ordemId));
    const entrada = detalhe!.timeline.find((item) => item.kind === 'status_changed');
    expect(entrada?.reason).toBe('Aparelho sem conserto viavel.');
  });

  it('cancelar sem motivo e recusado (item 53)', async () => {
    await expect(
      run(() => cancelServiceOrder(tenantA.context, ordemId, { reason: '  ' })),
    ).rejects.toThrow(ValidationError);
    expect(await statusDe(ordemId)).toBe('awaiting_technical_opinion');
  });
});

// ---------------------------------------------------------------------------
// Concorrencia
// ---------------------------------------------------------------------------

describe('concorrencia (itens 11, 117 e 118)', () => {
  it('versao antiga na mao perde a corrida, com aviso — nao sobrescreve', async () => {
    const versaoLida = await versaoDe(ordemId);

    await run(() =>
      transitionServiceOrder(tenantA.context, {
        serviceOrderId: ordemId,
        to: 'awaiting_repair',
        expectedVersion: versaoLida,
      }),
    );

    await expect(
      run(() =>
        transitionServiceOrder(tenantA.context, {
          serviceOrderId: ordemId,
          to: 'awaiting_part',
          expectedVersion: versaoLida,
        }),
      ),
    ).rejects.toThrow(ConflictError);

    expect(await statusDe(ordemId)).toBe('awaiting_repair');
    expect(await versaoDe(ordemId)).toBe(versaoLida + 1);
  });

  it('duas transicoes SIMULTANEAS a partir do mesmo estado: so uma vence', async () => {
    const versao = await versaoDe(ordemId);

    /**
     * As duas comecam da mesma leitura, como duas abas abertas na mesma OS.
     * O compare-and-swap decide: a segunda nao encontra a linha no estado que
     * leu e volta atras inteira.
     */
    const resultados = await Promise.allSettled([
      run(() =>
        transitionServiceOrder(tenantA.context, {
          serviceOrderId: ordemId,
          to: 'awaiting_repair',
          expectedVersion: versao,
        }),
      ),
      run(() =>
        transitionServiceOrder(tenantA.context, {
          serviceOrderId: ordemId,
          to: 'awaiting_approval',
          expectedVersion: versao,
        }),
      ),
    ]);

    const vencedoras = resultados.filter((r) => r.status === 'fulfilled');
    expect(vencedoras).toHaveLength(1);

    // E o rastro acompanha: uma unica mudanca de estado registrada.
    const linha = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(
        and(
          eq(serviceOrderTimeline.serviceOrderId, ordemId),
          eq(serviceOrderTimeline.kind, 'status_changed'),
        ),
      );
    expect(linha).toHaveLength(1);
    expect(await versaoDe(ordemId)).toBe(versao + 1);
  });

  it('sem versao informada, a transicao usa a versao lida agora', async () => {
    // Chamada de sistema (job, futura API) nao tem tela para ler versao.
    await run(() =>
      transitionServiceOrder(tenantA.context, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
    );
    expect(await statusDe(ordemId)).toBe('awaiting_repair');
  });
});

// ---------------------------------------------------------------------------
// Follow-up
// ---------------------------------------------------------------------------

describe('follow-up (itens 119, 120 e 122)', () => {
  it('a abertura ja agenda o acompanhamento para +2 dias', async () => {
    const [row] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId))
      .limit(1);

    const hoje = todayIn(tenantA.context.tenantTimezone);
    const esperado = new Date(`${hoje}T00:00:00Z`);
    esperado.setUTCDate(esperado.getUTCDate() + 2);

    expect(row!.followUpAt).toBe(esperado.toISOString().slice(0, 10));
  });

  it('ir para Aguardando Conserto reagenda para +3 dias', async () => {
    await run(() =>
      transitionServiceOrder(tenantA.context, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
    );

    const [row] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId))
      .limit(1);

    const hoje = todayIn(tenantA.context.tenantTimezone);
    const esperado = new Date(`${hoje}T00:00:00Z`);
    esperado.setUTCDate(esperado.getUTCDate() + 3);

    expect(row!.followUpAt).toBe(esperado.toISOString().slice(0, 10));
  });

  it('estado sem prazo proprio MANTEM o vigente, sem inventar numero', async () => {
    await run(() =>
      transitionServiceOrder(tenantA.context, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
    );
    const [antes] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId))
      .limit(1);

    await run(() =>
      transitionServiceOrder(tenantA.context, { serviceOrderId: ordemId, to: 'awaiting_part' }),
    );
    const [depois] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId))
      .limit(1);

    expect(depois!.followUpAt).toBe(antes!.followUpAt);
  });

  it('finalizar e cancelar tiram a ordem do radar (itens 127 e 128)', async () => {
    await run(() =>
      cancelServiceOrder(tenantA.context, ordemId, { reason: 'Aparelho sem conserto viavel.' }),
    );

    const [row] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId))
      .limit(1);

    expect(row!.followUpAt).toBeNull();
  });

  it('reagendar a mao grava o prazo, registra na linha do tempo e libera alerta novo', async () => {
    await getDb()
      .update(serviceOrders)
      .set({ followUpAlertedFor: '2026-01-01' })
      .where(eq(serviceOrders.id, ordemId));

    await run(() => rescheduleFollowUp(tenantA.context, ordemId, { followUpAt: '2026-12-24' }));

    const [row] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId))
      .limit(1);

    expect(row!.followUpAt).toBe('2026-12-24');
    expect(row!.followUpAlertedFor).toBeNull();

    const linha = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(
        and(
          eq(serviceOrderTimeline.serviceOrderId, ordemId),
          eq(serviceOrderTimeline.kind, 'follow_up_rescheduled'),
        ),
      );
    expect(linha).toHaveLength(1);
  });

  it('data vazia encerra o acompanhamento; data invalida e recusada', async () => {
    await run(() => rescheduleFollowUp(tenantA.context, ordemId, { followUpAt: '' }));
    const [row] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId))
      .limit(1);
    expect(row!.followUpAt).toBeNull();

    await expect(
      run(() => rescheduleFollowUp(tenantA.context, ordemId, { followUpAt: '24/12/2026' })),
    ).rejects.toThrow(ValidationError);
  });

  it('as pendencias da unidade saem de CONSULTA, nao de tabela de alertas', async () => {
    await run(() => rescheduleFollowUp(tenantA.context, ordemId, { followUpAt: '2020-01-01' }));

    const pendencias = await run(() => loadPendingWork(tenantA.context));
    expect(pendencias.overdueOrders.map((item) => item.id)).toContain(ordemId);
    expect(pendencias.dueTodayOrders).toHaveLength(0);

    // Finalizada sai do radar na hora, sem depender de nenhum job.
    await run(() => cancelServiceOrder(tenantA.context, ordemId, { reason: 'Cliente desistiu.' }));
    const depois = await run(() => loadPendingWork(tenantA.context));
    expect(depois.overdueOrders).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

describe('preparacao para entrega (itens 130, 131 e 133)', () => {
  it('entrar em Aguardando Preparacao cria a tarefa com o texto oficial', async () => {
    await levarAte('awaiting_delivery_preparation');

    const tarefas = await tarefasDe(ordemId);
    expect(tarefas).toHaveLength(1);
    expect(tarefas[0]!.kind).toBe(TASK_KINDS.DELIVERY_PREPARATION);
    expect(tarefas[0]!.title).toBe(DELIVERY_PREPARATION_TASK_TITLE);
    expect(tarefas[0]!.description).toBe(DELIVERY_PREPARATION_TASK_DESCRIPTION);
    expect(tarefas[0]!.status).toBe('open');
    // Responsavel e quem abriu a OS (itens 24 e 25).
    expect(tarefas[0]!.assigneeId).toBe(tenantA.adminUserId);
    expect(tarefas[0]!.dueDate).not.toBeNull();
  });

  it('concluir a preparacao NAO muda o estado sozinha (item 61)', async () => {
    await levarAte('awaiting_delivery_preparation');
    const [tarefa] = await tarefasDe(ordemId);

    await run(() => completeTask(tenantA.context, tarefa!.id));

    expect(await statusDe(ordemId)).toBe('awaiting_delivery_preparation');
    const [depois] = await tarefasDe(ordemId);
    expect(depois!.status).toBe('done');
    expect(depois!.completedBy).toBe(tenantA.adminUserId);
  });

  it('concluir duas vezes e recusado (item 131)', async () => {
    await levarAte('awaiting_delivery_preparation');
    const [tarefa] = await tarefasDe(ordemId);

    await run(() => completeTask(tenantA.context, tarefa!.id));
    await expect(run(() => completeTask(tenantA.context, tarefa!.id))).rejects.toThrow(
      BusinessRuleError,
    );
  });

  it('finalizar a ordem encerra as tarefas que ficaram abertas', async () => {
    await levarAte('awaiting_delivery_preparation');

    await run(() =>
      cancelServiceOrder(tenantA.context, ordemId, { reason: 'Cliente retirou sem preparo.' }),
    );

    const tarefas = await tarefasDe(ordemId);
    expect(tarefas[0]!.status).toBe('cancelled');
    expect(tarefas[0]!.openMarker).toBeNull();
  });
});

describe('Buscar Peca e ACAO, nao estado (itens 13, 16 e 129)', () => {
  it('cria tarefa e mantem a ordem em Aguardando Peca', async () => {
    await levarAte('awaiting_part');
    const versaoAntes = await versaoDe(ordemId);

    await run(() =>
      requestPartPickup(tenantA.context, ordemId, { note: 'Fonte 12V, distribuidor da Rua X.' }),
    );

    expect(await statusDe(ordemId)).toBe('awaiting_part');
    expect(await versaoDe(ordemId)).toBe(versaoAntes);

    const tarefas = await tarefasDe(ordemId);
    expect(tarefas).toHaveLength(1);
    expect(tarefas[0]!.kind).toBe(TASK_KINDS.PART_PICKUP);
    expect(tarefas[0]!.description).toBe('Fonte 12V, distribuidor da Rua X.');

    const linha = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(
        and(
          eq(serviceOrderTimeline.serviceOrderId, ordemId),
          eq(serviceOrderTimeline.kind, 'part_pickup_requested'),
        ),
      );
    expect(linha).toHaveLength(1);
  });

  it('registrar duas vezes nao enche a bancada de tarefas iguais (item 130)', async () => {
    await levarAte('awaiting_part');

    await run(() => requestPartPickup(tenantA.context, ordemId, { note: 'Fonte 12V.' }));
    await run(() => requestPartPickup(tenantA.context, ordemId, { note: 'Fonte 12V.' }));

    const abertas = (await tarefasDe(ordemId)).filter((task) => task.status === 'open');
    expect(abertas).toHaveLength(1);
  });

  it('so faz sentido enquanto falta peca', async () => {
    await expect(
      run(() => requestPartPickup(tenantA.context, ordemId, { note: 'Qualquer peca.' })),
    ).rejects.toThrow(BusinessRuleError);

    expect(await tarefasDe(ordemId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Informar Ordem Disponivel
// ---------------------------------------------------------------------------

describe('Informar Ordem Disponivel (itens 132 a 135)', () => {
  it('e recusada enquanto a preparacao nao estiver concluida', async () => {
    await levarAte('awaiting_delivery_preparation');

    await expect(run(() => notifyCustomerReady(tenantA.context, ordemId))).rejects.toThrow(
      BusinessRuleError,
    );
    expect(await statusDe(ordemId)).toBe('awaiting_delivery_preparation');
  });

  it('depois da preparacao, leva a Aguardando Cliente Retirar e registra a INTENCAO', async () => {
    await levarAte('awaiting_delivery_preparation');
    const [tarefa] = await tarefasDe(ordemId);
    await run(() => completeTask(tenantA.context, tarefa!.id));

    await run(() => notifyCustomerReady(tenantA.context, ordemId));

    expect(await statusDe(ordemId)).toBe('awaiting_customer_pickup');

    const [entrada] = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(
        and(
          eq(serviceOrderTimeline.serviceOrderId, ordemId),
          eq(serviceOrderTimeline.kind, 'customer_notification_requested'),
        ),
      );
    // O texto diz a VERDADE: nada foi enviado (item 64).
    expect(entrada!.summary).toContain('envio automatico ainda nao esta disponivel');

    const [evento] = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED'));
    expect(evento!.payload).toMatchObject({ delivered: false, reason: 'ready_for_pickup' });
  });

  it('fora do estado de preparacao, a acao nem existe', async () => {
    await expect(run(() => notifyCustomerReady(tenantA.context, ordemId))).rejects.toThrow(
      BusinessRuleError,
    );
  });
});

// ---------------------------------------------------------------------------
// Tecnico responsavel
// ---------------------------------------------------------------------------

describe('tecnico responsavel (itens 26 a 29)', () => {
  it('atribui quem esta ativo e vinculado a unidade da ordem', async () => {
    const tecnicoId = await createPlainUser(
      tenantA.tenantId,
      'tecnico@wf-a.invalid',
      'Ana Bancada',
    );
    await grantMembership(tenantA.tenantId, tecnicoId, tenantA.unitId);

    await run(() => assignTechnician(tenantA.context, ordemId, tecnicoId));

    const detalhe = await run(() => findServiceOrderDetail(tenantA.context, ordemId));
    expect(detalhe!.order.assignedTechnicianId).toBe(tecnicoId);
    expect(detalhe!.technicianName).toBe('Ana Bancada');

    const linha = await getDb()
      .select()
      .from(serviceOrderTimeline)
      .where(
        and(
          eq(serviceOrderTimeline.serviceOrderId, ordemId),
          eq(serviceOrderTimeline.kind, 'technician_assigned'),
        ),
      );
    expect(linha).toHaveLength(1);
  });

  it('recusa quem nao tem vinculo com a unidade da ordem', async () => {
    const outraUnidade = await createUnit(tenantA.tenantId, 'Norte');
    const forasteiro = await createPlainUser(tenantA.tenantId, 'norte@wf-a.invalid', 'So do Norte');
    await grantMembership(tenantA.tenantId, forasteiro, outraUnidade);

    await expect(run(() => assignTechnician(tenantA.context, ordemId, forasteiro))).rejects.toThrow(
      BusinessRuleError,
    );
  });

  it('recusa usuario inativo', async () => {
    const tecnicoId = await createPlainUser(tenantA.tenantId, 'saiu@wf-a.invalid', 'Ja Saiu');
    await grantMembership(tenantA.tenantId, tecnicoId, tenantA.unitId);
    await getDb()
      .update(serviceOrders)
      .set({ updatedAt: new Date() })
      .where(eq(serviceOrders.id, ordemId));
    await getDb().execute(
      `UPDATE users SET status = 'inactive' WHERE id = '${tecnicoId}'` as never,
    );

    await expect(run(() => assignTechnician(tenantA.context, ordemId, tecnicoId))).rejects.toThrow(
      BusinessRuleError,
    );
  });

  it('recusa pessoa de outra empresa, mesmo com o UUID em maos', async () => {
    await expect(
      run(() => assignTechnician(tenantA.context, ordemId, tenantB.adminUserId)),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('remover o responsavel e permitido e fica registrado', async () => {
    const tecnicoId = await createPlainUser(tenantA.tenantId, 'tec2@wf-a.invalid', 'Bancada Dois');
    await grantMembership(tenantA.tenantId, tecnicoId, tenantA.unitId);

    await run(() => assignTechnician(tenantA.context, ordemId, tecnicoId));
    await run(() => assignTechnician(tenantA.context, ordemId, null));

    const detalhe = await run(() => findServiceOrderDetail(tenantA.context, ordemId));
    expect(detalhe!.order.assignedTechnicianId).toBeNull();
  });

  it('atribuir tecnico NAO muda o estado da ordem', async () => {
    const tecnicoId = await createPlainUser(tenantA.tenantId, 'tec3@wf-a.invalid', 'Bancada Tres');
    await grantMembership(tenantA.tenantId, tecnicoId, tenantA.unitId);

    const versaoAntes = await versaoDe(ordemId);
    await run(() => assignTechnician(tenantA.context, ordemId, tecnicoId));

    expect(await statusDe(ordemId)).toBe('awaiting_technical_opinion');
    expect(await versaoDe(ordemId)).toBe(versaoAntes);
  });
});

// ---------------------------------------------------------------------------
// Isolamento
// ---------------------------------------------------------------------------

describe('isolamento por empresa e unidade (itens 123 a 125)', () => {
  it('ordem de outra empresa nao e encontrada, nem para transicao', async () => {
    const ordemB = await abrirOrdem(tenantB);

    await expect(
      run(() =>
        transitionServiceOrder(tenantA.context, { serviceOrderId: ordemB, to: 'awaiting_repair' }),
      ),
    ).rejects.toThrow(NotFoundError);

    expect(await statusDe(ordemB)).toBe('awaiting_technical_opinion');
  });

  it('ordem de outra unidade da MESMA empresa tambem nao e alcancavel', async () => {
    const outraUnidade = await createUnit(tenantA.tenantId, 'Norte');
    const soNorte = await createPlainUser(tenantA.tenantId, 'norte2@wf-a.invalid', 'Opera o Norte');
    await grantMembership(tenantA.tenantId, soNorte, outraUnidade);

    const contexto = await contextFor(tenantA.tenantId, soNorte, outraUnidade);

    await expect(
      run(() =>
        transitionServiceOrder(contexto, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('tarefa de outra empresa nao pode ser concluida', async () => {
    const ordemB = await abrirOrdem(tenantB);
    await levarAte('awaiting_delivery_preparation', tenantB, ordemB);
    const [tarefaB] = await tarefasDe(ordemB);

    await expect(run(() => completeTask(tenantA.context, tarefaB!.id))).rejects.toThrow(
      NotFoundError,
    );
  });

  it('as pendencias sao da unidade ativa, nunca a soma das lojas', async () => {
    await run(() => rescheduleFollowUp(tenantA.context, ordemId, { followUpAt: '2020-01-01' }));

    const ordemB = await abrirOrdem(tenantB);
    await run(() => rescheduleFollowUp(tenantB.context, ordemB, { followUpAt: '2020-01-01' }));

    const pendA = await run(() => loadPendingWork(tenantA.context));
    expect(pendA.overdueOrders.map((item) => item.id)).toEqual([ordemId]);
  });
});

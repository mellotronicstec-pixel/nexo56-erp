import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { addDays, todayIn } from '@/core/time/civil-date';
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/core/errors';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { units } from '@/modules/tenancy/infrastructure/schema';
import { FEATURES } from '@/modules/features/domain/catalog';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import { serviceOrderTasks, serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { TASK_KINDS } from '@/modules/service-orders/domain/workflow';
import { completeAgendaItem } from '@/modules/agenda/application/agenda-actions';
import {
  findTask,
  listTasks,
  loadAgenda,
  loadMyTasks,
} from '@/modules/agenda/application/agenda-queries';
import {
  assignTask,
  cancelTask,
  completeTask,
  createTask,
  updateTask,
} from '@/modules/agenda/application/task-service';
import {
  cancelAppointment,
  createAppointment,
  updateAppointment,
} from '@/modules/agenda/application/appointment-service';
import { agendaAppointments, agendaTasks } from '@/modules/agenda/infrastructure/schema';
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
 * AGENDA E TAREFAS (Prompt 14).
 *
 * O eixo destes testes e a promessa central do modulo: nenhuma Ordem de
 * Servico importante deve ser esquecida — e a maneira de cumpri-la sem criar
 * um segundo fluxo. Por isso o que mais se verifica aqui nao e o que a Agenda
 * faz, e o que ela NAO faz: nao copia tarefa de fluxo, nao converte follow-up,
 * nao escreve estado de OS e nao aceita vinculo que o navegador inventou.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

const hoje = () => todayIn('America/Sao_Paulo');

async function ligarAgenda(fixture: TenantFixture): Promise<void> {
  await run(() =>
    setTenantFeature(fixture.context, { featureKey: FEATURES.OPERATIONS_AGENDA, enabled: true }),
  );
}

async function abrirOrdem(fixture: TenantFixture): Promise<{
  serviceOrderId: string;
  customerId: string;
  equipmentId: string;
}> {
  const { customerId } = await run(() =>
    createCustomer(fixture.context, {
      kind: 'individual',
      name: `Cliente ${fixture.slug}`,
      contacts: [{ type: 'phone', value: '11955554444', isWhatsapp: false }],
    }),
  );

  const { equipmentId } = await run(() =>
    createEquipment(fixture.context, { customerId, kind: 'Televisor' }),
  );

  const { serviceOrderId } = await run(() =>
    createServiceOrder(fixture.context, {
      equipmentId,
      customerReport: 'O aparelho nao liga desde ontem.',
    }),
  );

  return { serviceOrderId, customerId, equipmentId };
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
  tenantA = await createTenantFixture('ag-a', planId);
  tenantB = await createTenantFixture('ag-b', planId);

  for (const t of [tenantA, tenantB]) await ligarAgenda(t);

  /** O contexto e remontado para enxergar a feature recem-ligada. */
  tenantA.context = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);
  tenantB.context = await contextFor(tenantB.tenantId, tenantB.adminUserId, tenantB.unitId);
});

// ---------------------------------------------------------------------------
// Criacao
// ---------------------------------------------------------------------------

describe('criar tarefa', () => {
  it('cria uma tarefa administrativa, sem Ordem de Servico nenhuma', async () => {
    const { taskId, reused } = await run(() =>
      createTask(tenantA.context, {
        title: 'Conferir a documentacao do fornecedor',
        dueDate: hoje(),
      }),
    );

    expect(reused).toBe(false);

    const [tarefa] = await getDb().select().from(agendaTasks).where(eq(agendaTasks.id, taskId));
    expect(tarefa!.serviceOrderId).toBeNull();
    expect(tarefa!.status).toBe('open');
    expect(tarefa!.priority).toBe('normal');
    expect(tarefa!.unitId).toBe(tenantA.unitId);
    expect(tarefa!.createdBy).toBe(tenantA.adminUserId);
    expect(tarefa!.version).toBe(1);
  });

  it('grava auditoria e evento, sem o texto da tarefa no rastro', async () => {
    const { taskId } = await run(() =>
      createTask(tenantA.context, { title: 'Organizar a prateleira de pecas' }),
    );

    const rastro = await getDb()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'agenda_task'), eq(auditLogs.entityId, taskId)));
    expect(rastro).toHaveLength(1);
    expect(rastro[0]!.action).toBe('task.created');
    expect(JSON.stringify(rastro[0]!.after)).not.toContain('prateleira');

    const eventos = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, 'TASK_CREATED'));
    expect(eventos).toHaveLength(1);
  });

  it('recusa unidade que o contexto nao autorizou', async () => {
    const outraUnidade = await createUnit(tenantA.tenantId, 'Filial sem acesso');

    await expect(
      run(() => createTask(tenantA.context, { title: 'Tarefa na filial', unitId: outraUnidade })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('recusa responsavel que nao tem acesso a unidade da tarefa', async () => {
    const estranhoId = await createPlainUser(tenantA.tenantId, 'sem-unidade@ag-a.invalid');

    await expect(
      run(() =>
        createTask(tenantA.context, {
          title: 'Atribuir a quem nao opera aqui',
          assigneeId: estranhoId,
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Idempotencia e concorrencia
// ---------------------------------------------------------------------------

describe('idempotencia da criacao', () => {
  it('a mesma chave de intencao reencontra a tarefa em vez de criar a segunda', async () => {
    const entrada = { title: 'Ligar para o fornecedor', idempotencyKey: 'form-abc-123' };

    const primeira = await run(() => createTask(tenantA.context, entrada));
    const segunda = await run(() => createTask(tenantA.context, entrada));

    expect(segunda.taskId).toBe(primeira.taskId);
    expect(segunda.reused).toBe(true);

    const todas = await getDb().select().from(agendaTasks);
    expect(todas).toHaveLength(1);
  });

  it('cinco criacoes simultaneas com a mesma chave produzem uma tarefa so', async () => {
    const entrada = { title: 'Duplo clique de verdade', idempotencyKey: 'corrida-001' };

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () => run(() => createTask(tenantA.context, entrada))),
    );

    const ok = resultados.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    expect(ok).toHaveLength(5);

    const ids = new Set(ok.map((r) => r.taskId));
    expect(ids.size).toBe(1);

    const todas = await getDb().select().from(agendaTasks);
    expect(todas).toHaveLength(1);
  });

  it('a mesma chave em outra empresa cria outra tarefa: a chave e por tenant', async () => {
    const entrada = { title: 'Mesma chave, outra empresa', idempotencyKey: 'compartilhada' };

    await run(() => createTask(tenantA.context, entrada));
    await run(() => createTask(tenantB.context, entrada));

    const todas = await getDb().select().from(agendaTasks);
    expect(todas).toHaveLength(2);
  });
});

describe('concluir e cancelar disputando a mesma tarefa', () => {
  it('quem perde a corrida recebe conflito, nao sobrescreve o fato', async () => {
    const { taskId } = await run(() => createTask(tenantA.context, { title: 'Disputa' }));

    const [concluir, cancelar] = await Promise.allSettled([
      run(() => completeTask(tenantA.context, taskId)),
      run(() => cancelTask(tenantA.context, taskId, 'Nao faz mais sentido.')),
    ]);

    const vencedores = [concluir, cancelar].filter((r) => r.status === 'fulfilled');
    expect(vencedores).toHaveLength(1);

    const perdedor = [concluir, cancelar].find((r) => r.status === 'rejected');
    expect(perdedor).toBeDefined();
    if (perdedor?.status === 'rejected') {
      expect(
        perdedor.reason instanceof ConflictError || perdedor.reason instanceof BusinessRuleError,
      ).toBe(true);
    }

    const [tarefa] = await getDb().select().from(agendaTasks).where(eq(agendaTasks.id, taskId));
    expect(['done', 'cancelled']).toContain(tarefa!.status);
  });

  it('concluir nao e cancelar: sao estados diferentes, com rastros diferentes', async () => {
    const a = await run(() => createTask(tenantA.context, { title: 'Feita' }));
    const b = await run(() => createTask(tenantA.context, { title: 'Abandonada' }));

    await run(() => completeTask(tenantA.context, a.taskId));
    await run(() => cancelTask(tenantA.context, b.taskId, 'O cliente desistiu do servico.'));

    const [feita] = await getDb().select().from(agendaTasks).where(eq(agendaTasks.id, a.taskId));
    const [abandonada] = await getDb()
      .select()
      .from(agendaTasks)
      .where(eq(agendaTasks.id, b.taskId));

    expect(feita!.status).toBe('done');
    expect(feita!.completedBy).toBe(tenantA.adminUserId);
    expect(feita!.cancelReason).toBeNull();

    expect(abandonada!.status).toBe('cancelled');
    expect(abandonada!.cancelReason).toBe('O cliente desistiu do servico.');
    expect(abandonada!.completedAt).toBeNull();
  });

  it('cancelar exige motivo com substancia', async () => {
    const { taskId } = await run(() => createTask(tenantA.context, { title: 'Sem motivo' }));

    await expect(run(() => cancelTask(tenantA.context, taskId, 'x'))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('a edicao com versao antiga e recusada', async () => {
    const { taskId } = await run(() => createTask(tenantA.context, { title: 'Original' }));
    await run(() => updateTask(tenantA.context, taskId, { title: 'Editada por outra pessoa' }));

    await expect(
      run(() => updateTask(tenantA.context, taskId, { title: 'Tarde demais', expectedVersion: 1 })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('tarefa encerrada nao volta a ser editavel', async () => {
    const { taskId } = await run(() => createTask(tenantA.context, { title: 'Ja foi' }));
    await run(() => completeTask(tenantA.context, taskId));

    await expect(
      run(() => updateTask(tenantA.context, taskId, { title: 'Mudando o passado' })),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

// ---------------------------------------------------------------------------
// Vinculos de contexto
// ---------------------------------------------------------------------------

describe('vinculos com OS, cliente e aparelho', () => {
  it('vincula a OS e herda dela o cliente e o aparelho', async () => {
    const { serviceOrderId, customerId, equipmentId } = await abrirOrdem(tenantA);

    const { taskId } = await run(() =>
      createTask(tenantA.context, { title: 'Ligar para o cliente', serviceOrderId }),
    );

    const [tarefa] = await getDb().select().from(agendaTasks).where(eq(agendaTasks.id, taskId));
    expect(tarefa!.serviceOrderId).toBe(serviceOrderId);
    expect(tarefa!.customerId).toBe(customerId);
    expect(tarefa!.equipmentId).toBe(equipmentId);
  });

  it('recusa a OS de outra empresa como se ela nao existisse', async () => {
    const { serviceOrderId } = await abrirOrdem(tenantB);

    await expect(
      run(() => createTask(tenantA.context, { title: 'OS alheia', serviceOrderId })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('recusa a OS de outra unidade da mesma empresa', async () => {
    const { serviceOrderId } = await abrirOrdem(tenantA);
    const outraUnidade = await createUnit(tenantA.tenantId, 'Filial com acesso');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, outraUnidade);

    const contextoFilial = await contextFor(tenantA.tenantId, tenantA.adminUserId, outraUnidade);

    await expect(
      run(() =>
        createTask(contextoFilial, {
          title: 'OS de outra unidade',
          unitId: outraUnidade,
          serviceOrderId,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('recusa cliente que nao e o da OS informada', async () => {
    const { serviceOrderId } = await abrirOrdem(tenantA);
    const { customerId: outroCliente } = await run(() =>
      createCustomer(tenantA.context, {
        kind: 'individual',
        name: 'Outro cliente qualquer',
        contacts: [{ type: 'phone', value: '11944443333', isWhatsapp: false }],
      }),
    );

    await expect(
      run(() =>
        createTask(tenantA.context, {
          title: 'Vinculos que nao combinam',
          serviceOrderId,
          customerId: outroCliente,
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Isolamento
// ---------------------------------------------------------------------------

describe('isolamento entre empresas e unidades', () => {
  it('a tarefa de outra empresa e indistinguivel de inexistente', async () => {
    const { taskId } = await run(() => createTask(tenantB.context, { title: 'Tarefa da B' }));

    await expect(run(() => completeTask(tenantA.context, taskId))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('a agenda de uma empresa nao enxerga a outra', async () => {
    await run(() => createTask(tenantA.context, { title: 'Da empresa A', dueDate: hoje() }));
    await run(() => createTask(tenantB.context, { title: 'Da empresa B', dueDate: hoje() }));

    const agendaA = await run(() => loadAgenda(tenantA.context));
    const titulos = agendaA.days.flatMap((dia) => dia.items.map((item) => item.title));

    expect(titulos).toContain('Da empresa A');
    expect(titulos).not.toContain('Da empresa B');
  });

  it('a tarefa de uma unidade sem acesso nao aparece nem pode ser mexida', async () => {
    const filial = await createUnit(tenantA.tenantId, 'Filial isolada');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, filial);
    const contextoFilial = await contextFor(tenantA.tenantId, tenantA.adminUserId, filial);

    const { taskId } = await run(() =>
      createTask(contextoFilial, { title: 'Tarefa da filial', unitId: filial, dueDate: hoje() }),
    );

    /** Um usuario que so opera na matriz nao alcanca a tarefa da filial. */
    const soMatriz = await createPlainUser(tenantA.tenantId, 'so-matriz@ag-a.invalid');
    await grantMembership(tenantA.tenantId, soMatriz, tenantA.unitId);
    const contextoMatriz = await contextFor(tenantA.tenantId, soMatriz, tenantA.unitId);

    await expect(run(() => completeTask(contextoMatriz, taskId))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// Effective Access
// ---------------------------------------------------------------------------

describe('a Agenda desligada', () => {
  it('recusa criar tarefa quando a feature esta desligada', async () => {
    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.OPERATIONS_AGENDA,
        enabled: false,
      }),
    );
    const semAgenda = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    await expect(
      run(() => createTask(semAgenda, { title: 'Nao deveria nascer' })),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('a agenda fica vazia, mas o follow-up da OS continua marcado no nucleo', async () => {
    const { serviceOrderId } = await abrirOrdem(tenantA);

    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.OPERATIONS_AGENDA,
        enabled: false,
      }),
    );
    const semAgenda = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    const agenda = await run(() => loadAgenda(semAgenda));
    expect(agenda.days).toHaveLength(0);
    expect(agenda.unitIds).toHaveLength(0);

    /**
     * E ESTE E O PONTO (item 12): desligar a Agenda apaga as TELAS, nao a rede
     * de seguranca. `follow_up_at` continua onde sempre esteve, porque quem o
     * escreve e o nucleo — nunca este modulo.
     */
    const [ordem] = await getDb()
      .select({ followUpAt: serviceOrders.followUpAt })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, serviceOrderId));
    expect(ordem!.followUpAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Read model unificado
// ---------------------------------------------------------------------------

async function levarAtePreparacao(id: string): Promise<void> {
  for (const passo of ['awaiting_repair', 'repair_completed', 'awaiting_delivery_preparation']) {
    await run(() =>
      transitionServiceOrder(tenantA.context, { serviceOrderId: id, to: passo as never }),
    );
  }
}

describe('a agenda reune quatro origens sem copiar nenhuma', () => {
  it('mostra tarefa, compromisso, tarefa de fluxo e follow-up, cada um com sua origem', async () => {
    const { serviceOrderId } = await abrirOrdem(tenantA);
    await levarAtePreparacao(serviceOrderId);

    await run(() =>
      createTask(tenantA.context, { title: 'Comprar material de limpeza', dueDate: hoje() }),
    );

    await run(() =>
      createAppointment(tenantA.context, {
        title: 'Visita tecnica no cliente',
        allDay: false,
        startAtLocal: `${hoje()}T14:00`,
        endAtLocal: `${hoje()}T15:00`,
      }),
    );

    const agenda = await run(() => loadAgenda(tenantA.context));
    const itens = agenda.days.flatMap((dia) => dia.items);
    const tipos = itens.map((item) => item.type);

    expect(tipos).toContain('task');
    expect(tipos).toContain('appointment');
    expect(tipos).toContain('service_order_task');
    expect(tipos).toContain('follow_up');

    /**
     * DEDUPLICACAO POR CONSTRUCAO (item 57): cada par (origem, id) aparece uma
     * vez so. Nao ha caminho por onde o mesmo trabalho seja projetado duas
     * vezes, porque nenhum registro vive em duas tabelas.
     */
    const chaves = itens.map((item) => `${item.type}:${item.id}`);
    expect(new Set(chaves).size).toBe(chaves.length);

    /** A tarefa de fluxo continua sendo dela: nada foi copiado para a Agenda. */
    const copias = await getDb()
      .select()
      .from(agendaTasks)
      .where(eq(agendaTasks.title, 'Preparar equipamento para entrega'));
    expect(copias).toHaveLength(0);

    /** E o follow-up nao virou tarefa nenhuma. */
    const daAgenda = await getDb().select().from(agendaTasks);
    expect(daAgenda).toHaveLength(1);
    expect(daAgenda[0]!.title).toBe('Comprar material de limpeza');
  });

  it('o follow-up projetado aponta para a OS e carrega o numero dela', async () => {
    const { serviceOrderId } = await abrirOrdem(tenantA);

    const agenda = await run(() => loadAgenda(tenantA.context));
    const followUp = agenda.days
      .flatMap((dia) => dia.items)
      .find((item) => item.type === 'follow_up');

    expect(followUp).toBeDefined();
    expect(followUp!.serviceOrderId).toBe(serviceOrderId);
    expect(followUp!.serviceOrderNumber).toBe(1);
    expect(followUp!.title).toBe('Acompanhar a OS 1');
  });

  it('o que venceu antes do inicio do periodo entra assim mesmo', async () => {
    const ontem = addDays(hoje(), -3);
    await run(() =>
      createTask(tenantA.context, { title: 'Venceu semana passada', dueDate: ontem }),
    );

    const agenda = await run(() => loadAgenda(tenantA.context));
    const itens = agenda.days.flatMap((dia) => dia.items);

    const atrasada = itens.find((item) => item.title === 'Venceu semana passada');
    expect(atrasada).toBeDefined();
    expect(atrasada!.overdue).toBe(true);
    expect(agenda.overdueCount).toBeGreaterThanOrEqual(1);
  });

  it('tarefa sem prazo nao entra na agenda, mas entra em Minhas tarefas', async () => {
    await run(() =>
      createTask(tenantA.context, {
        title: 'Sem prazo definido',
        assigneeId: tenantA.adminUserId,
      }),
    );

    const agenda = await run(() => loadAgenda(tenantA.context));
    const naAgenda = agenda.days
      .flatMap((dia) => dia.items)
      .some((item) => item.title === 'Sem prazo definido');
    expect(naAgenda).toBe(false);

    const minhas = await run(() => loadMyTasks(tenantA.context));
    const semPrazo = minhas.buckets.find((b) => b.bucket === 'no_due');
    expect(semPrazo?.items.map((i) => i.title)).toContain('Sem prazo definido');
  });

  it('recusa um periodo maior que o teto', async () => {
    await expect(
      run(() => loadAgenda(tenantA.context, { from: '2026-01-01', to: '2026-12-31' })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('compromisso nao e marcado como atrasado, mesmo depois de passar', async () => {
    await run(() =>
      createAppointment(tenantA.context, {
        title: 'Visita que ja aconteceu',
        allDay: true,
        startDate: addDays(hoje(), -2),
        endDate: addDays(hoje(), -2),
      }),
    );

    const agenda = await run(() =>
      loadAgenda(tenantA.context, { from: addDays(hoje(), -5), to: hoje() }),
    );
    const compromisso = agenda.days
      .flatMap((dia) => dia.items)
      .find((item) => item.title === 'Visita que ja aconteceu');

    expect(compromisso).toBeDefined();
    expect(compromisso!.overdue).toBe(false);
  });
});

describe('minhas tarefas', () => {
  it('separa em atrasadas, hoje, proximas e sem prazo', async () => {
    const meu = { assigneeId: tenantA.adminUserId };

    await run(() =>
      createTask(tenantA.context, { ...meu, title: 'Atrasada', dueDate: addDays(hoje(), -1) }),
    );
    await run(() => createTask(tenantA.context, { ...meu, title: 'De hoje', dueDate: hoje() }));
    await run(() =>
      createTask(tenantA.context, { ...meu, title: 'Semana que vem', dueDate: addDays(hoje(), 5) }),
    );
    await run(() => createTask(tenantA.context, { ...meu, title: 'Quando der' }));

    const minhas = await run(() => loadMyTasks(tenantA.context));
    const porBalde = Object.fromEntries(
      minhas.buckets.map((b) => [b.bucket, b.items.map((i) => i.title)]),
    );

    expect(porBalde.overdue).toEqual(['Atrasada']);
    expect(porBalde.today).toEqual(['De hoje']);
    expect(porBalde.upcoming).toEqual(['Semana que vem']);
    expect(porBalde.no_due).toEqual(['Quando der']);
    expect(minhas.overdueCount).toBe(1);
    expect(minhas.total).toBe(4);
  });

  it('nao mostra a tarefa de outra pessoa', async () => {
    const colega = await createPlainUser(tenantA.tenantId, 'colega@ag-a.invalid');
    await grantMembership(tenantA.tenantId, colega, tenantA.unitId);

    await run(() =>
      createTask(tenantA.context, { title: 'Do colega', assigneeId: colega, dueDate: hoje() }),
    );

    const minhas = await run(() => loadMyTasks(tenantA.context));
    const titulos = minhas.buckets.flatMap((b) => b.items.map((i) => i.title));
    expect(titulos).not.toContain('Do colega');
  });
});

describe('lista de tarefas', () => {
  it('filtra por situacao e devolve o total antes da paginacao', async () => {
    for (let i = 0; i < 3; i += 1) {
      await run(() => createTask(tenantA.context, { title: `Tarefa ${i}` }));
    }
    const { taskId } = await run(() => createTask(tenantA.context, { title: 'Concluida' }));
    await run(() => completeTask(tenantA.context, taskId));

    const abertas = await run(() => listTasks(tenantA.context, { status: 'open' }));
    expect(abertas.total).toBe(3);
    expect(abertas.rows.every((r) => r.status === 'open')).toBe(true);

    const todas = await run(() => listTasks(tenantA.context, {}));
    expect(todas.total).toBe(4);
  });

  it('a lista traz so tarefas da Agenda, nunca tarefas de fluxo da OS', async () => {
    const { serviceOrderId } = await abrirOrdem(tenantA);
    await levarAtePreparacao(serviceOrderId);

    const lista = await run(() => listTasks(tenantA.context, {}));
    expect(lista.rows.map((r) => r.title)).not.toContain('Preparar equipamento para entrega');
  });
});

// ---------------------------------------------------------------------------
// Delegacao e fronteira
// ---------------------------------------------------------------------------

describe('a Agenda nao reimplementa o fluxo da OS', () => {
  it('concluir uma tarefa de fluxo pela Agenda delega ao Prompt 08', async () => {
    const { serviceOrderId } = await abrirOrdem(tenantA);
    await levarAtePreparacao(serviceOrderId);

    const [tarefa] = await getDb()
      .select()
      .from(serviceOrderTasks)
      .where(
        and(
          eq(serviceOrderTasks.serviceOrderId, serviceOrderId),
          eq(serviceOrderTasks.kind, TASK_KINDS.DELIVERY_PREPARATION),
        ),
      );

    const statusAntes = (
      await getDb()
        .select({ status: serviceOrders.status, version: serviceOrders.version })
        .from(serviceOrders)
        .where(eq(serviceOrders.id, serviceOrderId))
    )[0]!;

    const resultado = await run(() =>
      completeAgendaItem(tenantA.context, 'service_order_task', tarefa!.id),
    );

    expect(resultado).toEqual({ kind: 'service_order_task', serviceOrderId });

    const [depois] = await getDb()
      .select()
      .from(serviceOrderTasks)
      .where(eq(serviceOrderTasks.id, tarefa!.id));
    expect(depois!.status).toBe('done');

    /**
     * E O ESTADO DA OS NAO MUDOU (item 8). Concluir a preparacao nao entrega o
     * aparelho: quem move a ordem e a transicao oficial, por decisao de uma
     * pessoa.
     */
    const statusDepois = (
      await getDb()
        .select({ status: serviceOrders.status, version: serviceOrders.version })
        .from(serviceOrders)
        .where(eq(serviceOrders.id, serviceOrderId))
    )[0]!;
    expect(statusDepois.status).toBe(statusAntes.status);
    expect(statusDepois.version).toBe(statusAntes.version);
  });

  it('follow-up nao se conclui: a resposta e uma recusa explicita', async () => {
    const { serviceOrderId } = await abrirOrdem(tenantA);

    await expect(
      run(() => completeAgendaItem(tenantA.context, 'follow_up', serviceOrderId)),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('compromisso nao se conclui: cancela-se', async () => {
    const { appointmentId } = await run(() =>
      createAppointment(tenantA.context, {
        title: 'Reuniao',
        allDay: true,
        startDate: hoje(),
        endDate: hoje(),
      }),
    );

    await expect(
      run(() => completeAgendaItem(tenantA.context, 'appointment', appointmentId)),
    ).rejects.toBeInstanceOf(ValidationError);

    await run(() => cancelAppointment(tenantA.context, appointmentId, 'O cliente remarcou.'));

    const [row] = await getDb()
      .select()
      .from(agendaAppointments)
      .where(eq(agendaAppointments.id, appointmentId));
    expect(row!.status).toBe('cancelled');
    expect(row!.cancelReason).toBe('O cliente remarcou.');
  });

  it('todo o trabalho da Agenda nao altera nenhum estado de OS', async () => {
    const { serviceOrderId } = await abrirOrdem(tenantA);
    const antes = (
      await getDb()
        .select({ status: serviceOrders.status, version: serviceOrders.version })
        .from(serviceOrders)
        .where(eq(serviceOrders.id, serviceOrderId))
    )[0]!;

    const { taskId } = await run(() =>
      createTask(tenantA.context, { title: 'Ligar para o cliente', serviceOrderId }),
    );
    await run(() => assignTask(tenantA.context, taskId, tenantA.adminUserId));
    await run(() => updateTask(tenantA.context, taskId, { priority: 'urgent' }));
    await run(() => completeTask(tenantA.context, taskId));

    const depois = (
      await getDb()
        .select({ status: serviceOrders.status, version: serviceOrders.version })
        .from(serviceOrders)
        .where(eq(serviceOrders.id, serviceOrderId))
    )[0]!;

    expect(depois).toEqual(antes);
  });
});

// ---------------------------------------------------------------------------
// Compromissos
// ---------------------------------------------------------------------------

describe('compromissos', () => {
  it('recusa fim antes do inicio', async () => {
    await expect(
      run(() =>
        createAppointment(tenantA.context, {
          title: 'Impossivel',
          allDay: false,
          startAtLocal: `${hoje()}T18:00`,
          endAtLocal: `${hoje()}T17:00`,
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('reagendar troca o quando e limpa o par que deixou de valer', async () => {
    const { appointmentId } = await run(() =>
      createAppointment(tenantA.context, {
        title: 'Visita',
        allDay: true,
        startDate: hoje(),
        endDate: hoje(),
      }),
    );

    await run(() =>
      updateAppointment(tenantA.context, appointmentId, {
        allDay: false,
        startAtLocal: `${addDays(hoje(), 1)}T14:00`,
        endAtLocal: `${addDays(hoje(), 1)}T15:00`,
      }),
    );

    const [row] = await getDb()
      .select()
      .from(agendaAppointments)
      .where(eq(agendaAppointments.id, appointmentId));

    expect(row!.allDay).toBe(0);
    expect(row!.startAt).toBeInstanceOf(Date);
    /** O par antigo foi a nulo: nao sobram duas versoes do quando. */
    expect(row!.startDate).toBeNull();
    expect(row!.endDate).toBeNull();
  });

  it('a mesma chave de intencao nao cria o segundo compromisso', async () => {
    const entrada = {
      title: 'Visita unica',
      allDay: true as const,
      startDate: hoje(),
      endDate: hoje(),
      idempotencyKey: 'compromisso-001',
    };

    const primeiro = await run(() => createAppointment(tenantA.context, entrada));
    const segundo = await run(() => createAppointment(tenantA.context, entrada));

    expect(segundo.appointmentId).toBe(primeiro.appointmentId);
    expect(segundo.reused).toBe(true);
    expect(await getDb().select().from(agendaAppointments)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Leitura nao e criacao
// ---------------------------------------------------------------------------

describe('agenda.view governa a leitura; agenda.tasks.create, so a criacao', () => {
  /** Monta uma pessoa com exatamente as permissoes pedidas, e nada mais. */
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

  it('quem tem agenda.view LE a agenda e a lista, mesmo sem poder criar', async () => {
    await run(() =>
      createTask(tenantA.context, { title: 'Visivel para quem so le', dueDate: hoje() }),
    );

    const soLeitura = await pessoaCom([PERMISSIONS.AGENDA_VIEW], 'so-leitura@ag-a.invalid');

    const agenda = await run(() => loadAgenda(soLeitura));
    const titulos = agenda.days.flatMap((dia) => dia.items.map((item) => item.title));
    expect(titulos).toContain('Visivel para quem so le');

    const lista = await run(() => listTasks(soLeitura, {}));
    expect(lista.total).toBeGreaterThan(0);
  });

  it('quem tem agenda.view NAO cria tarefa', async () => {
    const soLeitura = await pessoaCom([PERMISSIONS.AGENDA_VIEW], 'so-leitura2@ag-a.invalid');

    await expect(
      run(() => createTask(soLeitura, { title: 'Nao deveria nascer' })),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  /**
   * O CASO QUE MOTIVOU A CORRECAO: ter a chave de CRIAR nao pode, sozinha,
   * conceder leitura. Se concedesse, bastaria a permissao errada num papel
   * para expor a fila inteira da unidade.
   */
  it('quem tem agenda.tasks.create SEM agenda.view nao le nada', async () => {
    await run(() => createTask(tenantA.context, { title: 'Nao deve vazar', dueDate: hoje() }));

    const soCriacao = await pessoaCom([PERMISSIONS.AGENDA_TASKS_CREATE], 'so-criacao@ag-a.invalid');

    const agenda = await run(() => loadAgenda(soCriacao));
    expect(agenda.days).toHaveLength(0);
    expect(agenda.unitIds).toHaveLength(0);

    const lista = await run(() => listTasks(soCriacao, {}));
    expect(lista.rows).toHaveLength(0);
    expect(lista.total).toBe(0);

    const minhas = await run(() => loadMyTasks(soCriacao));
    expect(minhas.buckets).toHaveLength(0);

    /** Nem a ficha de uma tarefa cujo id ele conheca. */
    const [qualquer] = await getDb().select({ id: agendaTasks.id }).from(agendaTasks).limit(1);
    expect(await run(() => findTask(soCriacao, qualquer!.id))).toBeNull();
  });

  it('mas ele CRIA — a chave de criacao faz exatamente o que promete', async () => {
    const soCriacao = await pessoaCom(
      [PERMISSIONS.AGENDA_TASKS_CREATE],
      'so-criacao2@ag-a.invalid',
    );

    const { taskId } = await run(() => createTask(soCriacao, { title: 'Criada sem poder ler' }));
    expect(taskId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Semantica temporal do compromisso
// ---------------------------------------------------------------------------

describe('o horario do compromisso e civil, resolvido no fuso da unidade', () => {
  it('14h na unidade viram o instante certo, nao o do navegador', async () => {
    /** A unidade de teste nasce em America/Sao_Paulo: 14h locais = 17h UTC. */
    const { appointmentId } = await run(() =>
      createAppointment(tenantA.context, {
        title: 'Visita as duas da tarde',
        allDay: false,
        startAtLocal: '2026-09-22T14:00',
        endAtLocal: '2026-09-22T15:00',
      }),
    );

    const [row] = await getDb()
      .select()
      .from(agendaAppointments)
      .where(eq(agendaAppointments.id, appointmentId));

    expect(row!.startAt?.toISOString()).toBe('2026-09-22T17:00:00.000Z');
    expect(row!.endAt?.toISOString()).toBe('2026-09-22T18:00:00.000Z');
  });

  it('o mesmo horario civil em uma unidade de outro fuso produz outro instante', async () => {
    const filial = await createUnit(tenantA.tenantId, 'Filial em Lisboa');
    await getDb().update(units).set({ timezone: 'UTC' }).where(eq(units.id, filial));
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, filial);
    const contextoFilial = await contextFor(tenantA.tenantId, tenantA.adminUserId, filial);

    const { appointmentId } = await run(() =>
      createAppointment(contextoFilial, {
        title: 'Mesma hora, outro fuso',
        unitId: filial,
        allDay: false,
        startAtLocal: '2026-09-22T14:00',
        endAtLocal: '2026-09-22T15:00',
      }),
    );

    const [row] = await getDb()
      .select()
      .from(agendaAppointments)
      .where(eq(agendaAppointments.id, appointmentId));

    /** Na unidade em UTC, 14h civis sao 14h UTC — nao 17h. */
    expect(row!.startAt?.toISOString()).toBe('2026-09-22T14:00:00.000Z');
  });

  it('recusa instante ISO: o servico so aceita horario civil', async () => {
    await expect(
      run(() =>
        createAppointment(tenantA.context, {
          title: 'Instante cru',
          allDay: false,
          startAtLocal: '2026-09-22T17:00:00.000Z',
          endAtLocal: '2026-09-22T18:00:00.000Z',
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('a agenda devolve o fuso de cada unidade consultada', async () => {
    const agenda = await run(() => loadAgenda(tenantA.context));
    expect(agenda.timeZones[tenantA.unitId]).toBe('America/Sao_Paulo');
  });

  it('um compromisso das 22h continua no MESMO dia civil da unidade', async () => {
    const dia = addDays(hoje(), 1);

    await run(() =>
      createAppointment(tenantA.context, {
        title: 'Plantao da noite',
        allDay: false,
        startAtLocal: `${dia}T22:00`,
        endAtLocal: `${dia}T23:00`,
      }),
    );

    const agenda = await run(() => loadAgenda(tenantA.context));
    const noturno = agenda.days
      .flatMap((d) => d.items.map((item) => ({ dia: d.date, item })))
      .find((linha) => linha.item.title === 'Plantao da noite');

    expect(noturno).toBeDefined();
    /** Em UTC ja e o dia seguinte; na loja, nao. */
    expect(noturno!.dia).toBe(dia);
  });
});

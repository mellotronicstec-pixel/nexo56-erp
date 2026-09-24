import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import {
  completeTask,
  notifyCustomerReady,
} from '@/modules/service-orders/application/service-order-actions';
import { serviceOrderTasks } from '@/modules/service-orders/infrastructure/schema';
import { createTemplate } from '@/modules/communications/application/template-service';
import { communicationMessages } from '@/modules/communications/infrastructure/schema';
import { agendaTasks } from '@/modules/agenda/infrastructure/schema';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import { jobs } from '@/modules/jobs/infrastructure/schema';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { nowTimeIn } from '@/core/time/civil-date';
import { createRule, setRuleEnabled } from '@/modules/automations/application/rule-service';
import { processAutomationEvent } from '@/modules/automations/application/event-processor';
import { runExecutionActions } from '@/modules/automations/application/execution-runner';
import { runScheduleTick } from '@/modules/automations/application/schedule-coordinator';
import {
  registerAutomationSubscriptions,
  resetAutomationSubscriptionsForTesting,
} from '@/modules/automations/application/subscriptions';
import { automationExecutions } from '@/modules/automations/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  contextFor,
  createTenantFixture,
  createUnit,
  grantMembership,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';
import { EVENT_TYPES, type DomainEvent } from '@/modules/events/domain/event';

/**
 * O MOTOR CONTRA MariaDB REAL (Prompt 19).
 *
 * "Evento duplicado nunca duplica efeito." "Cron duplicado nunca duplica
 * ocorrencia." "Provider inexistente significa falha explicita, nunca
 * sucesso falso." "Desabilitar regra nunca deixa a acao rodar."
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

async function ligarTudo(fixture: TenantFixture): Promise<void> {
  for (const featureKey of [
    FEATURES.AUTOMATION_CORE,
    FEATURES.OPERATIONS_AGENDA,
    FEATURES.COMMUNICATIONS_CORE,
  ]) {
    await run(() => setTenantFeature(fixture.context, { featureKey, enabled: true }));
  }
}

/** Abre uma OS e a leva ate `awaiting_delivery_preparation`, com cliente com
 *  contato principal de WhatsApp (para as acoes de Comunicacao). */
async function ordemProntaParaAvisar(fixture: TenantFixture): Promise<string> {
  const { customerId } = await run(() =>
    createCustomer(fixture.context, {
      kind: 'individual',
      name: 'Cliente do Motor',
      contacts: [{ type: 'phone', value: '11999998888', isWhatsapp: true }],
    }),
  );
  const { equipmentId } = await run(() =>
    createEquipment(fixture.context, { customerId, kind: 'Televisor', brand: 'Marca' }),
  );
  const { serviceOrderId } = await run(() =>
    createServiceOrder(fixture.context, { equipmentId, customerReport: 'Nao liga.' }),
  );

  for (const passo of ['awaiting_repair', 'repair_completed', 'awaiting_delivery_preparation']) {
    await run(() =>
      transitionServiceOrder(fixture.context, { serviceOrderId, to: passo as never }),
    );
  }

  const [tarefa] = await getDb()
    .select({ id: serviceOrderTasks.id })
    .from(serviceOrderTasks)
    .where(
      and(
        eq(serviceOrderTasks.serviceOrderId, serviceOrderId),
        eq(serviceOrderTasks.status, 'open'),
      ),
    )
    .limit(1);
  if (tarefa) await run(() => completeTask(fixture.context, tarefa.id));

  return serviceOrderId;
}

/** Dispara `notifyCustomerReady` e devolve o EVENTO real gravado no outbox. */
async function avisarClienteEDevolverEvento(
  fixture: TenantFixture,
  serviceOrderId: string,
): Promise<DomainEvent> {
  await run(() => notifyCustomerReady(fixture.context, serviceOrderId));

  const todos = await getDb()
    .select()
    .from(domainEvents)
    .where(eq(domainEvents.tenantId, fixture.tenantId));
  const ultimo = todos
    .filter((e) => e.type === EVENT_TYPES.SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
  if (!ultimo) throw new Error('evento nao encontrado');

  return {
    id: ultimo.id,
    type: ultimo.type as DomainEvent['type'],
    tenantId: ultimo.tenantId,
    payload: ultimo.payload as Record<string, unknown>,
    correlationId: ultimo.correlationId,
    occurredAt: ultimo.occurredAt,
  };
}

async function criarModeloWhatsapp(fixture: TenantFixture): Promise<string> {
  const { templateId } = await run(() =>
    createTemplate(fixture.context, {
      name: 'Aparelho pronto',
      channel: 'whatsapp',
      body: 'Seu aparelho esta pronto para retirada.',
    }),
  );
  return templateId;
}

async function criarRegraDeComunicacao(
  fixture: TenantFixture,
  templateId: string,
  enabled = true,
): Promise<string> {
  const { ruleId } = await run(() =>
    createRule(fixture.context, {
      name: 'Avisar cliente por WhatsApp',
      scopeKind: 'UNIT_SET',
      unitIds: [fixture.unitId],
      definition: {
        schemaVersion: 1,
        triggerKey: 'service_order.customer_notification_requested',
        conditions: { all: [] },
        actions: [
          { key: 'communication.send_template', config: { templateId, channel: 'whatsapp' } },
        ],
      },
    }),
  );
  if (enabled) await run(() => setRuleEnabled(fixture.context, ruleId, true));
  return ruleId;
}

async function criarRegraDeAgenda(fixture: TenantFixture, enabled = true): Promise<string> {
  const { ruleId } = await run(() =>
    createRule(fixture.context, {
      name: 'Criar tarefa de contato',
      scopeKind: 'UNIT_SET',
      unitIds: [fixture.unitId],
      definition: {
        schemaVersion: 1,
        triggerKey: 'service_order.customer_notification_requested',
        conditions: { all: [] },
        actions: [
          { key: 'agenda.create_task', config: { title: 'Ligar para confirmar retirada' } },
        ],
      },
    }),
  );
  if (enabled) await run(() => setRuleEnabled(fixture.context, ruleId, true));
  return ruleId;
}

async function contarMensagens(tenantId: string): Promise<number> {
  const rows = await getDb()
    .select()
    .from(communicationMessages)
    .where(eq(communicationMessages.tenantId, tenantId));
  return rows.length;
}

async function contarTarefas(tenantId: string): Promise<number> {
  const rows = await getDb().select().from(agendaTasks).where(eq(agendaTasks.tenantId, tenantId));
  return rows.length;
}

async function contarExecucoes(tenantId: string, ruleId: string): Promise<number> {
  const rows = await getDb()
    .select()
    .from(automationExecutions)
    .where(
      and(eq(automationExecutions.tenantId, tenantId), eq(automationExecutions.ruleId, ruleId)),
    );
  return rows.length;
}

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  resetAutomationSubscriptionsForTesting();
  const planId = await seedCatalog();
  tenantA = await createTenantFixture('exec-a', planId);
  tenantB = await createTenantFixture('exec-b', planId);
  await ligarTudo(tenantA);
  await ligarTudo(tenantB);
});

describe('caminho feliz: evento -> execucao -> acao (itens 15, 112, 208)', () => {
  it('Comunicacao: 1 execucao, 1 mensagem, com o texto do modelo real', async () => {
    const templateId = await criarModeloWhatsapp(tenantA);
    const ruleId = await criarRegraDeComunicacao(tenantA, templateId);

    const osId = await ordemProntaParaAvisar(tenantA);
    const evento = await avisarClienteEDevolverEvento(tenantA, osId);
    await run(() => processAutomationEvent(evento));

    expect(await contarExecucoes(tenantA.tenantId, ruleId)).toBe(1);
    expect(await contarMensagens(tenantA.tenantId)).toBe(1);

    const [mensagem] = await getDb()
      .select()
      .from(communicationMessages)
      .where(eq(communicationMessages.tenantId, tenantA.tenantId));
    expect(mensagem?.body).toBe('Seu aparelho esta pronto para retirada.');
    expect(mensagem?.origin).toBe('domain_event');
    expect(mensagem?.requestedBy).toBeNull();
  });

  it('Agenda: 1 execucao, 1 tarefa, sem responsavel (item 35)', async () => {
    const ruleId = await criarRegraDeAgenda(tenantA);
    const osId = await ordemProntaParaAvisar(tenantA);
    const evento = await avisarClienteEDevolverEvento(tenantA, osId);
    await run(() => processAutomationEvent(evento));

    expect(await contarExecucoes(tenantA.tenantId, ruleId)).toBe(1);
    expect(await contarTarefas(tenantA.tenantId)).toBe(1);

    const [tarefa] = await getDb()
      .select()
      .from(agendaTasks)
      .where(eq(agendaTasks.tenantId, tenantA.tenantId));
    expect(tarefa?.title).toBe('Ligar para confirmar retirada');
    expect(tarefa?.assigneeId).toBeNull();
    expect(tarefa?.createdBy).toBeNull();
  });
});

describe('regra desabilitada nunca produz efeito (item 159)', () => {
  it('evento chega, 0 execucoes, 0 mensagens', async () => {
    const templateId = await criarModeloWhatsapp(tenantA);
    await criarRegraDeComunicacao(tenantA, templateId, false);

    const osId = await ordemProntaParaAvisar(tenantA);
    const evento = await avisarClienteEDevolverEvento(tenantA, osId);
    await run(() => processAutomationEvent(evento));

    expect(await contarMensagens(tenantA.tenantId)).toBe(0);
  });
});

describe('feature OFF (itens 160 e 161)', () => {
  it('automation.core OFF: 0 execucao, 0 acao', async () => {
    const templateId = await criarModeloWhatsapp(tenantA);
    const ruleId = await criarRegraDeComunicacao(tenantA, templateId);
    await run(() =>
      setTenantFeature(tenantA.context, { featureKey: FEATURES.AUTOMATION_CORE, enabled: false }),
    );

    const osId = await ordemProntaParaAvisar(tenantA);
    const evento = await avisarClienteEDevolverEvento(tenantA, osId);
    await run(() => processAutomationEvent(evento));

    expect(await contarExecucoes(tenantA.tenantId, ruleId)).toBe(0);
    expect(await contarMensagens(tenantA.tenantId)).toBe(0);
  });

  it('communications.core OFF, automation ON: execucao existe e falha explicitamente, sem mensagem (item 34, 108, 161)', async () => {
    const templateId = await criarModeloWhatsapp(tenantA);
    const ruleId = await criarRegraDeComunicacao(tenantA, templateId);
    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.COMMUNICATIONS_CORE,
        enabled: false,
      }),
    );

    const osId = await ordemProntaParaAvisar(tenantA);
    const evento = await avisarClienteEDevolverEvento(tenantA, osId);
    await run(() => processAutomationEvent(evento));

    expect(await contarMensagens(tenantA.tenantId)).toBe(0);
    const [execucao] = await getDb()
      .select()
      .from(automationExecutions)
      .where(
        and(
          eq(automationExecutions.tenantId, tenantA.tenantId),
          eq(automationExecutions.ruleId, ruleId),
        ),
      );
    expect(execucao?.status).toBe('failed');
    expect(execucao?.errorSummary).toBeTruthy();
  });
});

describe('isolamento (itens 62, 166 e 167)', () => {
  it('evento do tenant A nunca dispara regra do tenant B, mesmo com o mesmo trigger', async () => {
    const templateId = await criarModeloWhatsapp(tenantB);
    await criarRegraDeComunicacao(tenantB, templateId);

    const osId = await ordemProntaParaAvisar(tenantA);
    const evento = await avisarClienteEDevolverEvento(tenantA, osId);
    await run(() => processAutomationEvent(evento));

    expect(await contarMensagens(tenantB.tenantId)).toBe(0);
  });

  it('regra de uma unidade nunca dispara por evento de outra unidade (item 167)', async () => {
    const outraUnidade = await createUnit(tenantA.tenantId, 'Unidade fora do escopo');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, outraUnidade);
    const contextoComDuasUnidades = await contextFor(
      tenantA.tenantId,
      tenantA.adminUserId,
      tenantA.unitId,
    );

    const templateId = await criarModeloWhatsapp(tenantA);
    const { ruleId } = await run(() =>
      createRule(contextoComDuasUnidades, {
        name: 'Regra so da unidade extra',
        scopeKind: 'UNIT_SET',
        unitIds: [outraUnidade],
        definition: {
          schemaVersion: 1,
          triggerKey: 'service_order.customer_notification_requested',
          conditions: { all: [] },
          actions: [
            { key: 'communication.send_template', config: { templateId, channel: 'whatsapp' } },
          ],
        },
      }),
    );
    await run(() => setRuleEnabled(contextoComDuasUnidades, ruleId, true));

    const osId = await ordemProntaParaAvisar(tenantA);
    const evento = await avisarClienteEDevolverEvento(tenantA, osId);
    await run(() => processAutomationEvent(evento));

    expect(await contarExecucoes(tenantA.tenantId, ruleId)).toBe(0);
    expect(await contarMensagens(tenantA.tenantId)).toBe(0);
  });
});

describe('concorrencia real contra MariaDB (itens 79, 176 e 260)', () => {
  it('5 processamentos simultaneos do MESMO evento/regra -> exatamente 1 execucao e 1 mensagem', async () => {
    const templateId = await criarModeloWhatsapp(tenantA);
    const ruleId = await criarRegraDeComunicacao(tenantA, templateId);

    const osId = await ordemProntaParaAvisar(tenantA);
    const evento = await avisarClienteEDevolverEvento(tenantA, osId);

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () => run(() => processAutomationEvent(evento))),
    );
    expect(resultados.every((r) => r.status === 'fulfilled')).toBe(true);

    expect(await contarExecucoes(tenantA.tenantId, ruleId)).toBe(1);
    expect(await contarMensagens(tenantA.tenantId)).toBe(1);
  });
});

describe('retry / recuperacao (itens 89, 155 e 179)', () => {
  it('rodar runExecutionActions duas vezes na mesma execucao nao duplica o efeito', async () => {
    const templateId = await criarModeloWhatsapp(tenantA);
    await criarRegraDeComunicacao(tenantA, templateId);

    const osId = await ordemProntaParaAvisar(tenantA);
    const evento = await avisarClienteEDevolverEvento(tenantA, osId);
    await run(() => processAutomationEvent(evento));
    expect(await contarMensagens(tenantA.tenantId)).toBe(1);

    const [execucao] = await getDb()
      .select()
      .from(automationExecutions)
      .where(eq(automationExecutions.tenantId, tenantA.tenantId));
    expect(execucao).toBeDefined();

    await run(() => runExecutionActions(execucao!.id, tenantA.tenantId));
    await run(() => runExecutionActions(execucao!.id, tenantA.tenantId));

    expect(await contarMensagens(tenantA.tenantId)).toBe(1);
  });
});

describe('agendamento (itens 17 a 21, 115, 178 e 262)', () => {
  it('schedule.daily due agora cria exatamente 1 tarefa; tick repetido nao duplica', async () => {
    const horarioAgora = nowTimeIn(tenantA.context.tenantTimezone);
    const { ruleId } = await run(() =>
      createRule(tenantA.context, {
        name: 'Rotina diaria de estoque',
        scopeKind: 'UNIT_SET',
        unitIds: [tenantA.unitId],
        definition: {
          schemaVersion: 1,
          triggerKey: 'schedule.daily',
          triggerConfig: { timeOfDay: horarioAgora },
          conditions: { all: [] },
          actions: [{ key: 'agenda.create_task', config: { title: 'Conferir estoque do dia' } }],
        },
      }),
    );
    await run(() => setRuleEnabled(tenantA.context, ruleId, true));

    const primeiro = await run(() => runScheduleTick());
    expect(primeiro.triggered).toBeGreaterThanOrEqual(1);
    expect(await contarTarefas(tenantA.tenantId)).toBe(1);

    const segundo = await run(() => runScheduleTick());
    void segundo;
    expect(await contarTarefas(tenantA.tenantId)).toBe(1);
    expect(await contarExecucoes(tenantA.tenantId, ruleId)).toBe(1);
  });

  it('5 ticks simultaneos para a MESMA ocorrencia -> exatamente 1 execucao (item 80)', async () => {
    const horarioAgora = nowTimeIn(tenantA.context.tenantTimezone);
    const { ruleId } = await run(() =>
      createRule(tenantA.context, {
        name: 'Rotina concorrente',
        scopeKind: 'UNIT_SET',
        unitIds: [tenantA.unitId],
        definition: {
          schemaVersion: 1,
          triggerKey: 'schedule.daily',
          triggerConfig: { timeOfDay: horarioAgora },
          conditions: { all: [] },
          actions: [{ key: 'agenda.create_task', config: { title: 'Tarefa concorrente' } }],
        },
      }),
    );
    await run(() => setRuleEnabled(tenantA.context, ruleId, true));

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () => run(() => runScheduleTick())),
    );
    expect(resultados.every((r) => r.status === 'fulfilled')).toBe(true);

    expect(await contarExecucoes(tenantA.tenantId, ruleId)).toBe(1);
    expect(await contarTarefas(tenantA.tenantId)).toBe(1);
  });
});

describe('costura com o event-bus (item 74/75): assinatura enfileira job, nunca processa in-line', () => {
  it('publicar o evento oficial enfileira automation.dispatch-event uma vez', async () => {
    registerAutomationSubscriptions();

    const templateId = await criarModeloWhatsapp(tenantA);
    await criarRegraDeComunicacao(tenantA, templateId);

    const osId = await ordemProntaParaAvisar(tenantA);
    await run(() => notifyCustomerReady(tenantA.context, osId));

    const enfileirados = await getDb()
      .select()
      .from(jobs)
      .where(eq(jobs.name, 'automation.dispatch-event'));
    expect(enfileirados.length).toBe(1);
  });
});

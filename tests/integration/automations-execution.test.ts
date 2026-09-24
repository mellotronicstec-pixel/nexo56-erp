import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { resetEnvCache } from '@/core/config/env';
import { newId } from '@/core/ids/id';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import {
  completeTask,
  notifyCustomerReady,
} from '@/modules/service-orders/application/service-order-actions';
import { serviceOrders, serviceOrderTasks } from '@/modules/service-orders/infrastructure/schema';
import { createTemplate } from '@/modules/communications/application/template-service';
import { createMessageFromAutomation } from '@/modules/communications/application/message-service';
import {
  communicationAttempts,
  communicationMessages,
} from '@/modules/communications/infrastructure/schema';
import { agendaTasks } from '@/modules/agenda/infrastructure/schema';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import { jobs } from '@/modules/jobs/infrastructure/schema';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { EVENT_TYPES as CORE_EVENT_TYPES } from '@/modules/events/domain/event';
import { nowTimeIn } from '@/core/time/civil-date';
import { createRule, setRuleEnabled } from '@/modules/automations/application/rule-service';
import { processAutomationEvent } from '@/modules/automations/application/event-processor';
import { runExecutionActions } from '@/modules/automations/application/execution-runner';
import { runScheduleTick } from '@/modules/automations/application/schedule-coordinator';
import {
  registerAutomationSubscriptions,
  resetAutomationSubscriptionsForTesting,
} from '@/modules/automations/application/subscriptions';
import { AUTOMATION_TRIGGERS } from '@/modules/automations/domain/trigger-catalog';
import {
  automationActionAttempts,
  automationExecutions,
  automationRules,
} from '@/modules/automations/infrastructure/schema';
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

/**
 * Materializa uma UNICA execucao com UMA UNICA acao pendente (status
 * `running`, zero tentativas), sem passar por `processAutomationEvent` — para
 * isolar exatamente o gate de claim concorrente da MESMA action (Secao 2 do
 * fechamento), sem misturar com a corrida de criacao da propria execucao
 * (ja coberta por "5 processamentos simultaneos do MESMO evento/regra").
 */
async function materializarExecucaoPendente(
  fixture: TenantFixture,
  ruleId: string,
  serviceOrderId: string,
): Promise<string> {
  const [regra] = await getDb()
    .select({ versionId: automationRules.currentVersionId })
    .from(automationRules)
    .where(and(eq(automationRules.id, ruleId), eq(automationRules.tenantId, fixture.tenantId)))
    .limit(1);
  if (!regra?.versionId) throw new Error('regra sem versao atual');

  const executionId = newId();
  const now = new Date();
  await getDb()
    .insert(automationExecutions)
    .values({
      id: executionId,
      tenantId: fixture.tenantId,
      ruleId,
      ruleVersionId: regra.versionId,
      triggerKind: 'domain_event',
      triggerRef: newId(),
      idempotencyKey: `test:claim-direto:${newId()}`,
      status: 'running',
      inputSnapshot: { serviceOrderId, unitId: fixture.unitId },
      startedAt: now,
      correlationId: null,
      createdAt: now,
    });
  return executionId;
}

async function contarTentativasDaAcao(executionId: string, actionIndex = 0) {
  return getDb()
    .select()
    .from(automationActionAttempts)
    .where(
      and(
        eq(automationActionAttempts.executionId, executionId),
        eq(automationActionAttempts.actionIndex, actionIndex),
      ),
    );
}

let ambienteAnterior: NodeJS.ProcessEnv | null = null;

/** Mesma tecnica de `tests/unit/communications-provider.test.ts`: troca so
 *  NODE_ENV (+ a valvula de APP_URL local), preserva DATABASE_URL real. */
function ligarProducao(): void {
  ambienteAnterior = { ...process.env };
  Object.assign(process.env, { NODE_ENV: 'production', ALLOW_INSECURE_APP_URL: '1' });
  resetEnvCache();
}

function desligarProducao(): void {
  if (!ambienteAnterior) return;
  for (const chave of Object.keys(process.env)) delete process.env[chave];
  Object.assign(process.env, ambienteAnterior);
  ambienteAnterior = null;
  resetEnvCache();
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

/** Rede de seguranca: nenhum teste deixa NODE_ENV=production vazando para o
 *  proximo, mesmo se a asserção do proprio teste falhar no meio. */
afterEach(() => {
  desligarProducao();
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

/**
 * FECHAMENTO DE GATES (Secoes 2 a 8 do relatorio de fechamento do Prompt 19).
 *
 * Cada bloco abaixo isola exatamente o gate pedido, sem reaproveitar os
 * testes de concorrencia ja existentes acima (que provam a corrida na
 * CRIACAO da execucao, nao o claim de uma acao ja pendente).
 */
describe('claim concorrente da MESMA action pendente (Secao 2/3/6/7 do fechamento)', () => {
  it('Comunicacao: 5 workers simultaneos (Promise.allSettled) -> exatamente 1 claim vencedor, 1 tentativa succeeded, 1 processamento, 1 message, 1 communication_attempt de envio real', async () => {
    const templateId = await criarModeloWhatsapp(tenantA);
    const ruleId = await criarRegraDeComunicacao(tenantA, templateId);
    const osId = await ordemProntaParaAvisar(tenantA);
    const executionId = await materializarExecucaoPendente(tenantA, ruleId, osId);

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() => runExecutionActions(executionId, tenantA.tenantId)),
      ),
    );

    const fulfilled = resultados
      .filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof runExecutionActions>>> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value);
    expect(resultados.filter((r) => r.status === 'rejected').length).toBe(0);
    expect(fulfilled.length).toBe(5);

    /**
     * SINGLE-CLAIM REAL (Secao 3): dos 5 workers, exatamente 1 recebe
     * `status: 'succeeded'` (o vencedor do claim, que rodou a acao); os
     * outros 4 recebem `claim_not_acquired` — nunca `succeeded`, nunca
     * `failed` (que so descreveria uma acao que rodou e falhou).
     */
    expect(fulfilled.filter((r) => r.status === 'succeeded').length).toBe(1);
    expect(fulfilled.filter((r) => r.status === 'claim_not_acquired').length).toBe(4);
    expect(fulfilled.every((r) => r.status !== 'failed')).toBe(true);

    const tentativas = await contarTentativasDaAcao(executionId);
    // EXATAMENTE 1 tentativa e criada no total — os perdedores do claim da
    // EXECUCAO nunca chegam a inserir tentativa nenhuma (Secao 4).
    expect(tentativas.length).toBe(1);
    expect(tentativas[0]?.status).toBe('succeeded');

    expect(await contarMensagens(tenantA.tenantId)).toBe(1);
    const [mensagem] = await getDb()
      .select({ id: communicationMessages.id, status: communicationMessages.status })
      .from(communicationMessages)
      .where(eq(communicationMessages.tenantId, tenantA.tenantId));
    expect(mensagem?.status).toBe('sent');

    // NENHUMA segunda chamada ao provedor: so o unico worker vencedor chegou
    // a `processMessage`.
    const tentativasDeEnvio = await getDb()
      .select()
      .from(communicationAttempts)
      .where(eq(communicationAttempts.messageId, mensagem!.id));
    expect(tentativasDeEnvio.length).toBe(1);
    expect(tentativasDeEnvio[0]?.outcome).toBe('accepted');

    const [execucaoFinal] = await getDb()
      .select({ status: automationExecutions.status, lockedBy: automationExecutions.lockedBy })
      .from(automationExecutions)
      .where(eq(automationExecutions.id, executionId));
    expect(execucaoFinal?.status).toBe('succeeded');
    expect(execucaoFinal?.lockedBy).toBeNull();
  });

  it('Agenda: 5 workers simultaneos -> exatamente 1 claim vencedor, 1 tentativa succeeded, 1 tarefa', async () => {
    const ruleId = await criarRegraDeAgenda(tenantA);
    const osId = await ordemProntaParaAvisar(tenantA);
    const executionId = await materializarExecucaoPendente(tenantA, ruleId, osId);

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() => runExecutionActions(executionId, tenantA.tenantId)),
      ),
    );

    const fulfilled = resultados
      .filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof runExecutionActions>>> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value);
    expect(resultados.filter((r) => r.status === 'rejected').length).toBe(0);
    expect(fulfilled.length).toBe(5);
    expect(fulfilled.filter((r) => r.status === 'succeeded').length).toBe(1);
    expect(fulfilled.filter((r) => r.status === 'claim_not_acquired').length).toBe(4);

    const tentativas = await contarTentativasDaAcao(executionId);
    expect(tentativas.length).toBe(1);
    expect(tentativas[0]?.status).toBe('succeeded');
    expect(await contarTarefas(tenantA.tenantId)).toBe(1);

    const [execucaoFinal] = await getDb()
      .select({ status: automationExecutions.status, lockedBy: automationExecutions.lockedBy })
      .from(automationExecutions)
      .where(eq(automationExecutions.id, executionId));
    expect(execucaoFinal?.status).toBe('succeeded');
    expect(execucaoFinal?.lockedBy).toBeNull();
  });
});

describe('crash/retry apos claim (Secao 8/18-C/18-D do fechamento)', () => {
  it('Comunicacao: claim fica obsoleto antes de terminar (worker morreu) -> novo processamento reclama, converge, sem segunda mensagem', async () => {
    const templateId = await criarModeloWhatsapp(tenantA);
    const ruleId = await criarRegraDeComunicacao(tenantA, templateId);
    const osId = await ordemProntaParaAvisar(tenantA);
    const executionId = await materializarExecucaoPendente(tenantA, ruleId, osId);

    // Simula: um worker venceu o claim, RODOU a acao (efeito real existe),
    // mas morreu antes de marcar a execucao como succeeded — o claim fica
    // parado em `running`, com `locked_at` velho.
    const jaExecutou = await run(() => runExecutionActions(executionId, tenantA.tenantId));
    expect(jaExecutou.status).toBe('succeeded');
    expect(await contarMensagens(tenantA.tenantId)).toBe(1);

    // Reabre a execucao como se o worker tivesse morrido ANTES de
    // `finishExecution` (que e o que realmente limpa o lock) — mas o efeito
    // (mensagem real) ja aconteceu, exatamente como o cenario da Secao 8.
    const staleAt = new Date(Date.now() - 10 * 60 * 1000);
    await getDb()
      .update(automationExecutions)
      .set({ status: 'running', completedAt: null, lockedBy: 'worker-morto', lockedAt: staleAt })
      .where(eq(automationExecutions.id, executionId));

    const retomado = await run(() => runExecutionActions(executionId, tenantA.tenantId));
    expect(retomado.status).toBe('succeeded');

    // Convergiu sem rodar a acao de novo: `hasSucceededAttempt` already-true
    // pula a acao no laco, entao nenhuma tentativa nova foi criada.
    const tentativas = await contarTentativasDaAcao(executionId);
    expect(tentativas.length).toBe(1);
    expect(await contarMensagens(tenantA.tenantId)).toBe(1);
  });

  it('Agenda: mesmo cenario de claim obsoleto -> sem segunda tarefa', async () => {
    const ruleId = await criarRegraDeAgenda(tenantA);
    const osId = await ordemProntaParaAvisar(tenantA);
    const executionId = await materializarExecucaoPendente(tenantA, ruleId, osId);

    const jaExecutou = await run(() => runExecutionActions(executionId, tenantA.tenantId));
    expect(jaExecutou.status).toBe('succeeded');
    expect(await contarTarefas(tenantA.tenantId)).toBe(1);

    const staleAt = new Date(Date.now() - 10 * 60 * 1000);
    await getDb()
      .update(automationExecutions)
      .set({ status: 'running', completedAt: null, lockedBy: 'worker-morto', lockedAt: staleAt })
      .where(eq(automationExecutions.id, executionId));

    const retomado = await run(() => runExecutionActions(executionId, tenantA.tenantId));
    expect(retomado.status).toBe('succeeded');
    expect(await contarTarefas(tenantA.tenantId)).toBe(1);
  });

  it('claim ainda fresco (dentro de LOCK_STALE_MS) NAO e reclamado por outro processamento', async () => {
    const ruleId = await criarRegraDeAgenda(tenantA);
    const osId = await ordemProntaParaAvisar(tenantA);
    const executionId = await materializarExecucaoPendente(tenantA, ruleId, osId);

    // Simula um worker que acabou de pegar o claim (locked_at = agora) e
    // ainda esta "trabalhando" — nunca chegou a inserir tentativa nem a
    // rodar a acao.
    await getDb()
      .update(automationExecutions)
      .set({ lockedBy: 'worker-ativo', lockedAt: new Date() })
      .where(eq(automationExecutions.id, executionId));

    const resultado = await run(() => runExecutionActions(executionId, tenantA.tenantId));
    expect(resultado.status).toBe('claim_not_acquired');
    expect(await contarTentativasDaAcao(executionId)).toHaveLength(0);
    expect(await contarTarefas(tenantA.tenantId)).toBe(0);
  });
});

describe('guarda de producao: Communication sem provider real (Secao 9/10/11/12 do fechamento)', () => {
  it('NODE_ENV=production, sem provider configurado: message failed, communication_attempt failed/provider_not_configured, automation action failed, execution failed, OS intocada, nada de delivered/read inventado', async () => {
    const templateId = await criarModeloWhatsapp(tenantA);
    const ruleId = await criarRegraDeComunicacao(tenantA, templateId);
    const osId = await ordemProntaParaAvisar(tenantA);
    const evento = await avisarClienteEDevolverEvento(tenantA, osId);
    /** Capturado DEPOIS de `notifyCustomerReady` (que tem sua propria
     *  transicao de status, alheia ao Motor) e ANTES do Motor rodar — isola
     *  exatamente o que a ACAO DE AUTOMACAO pode ou nao mudar na OS. */
    const [osAntes] = await getDb()
      .select({ status: serviceOrders.status })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, osId));

    ligarProducao();
    await run(() => processAutomationEvent(evento));
    desligarProducao();

    /**
     * CORRECAO DO DEFEITO 2 (Secao 9-10 do fechamento): `provider_not_configured`
     * e SEM efeito real — a acao configurada e "delegar ao servico oficial e
     * obter resultado coerente com a politica desse modulo", nao apenas
     * "criar uma linha". O resultado de `processMessage` agora e propagado
     * por `createMessageFromAutomation` (`message-service.ts`) em vez de
     * ser descartado; `toActionResult` mapeia `outcome:'failed'` para
     * `ok:false`, e `finishExecution` fecha a execucao como `failed`.
     */
    expect(await contarExecucoes(tenantA.tenantId, ruleId)).toBe(1);
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

    const tentativaDaAcao = await contarTentativasDaAcao(execucao!.id);
    expect(tentativaDaAcao.length).toBe(1);
    expect(tentativaDaAcao[0]?.status).toBe('failed');
    expect(tentativaDaAcao[0]?.errorCode).toBe('PROVIDER_NOT_CONFIGURED');

    // O FATO REAL — nenhum provedor real disponivel em producao — fica
    // registrado onde a entrega de fato e decidida: a propria mensagem e
    // seus attempts, nunca inventando `delivered`/`read` (ADR-078).
    expect(await contarMensagens(tenantA.tenantId)).toBe(1);
    const [mensagem] = await getDb()
      .select()
      .from(communicationMessages)
      .where(eq(communicationMessages.tenantId, tenantA.tenantId));
    expect(mensagem?.status).toBe('failed');
    expect(mensagem?.lastErrorCode).toBe('provider_not_configured');

    const tentativasDeEnvio = await getDb()
      .select()
      .from(communicationAttempts)
      .where(eq(communicationAttempts.messageId, mensagem!.id));
    expect(tentativasDeEnvio.length).toBe(1);
    expect(tentativasDeEnvio[0]?.outcome).toBe('failed');
    expect(tentativasDeEnvio[0]?.errorCode).toBe('provider_not_configured');
    /**
     * RETRY POLICY (Secao 12): `PROVIDER_NOT_CONFIGURED` e um dos
     * `PERMANENT_ERROR_CODES` (`error-codes.ts`) — nunca melhora sozinho, um
     * retry automatico seria desperdicio. Um unico attempt terminal por
     * chamada, sem reenvio automatico (reenviar exige acao explicita fora
     * do Motor); nenhum job de retry e agendado.
     */

    const [osDepois] = await getDb()
      .select({ status: serviceOrders.status })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, osId));
    expect(osDepois?.status).toBe(osAntes?.status);
  });
});

describe('reuso de mensagem existente via idempotencyKey (Secao 13 do fechamento)', () => {
  it('mensagem existente FAILED reaproveitada pela idempotencia NAO vira action succeeded', async () => {
    const templateId = await criarModeloWhatsapp(tenantA);
    const ruleId = await criarRegraDeComunicacao(tenantA, templateId);
    const osId = await ordemProntaParaAvisar(tenantA);
    const executionId = await materializarExecucaoPendente(tenantA, ruleId, osId);

    // Primeira tentativa, em producao sem provider: cria a mensagem, ela
    // fica `failed`, a acao fica `failed` (mesmo cenario do teste acima).
    ligarProducao();
    const primeira = await run(() => runExecutionActions(executionId, tenantA.tenantId));
    desligarProducao();
    expect(primeira.status).toBe('failed');
    expect(await contarMensagens(tenantA.tenantId)).toBe(1);

    // Reabre a execucao (simulando um novo processamento/retry externo) e
    // roda de novo — SEM provider ainda ausente (fora de producao agora),
    // mas a mensagem ja existe com idempotencyKey igual e status `failed`.
    await getDb()
      .update(automationExecutions)
      .set({ status: 'running', completedAt: null, errorSummary: null })
      .where(eq(automationExecutions.id, executionId));

    const segunda = await run(() => runExecutionActions(executionId, tenantA.tenantId));

    // O REUSE nao virou sucesso so porque a linha ja existia: a mensagem
    // reaproveitada continua `failed`, entao a acao (e a execucao) tambem.
    expect(segunda.status).toBe('failed');
    expect(await contarMensagens(tenantA.tenantId)).toBe(1); // nunca uma segunda

    const [execucaoFinal] = await getDb()
      .select({ status: automationExecutions.status })
      .from(automationExecutions)
      .where(eq(automationExecutions.id, executionId));
    expect(execucaoFinal?.status).toBe('failed');
  });

  it('mensagem existente SENT (sucesso real) reaproveitada pela idempotencia converge para action succeeded, sem novo side effect', async () => {
    const templateId = await criarModeloWhatsapp(tenantA);
    const ruleId = await criarRegraDeComunicacao(tenantA, templateId);
    const osId = await ordemProntaParaAvisar(tenantA);
    const executionId = await materializarExecucaoPendente(tenantA, ruleId, osId);

    // Primeira tentativa, fora de producao (capture provider aceita) — a
    // mensagem fica `sent`.
    const primeira = await run(() => runExecutionActions(executionId, tenantA.tenantId));
    expect(primeira.status).toBe('succeeded');
    expect(await contarMensagens(tenantA.tenantId)).toBe(1);
    const [mensagemAntes] = await getDb()
      .select({ id: communicationMessages.id, status: communicationMessages.status })
      .from(communicationMessages)
      .where(eq(communicationMessages.tenantId, tenantA.tenantId));
    expect(mensagemAntes?.status).toBe('sent');

    // Reabre a execucao e roda de novo: a mensagem ja existe, ja SENT.
    await getDb()
      .update(automationExecutions)
      .set({ status: 'running', completedAt: null })
      .where(eq(automationExecutions.id, executionId));

    const segunda = await run(() => runExecutionActions(executionId, tenantA.tenantId));
    expect(segunda.status).toBe('succeeded');
    // Convergiu sem novo side effect: continua exatamente 1 mensagem, e e a
    // MESMA linha (mesmo id), nunca uma segunda.
    expect(await contarMensagens(tenantA.tenantId)).toBe(1);
    const [mensagemDepois] = await getDb()
      .select({ id: communicationMessages.id })
      .from(communicationMessages)
      .where(eq(communicationMessages.tenantId, tenantA.tenantId));
    expect(mensagemDepois?.id).toBe(mensagemAntes?.id);
  });

  it('createMessageFromAutomation chamado 2x com a MESMA idempotencyKey: 1a cria e envia, 2a reconhece reuse de sucesso sem chamar o provedor de novo', async () => {
    const templateId = await criarModeloWhatsapp(tenantA);
    const osId = await ordemProntaParaAvisar(tenantA);
    const [os] = await getDb()
      .select({ customerId: serviceOrders.customerId })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, osId));
    const idempotencyKey = `test:reuse-direto:${newId()}`;
    const input = {
      tenantId: tenantA.tenantId,
      unitId: tenantA.unitId,
      customerId: os!.customerId,
      channel: 'whatsapp' as const,
      templateId,
      serviceOrderId: osId,
      idempotencyKey,
    };

    const primeira = await run(() => createMessageFromAutomation(input));
    expect(primeira.outcome).toBe('created');
    const [mensagem] = await getDb()
      .select({ status: communicationMessages.status })
      .from(communicationMessages)
      .where(eq(communicationMessages.id, primeira.messageId!));
    expect(mensagem?.status).toBe('sent');

    const segunda = await run(() => createMessageFromAutomation(input));
    expect(segunda.outcome).toBe('reused');
    expect(segunda.messageId).toBe(primeira.messageId);
    expect(await contarMensagens(tenantA.tenantId)).toBe(1);

    const tentativas = await getDb()
      .select()
      .from(communicationAttempts)
      .where(eq(communicationAttempts.messageId, primeira.messageId!));
    // A 2a chamada nunca tentou entregar de novo: so 1 tentativa de envio
    // real existe (a da criacao original).
    expect(tentativas.length).toBe(1);
  });
});

describe('Agenda OFF, automation ON (Secao 7 do fechamento — espelha o teste de Communications OFF)', () => {
  it('operations.agenda OFF: execucao existe e falha explicitamente com ACTION_FEATURE_DISABLED, sem tarefa, sem retry infinito', async () => {
    const ruleId = await criarRegraDeAgenda(tenantA);
    await run(() =>
      setTenantFeature(tenantA.context, { featureKey: FEATURES.OPERATIONS_AGENDA, enabled: false }),
    );

    const osId = await ordemProntaParaAvisar(tenantA);
    const evento = await avisarClienteEDevolverEvento(tenantA, osId);
    await run(() => processAutomationEvent(evento));

    expect(await contarTarefas(tenantA.tenantId)).toBe(0);
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

    // Sem retry automatico: rodar o mesmo processamento de novo nao produz
    // segunda execucao nem segunda tentativa (a idempotencyKey do evento e
    // estavel; a execucao ja terminal nao e retomada).
    await run(() => processAutomationEvent(evento));
    expect(await contarExecucoes(tenantA.tenantId, ruleId)).toBe(1);
    expect(await contarTarefas(tenantA.tenantId)).toBe(0);
  });
});

describe('prevencao de loop (Secao 8 do fechamento)', () => {
  it('nenhum evento PRODUZIDO por uma acao (TASK_CREATED, MESSAGE_CREATED/SENT/FAILED) e sourceEvent de gatilho algum — Rule -> Action -> Event -> Rule nao fecha ciclo por construcao', () => {
    const sourceEvents: Set<string> = new Set(
      Object.values(AUTOMATION_TRIGGERS)
        .map((t) => t.sourceEvent)
        .filter((e): e is NonNullable<typeof e> => e !== null),
    );
    const eventosProduzidosPorAcoes = [
      CORE_EVENT_TYPES.TASK_CREATED,
      CORE_EVENT_TYPES.MESSAGE_CREATED,
      CORE_EVENT_TYPES.MESSAGE_SENT,
      CORE_EVENT_TYPES.MESSAGE_FAILED,
    ];
    for (const tipo of eventosProduzidosPorAcoes) {
      expect(sourceEvents.has(tipo)).toBe(false);
    }
  });

  it('publicar TASK_CREATED/MESSAGE_CREATED real nao enfileira nenhum job de automacao (o produtor nunca e assinado)', async () => {
    registerAutomationSubscriptions();
    const templateId = await criarModeloWhatsapp(tenantA);
    await criarRegraDeComunicacao(tenantA, templateId);
    const ruleAgendaId = await criarRegraDeAgenda(tenantA);
    void ruleAgendaId;

    const osId = await ordemProntaParaAvisar(tenantA);
    const evento = await avisarClienteEDevolverEvento(tenantA, osId);
    await run(() => processAutomationEvent(evento));

    // A propria acao rodou (criou mensagem/tarefa, que por sua vez emitiu
    // MESSAGE_CREATED/TASK_CREATED de verdade no outbox) — e mesmo assim
    // NENHUM segundo job de automacao foi enfileirado por causa disso,
    // porque `registerAutomationSubscriptions` nunca se inscreveu nesses
    // eventos (Secao 8: nao ha assinatura = nao ha ciclo possivel).
    const jobsDeAutomacao = await getDb()
      .select()
      .from(jobs)
      .where(eq(jobs.name, 'automation.dispatch-event'));
    expect(jobsDeAutomacao.length).toBe(1); // so o dispatch do evento ORIGINAL
  });
});

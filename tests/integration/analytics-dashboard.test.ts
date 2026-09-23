import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { newId } from '@/core/ids/id';
import { Money } from '@/core/money/money';
import { todayIn, addDays } from '@/core/time/civil-date';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import {
  completeTask,
  notifyCustomerReady,
} from '@/modules/service-orders/application/service-order-actions';
import { serviceOrders, serviceOrderTasks } from '@/modules/service-orders/infrastructure/schema';
import { quotes } from '@/modules/quotes/infrastructure/schema';
import { agendaTasks } from '@/modules/agenda/infrastructure/schema';
import { communicationMessages } from '@/modules/communications/infrastructure/schema';
import {
  createFinancialAccount,
  ensureFinanceDefaults,
  listActivePaymentMethods,
} from '@/modules/finance/application/finance-settings-service';
import {
  createFinancialTitle,
  listInstallmentsOfTitle,
} from '@/modules/finance/application/title-service';
import {
  reverseSettlement,
  settleFinancialTitle,
} from '@/modules/finance/application/settlement-service';
import { loadDashboard } from '@/modules/analytics/application/dashboard-query-service';
import { resolveAnalyticsScope } from '@/modules/analytics/domain/analytics-scope';
import { loadServiceOrderMetrics } from '@/modules/analytics/application/service-order-metrics';
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
 * O PAINEL contra MariaDB de verdade (Prompt 18).
 *
 * O eixo: nenhum numero atravessa fronteira de tenant, de unidade nao
 * autorizada, de permissao ausente ou de modulo desligado — e o cartao e o
 * numero da lista sempre contam a MESMA historia (reconciliacao).
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);
const TZ = 'America/Sao_Paulo';
const hoje = () => todayIn(TZ);

async function ligarPainel(fixture: TenantFixture): Promise<void> {
  // core.quotes e CORE (estrutural): ja vem sempre ligado, nunca aceita toggle.
  for (const featureKey of [
    FEATURES.ANALYTICS_DASHBOARD,
    FEATURES.FINANCE_CORE,
    FEATURES.OPERATIONS_INVENTORY,
    FEATURES.OPERATIONS_PURCHASING,
    FEATURES.OPERATIONS_WARRANTIES,
    FEATURES.OPERATIONS_AGENDA,
    FEATURES.COMMUNICATIONS_CORE,
  ]) {
    await run(() => setTenantFeature(fixture.context, { featureKey, enabled: true }));
  }
}

async function abrirOrdem(
  fixture: TenantFixture,
  contexto = fixture.context,
  nome = 'Cliente do Painel',
): Promise<string> {
  const { customerId } = await run(() =>
    createCustomer(contexto, {
      kind: 'individual',
      name: nome,
      contacts: [{ type: 'phone', value: '11933332222', isWhatsapp: false }],
    }),
  );
  const { equipmentId } = await run(() =>
    createEquipment(contexto, { customerId, kind: 'Televisor', brand: 'Marca' }),
  );
  const { serviceOrderId } = await run(() =>
    createServiceOrder(contexto, { equipmentId, customerReport: 'O aparelho nao liga.' }),
  );
  return serviceOrderId;
}

/**
 * Leva a OS ate `completed`, pelo caminho oficial mais curto.
 *
 * `awaiting_customer_pickup` e `actionOnly` (so alcancavel por "Informar
 * Ordem Disponivel", nunca pelo botao generico de transicao) — e essa acao
 * so libera depois que a tarefa de preparacao para entrega e concluida.
 */
async function finalizar(fixture: TenantFixture, id: string): Promise<void> {
  for (const passo of ['awaiting_repair', 'repair_completed', 'awaiting_delivery_preparation']) {
    await run(() =>
      transitionServiceOrder(fixture.context, { serviceOrderId: id, to: passo as never }),
    );
  }

  const [tarefa] = await getDb()
    .select({ id: serviceOrderTasks.id })
    .from(serviceOrderTasks)
    .where(and(eq(serviceOrderTasks.serviceOrderId, id), eq(serviceOrderTasks.status, 'open')))
    .limit(1);
  if (tarefa) await run(() => completeTask(fixture.context, tarefa.id));

  await run(() => notifyCustomerReady(fixture.context, id));
  await run(() => transitionServiceOrder(fixture.context, { serviceOrderId: id, to: 'completed' }));
}

/**
 * BACKDATING DE FIXTURE: escreve `opened_at`/`status_changed_at` diretamente.
 *
 * Isto NUNCA testa a maquina de estados (ja coberta pela propria suite de
 * OS) — serve apenas para colocar um FATO HISTORICO conhecido no banco, para
 * que o Painel seja testado com datas determinaveis em vez de "agora".
 */
async function backdate(id: string, openedAt: string, statusChangedAt?: string): Promise<void> {
  await getDb()
    .update(serviceOrders)
    .set({
      openedAt: new Date(`${openedAt}T12:00:00.000Z`),
      ...(statusChangedAt ? { statusChangedAt: new Date(`${statusChangedAt}T12:00:00.000Z`) } : {}),
    })
    .where(eq(serviceOrders.id, id));
}

/**
 * PROVA DE NAO-EXECUCAO POR DADO REAL (nao por spy).
 *
 * Este repositorio nao tem NENHUM precedente de `vi.spyOn`/`vi.mock` em
 * nenhum dos 105 arquivos de teste da suite — toda garantia de "nao
 * consultou" e provada plantando um dado real e detectavel, e confirmando
 * que ele nunca atravessa a fronteira (mesmo padrao de
 * `tests/integration/analytics-dashboard.test.ts` > "financeiro: Money e
 * reversao" e de toda a suite de Portal/Central de Trabalho). Um valor
 * bem conhecido (R$ 1.234,56) e liquidado de verdade; se
 * `loadFinanceMetrics`/`loadFinanceOverview` fosse chamado, o numero
 * apareceria em `dashboard.finance.settlementsInPeriod` — a asserção
 * `finance === null` so passa se a consulta genuinamente nunca rodou.
 */
async function liquidarValorDetectavel(fixture: TenantFixture): Promise<void> {
  await run(() => ensureFinanceDefaults(fixture.context));
  const { customerId } = await run(() =>
    createCustomer(fixture.context, {
      kind: 'individual',
      name: 'Cliente com liquidacao detectavel',
      contacts: [{ type: 'phone', value: '11911112222', isWhatsapp: false }],
    }),
  );
  const conta = await run(() =>
    createFinancialAccount(fixture.context, {
      name: 'Conta deteccao',
      kind: 'bank',
      unitId: fixture.unitId,
    }),
  );
  const metodos = await run(() => listActivePaymentMethods(fixture.context));
  const metodoId = metodos[0]!.id;

  const titulo = await run(() =>
    createFinancialTitle(fixture.context, {
      unitId: fixture.unitId,
      direction: 'receivable',
      customerId,
      description: 'Valor detectavel para prova de nao-execucao',
      amount: '1234.56',
      dueDate: todayIn('America/Sao_Paulo'),
      installmentCount: 1,
    }),
  );
  const parcelas = await run(() => listInstallmentsOfTitle(fixture.context, titulo.titleId));

  await run(() =>
    settleFinancialTitle(fixture.context, titulo.titleId, {
      installmentId: parcelas[0]!.id,
      amount: '1234.56',
      financialAccountId: conta,
      paymentMethodId: metodoId,
      effectiveDate: todayIn('America/Sao_Paulo'),
    }),
  );
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
  tenantA = await createTenantFixture('an-a', planId);
  tenantB = await createTenantFixture('an-b', planId);
  for (const t of [tenantA, tenantB]) await ligarPainel(t);
});

// ---------------------------------------------------------------------------
// Isolamento de tenant
// ---------------------------------------------------------------------------

describe('isolamento de tenant', () => {
  it('OS de outro tenant nunca aparece no Painel', async () => {
    await abrirOrdem(tenantA);
    await abrirOrdem(tenantA);
    await abrirOrdem(tenantB);
    await abrirOrdem(tenantB);
    await abrirOrdem(tenantB);

    const painelA = await run(() => loadDashboard(tenantA.context));
    const painelB = await run(() => loadDashboard(tenantB.context));

    expect(painelA.serviceOrders.openTotal).toBe(2);
    expect(painelB.serviceOrders.openTotal).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Escopo de unidade e "todas as unidades"
// ---------------------------------------------------------------------------

describe('escopo de unidade', () => {
  it('usuario MEMBRO de 2 das 3 unidades do tenant: "todas" nunca inclui a terceira (item 146)', async () => {
    const unitB = await createUnit(tenantA.tenantId, 'Unidade B');
    const unitC = await createUnit(tenantA.tenantId, 'Unidade C');

    const userId = await createPlainUser(tenantA.tenantId, 'gerente@an-a.invalid');
    // Membership (item 122) SO em A e B — C nunca e nem "vista" pelo usuario,
    // membership e o que responde "onde a pessoa pode operar" (tenant-context.ts).
    await grantMembership(tenantA.tenantId, userId, tenantA.unitId);
    await grantMembership(tenantA.tenantId, userId, unitB);

    const roleId = await createRoleWithPermissions(tenantA.tenantId, 'gerente-2-unidades', [
      PERMISSIONS.ANALYTICS_VIEW,
      PERMISSIONS.SERVICE_ORDERS_VIEW,
    ]);
    await assignTenantRole(tenantA.tenantId, userId, roleId);

    // O ADMIN tambem precisa de membership nas novas unidades para abrir OS
    // nelas — `createServiceOrder` valida `authorizedUnitIds` de quem chama.
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, unitB);
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, unitC);
    const adminContext = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    await abrirOrdem(
      tenantA,
      { ...adminContext, activeUnitId: tenantA.unitId },
      'Cliente Unidade A',
    );
    await abrirOrdem(tenantA, { ...adminContext, activeUnitId: unitB }, 'Cliente Unidade B');
    await abrirOrdem(tenantA, { ...adminContext, activeUnitId: unitC }, 'Cliente Unidade C');

    const contextoGerente = await contextFor(tenantA.tenantId, userId, tenantA.unitId);
    // O gerente so enxerga A e B via membership: C nunca aparece autorizada.
    expect([...contextoGerente.authorizedUnitIds].sort()).toEqual([tenantA.unitId, unitB].sort());

    const scope = resolveAnalyticsScope(contextoGerente, {});
    expect([...scope.selectedUnitIds].sort()).toEqual([tenantA.unitId, unitB].sort());
    expect(scope.allUnitsSelected).toBe(true);

    // Pipeline completo (permissao por unidade incluida), nao so o escopo.
    const dashboard = await run(() => loadDashboard(contextoGerente));
    // 2 OS visiveis (A e B); a de C nunca entra na soma.
    expect(dashboard.serviceOrders.openTotal).toBe(2);
  });

  it('pedir explicitamente uma unidade NAO autorizada devolve escopo vazio, nunca "todas" (item 123)', async () => {
    const scope = resolveAnalyticsScope(tenantA.context, { unitIds: ['unidade-que-nao-existe'] });
    expect(scope.selectedUnitIds).toEqual([]);

    const metrics = await run(() => loadServiceOrderMetrics(scope));
    expect(metrics.openTotal).toBe(0);
    expect(metrics.statusDistribution.every((row) => row.total === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Permissao e feature: "Dashboard Access + Feature + Permission + Unit = Metric Access"
// ---------------------------------------------------------------------------

describe('permissao de dominio', () => {
  it('analytics.view sem finance.view: query financeira NUNCA roda, mesmo com liquidacao real no banco (item 147)', async () => {
    // Dado real e detectavel PLANTADO ANTES da checagem: se loadFinanceMetrics
    // rodasse, dashboard.finance.settlementsInPeriod seria '1234.56'.
    await liquidarValorDetectavel(tenantA);

    const userId = await createPlainUser(tenantA.tenantId, 'sem-financeiro@an-a.invalid');
    await grantMembership(tenantA.tenantId, userId, tenantA.unitId);
    const roleId = await createRoleWithPermissions(tenantA.tenantId, 'so-analytics', [
      PERMISSIONS.ANALYTICS_VIEW,
      PERMISSIONS.SERVICE_ORDERS_VIEW,
    ]);
    await assignTenantRole(tenantA.tenantId, userId, roleId);
    const contexto = await contextFor(tenantA.tenantId, userId, tenantA.unitId);

    const dashboard = await run(() => loadDashboard(contexto));

    // null, NUNCA um objeto com total zerado — a chave existe no DTO, o valor nao.
    expect(dashboard.finance).toBeNull();
    expect(JSON.stringify(dashboard)).not.toContain('1234.56');
    expect(dashboard.serviceOrders).not.toBeNull();
  });

  it('com finance.view, o cartao financeiro aparece e reflete a liquidacao real', async () => {
    await liquidarValorDetectavel(tenantA);
    const dashboard = await run(() => loadDashboard(tenantA.context));
    expect(dashboard.finance).not.toBeNull();
    expect(dashboard.finance?.settlementsInPeriod).toBe('1234.56');
  });
});

describe('feature desligada nunca vaza contagem (item 26 e 148)', () => {
  it('finance.core OFF: query financeira NUNCA roda, mesmo com liquidacao real e permissao concedida', async () => {
    // Liquidacao real feita ENQUANTO a feature ainda esta ligada — depois a
    // feature e desligada e o mesmo usuario (com finance.view completo)
    // consulta o Painel de novo.
    await liquidarValorDetectavel(tenantA);

    await run(() =>
      setTenantFeature(tenantA.context, { featureKey: FEATURES.FINANCE_CORE, enabled: false }),
    );

    const dashboard = await run(() => loadDashboard(tenantA.context));
    expect(dashboard.finance).toBeNull();
    expect(JSON.stringify(dashboard)).not.toContain('1234.56');
  });

  it('operations.warranties OFF: garantias ausentes', async () => {
    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.OPERATIONS_WARRANTIES,
        enabled: false,
      }),
    );
    const dashboard = await run(() => loadDashboard(tenantA.context));
    expect(dashboard.warranties).toBeNull();
  });

  it('operations.agenda OFF: agenda ausente', async () => {
    await run(() =>
      setTenantFeature(tenantA.context, { featureKey: FEATURES.OPERATIONS_AGENDA, enabled: false }),
    );
    const dashboard = await run(() => loadDashboard(tenantA.context));
    expect(dashboard.agenda).toBeNull();
  });

  it('communications.core OFF: comunicacao ausente', async () => {
    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.COMMUNICATIONS_CORE,
        enabled: false,
      }),
    );
    const dashboard = await run(() => loadDashboard(tenantA.context));
    expect(dashboard.communications).toBeNull();
  });

  it('operations.inventory OFF: estoque ausente', async () => {
    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.OPERATIONS_INVENTORY,
        enabled: false,
      }),
    );
    const dashboard = await run(() => loadDashboard(tenantA.context));
    expect(dashboard.inventory).toBeNull();
  });

  it('operations.purchasing OFF: compras ausente', async () => {
    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.OPERATIONS_PURCHASING,
        enabled: false,
      }),
    );
    const dashboard = await run(() => loadDashboard(tenantA.context));
    expect(dashboard.purchasing).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reconciliacao: cartao = soma da lista
// ---------------------------------------------------------------------------

describe('reconciliacao (item 46)', () => {
  it('a soma da distribuicao por status bate com o total de OS criadas', async () => {
    const id1 = await abrirOrdem(tenantA);
    const id2 = await abrirOrdem(tenantA);
    const id3 = await abrirOrdem(tenantA);
    await finalizar(tenantA, id3);
    void id1;
    void id2;

    const dashboard = await run(() => loadDashboard(tenantA.context));
    const somaDistribuicao = dashboard.serviceOrders.statusDistribution.reduce(
      (t, r) => t + r.total,
      0,
    );
    expect(somaDistribuicao).toBe(3);

    const completedRow = dashboard.serviceOrders.statusDistribution.find(
      (r) => r.status === 'completed',
    );
    expect(completedRow?.total).toBe(1);

    // Reconciliacao contra contagem direta no banco, sem passar pelo adaptador.
    const [linha] = await getDb()
      .select({ total: sql<number>`COUNT(*)` })
      .from(serviceOrders)
      .where(
        and(eq(serviceOrders.tenantId, tenantA.tenantId), eq(serviceOrders.status, 'completed')),
      );
    expect(Number((linha as { total: number | string }).total)).toBe(1);
  });

  it('open_total = soma exata das situacoes NAO terminais (nunca inclui completed/cancelled)', async () => {
    const abertaId = await abrirOrdem(tenantA);
    const finalizadaId = await abrirOrdem(tenantA);
    await finalizar(tenantA, finalizadaId);
    void abertaId;

    const dashboard = await run(() => loadDashboard(tenantA.context));
    expect(dashboard.serviceOrders.openTotal).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Periodo: limites inclusivos
// ---------------------------------------------------------------------------

describe('limites do periodo (item 142)', () => {
  it('OS exatamente no inicio e no fim do periodo sao INCLUIDAS; um dia fora, excluidas', async () => {
    const hojeStr = hoje();
    const de = addDays(hojeStr, -6); // periodo '7d'

    const antesDoInicio = await abrirOrdem(tenantA, tenantA.context, 'Antes');
    const noInicio = await abrirOrdem(tenantA, tenantA.context, 'No inicio');
    const dentro = await abrirOrdem(tenantA, tenantA.context, 'Dentro');
    const noFim = await abrirOrdem(tenantA, tenantA.context, 'No fim');
    const depoisDoFim = await abrirOrdem(tenantA, tenantA.context, 'Depois');

    await backdate(antesDoInicio, addDays(de, -1));
    await backdate(noInicio, de);
    await backdate(dentro, addDays(de, 2));
    await backdate(noFim, hojeStr);
    await backdate(depoisDoFim, addDays(hojeStr, 1));

    const dashboard = await run(() => loadDashboard(tenantA.context, { period: '7d' }));
    expect(dashboard.serviceOrders.createdInPeriod).toBe(3); // noInicio + dentro + noFim
  });
});

// ---------------------------------------------------------------------------
// Antiguidade de backlog e tempo de ciclo
// ---------------------------------------------------------------------------

describe('backlog aging e tempo de ciclo', () => {
  it('classifica a antiguidade do backlog pela abertura, nunca pelo estado atual', async () => {
    const hojeStr = hoje();
    const nova = await abrirOrdem(tenantA, tenantA.context, 'Nova');
    const antiga = await abrirOrdem(tenantA, tenantA.context, 'Antiga');
    await backdate(nova, hojeStr);
    await backdate(antiga, addDays(hojeStr, -40));

    const dashboard = await run(() => loadDashboard(tenantA.context));
    const porFaixa = new Map(dashboard.serviceOrders.backlogAging.map((b) => [b.key, b.total]));
    expect(porFaixa.get('0-2')).toBe(1);
    expect(porFaixa.get('30+')).toBe(1);
  });

  it('tempo de ciclo usa abertura -> finalizacao, so para OS completadas NO PERIODO', async () => {
    const hojeStr = hoje();
    const os = await abrirOrdem(tenantA, tenantA.context, 'Ciclo conhecido');
    await finalizar(tenantA, os);
    // Abriu ha 10 dias, finalizou hoje: ciclo de 10 dias, amostra unica.
    await backdate(os, addDays(hojeStr, -10), hojeStr);

    const dashboard = await run(() => loadDashboard(tenantA.context, { period: '30d' }));
    expect(dashboard.serviceOrders.cycleTime).toEqual({
      sampleSize: 1,
      medianDays: 10,
      averageDays: 10,
    });
  });

  it('sem OS finalizada no periodo: "sem dados suficientes" (null), nunca 0 dias (item 44)', async () => {
    const dashboard = await run(() => loadDashboard(tenantA.context));
    expect(dashboard.serviceOrders.cycleTime).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dinheiro: Money, nunca float; reversao nunca conta como recebido
// ---------------------------------------------------------------------------

describe('financeiro: Money e reversao (itens 52 e 54)', () => {
  it('liquidacao estornada NUNCA conta como recebimento liquidado', async () => {
    await run(() => ensureFinanceDefaults(tenantA.context));
    const { customerId } = await run(() =>
      createCustomer(tenantA.context, {
        kind: 'individual',
        name: 'Cliente Financeiro',
        contacts: [{ type: 'phone', value: '11955554444', isWhatsapp: false }],
      }),
    );
    const conta = await run(() =>
      createFinancialAccount(tenantA.context, {
        name: 'Conta teste',
        kind: 'bank',
        unitId: tenantA.unitId,
      }),
    );
    const metodos = await run(() => listActivePaymentMethods(tenantA.context));
    const metodoId = metodos[0]!.id;

    const titulo = await run(() =>
      createFinancialTitle(tenantA.context, {
        unitId: tenantA.unitId,
        direction: 'receivable',
        customerId,
        description: 'Conserto de televisor',
        amount: '1000.00',
        dueDate: hoje(),
        installmentCount: 1,
      }),
    );
    const parcelas = await run(() => listInstallmentsOfTitle(tenantA.context, titulo.titleId));

    const liquidacao = await run(() =>
      settleFinancialTitle(tenantA.context, titulo.titleId, {
        installmentId: parcelas[0]!.id,
        amount: '1000.00',
        financialAccountId: conta,
        paymentMethodId: metodoId,
        effectiveDate: hoje(),
      }),
    );

    const antesDoEstorno = await run(() => loadDashboard(tenantA.context));
    expect(antesDoEstorno.finance?.settlementsInPeriod).toBe('1000.00');

    await run(() =>
      reverseSettlement(tenantA.context, liquidacao.settlementId, 'Cheque devolvido'),
    );

    const depoisDoEstorno = await run(() => loadDashboard(tenantA.context));
    // Nunca "-1000.00" nem "0.00 com erro de arredondamento": exatamente zero.
    expect(depoisDoEstorno.finance?.settlementsInPeriod).toBe(Money.zero().toString());
  });
});

// ---------------------------------------------------------------------------
// Orcamentos, Agenda e Comunicacao — fixture minima direta (leitura, nao escrita)
// ---------------------------------------------------------------------------

describe('orcamentos: taxa de aprovacao', () => {
  it('pendentes nao entram no denominador; so aprovados e rejeitados contam', async () => {
    const serviceOrderId = await abrirOrdem(tenantA);
    const now = new Date();
    const base = {
      tenantId: tenantA.tenantId,
      unitId: tenantA.unitId,
      serviceOrderId,
      subtotal: '100.00',
      discount: '0.00',
      total: '100.00',
      currency: 'BRL',
      createdAt: now,
      updatedAt: now,
    };

    await getDb()
      .insert(quotes)
      .values([
        { id: newId(), number: 1, status: 'approved', decidedAt: now, ...base },
        { id: newId(), number: 2, status: 'rejected', decidedAt: now, ...base },
        { id: newId(), number: 3, status: 'sent', sentAt: now, ...base },
      ]);

    const dashboard = await run(() => loadDashboard(tenantA.context));
    expect(dashboard.quotes?.approvedInPeriod).toBe(1);
    expect(dashboard.quotes?.rejectedInPeriod).toBe(1);
    expect(dashboard.quotes?.approvalRate).toBe(0.5);
  });
});

describe('agenda: vencidas e hoje nunca se misturam', () => {
  it('conta vencidas e de hoje separadamente, so tarefas abertas', async () => {
    const now = new Date();
    const hojeStr = hoje();
    const base = {
      tenantId: tenantA.tenantId,
      unitId: tenantA.unitId,
      title: 'Tarefa',
      createdAt: now,
      updatedAt: now,
    };

    await getDb()
      .insert(agendaTasks)
      .values([
        { id: newId(), status: 'open', dueDate: addDays(hojeStr, -3), ...base },
        { id: newId(), status: 'open', dueDate: hojeStr, ...base },
        { id: newId(), status: 'done', dueDate: addDays(hojeStr, -5), ...base },
      ]);

    const dashboard = await run(() => loadDashboard(tenantA.context));
    expect(dashboard.agenda?.overdueTasks).toBe(1);
    expect(dashboard.agenda?.todayTasks).toBe(1);
  });
});

describe('comunicacao: nunca promete entrega', () => {
  it('conta registradas e com falha, sem inventar status de entrega', async () => {
    const now = new Date();
    const base = {
      tenantId: tenantA.tenantId,
      unitId: tenantA.unitId,
      channel: 'whatsapp',
      origin: 'manual',
      recipientValue: '11999998888',
      recipientDisplay: '11999998888',
      body: 'Ola',
      createdAt: now,
      updatedAt: now,
    };

    await getDb()
      .insert(communicationMessages)
      .values([
        { id: newId(), status: 'sent', sentAt: now, ...base },
        { id: newId(), status: 'failed', ...base },
        { id: newId(), status: 'queued', ...base },
      ]);

    const dashboard = await run(() => loadDashboard(tenantA.context));
    expect(dashboard.communications?.registeredInPeriod).toBe(3);
    expect(dashboard.communications?.failedInPeriod).toBe(1);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { requestPartPickup } from '@/modules/service-orders/application/service-order-actions';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import {
  createWorkflowTask,
  transitionServiceOrder,
} from '@/modules/service-orders/application/workflow-service';
import {
  DELIVERY_PREPARATION_TASK_DESCRIPTION,
  DELIVERY_PREPARATION_TASK_DESCRIPTION_LEGACY,
  DELIVERY_PREPARATION_TASK_TITLE,
  PART_PICKUP_TASK_TITLE,
  TASK_KINDS,
} from '@/modules/service-orders/domain/workflow';
import { serviceOrderTasks, serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * O TEXTO OFICIAL DA TAREFA DE PREPARACAO, E O QUE ELE NAO GOVERNA.
 *
 * O Prompt 08 gravou uma redacao sem acentos; a especificacao sempre teve
 * acentos. Corrigir isso e seguro por um motivo estrutural, e e esse motivo
 * que estes testes protegem: A IDENTIDADE DA TAREFA SISTEMICA E
 * `(service_order_id, kind, open_marker)`, NUNCA O TEXTO.
 *
 * Se algum dia alguem trocar essa identidade por uma comparacao de titulo,
 * estes testes quebram — e e para isso que eles existem.
 */

let tenantA: TenantFixture;
let ordemId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

async function abrirOrdem(fixture: TenantFixture): Promise<string> {
  const { customerId } = await run(() =>
    createCustomer(fixture.context, {
      kind: 'individual',
      name: 'Cliente da preparacao',
      contacts: [{ type: 'phone', value: '11977776666', isWhatsapp: false }],
    }),
  );

  const { equipmentId } = await run(() =>
    createEquipment(fixture.context, { customerId, kind: 'Notebook' }),
  );

  const { serviceOrderId } = await run(() =>
    createServiceOrder(fixture.context, {
      equipmentId,
      customerReport: 'Aparelho desliga sozinho depois de alguns minutos.',
    }),
  );

  return serviceOrderId;
}

async function levarAtePreparacao(id: string): Promise<void> {
  for (const passo of ['awaiting_repair', 'repair_completed', 'awaiting_delivery_preparation']) {
    await run(() =>
      transitionServiceOrder(tenantA.context, { serviceOrderId: id, to: passo as never }),
    );
  }
}

async function preparacoesDe(id: string) {
  return getDb()
    .select()
    .from(serviceOrderTasks)
    .where(
      and(
        eq(serviceOrderTasks.serviceOrderId, id),
        eq(serviceOrderTasks.kind, TASK_KINDS.DELIVERY_PREPARATION),
      ),
    );
}

async function ordemDe(id: string) {
  const [row] = await getDb()
    .select({ status: serviceOrders.status, version: serviceOrders.version })
    .from(serviceOrders)
    .where(eq(serviceOrders.id, id))
    .limit(1);
  return row!;
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
  tenantA = await createTenantFixture('prep-a', planId);
  ordemId = await abrirOrdem(tenantA);
});

describe('texto oficial da tarefa de preparacao', () => {
  it('a tarefa sistemica nasce com o texto acentuado, exatamente como especificado', async () => {
    await levarAtePreparacao(ordemId);

    const tarefas = await preparacoesDe(ordemId);
    expect(tarefas).toHaveLength(1);

    /** O literal, sem passar pela constante: e a especificacao que manda. */
    expect(tarefas[0]!.description).toBe(
      'Realizar limpeza final, conferência estética e preparação do equipamento para entrega ao cliente.',
    );
    expect(tarefas[0]!.title).toBe('Preparar equipamento para entrega');

    /** E a constante concorda com a especificacao. */
    expect(DELIVERY_PREPARATION_TASK_DESCRIPTION).toBe(
      'Realizar limpeza final, conferência estética e preparação do equipamento para entrega ao cliente.',
    );
  });

  it('a redacao antiga nao e mais escrita por ninguem', async () => {
    await levarAtePreparacao(ordemId);

    const tarefas = await preparacoesDe(ordemId);
    expect(tarefas[0]!.description).not.toBe(DELIVERY_PREPARATION_TASK_DESCRIPTION_LEGACY);
    expect(DELIVERY_PREPARATION_TASK_DESCRIPTION).not.toBe(
      DELIVERY_PREPARATION_TASK_DESCRIPTION_LEGACY,
    );
  });
});

describe('identidade estrutural, nao textual', () => {
  it('reprocessar a criacao nao duplica a tarefa', async () => {
    await levarAtePreparacao(ordemId);
    const antes = await ordemDe(ordemId);

    const [ordem] = await getDb()
      .select({ id: serviceOrders.id, unitId: serviceOrders.unitId })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId))
      .limit(1);

    /** A mesma criacao, de novo: o segundo pedido reencontra e nao insere. */
    const segundo = await run(() =>
      runInTransaction((tx) =>
        createWorkflowTask(tx, tenantA.context, {
          order: ordem!,
          kind: TASK_KINDS.DELIVERY_PREPARATION,
          title: DELIVERY_PREPARATION_TASK_TITLE,
          description: DELIVERY_PREPARATION_TASK_DESCRIPTION,
          now: new Date(),
        }),
      ),
    );

    expect(segundo).toBeNull();
    expect(await preparacoesDe(ordemId)).toHaveLength(1);

    /** E nada disso mexeu no estado da OS (item 7 da correcao). */
    const depois = await ordemDe(ordemId);
    expect(depois.status).toBe(antes.status);
    expect(depois.version).toBe(antes.version);
  });

  it('a idempotencia NAO depende do titulo: texto diferente, mesma tarefa', async () => {
    await levarAtePreparacao(ordemId);

    const [ordem] = await getDb()
      .select({ id: serviceOrders.id, unitId: serviceOrders.unitId })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId))
      .limit(1);

    /**
     * Titulo e descricao COMPLETAMENTE outros, mesmo `kind`. Se a identidade
     * fosse textual, isto criaria a segunda tarefa. Nao cria.
     */
    const segundo = await run(() =>
      runInTransaction((tx) =>
        createWorkflowTask(tx, tenantA.context, {
          order: ordem!,
          kind: TASK_KINDS.DELIVERY_PREPARATION,
          title: 'Um titulo totalmente diferente',
          description: 'Uma descricao totalmente diferente.',
          now: new Date(),
        }),
      ),
    );

    expect(segundo).toBeNull();

    const tarefas = await preparacoesDe(ordemId);
    expect(tarefas).toHaveLength(1);
    /** E a tarefa que ficou continua com o texto oficial. */
    expect(tarefas[0]!.description).toBe(DELIVERY_PREPARATION_TASK_DESCRIPTION);
  });

  it('uma tarefa legada, sem acentos, nao vira duas depois do reprocessamento', async () => {
    const [ordem] = await getDb()
      .select({ id: serviceOrders.id, unitId: serviceOrders.unitId })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId))
      .limit(1);

    /** O banco de quem ja rodava o Prompt 08: a tarefa esta la, sem acentos. */
    await run(() =>
      runInTransaction((tx) =>
        createWorkflowTask(tx, tenantA.context, {
          order: ordem!,
          kind: TASK_KINDS.DELIVERY_PREPARATION,
          title: DELIVERY_PREPARATION_TASK_TITLE,
          description: DELIVERY_PREPARATION_TASK_DESCRIPTION_LEGACY,
          now: new Date(),
        }),
      ),
    );

    expect(await preparacoesDe(ordemId)).toHaveLength(1);

    /** O fluxo roda de novo, agora com o texto novo. Nao nasce a segunda. */
    await levarAtePreparacao(ordemId);

    const tarefas = await preparacoesDe(ordemId);
    expect(tarefas).toHaveLength(1);
    expect(tarefas.filter((t) => t.status === 'open')).toHaveLength(1);
    /**
     * A que ficou e a LEGADA — o fluxo respeitou a que ja existia em vez de
     * criar uma nova. Quem corrige a redacao de linhas antigas e a migration
     * 0013, nao o fluxo (ADR-075).
     */
    expect(tarefas[0]!.description).toBe(DELIVERY_PREPARATION_TASK_DESCRIPTION_LEGACY);
  });

  it('cinco criacoes simultaneas produzem uma tarefa so', async () => {
    /**
     * Sem preparar o terreno: a tarefa AINDA NAO EXISTE, entao as cinco
     * transacoes disputam de verdade quem a cria. Se o teste comecasse com a
     * tarefa ja criada, todas as cinco sairiam pelo `SELECT` inicial e a
     * corrida — que e o que importa — nunca aconteceria.
     */
    const [ordem] = await getDb()
      .select({ id: serviceOrders.id, unitId: serviceOrders.unitId })
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId))
      .limit(1);

    /**
     * Concorrencia de verdade, contra o MariaDB: cinco transacoes pedindo a
     * mesma tarefa ao mesmo tempo. Nenhuma pode vencer duas vezes. Quem perde
     * a corrida entre o SELECT e o INSERT esbarra na UNIQUE
     * `uq_so_task_open` — e a tabela continua com uma tarefa aberta.
     */
    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() =>
          runInTransaction((tx) =>
            createWorkflowTask(tx, tenantA.context, {
              order: ordem!,
              kind: TASK_KINDS.DELIVERY_PREPARATION,
              title: DELIVERY_PREPARATION_TASK_TITLE,
              description: DELIVERY_PREPARATION_TASK_DESCRIPTION,
              now: new Date(),
            }),
          ),
        ),
      ),
    );

    const criadas = resultados.flatMap((r) =>
      r.status === 'fulfilled' && r.value !== null ? [r.value] : [],
    );

    /** UMA vencedora. As outras quatro ou reencontraram, ou bateram na UNIQUE. */
    expect(criadas).toHaveLength(1);

    const todas = await preparacoesDe(ordemId);
    expect(todas).toHaveLength(1);
    expect(todas[0]!.id).toBe(criadas[0]);
    expect(todas[0]!.status).toBe('open');
    expect(todas[0]!.openMarker).toBe(1);
    expect(todas[0]!.description).toBe(DELIVERY_PREPARATION_TASK_DESCRIPTION);

    /** Nenhuma das cinco encostou no estado da OS. */
    const ordemDepois = await ordemDe(ordemId);
    expect(ordemDepois.status).toBe('awaiting_technical_opinion');
    expect(ordemDepois.version).toBe(1);
  });
});

describe('Buscar Peca continua sendo outra coisa', () => {
  it('a preparacao e a busca de peca coexistem, cada uma com seu texto', async () => {
    await run(() =>
      transitionServiceOrder(tenantA.context, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
    );
    await run(() =>
      transitionServiceOrder(tenantA.context, { serviceOrderId: ordemId, to: 'awaiting_part' }),
    );
    await run(() => requestPartPickup(tenantA.context, ordemId));

    const pecas = await getDb()
      .select()
      .from(serviceOrderTasks)
      .where(
        and(
          eq(serviceOrderTasks.serviceOrderId, ordemId),
          eq(serviceOrderTasks.kind, TASK_KINDS.PART_PICKUP),
        ),
      );

    expect(pecas).toHaveLength(1);
    expect(pecas[0]!.title).toBe(PART_PICKUP_TASK_TITLE);
    /** A correcao de texto da preparacao nao encostou na busca de peca. */
    expect(pecas[0]!.description).not.toBe(DELIVERY_PREPARATION_TASK_DESCRIPTION);
    expect(await preparacoesDe(ordemId)).toHaveLength(0);
  });
});

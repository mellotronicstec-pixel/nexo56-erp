import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { AuthorizationError, NotFoundError } from '@/core/errors';
import { can } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import {
  assignTechnician,
  cancelServiceOrder,
  completeTask,
  requestPartPickup,
  rescheduleFollowUp,
} from '@/modules/service-orders/application/service-order-actions';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import { serviceOrderTasks, serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  assignTenantRole,
  assignUnitRole,
  contextFor,
  createPlainUser,
  createRoleWithPermissions,
  createTenantFixture,
  createUnit,
  grantMembership,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * PERMISSOES DO WORKFLOW (Prompt 08, itens 50, 51, 71 a 76 e 115 a 116).
 *
 * O que estes testes travam:
 *
 *  1. Cada acao do workflow exige a SUA permissao. Ver a OS nao move a OS;
 *     mover a OS nao finaliza; finalizar nao cancela.
 *  2. A permissao vale na UNIDADE DA ORDEM, nao na unidade ativa da sessao.
 *     Quem opera duas lojas nao mexe no trabalho da loja B por estar com a
 *     loja A selecionada.
 *  3. Feature desligada bloqueia o workflow inteiro, nao so a listagem.
 */

let tenant: TenantFixture;
let ordemId: string;
let unidadeNorte: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

/** Usuario com um papel de unidade contendo exatamente as permissoes pedidas. */
async function usuarioCom(
  permissoes: readonly PermissionKey[],
  unitId: string,
  email: string,
): Promise<TenantContext> {
  const userId = await createPlainUser(tenant.tenantId, email, 'Pessoa de teste');
  await grantMembership(tenant.tenantId, userId, unitId);
  const roleId = await createRoleWithPermissions(tenant.tenantId, `papel-${email}`, permissoes);
  await assignUnitRole(tenant.tenantId, userId, roleId, unitId);
  return contextFor(tenant.tenantId, userId, unitId);
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
  tenant = await createTenantFixture('wf-autz', planId);
  unidadeNorte = await createUnit(tenant.tenantId, 'Norte');

  const customerId = (
    await run(() =>
      createCustomer(tenant.context, {
        kind: 'individual',
        name: 'Cliente da OS',
        contacts: [{ type: 'phone', value: '11988887777', isWhatsapp: false }],
      }),
    )
  ).customerId;

  const equipmentId = (
    await run(() => createEquipment(tenant.context, { customerId, kind: 'Televisor' }))
  ).equipmentId;

  ordemId = (
    await run(() =>
      createServiceOrder(tenant.context, { equipmentId, customerReport: 'Nao liga.' }),
    )
  ).serviceOrderId;
});

async function statusDe(id: string): Promise<string> {
  const [row] = await getDb()
    .select({ status: serviceOrders.status })
    .from(serviceOrders)
    .where(eq(serviceOrders.id, id))
    .limit(1);
  return row!.status;
}

describe('cada acao exige a sua permissao (itens 50, 51 e 115)', () => {
  it('quem so VE a OS nao consegue move-la', async () => {
    const contexto = await usuarioCom(
      [PERMISSIONS.SERVICE_ORDERS_VIEW],
      tenant.unitId,
      'so-ve@wf.invalid',
    );

    await expect(
      run(() =>
        transitionServiceOrder(contexto, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
      ),
    ).rejects.toThrow(AuthorizationError);

    expect(await statusDe(ordemId)).toBe('awaiting_technical_opinion');
  });

  it('quem move a OS NAO finaliza: finalizar tem permissao propria (item 51)', async () => {
    const contexto = await usuarioCom(
      [PERMISSIONS.SERVICE_ORDERS_VIEW, PERMISSIONS.SERVICE_ORDERS_TRANSITION],
      tenant.unitId,
      'move@wf.invalid',
    );

    // Consegue percorrer o fluxo…
    for (const destino of ['awaiting_repair', 'repair_completed'] as const) {
      await run(() => transitionServiceOrder(contexto, { serviceOrderId: ordemId, to: destino }));
    }
    expect(await statusDe(ordemId)).toBe('repair_completed');

    // …mas nao chega ao fim sem a permissao de finalizar.
    await run(() =>
      transitionServiceOrder(contexto, {
        serviceOrderId: ordemId,
        to: 'awaiting_delivery_preparation',
      }),
    );
    await run(() =>
      transitionServiceOrder(contexto, {
        serviceOrderId: ordemId,
        to: 'awaiting_customer_pickup',
        via: 'teste',
      }),
    );

    await expect(
      run(() => transitionServiceOrder(contexto, { serviceOrderId: ordemId, to: 'completed' })),
    ).rejects.toThrow(AuthorizationError);

    expect(await statusDe(ordemId)).toBe('awaiting_customer_pickup');
  });

  it('quem move a OS nao cancela: cancelar tem permissao propria (item 53)', async () => {
    const contexto = await usuarioCom(
      [PERMISSIONS.SERVICE_ORDERS_VIEW, PERMISSIONS.SERVICE_ORDERS_TRANSITION],
      tenant.unitId,
      'nao-cancela@wf.invalid',
    );

    await expect(
      run(() => cancelServiceOrder(contexto, ordemId, { reason: 'Sem motivo declarado.' })),
    ).rejects.toThrow(AuthorizationError);

    expect(await statusDe(ordemId)).toBe('awaiting_technical_opinion');
  });

  it('atribuir tecnico, acompanhar e cuidar de tarefas sao permissoes distintas', async () => {
    const contexto = await usuarioCom(
      [PERMISSIONS.SERVICE_ORDERS_VIEW, PERMISSIONS.SERVICE_ORDERS_TRANSITION],
      tenant.unitId,
      'so-transicao@wf.invalid',
    );

    await expect(
      run(() => assignTechnician(contexto, ordemId, tenant.adminUserId)),
    ).rejects.toThrow(AuthorizationError);

    await expect(
      run(() => rescheduleFollowUp(contexto, ordemId, { followUpAt: '2026-12-24' })),
    ).rejects.toThrow(AuthorizationError);

    await run(() =>
      transitionServiceOrder(contexto, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
    );
    await run(() =>
      transitionServiceOrder(contexto, { serviceOrderId: ordemId, to: 'awaiting_part' }),
    );

    await expect(
      run(() => requestPartPickup(contexto, ordemId, { note: 'Fonte 12V.' })),
    ).rejects.toThrow(AuthorizationError);
  });

  it('quem cuida de tarefas nao move a OS', async () => {
    const contexto = await usuarioCom(
      [PERMISSIONS.SERVICE_ORDERS_VIEW, PERMISSIONS.SERVICE_ORDERS_MANAGE_TASKS],
      tenant.unitId,
      'tarefas@wf.invalid',
    );

    await expect(
      run(() =>
        transitionServiceOrder(contexto, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
      ),
    ).rejects.toThrow(AuthorizationError);
  });
});

describe('a permissao vale na UNIDADE DA ORDEM (itens 72 e 116)', () => {
  it('papel concedido so na outra loja nao move a ordem desta loja', async () => {
    const userId = await createPlainUser(tenant.tenantId, 'duas-lojas@wf.invalid', 'Duas Lojas');
    await grantMembership(tenant.tenantId, userId, tenant.unitId);
    await grantMembership(tenant.tenantId, userId, unidadeNorte);

    // Pode transicionar — mas SO no Norte.
    const roleId = await createRoleWithPermissions(tenant.tenantId, 'papel-norte', [
      PERMISSIONS.SERVICE_ORDERS_VIEW,
      PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    ]);
    await assignUnitRole(tenant.tenantId, userId, roleId, unidadeNorte);

    /**
     * A sessao esta com o NORTE ativo, e a ordem e da unidade original. Se a
     * autorizacao olhasse a unidade ATIVA, esta transicao passaria — e seria
     * exatamente o furo que o Prompt 08 fecha.
     */
    const contexto = await contextFor(tenant.tenantId, userId, unidadeNorte);
    expect(contexto.activeUnitId).toBe(unidadeNorte);

    await expect(
      run(() =>
        transitionServiceOrder(contexto, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
      ),
    ).rejects.toThrow(AuthorizationError);

    expect(await statusDe(ordemId)).toBe('awaiting_technical_opinion');
  });

  it('papel de nivel TENANT vale em qualquer unidade que a pessoa acesse', async () => {
    const userId = await createPlainUser(tenant.tenantId, 'tenant-wide@wf.invalid', 'Tenant Wide');
    await grantMembership(tenant.tenantId, userId, tenant.unitId);
    await grantMembership(tenant.tenantId, userId, unidadeNorte);

    const roleId = await createRoleWithPermissions(tenant.tenantId, 'papel-tenant', [
      PERMISSIONS.SERVICE_ORDERS_VIEW,
      PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    ]);
    await assignTenantRole(tenant.tenantId, userId, roleId);

    const contexto = await contextFor(tenant.tenantId, userId, unidadeNorte);
    await run(() =>
      transitionServiceOrder(contexto, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
    );

    expect(await statusDe(ordemId)).toBe('awaiting_repair');
  });

  it('sem vinculo com a unidade, a ordem sequer e encontrada (item 65)', async () => {
    const userId = await createPlainUser(tenant.tenantId, 'sem-vinculo@wf.invalid', 'Sem Vinculo');
    await grantMembership(tenant.tenantId, userId, unidadeNorte);

    const roleId = await createRoleWithPermissions(tenant.tenantId, 'papel-amplo', [
      PERMISSIONS.SERVICE_ORDERS_VIEW,
      PERMISSIONS.SERVICE_ORDERS_TRANSITION,
      PERMISSIONS.SERVICE_ORDERS_CANCEL,
    ]);
    await assignTenantRole(tenant.tenantId, userId, roleId);

    const contexto = await contextFor(tenant.tenantId, userId, unidadeNorte);

    // "Nao encontrada", nunca "sem permissao": a segunda confirmaria que existe.
    await expect(
      run(() =>
        transitionServiceOrder(contexto, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('tarefa de outra unidade nao pode ser concluida (item 73)', async () => {
    await run(() =>
      transitionServiceOrder(tenant.context, { serviceOrderId: ordemId, to: 'awaiting_repair' }),
    );
    await run(() =>
      transitionServiceOrder(tenant.context, { serviceOrderId: ordemId, to: 'repair_completed' }),
    );
    await run(() =>
      transitionServiceOrder(tenant.context, {
        serviceOrderId: ordemId,
        to: 'awaiting_delivery_preparation',
      }),
    );

    const [tarefa] = await getDb()
      .select()
      .from(serviceOrderTasks)
      .where(eq(serviceOrderTasks.serviceOrderId, ordemId));

    const contexto = await usuarioCom(
      [PERMISSIONS.SERVICE_ORDERS_VIEW, PERMISSIONS.SERVICE_ORDERS_MANAGE_TASKS],
      unidadeNorte,
      'tarefa-norte@wf.invalid',
    );

    await expect(run(() => completeTask(contexto, tarefa!.id))).rejects.toThrow(NotFoundError);
  });
});

describe('Effective Access no workflow (item 74)', () => {
  it('Ordens de Servico e CORE: o tenant nao consegue desligar o workflow', async () => {
    // Desligar a feature deixaria ordens vivas sem caminho para andar.
    await expect(
      run(() =>
        setTenantFeature(tenant.context, {
          featureKey: FEATURES.CORE_SERVICE_ORDERS,
          enabled: false,
        }),
      ),
    ).rejects.toThrow();

    const decisao = await can(tenant.context, {
      permission: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
      featureKey: FEATURES.CORE_SERVICE_ORDERS,
      unitId: tenant.unitId,
    });
    expect(decisao.allowed).toBe(true);
  });

  it('a permissao NAO contorna uma feature indisponivel', async () => {
    const decisao = await can(tenant.context, {
      permission: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
      featureKey: 'core.inexistente',
      unitId: tenant.unitId,
    });
    expect(decisao.allowed).toBe(false);
    expect(decisao.reason).toBe('FEATURE_UNAVAILABLE');
  });
});

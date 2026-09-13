import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runWithContext } from '@/core/context/request-context';
import { AuthorizationError, NotFoundError } from '@/core/errors';
import { authorize, can } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import { checkAccess } from '@/modules/features/application/effective-access';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import {
  findServiceOrderDetail,
  listServiceOrders,
} from '@/modules/service-orders/application/service-order-queries';
import {
  createServiceOrder,
  updateServiceOrder,
} from '@/modules/service-orders/application/service-order-service';
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

/**
 * AUTORIZACAO E ISOLAMENTO DA ORDEM DE SERVICO (Prompt 07, itens 61 a 65 e
 * 124 a 125).
 *
 * A OS e a primeira entidade do sistema em que o isolamento por UNIDADE tem
 * consequencia operacional direta: quem opera a loja Norte nao pode ver, abrir
 * nem corrigir o trabalho da loja Centro — mesmo conhecendo o UUID.
 */

let tenant: TenantFixture;
let unidadeNorte: string;
let clienteId: string;
let equipamentoId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenant = await createTenantFixture('os-autz', planId);
  unidadeNorte = await createUnit(tenant.tenantId, 'Norte');

  clienteId = (
    await run(() =>
      createCustomer(tenant.context, {
        kind: 'individual',
        name: 'Cliente da OS',
        contacts: [{ type: 'phone', value: '11988887777', isWhatsapp: false }],
      }),
    )
  ).customerId;

  equipamentoId = (
    await run(() => createEquipment(tenant.context, { customerId: clienteId, kind: 'Televisor' }))
  ).equipmentId;
});

function ordem(overrides: Record<string, unknown> = {}) {
  return { equipmentId: equipamentoId, customerReport: 'Nao liga.', ...overrides };
}

// ---------------------------------------------------------------------------

describe('permissoes proprias (itens 61 e 62)', () => {
  it('SEM service_orders.create, nao abre', async () => {
    const papel = await createRoleWithPermissions(tenant.tenantId, 'so-leitor', [
      PERMISSIONS.SERVICE_ORDERS_VIEW,
    ]);
    const userId = await createPlainUser(tenant.tenantId, 'leitor@os.invalid');
    await grantMembership(tenant.tenantId, userId, tenant.unitId);
    await assignTenantRole(tenant.tenantId, userId, papel);
    const context = await contextFor(tenant.tenantId, userId);

    await expect(
      authorize(context, {
        permission: PERMISSIONS.SERVICE_ORDERS_CREATE,
        featureKey: FEATURES.CORE_SERVICE_ORDERS,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('abrir NAO implica corrigir', async () => {
    const papel = await createRoleWithPermissions(tenant.tenantId, 'so-atendente', [
      PERMISSIONS.SERVICE_ORDERS_VIEW,
      PERMISSIONS.SERVICE_ORDERS_CREATE,
    ]);
    const userId = await createPlainUser(tenant.tenantId, 'atendente@os.invalid');
    await grantMembership(tenant.tenantId, userId, tenant.unitId);
    await assignTenantRole(tenant.tenantId, userId, papel);
    const context = await contextFor(tenant.tenantId, userId);

    const criar = await can(context, {
      permission: PERMISSIONS.SERVICE_ORDERS_CREATE,
      featureKey: FEATURES.CORE_SERVICE_ORDERS,
    });
    const corrigir = await can(context, {
      permission: PERMISSIONS.SERVICE_ORDERS_UPDATE,
      featureKey: FEATURES.CORE_SERVICE_ORDERS,
    });

    expect(criar.allowed).toBe(true);
    expect(corrigir.allowed).toBe(false);
  });

  it('receber equipamento NAO implica abrir Ordem de Servico', async () => {
    const papel = await createRoleWithPermissions(tenant.tenantId, 'so-recepcao', [
      PERMISSIONS.EQUIPMENT_VIEW,
      PERMISSIONS.EQUIPMENT_INTAKE_CREATE,
    ]);
    const userId = await createPlainUser(tenant.tenantId, 'recepcao@os.invalid');
    await grantMembership(tenant.tenantId, userId, tenant.unitId);
    await assignTenantRole(tenant.tenantId, userId, papel);
    const context = await contextFor(tenant.tenantId, userId);

    const decisao = await can(context, {
      permission: PERMISSIONS.SERVICE_ORDERS_CREATE,
      featureKey: FEATURES.CORE_SERVICE_ORDERS,
    });
    expect(decisao.allowed).toBe(false);
  });

  it('o administrador do tenant tem as tres', async () => {
    for (const permission of [
      PERMISSIONS.SERVICE_ORDERS_VIEW,
      PERMISSIONS.SERVICE_ORDERS_CREATE,
      PERMISSIONS.SERVICE_ORDERS_UPDATE,
    ]) {
      const decisao = await can(tenant.context, {
        permission,
        featureKey: FEATURES.CORE_SERVICE_ORDERS,
      });
      expect(decisao.allowed).toBe(true);
    }
  });

  it('contexto nulo nega tudo', async () => {
    const decisao = await can(null, {
      permission: PERMISSIONS.SERVICE_ORDERS_VIEW,
      featureKey: FEATURES.CORE_SERVICE_ORDERS,
    });
    expect(decisao.allowed).toBe(false);
    expect(decisao.reason).toBe('NOT_AUTHENTICATED');
  });
});

// ---------------------------------------------------------------------------

describe('Effective Access (itens 66, 67, 70 e 71)', () => {
  it('Ordens de Servico e CORE — permanece disponivel', async () => {
    const decisao = await checkAccess(tenant.context, {
      featureKey: FEATURES.CORE_SERVICE_ORDERS,
      permission: PERMISSIONS.SERVICE_ORDERS_VIEW,
    });
    expect(decisao.allowed).toBe(true);
  });

  it('CORE nao pode ser desativada pelo tenant (item 70)', async () => {
    await expect(
      run(() =>
        setTenantFeature(tenant.context, {
          featureKey: FEATURES.CORE_SERVICE_ORDERS,
          enabled: false,
        }),
      ),
    ).rejects.toThrow();

    // E o dado continua la, acessivel.
    const criada = await run(() => createServiceOrder(tenant.context, ordem()));
    expect(await findServiceOrderDetail(tenant.context, criada.serviceOrderId)).not.toBeNull();
  });

  it('permissao nao contorna feature indisponivel', async () => {
    const decisao = await can(tenant.context, {
      permission: PERMISSIONS.SERVICE_ORDERS_VIEW,
      featureKey: 'core.inexistente',
    });
    expect(decisao.allowed).toBe(false);
    expect(decisao.reason).toBe('FEATURE_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------

describe('isolamento por UNIDADE (itens 63, 64 e 125)', () => {
  /** Abre uma OS na unidade principal e devolve o id. */
  async function ordemNaUnidadePrincipal(): Promise<string> {
    return (await run(() => createServiceOrder(tenant.context, ordem()))).serviceOrderId;
  }

  it('a listagem muda quando a unidade ativa muda', async () => {
    await ordemNaUnidadePrincipal();

    await grantMembership(tenant.tenantId, tenant.adminUserId, unidadeNorte);
    const naNorte = await contextFor(tenant.tenantId, tenant.adminUserId, unidadeNorte);

    expect((await listServiceOrders(tenant.context, {})).total).toBe(1);
    expect((await listServiceOrders(naNorte, {})).total).toBe(0);
  });

  it('a OS mantem a unidade historica quando a pessoa troca de unidade', async () => {
    const id = await ordemNaUnidadePrincipal();

    await grantMembership(tenant.tenantId, tenant.adminUserId, unidadeNorte);
    const naNorte = await contextFor(tenant.tenantId, tenant.adminUserId, unidadeNorte);

    // O admin acessa as duas unidades, entao continua enxergando a ficha —
    // mas a unidade gravada na ordem NAO mudou.
    const detail = await findServiceOrderDetail(naNorte, id);
    expect(detail!.order.unitId).toBe(tenant.unitId);
  });

  it('quem so opera a Norte NAO acessa a ordem da unidade principal, nem com o UUID', async () => {
    const id = await ordemNaUnidadePrincipal();

    const papel = await createRoleWithPermissions(tenant.tenantId, 'so-norte', [
      PERMISSIONS.SERVICE_ORDERS_VIEW,
      PERMISSIONS.SERVICE_ORDERS_UPDATE,
    ]);
    const userId = await createPlainUser(tenant.tenantId, 'norte@os.invalid');
    await grantMembership(tenant.tenantId, userId, unidadeNorte);
    await assignUnitRole(tenant.tenantId, userId, papel, unidadeNorte);
    const soNorte = await contextFor(tenant.tenantId, userId, unidadeNorte);

    // Nao aparece na listagem...
    expect((await listServiceOrders(soNorte, {})).total).toBe(0);
    // ...nem pela ficha, com o ID em maos (item 63).
    expect(await findServiceOrderDetail(soNorte, id)).toBeNull();
    // ...nem para corrigir.
    await expect(
      run(() => updateServiceOrder(soNorte, id, { customerReport: 'Invadido.' })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('papel de UNIDADE nao vale na outra unidade (item 64)', async () => {
    const papel = await createRoleWithPermissions(tenant.tenantId, 'so-unit-norte', [
      PERMISSIONS.SERVICE_ORDERS_CREATE,
    ]);
    const userId = await createPlainUser(tenant.tenantId, 'unitrole@os.invalid');
    await grantMembership(tenant.tenantId, userId, unidadeNorte);
    await grantMembership(tenant.tenantId, userId, tenant.unitId);
    await assignUnitRole(tenant.tenantId, userId, papel, unidadeNorte);

    const naNorte = await contextFor(tenant.tenantId, userId, unidadeNorte);
    const naPrincipal = await contextFor(tenant.tenantId, userId, tenant.unitId);

    // O caminho real das Server Actions de OS: a permissao e avaliada DENTRO
    // da unidade ativa (`requireUnitAuthorization`), e nao no escopo tenant.
    expect(
      (
        await can(naNorte, {
          permission: PERMISSIONS.SERVICE_ORDERS_CREATE,
          featureKey: FEATURES.CORE_SERVICE_ORDERS,
          unitId: naNorte.activeUnitId,
        })
      ).allowed,
    ).toBe(true);

    expect(
      (
        await can(naPrincipal, {
          permission: PERMISSIONS.SERVICE_ORDERS_CREATE,
          featureKey: FEATURES.CORE_SERVICE_ORDERS,
          unitId: naPrincipal.activeUnitId,
        })
      ).allowed,
    ).toBe(false);

    // E sem informar a unidade valem so os papeis TENANT — este usuario nao tem.
    expect(
      (
        await can(naNorte, {
          permission: PERMISSIONS.SERVICE_ORDERS_CREATE,
          featureKey: FEATURES.CORE_SERVICE_ORDERS,
        })
      ).allowed,
    ).toBe(false);
  });

  it('papel TENANT vale nas unidades que a pessoa acessa, e so nelas', async () => {
    const papel = await createRoleWithPermissions(tenant.tenantId, 'so-tenant-role', [
      PERMISSIONS.SERVICE_ORDERS_VIEW,
    ]);
    const userId = await createPlainUser(tenant.tenantId, 'tenantrole@os.invalid');
    await grantMembership(tenant.tenantId, userId, tenant.unitId);
    await assignTenantRole(tenant.tenantId, userId, papel);
    const context = await contextFor(tenant.tenantId, userId);

    // Vinculado so a unidade principal: a Norte nao entra no contexto.
    expect(context.authorizedUnitIds).toEqual([tenant.unitId]);

    const decisaoNorte = await can(context, {
      permission: PERMISSIONS.SERVICE_ORDERS_VIEW,
      featureKey: FEATURES.CORE_SERVICE_ORDERS,
      unitId: unidadeNorte,
    });
    expect(decisaoNorte.allowed).toBe(false);
    expect(decisaoNorte.reason).toBe('UNIT_NOT_AUTHORIZED');
  });

  it('a ordem so e acessivel por quem opera a unidade dela', async () => {
    const id = await ordemNaUnidadePrincipal();
    const decisao = await can(tenant.context, {
      permission: PERMISSIONS.SERVICE_ORDERS_VIEW,
      featureKey: FEATURES.CORE_SERVICE_ORDERS,
      resource: { tenantId: tenant.tenantId, unitId: tenant.unitId },
    });
    expect(decisao.allowed).toBe(true);
    expect(id).toBeTruthy();
  });
});

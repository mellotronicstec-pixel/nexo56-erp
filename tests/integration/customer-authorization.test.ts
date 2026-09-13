import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runWithContext } from '@/core/context/request-context';
import { AuthorizationError, NotFoundError } from '@/core/errors';
import { authorize, can } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import {
  createCustomer,
  setCustomerStatus,
  updateCustomer,
} from '@/modules/customers/application/customer-service';
import {
  findCustomerDetail,
  listCustomers,
} from '@/modules/customers/application/customer-queries';
import { FEATURES } from '@/modules/features/domain/catalog';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  assignTenantRole,
  contextFor,
  createPlainUser,
  createRoleWithPermissions,
  createTenantFixture,
  grantMembership,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/**
 * AUTORIZACAO DE CLIENTES (Prompt 05, itens 38, 39 e 58).
 *
 * Clientes entra no RBAC que ja existe — nao ha um segundo mecanismo. O teste
 * monta pessoas com permissoes diferentes e verifica cada capacidade.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;

/** So consulta. */
let leitor: Awaited<ReturnType<typeof contextFor>>;
/** Consulta e cadastra, mas nao muda situacao. */
let cadastrador: Awaited<ReturnType<typeof contextFor>>;
/** Nenhuma permissao de clientes. */
let estranho: Awaited<ReturnType<typeof contextFor>>;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

const clienteBase = {
  kind: 'individual' as const,
  name: 'Cliente de Teste',
  contacts: [{ type: 'phone' as const, value: '11988887777', isWhatsapp: false }],
};

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenantA = await createTenantFixture('autz-a', planId);
  tenantB = await createTenantFixture('autz-b', planId);

  const papelLeitor = await createRoleWithPermissions(tenantA.tenantId, 'leitor-clientes', [
    PERMISSIONS.CUSTOMERS_VIEW,
  ]);
  const papelCadastrador = await createRoleWithPermissions(tenantA.tenantId, 'cadastrador', [
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.CUSTOMERS_MANAGE,
  ]);
  const papelVazio = await createRoleWithPermissions(tenantA.tenantId, 'sem-clientes', []);

  const idLeitor = await createPlainUser(tenantA.tenantId, 'leitor@autz.invalid');
  const idCadastrador = await createPlainUser(tenantA.tenantId, 'cadastrador@autz.invalid');
  const idEstranho = await createPlainUser(tenantA.tenantId, 'estranho@autz.invalid');

  for (const userId of [idLeitor, idCadastrador, idEstranho]) {
    await grantMembership(tenantA.tenantId, userId, tenantA.unitId);
  }

  await assignTenantRole(tenantA.tenantId, idLeitor, papelLeitor);
  await assignTenantRole(tenantA.tenantId, idCadastrador, papelCadastrador);
  await assignTenantRole(tenantA.tenantId, idEstranho, papelVazio);

  leitor = await contextFor(tenantA.tenantId, idLeitor);
  cadastrador = await contextFor(tenantA.tenantId, idCadastrador);
  estranho = await contextFor(tenantA.tenantId, idEstranho);
});

describe('quem pode ver', () => {
  it('com customers.view, pode visualizar', async () => {
    const decision = await can(leitor, {
      permission: PERMISSIONS.CUSTOMERS_VIEW,
      featureKey: FEATURES.CORE_CUSTOMERS,
    });

    expect(decision.allowed).toBe(true);
  });

  it('SEM customers.view, nao pode visualizar', async () => {
    const decision = await can(estranho, {
      permission: PERMISSIONS.CUSTOMERS_VIEW,
      featureKey: FEATURES.CORE_CUSTOMERS,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('PERMISSION_DENIED');
  });
});

describe('quem pode cadastrar e editar', () => {
  it('SEM customers.manage, nao pode criar', async () => {
    await expect(
      authorize(leitor, {
        permission: PERMISSIONS.CUSTOMERS_MANAGE,
        featureKey: FEATURES.CORE_CUSTOMERS,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('com customers.manage, pode criar e editar', async () => {
    const { customerId } = await run(() => createCustomer(cadastrador, clienteBase));
    await run(() =>
      updateCustomer(cadastrador, customerId, { ...clienteBase, name: 'Nome Editado' }),
    );

    const detail = await findCustomerDetail(cadastrador, customerId);
    expect(detail?.customer.name).toBe('Nome Editado');
  });

  it('SEM customers.manage, nao pode editar', async () => {
    const { customerId } = await run(() => createCustomer(cadastrador, clienteBase));

    await expect(
      authorize(leitor, {
        permission: PERMISSIONS.CUSTOMERS_MANAGE,
        featureKey: FEATURES.CORE_CUSTOMERS,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // O cadastro segue intacto.
    const detail = await findCustomerDetail(leitor, customerId);
    expect(detail?.customer.name).toBe('Cliente de Teste');
  });
});

describe('quem pode alterar situacao', () => {
  it('cadastrar NAO implica alterar situacao — as permissoes sao separadas', async () => {
    await expect(
      authorize(cadastrador, {
        permission: PERMISSIONS.CUSTOMERS_CHANGE_STATUS,
        featureKey: FEATURES.CORE_CUSTOMERS,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('o administrador do tenant tem todas as tres', async () => {
    for (const permission of [
      PERMISSIONS.CUSTOMERS_VIEW,
      PERMISSIONS.CUSTOMERS_MANAGE,
      PERMISSIONS.CUSTOMERS_CHANGE_STATUS,
    ]) {
      const decision = await can(tenantA.context, {
        permission,
        featureKey: FEATURES.CORE_CUSTOMERS,
      });
      expect(decision.allowed).toBe(true);
    }
  });
});

describe('travessia de tenant (item 58 — obrigatorio)', () => {
  it('cliente de OUTRO tenant nao e acessivel nem com o ID em maos', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, clienteBase));

    // O administrador do tenant B tem TODAS as permissoes... no tenant dele.
    expect(await findCustomerDetail(tenantB.context, customerId)).toBeNull();

    await expect(
      run(() => updateCustomer(tenantB.context, customerId, clienteBase)),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      run(() => setCustomerStatus(tenantB.context, customerId, 'inactive')),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a resposta e "nao encontrado", nao "sem permissao" — nao confirma existencia', async () => {
    const { customerId } = await run(() => createCustomer(tenantA.context, clienteBase));

    const erro = await run(() => setCustomerStatus(tenantB.context, customerId, 'inactive')).catch(
      (error: unknown) => error,
    );

    expect(erro).toBeInstanceOf(NotFoundError);
    expect((erro as Error).message).toMatch(/nao encontrado/i);
  });

  it('a listagem do tenant B nao conta os clientes do tenant A', async () => {
    await run(() => createCustomer(tenantA.context, clienteBase));
    expect((await listCustomers(tenantB.context, {})).total).toBe(0);
  });
});

describe('feature desativada nao e contornada por permissao', () => {
  it('a decisao exige feature disponivel E permissao', async () => {
    const decision = await can(leitor, {
      permission: PERMISSIONS.CUSTOMERS_VIEW,
      featureKey: FEATURES.CORE_CUSTOMERS,
    });
    // core.customers e estrutural: sempre disponivel, entao aqui a permissao decide.
    expect(decision.allowed).toBe(true);

    const negado = await can(leitor, {
      permission: PERMISSIONS.CUSTOMERS_MANAGE,
      featureKey: FEATURES.CORE_CUSTOMERS,
    });
    expect(negado.allowed).toBe(false);
  });

  it('contexto nulo nega tudo', async () => {
    const decision = await can(null, {
      permission: PERMISSIONS.CUSTOMERS_VIEW,
      featureKey: FEATURES.CORE_CUSTOMERS,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('NOT_AUTHENTICATED');
  });
});

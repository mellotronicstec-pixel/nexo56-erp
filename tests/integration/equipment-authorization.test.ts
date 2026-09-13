import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runWithContext } from '@/core/context/request-context';
import { AuthorizationError } from '@/core/errors';
import { authorize, can } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
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
 * AUTORIZACAO DE EQUIPAMENTOS (Prompt 06, itens 66, 72 e 106).
 *
 * Clientes, Equipamentos e Recebimento usam o MESMO RBAC — nao ha segundo
 * mecanismo. O teste monta pessoas com permissoes diferentes e confere cada
 * capacidade separadamente, porque elas sao mesmo separadas.
 */

let tenant: TenantFixture;
let leitor: Awaited<ReturnType<typeof contextFor>>;
let cadastrador: Awaited<ReturnType<typeof contextFor>>;
let recepcionista: Awaited<ReturnType<typeof contextFor>>;

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
  tenant = await createTenantFixture('equip-autz', planId);

  const papelLeitor = await createRoleWithPermissions(tenant.tenantId, 'leitor-equip', [
    PERMISSIONS.EQUIPMENT_VIEW,
  ]);
  const papelCadastrador = await createRoleWithPermissions(tenant.tenantId, 'cadastrador-equip', [
    PERMISSIONS.EQUIPMENT_VIEW,
    PERMISSIONS.EQUIPMENT_MANAGE,
  ]);
  const papelRecepcao = await createRoleWithPermissions(tenant.tenantId, 'recepcao', [
    PERMISSIONS.EQUIPMENT_VIEW,
    PERMISSIONS.EQUIPMENT_INTAKE_VIEW,
    PERMISSIONS.EQUIPMENT_INTAKE_CREATE,
  ]);

  const ids = await Promise.all([
    createPlainUser(tenant.tenantId, 'leitor@equip.invalid'),
    createPlainUser(tenant.tenantId, 'cadastrador@equip.invalid'),
    createPlainUser(tenant.tenantId, 'recepcao@equip.invalid'),
  ]);

  for (const userId of ids) await grantMembership(tenant.tenantId, userId, tenant.unitId);

  await assignTenantRole(tenant.tenantId, ids[0]!, papelLeitor);
  await assignTenantRole(tenant.tenantId, ids[1]!, papelCadastrador);
  await assignTenantRole(tenant.tenantId, ids[2]!, papelRecepcao);

  leitor = await contextFor(tenant.tenantId, ids[0]!);
  cadastrador = await contextFor(tenant.tenantId, ids[1]!);
  recepcionista = await contextFor(tenant.tenantId, ids[2]!);
});

describe('equipamentos', () => {
  it('com equipment.view, visualiza', async () => {
    const decision = await can(leitor, {
      permission: PERMISSIONS.EQUIPMENT_VIEW,
      featureKey: FEATURES.CORE_EQUIPMENT,
    });
    expect(decision.allowed).toBe(true);
  });

  it('SEM equipment.manage, nao cadastra', async () => {
    await expect(
      authorize(leitor, {
        permission: PERMISSIONS.EQUIPMENT_MANAGE,
        featureKey: FEATURES.CORE_EQUIPMENT,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('com equipment.manage, cadastra de verdade', async () => {
    const { customerId } = await run(() =>
      createCustomer(cadastrador, {
        kind: 'individual',
        name: 'Cliente do Cadastrador',
        contacts: [{ type: 'phone', value: '11988887777', isWhatsapp: false }],
      }),
    );

    const created = await run(() =>
      createEquipment(cadastrador, { customerId, kind: 'TV', voltage: 'unknown' }),
    );
    expect(created.equipmentId).toBeTruthy();
  });
});

describe('recebimento tem permissoes PROPRIAS (item 66)', () => {
  it('cadastrar equipamento NAO implica poder receber', async () => {
    await expect(
      authorize(cadastrador, {
        permission: PERMISSIONS.EQUIPMENT_INTAKE_CREATE,
        featureKey: FEATURES.CORE_EQUIPMENT_INTAKE,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('receber NAO implica poder editar o cadastro', async () => {
    await expect(
      authorize(recepcionista, {
        permission: PERMISSIONS.EQUIPMENT_MANAGE,
        featureKey: FEATURES.CORE_EQUIPMENT,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('receber NAO implica poder gerenciar fotos', async () => {
    await expect(
      authorize(recepcionista, {
        permission: PERMISSIONS.EQUIPMENT_INTAKE_MANAGE_MEDIA,
        featureKey: FEATURES.CORE_EQUIPMENT_INTAKE,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('o administrador do tenant tem todas as cinco', async () => {
    for (const permission of [
      PERMISSIONS.EQUIPMENT_VIEW,
      PERMISSIONS.EQUIPMENT_MANAGE,
      PERMISSIONS.EQUIPMENT_INTAKE_VIEW,
      PERMISSIONS.EQUIPMENT_INTAKE_CREATE,
      PERMISSIONS.EQUIPMENT_INTAKE_MANAGE_MEDIA,
    ]) {
      const decision = await can(tenant.context, {
        permission,
        featureKey: FEATURES.CORE_EQUIPMENT,
      });
      expect(decision.allowed, permission).toBe(true);
    }
  });
});

describe('Effective Access (itens 72 a 74)', () => {
  it('permissao NAO contorna feature indisponivel', async () => {
    /**
     * `platform.label_recognition` e OPTIONAL: a empresa pode desliga-la. Com
     * ela desativada, nem o administrador — que tem todas as permissoes —
     * passa. A permissao responde "o que a pessoa pode"; a feature responde
     * "o que a empresa tem".
     */
    await run(() =>
      setTenantFeature(tenant.context, {
        featureKey: FEATURES.PLATFORM_LABEL_RECOGNITION,
        enabled: false,
      }),
    );

    const decision = await can(tenant.context, {
      permission: PERMISSIONS.EQUIPMENT_VIEW,
      featureKey: FEATURES.PLATFORM_LABEL_RECOGNITION,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('FEATURE_UNAVAILABLE');
  });

  it('Equipamentos continua disponivel — e CORE, nao desativavel', async () => {
    const decision = await can(tenant.context, {
      permission: PERMISSIONS.EQUIPMENT_VIEW,
      featureKey: FEATURES.CORE_EQUIPMENT,
    });
    expect(decision.allowed).toBe(true);
  });

  it('contexto nulo nega tudo', async () => {
    const decision = await can(null, {
      permission: PERMISSIONS.EQUIPMENT_VIEW,
      featureKey: FEATURES.CORE_EQUIPMENT,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('NOT_AUTHENTICATED');
  });
});

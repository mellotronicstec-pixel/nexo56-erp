import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runWithContext } from '@/core/context/request-context';
import {
  AuthorizationError,
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from '@/core/errors';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import {
  archiveRule,
  createRule,
  getRule,
  listRules,
  setRuleEnabled,
  updateRuleDefinition,
} from '@/modules/automations/application/rule-service';
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
 * REGRA (CRUD + VERSIONAMENTO + AUTORIZACAO) CONTRA MariaDB REAL (Prompt 19).
 *
 * "Editar regra nao reescreve o passado." "Desabilitar nao apaga historico."
 * "Nasce sempre desabilitada."
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

async function ligarAutomacao(fixture: TenantFixture): Promise<void> {
  await run(() =>
    setTenantFeature(fixture.context, { featureKey: FEATURES.AUTOMATION_CORE, enabled: true }),
  );
  await run(() =>
    setTenantFeature(fixture.context, { featureKey: FEATURES.OPERATIONS_AGENDA, enabled: true }),
  );
}

const notificationDefinition = (title = 'Ligar para o cliente') => ({
  schemaVersion: 1,
  triggerKey: 'service_order.customer_notification_requested',
  conditions: { all: [] },
  actions: [{ key: 'agenda.create_task', config: { title } }],
});

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenantA = await createTenantFixture('auto-a', planId);
  tenantB = await createTenantFixture('auto-b', planId);
  await ligarAutomacao(tenantA);
  await ligarAutomacao(tenantB);
});

describe('criacao', () => {
  it('nasce sempre desabilitada, mesmo pedindo habilitada (item 103)', async () => {
    const { ruleId } = await run(() =>
      createRule(tenantA.context, {
        name: 'Avisar cliente',
        scopeKind: 'UNIT_SET',
        unitIds: [tenantA.unitId],
        definition: notificationDefinition(),
      }),
    );
    const rule = await run(() => getRule(tenantA.context, ruleId));
    expect(rule.enabled).toBe(false);
  });

  it('rejeita definicao invalida com o erro do RuleValidator', async () => {
    await expect(
      run(() =>
        createRule(tenantA.context, {
          name: 'Regra invalida',
          scopeKind: 'UNIT_SET',
          unitIds: [tenantA.unitId],
          definition: {
            schemaVersion: 1,
            triggerKey: 'gatilho.inventado',
            conditions: { all: [] },
            actions: [],
          },
        }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('exige automations.manage (item 169)', async () => {
    const userId = await createPlainUser(tenantA.tenantId, 'sem-manage@auto-a.invalid');
    await grantMembership(tenantA.tenantId, userId, tenantA.unitId);
    const roleId = await createRoleWithPermissions(tenantA.tenantId, 'so-view', [
      PERMISSIONS.AUTOMATIONS_VIEW,
    ]);
    await assignTenantRole(tenantA.tenantId, userId, roleId);
    const contexto = await contextFor(tenantA.tenantId, userId, tenantA.unitId);

    await expect(
      run(() =>
        createRule(contexto, {
          name: 'Tentativa sem permissao',
          scopeKind: 'UNIT_SET',
          unitIds: [tenantA.unitId],
          definition: notificationDefinition(),
        }),
      ),
    ).rejects.toThrow(AuthorizationError);
  });

  it('acao especifica exige a permissao do modulo alvo no escopo (item 170)', async () => {
    const userId = await createPlainUser(tenantA.tenantId, 'sem-agenda@auto-a.invalid');
    await grantMembership(tenantA.tenantId, userId, tenantA.unitId);
    const roleId = await createRoleWithPermissions(tenantA.tenantId, 'so-automations', [
      PERMISSIONS.AUTOMATIONS_MANAGE,
    ]);
    await assignTenantRole(tenantA.tenantId, userId, roleId);
    const contexto = await contextFor(tenantA.tenantId, userId, tenantA.unitId);

    await expect(
      run(() =>
        createRule(contexto, {
          name: 'Regra com acao proibida para o autor',
          scopeKind: 'UNIT_SET',
          unitIds: [tenantA.unitId],
          definition: notificationDefinition(),
        }),
      ),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('usuario nao pode escolher unidade que nao autoriza (item 57)', async () => {
    const outraUnidade = await createUnit(tenantA.tenantId, 'Outra unidade');
    await expect(
      run(() =>
        createRule(tenantA.context, {
          name: 'Regra fora de escopo',
          scopeKind: 'UNIT_SET',
          unitIds: [outraUnidade],
          definition: notificationDefinition(),
        }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('TENANT_WIDE exige automations.manage no escopo TENANT (item 60)', async () => {
    const userId = await createPlainUser(tenantA.tenantId, 'unit-scope@auto-a.invalid');
    await grantMembership(tenantA.tenantId, userId, tenantA.unitId);
    const roleId = await createRoleWithPermissions(tenantA.tenantId, 'unit-automations', [
      PERMISSIONS.AUTOMATIONS_MANAGE,
      PERMISSIONS.AGENDA_TASKS_CREATE,
    ]);
    await assignUnitRole(tenantA.tenantId, userId, roleId, tenantA.unitId);
    const contexto = await contextFor(tenantA.tenantId, userId, tenantA.unitId);

    await expect(
      run(() =>
        createRule(contexto, {
          name: 'Regra tenant-wide sem autoridade',
          scopeKind: 'TENANT_WIDE',
          definition: notificationDefinition(),
        }),
      ),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('regra agendada exige unidades especificas, nunca TENANT_WIDE (item 115)', async () => {
    await expect(
      run(() =>
        createRule(tenantA.context, {
          name: 'Agendada tenant-wide',
          scopeKind: 'TENANT_WIDE',
          definition: {
            schemaVersion: 1,
            triggerKey: 'schedule.daily',
            triggerConfig: { timeOfDay: '09:00' },
            conditions: { all: [] },
            actions: [{ key: 'agenda.create_task', config: { title: 'Conferir estoque' } }],
          },
        }),
      ),
    ).rejects.toThrow(BusinessRuleError);
  });
});

describe('versionamento (itens 49 a 51, 105, 163 e 182)', () => {
  it('editar cria nova versao; a versao antiga fica intacta', async () => {
    const { ruleId } = await run(() =>
      createRule(tenantA.context, {
        name: 'Regra versionada',
        scopeKind: 'UNIT_SET',
        unitIds: [tenantA.unitId],
        definition: notificationDefinition('Titulo v1'),
      }),
    );

    const { versionNumber } = await run(() =>
      updateRuleDefinition(tenantA.context, ruleId, notificationDefinition('Titulo v2')),
    );
    expect(versionNumber).toBe(2);

    const rule = await run(() => getRule(tenantA.context, ruleId));
    expect(rule.currentVersionNumber).toBe(2);
    expect(rule.definition?.actions[0]?.config).toMatchObject({ title: 'Titulo v2' });
  });
});

describe('habilitar / desabilitar / arquivar (itens 53, 55, 129 e 165)', () => {
  it('desabilitar preserva a regra; habilitar exige versao publicada', async () => {
    const { ruleId } = await run(() =>
      createRule(tenantA.context, {
        name: 'Regra para habilitar',
        scopeKind: 'UNIT_SET',
        unitIds: [tenantA.unitId],
        definition: notificationDefinition(),
      }),
    );
    await run(() => setRuleEnabled(tenantA.context, ruleId, true));
    let rule = await run(() => getRule(tenantA.context, ruleId));
    expect(rule.enabled).toBe(true);

    await run(() => setRuleEnabled(tenantA.context, ruleId, false));
    rule = await run(() => getRule(tenantA.context, ruleId));
    expect(rule.enabled).toBe(false);
    expect(rule.definition).not.toBeNull();
  });

  it('arquivar desabilita e impede nova habilitacao; preserva historico', async () => {
    const { ruleId } = await run(() =>
      createRule(tenantA.context, {
        name: 'Regra para arquivar',
        scopeKind: 'UNIT_SET',
        unitIds: [tenantA.unitId],
        definition: notificationDefinition(),
      }),
    );
    await run(() => setRuleEnabled(tenantA.context, ruleId, true));
    await run(() => archiveRule(tenantA.context, ruleId));

    const rule = await run(() => getRule(tenantA.context, ruleId));
    expect(rule.archived).toBe(true);
    expect(rule.enabled).toBe(false);
    expect(rule.name).toBe('Regra para arquivar');

    await expect(run(() => setRuleEnabled(tenantA.context, ruleId, true))).rejects.toThrow(
      BusinessRuleError,
    );
  });
});

describe('isolamento de tenant (item 62 e 166)', () => {
  it('regra de um tenant nunca aparece para outro', async () => {
    const { ruleId } = await run(() =>
      createRule(tenantA.context, {
        name: 'Regra do tenant A',
        scopeKind: 'UNIT_SET',
        unitIds: [tenantA.unitId],
        definition: notificationDefinition(),
      }),
    );

    await expect(run(() => getRule(tenantB.context, ruleId))).rejects.toThrow(NotFoundError);

    const rulesB = await run(() => listRules(tenantB.context));
    expect(rulesB.find((r) => r.id === ruleId)).toBeUndefined();
  });
});

describe('"todas as unidades" persistido, nunca expandido depois (item 168)', () => {
  it('unidade nova nao entra automaticamente no escopo de uma regra existente', async () => {
    const { ruleId } = await run(() =>
      createRule(tenantA.context, {
        name: 'Regra com escopo fixo',
        scopeKind: 'UNIT_SET',
        unitIds: [tenantA.unitId],
        definition: notificationDefinition(),
      }),
    );

    const novaUnidade = await createUnit(tenantA.tenantId, 'Unidade Nova');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, novaUnidade);

    const rule = await run(() => getRule(tenantA.context, ruleId));
    expect(rule.unitIds).toEqual([tenantA.unitId]);
    expect(rule.unitIds).not.toContain(novaUnidade);
  });
});

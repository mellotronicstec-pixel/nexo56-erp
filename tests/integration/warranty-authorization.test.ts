import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { AuthorizationError, NotFoundError } from '@/core/errors';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { transitionServiceOrder } from '@/modules/service-orders/application/workflow-service';
import type { ServiceOrderStatus } from '@/modules/service-orders/domain/workflow';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { issueWarranty, revokeWarranty } from '@/modules/warranties/application/warranty-service';
import { createWarrantyPolicy } from '@/modules/warranties/application/warranty-policy-service';
import {
  listWarrantyCosts,
  recordWarrantyCost,
} from '@/modules/warranties/application/warranty-cost-service';
import {
  reclassifyWarrantyServiceOrder,
  registerWarrantyReturn,
} from '@/modules/warranties/application/warranty-return-service';
import { listWarranties } from '@/modules/warranties/application/warranty-queries';
import { warrantyReturns } from '@/modules/warranties/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  assignTenantRole,
  assignUnitRole,
  clearTenantRoles,
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
 * AUTORIZACAO DE GARANTIAS (Prompt 13, itens 68 a 70, 77, 107 e 108).
 *
 * Estes testes chamam os CASOS DE USO diretamente, sem passar por tela nenhuma.
 * Esconder um botao e cortesia; a recusa de verdade acontece aqui — e e aqui
 * que ela precisa ser provada.
 *
 * O eixo: a autoridade tecnica para reclassificar e uma PERMISSAO, nunca o
 * nome do cargo (item 69); custo e cobertura tem autorizacoes separadas (item
 * 70); e nada disso atravessa empresa nem unidade.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let clienteId: string;
let equipamentoId: string;
let unidadeNorte: string;

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
  tenantA = await createTenantFixture('gar-auth-a', planId);
  tenantB = await createTenantFixture('gar-auth-b', planId);

  for (const t of [tenantA, tenantB]) {
    await run(() =>
      setTenantFeature(t.context, { featureKey: FEATURES.OPERATIONS_WARRANTIES, enabled: true }),
    );
  }
  tenantA.context = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);
  tenantB.context = await contextFor(tenantB.tenantId, tenantB.adminUserId, tenantB.unitId);

  unidadeNorte = await createUnit(tenantA.tenantId, 'Unidade Norte');

  clienteId = (
    await run(() =>
      createCustomer(tenantA.context, {
        kind: 'individual',
        name: 'Cliente Autorizacao',
        contacts: [{ type: 'phone', value: '11944443333', isWhatsapp: false }],
      }),
    )
  ).customerId;

  equipamentoId = (
    await run(() =>
      createEquipment(tenantA.context, {
        customerId: clienteId,
        kind: 'Receiver',
        voltage: 'bivolt',
      }),
    )
  ).equipmentId;
});

async function osFinalizada(context = tenantA.context): Promise<string> {
  const criada = await run(() =>
    createServiceOrder(context, { equipmentId: equipamentoId, customerReport: 'Nao liga.' }),
  );

  const caminho: Array<[ServiceOrderStatus, string | undefined]> = [
    ['awaiting_repair', undefined],
    ['repair_completed', undefined],
    ['awaiting_delivery_preparation', undefined],
    ['awaiting_customer_pickup', 'delivery_ready'],
    ['completed', undefined],
  ];
  for (const [to, via] of caminho) {
    await run(() =>
      transitionServiceOrder(context, {
        serviceOrderId: criada.serviceOrderId,
        to,
        ...(via ? { via } : {}),
      }),
    );
  }
  return criada.serviceOrderId;
}

function emissao(osId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'internal',
    equipmentId: equipamentoId,
    serviceOrderId: osId,
    durationAmount: 90,
    durationUnit: 'days',
    coversWholeService: true,
    coverageItems: [{ kind: 'labor', description: 'Reparo da fonte' }],
    ...overrides,
  };
}

/** Usuario com exatamente as permissoes pedidas, na unidade principal. */
async function usuarioCom(
  permissoes: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][],
  email: string,
) {
  const userId = await createPlainUser(tenantA.tenantId, email);
  await grantMembership(tenantA.tenantId, userId, tenantA.unitId);
  const roleId = await createRoleWithPermissions(tenantA.tenantId, `papel-${email}`, permissoes);
  await assignTenantRole(tenantA.tenantId, userId, roleId);
  return { userId, context: await contextFor(tenantA.tenantId, userId, tenantA.unitId) };
}

// ---------------------------------------------------------------------------

describe('a autoridade tecnica e PERMISSAO, nunca o nome do cargo (item 69)', () => {
  async function osDeGarantia() {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));
    const retorno = await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Voltou a desligar.',
        coverageAssessment: 'covered',
      }),
    );
    return retorno.serviceOrderId!;
  }

  const MOTIVO = 'Oxidacao por liquido na regiao do conector, posterior ao reparo da fonte.';

  it('quem SO ve garantias nao reclassifica', async () => {
    const serviceOrderId = await osDeGarantia();
    const atendente = await usuarioCom(
      [PERMISSIONS.WARRANTIES_VIEW, PERMISSIONS.SERVICE_ORDERS_VIEW],
      'atendente@gar.invalid',
    );

    await expect(
      run(() =>
        reclassifyWarrantyServiceOrder(atendente.context, { serviceOrderId, reason: MOTIVO }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('quem cria e emite garantias TAMBEM nao reclassifica', async () => {
    /**
     * Emitir e decisao comercial; reclassificar e parecer tecnico. Um papel
     * poderoso em garantias nao herda a autoridade de dizer que o defeito
     * mudou — a chave e propria de proposito.
     */
    const serviceOrderId = await osDeGarantia();
    const gerente = await usuarioCom(
      [
        PERMISSIONS.WARRANTIES_VIEW,
        PERMISSIONS.WARRANTIES_CREATE,
        PERMISSIONS.WARRANTIES_ISSUE,
        PERMISSIONS.WARRANTIES_RETURN_CREATE,
      ],
      'gerente@gar.invalid',
    );

    await expect(
      run(() =>
        reclassifyWarrantyServiceOrder(gerente.context, { serviceOrderId, reason: MOTIVO }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('com warranties.reclassify E a transicao da OS, passa', async () => {
    const serviceOrderId = await osDeGarantia();
    const tecnico = await usuarioCom(
      [
        PERMISSIONS.WARRANTIES_VIEW,
        PERMISSIONS.WARRANTIES_RECLASSIFY,
        PERMISSIONS.SERVICE_ORDERS_VIEW,
        PERMISSIONS.SERVICE_ORDERS_TRANSITION,
      ],
      'tecnico@gar.invalid',
    );

    await run(() =>
      reclassifyWarrantyServiceOrder(tecnico.context, { serviceOrderId, reason: MOTIVO }),
    );

    const [os] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, serviceOrderId));
    expect(os!.classification).toBe('standard');
  });

  it('sem a permissao de TRANSICAO da OS, a reclassificacao tambem e recusada', async () => {
    /**
     * Reclassificar move a Ordem de Servico. Quem nao pode mover OS nao move
     * OS — nem por dentro do fluxo de garantia. A maquina de estados confere a
     * propria permissao, alem da de garantias.
     */
    const serviceOrderId = await osDeGarantia();
    const meioTecnico = await usuarioCom(
      [
        PERMISSIONS.WARRANTIES_VIEW,
        PERMISSIONS.WARRANTIES_RECLASSIFY,
        PERMISSIONS.SERVICE_ORDERS_VIEW,
      ],
      'meio@gar.invalid',
    );

    await expect(
      run(() =>
        reclassifyWarrantyServiceOrder(meioTecnico.context, { serviceOrderId, reason: MOTIVO }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('cada acao tem a sua chave (item 68)', () => {
  it('ver nao emite, e emitir nao revoga', async () => {
    const osId = await osFinalizada();
    const so_ve = await usuarioCom([PERMISSIONS.WARRANTIES_VIEW], 'sove@gar.invalid');

    await expect(run(() => issueWarranty(so_ve.context, emissao(osId)))).rejects.toBeInstanceOf(
      AuthorizationError,
    );

    const emissor = await usuarioCom(
      [PERMISSIONS.WARRANTIES_VIEW, PERMISSIONS.WARRANTIES_ISSUE],
      'emissor@gar.invalid',
    );
    const g = await run(() => issueWarranty(emissor.context, emissao(osId)));

    await expect(
      run(() => revokeWarranty(emissor.context, g.warrantyId, 'Lacre violado por terceiro.')),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('registrar retorno exige a chave propria', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));

    const semRetorno = await usuarioCom(
      [PERMISSIONS.WARRANTIES_VIEW, PERMISSIONS.WARRANTIES_ISSUE],
      'semretorno@gar.invalid',
    );

    await expect(
      run(() =>
        registerWarrantyReturn(semRetorno.context, {
          warrantyId: g.warrantyId,
          customerReport: 'Voltou.',
          coverageAssessment: 'covered',
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('configurar politicas e outra chave ainda', async () => {
    const semConfig = await usuarioCom(
      [PERMISSIONS.WARRANTIES_VIEW, PERMISSIONS.WARRANTIES_ISSUE],
      'semconfig@gar.invalid',
    );

    await expect(
      run(() =>
        createWarrantyPolicy(semConfig.context, {
          name: 'Tentativa',
          type: 'internal',
          durationAmount: 90,
          durationUnit: 'days',
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('custos sao dado separado (item 70)', () => {
  it('quem ve a garantia NAO ve o custo dela', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));
    await run(() =>
      recordWarrantyCost(tenantA.context, {
        warrantyId: g.warrantyId,
        kind: 'part',
        description: 'Fonte chaveada',
        amount: '80.00',
      }),
    );

    const atendente = await usuarioCom([PERMISSIONS.WARRANTIES_VIEW], 'custo-nao@gar.invalid');

    /** Ve a garantia... */
    const lista = await run(() => listWarranties(atendente.context, {}));
    expect(lista.total).toBe(1);

    /** ...e NAO ve quanto ela custou a loja. */
    await expect(
      run(() => listWarrantyCosts(atendente.context, g.warrantyId)),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('ver custo nao autoriza lancar custo', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));

    const leitor = await usuarioCom(
      [PERMISSIONS.WARRANTIES_VIEW, PERMISSIONS.WARRANTIES_COSTS_VIEW],
      'custo-le@gar.invalid',
    );

    await run(() => listWarrantyCosts(leitor.context, g.warrantyId));

    await expect(
      run(() =>
        recordWarrantyCost(leitor.context, {
          warrantyId: g.warrantyId,
          kind: 'labor',
          description: 'Mao de obra',
          amount: '50.00',
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('cross-tenant (itens 39 e 107)', () => {
  it('o tenant B nao emite, nao retorna, nao reclassifica e nao custeia no A', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));
    const retorno = await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Voltou.',
        coverageAssessment: 'covered',
      }),
    );

    await expect(run(() => issueWarranty(tenantB.context, emissao(osId)))).rejects.toBeInstanceOf(
      NotFoundError,
    );

    await expect(
      run(() =>
        registerWarrantyReturn(tenantB.context, {
          warrantyId: g.warrantyId,
          customerReport: 'Tentando.',
          coverageAssessment: 'covered',
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      run(() =>
        reclassifyWarrantyServiceOrder(tenantB.context, {
          serviceOrderId: retorno.serviceOrderId!,
          reason: 'Tentando reclassificar Ordem de Servico de outra empresa.',
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      run(() =>
        recordWarrantyCost(tenantB.context, {
          warrantyId: g.warrantyId,
          kind: 'part',
          description: 'Tentando.',
          amount: '10.00',
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a lista do B nao traz nada do A', async () => {
    const osId = await osFinalizada();
    await run(() => issueWarranty(tenantA.context, emissao(osId)));

    const doB = await run(() => listWarranties(tenantB.context, {}));
    expect(doB.total).toBe(0);
    expect(doB.items).toHaveLength(0);
  });
});

describe('cross-unit (item 108)', () => {
  it('quem so acessa a Unidade Norte nao ve nem aciona garantia da principal', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));

    /** Usuario com papel APENAS na Norte. */
    const userId = await createPlainUser(tenantA.tenantId, 'norte@gar.invalid');
    await grantMembership(tenantA.tenantId, userId, unidadeNorte);
    const roleId = await createRoleWithPermissions(tenantA.tenantId, 'papel-norte', [
      PERMISSIONS.WARRANTIES_VIEW,
      PERMISSIONS.WARRANTIES_ISSUE,
      PERMISSIONS.WARRANTIES_RETURN_CREATE,
      PERMISSIONS.SERVICE_ORDERS_VIEW,
    ]);
    await assignUnitRole(tenantA.tenantId, userId, roleId, unidadeNorte);
    const norte = await contextFor(tenantA.tenantId, userId, unidadeNorte);

    /** A garantia foi concedida na unidade principal: nao aparece para ele. */
    const lista = await run(() => listWarranties(norte, {}));
    expect(lista.total).toBe(0);

    await expect(
      run(() =>
        registerWarrantyReturn(norte, {
          warrantyId: g.warrantyId,
          customerReport: 'Tentando de outra unidade.',
          coverageAssessment: 'covered',
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sem papel nenhum, o BACKEND recusa na porta de entrada', async () => {
    const osId = await osFinalizada();
    await run(() => issueWarranty(tenantA.context, emissao(osId)));

    await clearTenantRoles(tenantA.adminUserId);
    const semPapel = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    /**
     * ONDE A PERMISSAO E CONFERIDA, e por que o teste olha para ca.
     *
     * `listWarranties` e consulta interna: ela recorta por tenant e pelas
     * unidades em que a pessoa e MEMBRO, e so e alcancavel depois que a
     * pagina ou a Server Action ja autorizou — e o mesmo arranjo do Financeiro
     * e de Compras. Cobrar permissao dentro da consulta faria cada modulo
     * repetir a autorizacao em dezenas de pontos, e o dia em que um deles
     * esquecesse seria justamente o dia do vazamento.
     *
     * A barreira real e esta, e ela nao depende de tela nenhuma (item 77).
     */
    await expect(
      run(() =>
        authorize(semPapel, {
          permission: PERMISSIONS.WARRANTIES_VIEW,
          featureKey: FEATURES.OPERATIONS_WARRANTIES,
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    /** E as acoes de escrita tambem, cada uma pela sua chave. */
    await expect(run(() => issueWarranty(semPapel, emissao(osId)))).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});

describe('a feature desligada bloqueia o backend, nao so o menu (itens 73 e 77)', () => {
  it('com operations.warranties desligada, emitir e registrar retorno sao recusados', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));

    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.OPERATIONS_WARRANTIES,
        enabled: false,
      }),
    );
    const semFeature = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    await expect(run(() => issueWarranty(semFeature, emissao(osId)))).rejects.toBeInstanceOf(
      AuthorizationError,
    );

    await expect(
      run(() =>
        registerWarrantyReturn(semFeature, {
          warrantyId: g.warrantyId,
          customerReport: 'Voltou.',
          coverageAssessment: 'covered',
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('o HISTORICO sobrevive ao desligamento e volta na reativacao (itens 74 e 75)', async () => {
    const osId = await osFinalizada();
    const g = await run(() => issueWarranty(tenantA.context, emissao(osId)));
    const retorno = await run(() =>
      registerWarrantyReturn(tenantA.context, {
        warrantyId: g.warrantyId,
        customerReport: 'Voltou.',
        coverageAssessment: 'covered',
      }),
    );

    await run(() =>
      setTenantFeature(tenantA.context, {
        featureKey: FEATURES.OPERATIONS_WARRANTIES,
        enabled: false,
      }),
    );

    /** Desligar NAO apaga: os dados continuam no banco. */
    const retornos = await getDb().select().from(warrantyReturns);
    expect(retornos).toHaveLength(1);

    /** E a OS de garantia continua inteira, com a classificacao preservada. */
    const [os] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, retorno.serviceOrderId!));
    expect(os!.classification).toBe('warranty_internal');

    /** Ao reativar, tudo volta a aparecer — sem duplicar nada. */
    const reativado = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);
    await run(() =>
      setTenantFeature(reativado, { featureKey: FEATURES.OPERATIONS_WARRANTIES, enabled: true }),
    );
    const depois = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    const lista = await run(() => listWarranties(depois, {}));
    expect(lista.total).toBe(1);
    expect(await getDb().select().from(warrantyReturns)).toHaveLength(1);
  });
});

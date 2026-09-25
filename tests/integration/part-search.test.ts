import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { resetEnvCache } from '@/core/config/env';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { isAppError, NotFoundError } from '@/core/errors';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { findServiceOrderDetail } from '@/modules/service-orders/application/service-order-queries';
import { createPart } from '@/modules/inventory/application/part-service';
import { receiveStock } from '@/modules/inventory/application/stock-service';
import { purchaseNeeds } from '@/modules/purchasing/infrastructure/schema';
import {
  performPartSearch,
  setPartSearchProviderTimeoutMsForTesting,
} from '@/modules/part-search/application/search-service';
import {
  createPurchaseNeedFromSelection,
  selectCandidate,
} from '@/modules/part-search/application/selection-service';
import { getSessionResults } from '@/modules/part-search/application/search-queries';
import {
  getCapturePartSearchProvider,
  resetCapturePartSearchProviderForTesting,
} from '@/modules/part-search/infrastructure/provider-registry';
import {
  partSearchCandidates,
  partSearchSelections,
  partSearchSessions,
} from '@/modules/part-search/infrastructure/schema';
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
 * FLUXO PONTA A PONTA DA BUSCA DE PECAS, contra MariaDB de verdade (Prompt
 * 21). Mesmo proposito do `ai-writing.test.ts` (Prompt 20): provar
 * isolamento real de tenant/unidade, autorizacao COMPOSTA, e que buscar e
 * selecionar NUNCA compram/reservam nada sozinhos.
 */

let planId: string;
let tenant: TenantFixture;
let sequencial = 0;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

async function ligarBusca(alvo: TenantFixture): Promise<void> {
  await run(() => setTenantFeature(alvo.context, { featureKey: FEATURES.AI_CORE, enabled: true }));
  await run(() =>
    setTenantFeature(alvo.context, { featureKey: FEATURES.AI_PART_SEARCH, enabled: true }),
  );
  await run(() =>
    setTenantFeature(alvo.context, { featureKey: FEATURES.OPERATIONS_INVENTORY, enabled: true }),
  );
  await run(() =>
    setTenantFeature(alvo.context, { featureKey: FEATURES.OPERATIONS_PURCHASING, enabled: true }),
  );
}

interface AbrirOsOptions {
  equipmentBrand?: string;
  equipmentModel?: string;
}

async function abrirOs(alvo: TenantFixture, options: AbrirOsOptions = {}): Promise<string> {
  sequencial += 1;
  const telefone = `11${String(900000000 + sequencial * 37).slice(0, 9)}`;
  const { customerId } = await run(() =>
    createCustomer(alvo.context, {
      kind: 'individual',
      name: `Cliente Busca ${sequencial}`,
      contacts: [{ type: 'phone', value: telefone, isWhatsapp: false }],
    }),
  );
  const { equipmentId } = await run(() =>
    createEquipment(alvo.context, {
      customerId,
      kind: 'Televisor',
      brand: options.equipmentBrand ?? 'Marca X',
      model: options.equipmentModel ?? 'X123',
    }),
  );
  const { serviceOrderId } = await run(() =>
    createServiceOrder(alvo.context, {
      equipmentId,
      customerReport: 'Nao liga.',
    }),
  );
  return serviceOrderId;
}

async function criarPeca(
  alvo: TenantFixture,
  options: { partNumber?: string; suggestedPrice?: string } = {},
): Promise<string> {
  sequencial += 1;
  const partId = await run(() =>
    createPart(alvo.context, {
      code: `PC-${sequencial}`,
      name: `Placa fonte ${sequencial}`,
      brand: 'Marca X',
      partNumber: options.partNumber,
      unitOfMeasure: 'unit',
      suggestedPrice: options.suggestedPrice ?? '150.00',
    }),
  );
  return partId;
}

async function darEstoque(alvo: TenantFixture, partId: string, quantity = '5'): Promise<void> {
  await run(() =>
    receiveStock(alvo.context, {
      unitId: alvo.unitId,
      partId,
      quantity,
      unitCost: '100.00',
    }),
  );
}

async function usuarioCom(
  alvo: TenantFixture,
  permissoes: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][],
  unitId = alvo.unitId,
) {
  sequencial += 1;
  const userId = await createPlainUser(alvo.tenantId, `ps-${sequencial}@rbac.invalid`);
  await grantMembership(alvo.tenantId, userId, unitId);
  const roleId = await createRoleWithPermissions(
    alvo.tenantId,
    `perfil-ps-${sequencial}`,
    permissoes,
  );
  await assignTenantRole(alvo.tenantId, userId, roleId);
  return contextFor(alvo.tenantId, userId, unitId);
}

function errorCode(error: unknown): string | undefined {
  if (!isAppError(error)) return undefined;
  return (error.details as { partSearchErrorCode?: string } | undefined)?.partSearchErrorCode;
}

async function contarSessoes(): Promise<number> {
  const linhas = await getDb().execute(sql`SELECT COUNT(*) AS total FROM part_search_sessions`);
  return Number(
    (linhas as unknown as Array<Array<{ total: number | string }>>)[0]?.[0]?.total ?? 0,
  );
}

async function contarSelecoes(): Promise<number> {
  const linhas = await getDb().execute(sql`SELECT COUNT(*) AS total FROM part_search_selections`);
  return Number(
    (linhas as unknown as Array<Array<{ total: number | string }>>)[0]?.[0]?.total ?? 0,
  );
}

async function contarNecessidades(unitId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: purchaseNeeds.id })
    .from(purchaseNeeds)
    .where(eq(purchaseNeeds.unitId, unitId));
  return rows.length;
}

let ambienteAnterior: NodeJS.ProcessEnv | null = null;

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
  resetCapturePartSearchProviderForTesting();
  setPartSearchProviderTimeoutMsForTesting(200);
  planId = await seedCatalog();
  tenant = await createTenantFixture('ps-integ', planId);
  await ligarBusca(tenant);
});

afterEach(() => {
  desligarProducao();
  setPartSearchProviderTimeoutMsForTesting(null);
});

describe('feature e permissao (composta)', () => {
  it('feature ai.part_search desligada: PART_SEARCH_FEATURE_DISABLED e nenhuma sessao gravada', async () => {
    const semBusca = await createTenantFixture('ps-integ-sem-busca', planId);
    await run(() =>
      setTenantFeature(semBusca.context, { featureKey: FEATURES.AI_CORE, enabled: true }),
    );

    const erro = await run(() =>
      performPartSearch(semBusca.context, { term: 'placa fonte', unitId: semBusca.unitId }),
    ).catch((e: unknown) => e);

    expect(errorCode(erro)).toBe('PART_SEARCH_FEATURE_DISABLED');
    expect(await contarSessoes()).toBe(0);
  });

  it('parts.search ausente: PART_SEARCH_PERMISSION_DENIED', async () => {
    const semPermissao = await usuarioCom(tenant, [PERMISSIONS.INVENTORY_VIEW]);

    const erro = await run(() =>
      performPartSearch(semPermissao, { term: 'placa fonte', unitId: tenant.unitId }),
    ).catch((e: unknown) => e);

    expect(errorCode(erro)).toBe('PART_SEARCH_PERMISSION_DENIED');
  });

  it('busca a partir de OS exige tambem service_orders.view na unidade da OS', async () => {
    const serviceOrderId = await abrirOs(tenant);
    const semServiceOrdersView = await usuarioCom(tenant, [PERMISSIONS.PARTS_SEARCH]);

    const erro = await run(() =>
      performPartSearch(semServiceOrdersView, { term: 'placa fonte', serviceOrderId }),
    ).catch((e: unknown) => e);

    expect(isAppError(erro) && erro.code).toBe('AUTHORIZATION_ERROR');
  });
});

describe('busca interna (Estoque)', () => {
  it('encontra peca interna e classifica alta_probabilidade quando o codigo bate exatamente', async () => {
    const partId = await criarPeca(tenant, { partNumber: 'X123' });
    await darEstoque(tenant, partId);

    const result = await run(() =>
      performPartSearch(tenant.context, {
        term: 'placa fonte',
        partNumberHint: 'X123',
        unitId: tenant.unitId,
      }),
    );

    expect(result.internalSearched).toBe(true);
    const found = result.candidates.find((c) => c.sourceType === 'internal_inventory');
    expect(found).toBeDefined();
    expect(found!.compatibilityLabel).toBe('alta_probabilidade');
  });

  it('classifica alta_probabilidade quando o codigo vem SOMENTE no termo digitado, sem partNumberHint separado (regressao: ancora minuscula vs codigo maiusculo)', async () => {
    const partId = await criarPeca(tenant, { partNumber: 'X123' });
    await darEstoque(tenant, partId);

    const result = await run(() =>
      performPartSearch(tenant.context, { term: 'X123', unitId: tenant.unitId }),
    );

    const found = result.candidates.find((c) => c.sourceType === 'internal_inventory');
    expect(found).toBeDefined();
    expect(found!.compatibilityLabel).toBe('alta_probabilidade');
  });

  it('sem codigo batendo, o candidate interno fica nao_verificada (nunca inventa mapeamento — item 114)', async () => {
    await criarPeca(tenant, { partNumber: 'Z999' });

    const result = await run(() =>
      performPartSearch(tenant.context, { term: 'Placa fonte', unitId: tenant.unitId }),
    );

    const found = result.candidates.find((c) => c.sourceType === 'internal_inventory');
    expect(found?.compatibilityLabel).toBe('nao_verificada');
  });

  it('estoque com saldo > 0 vira oferta "em estoque"; sem saldo, "indisponivel" (nunca inventado)', async () => {
    const partId = await criarPeca(tenant);
    await darEstoque(tenant, partId, '3');

    const result = await run(() =>
      performPartSearch(tenant.context, { term: 'Placa fonte', unitId: tenant.unitId }),
    );
    const found = result.candidates.find((c) => c.sourceType === 'internal_inventory');
    expect(found!.offers.some((o) => o.availability === 'in_stock')).toBe(true);
  });

  it('sem inventory.view, internalSearched e false — a busca externa continua funcionando isolada', async () => {
    const semInventory = await usuarioCom(tenant, [PERMISSIONS.PARTS_SEARCH]);
    await criarPeca(tenant);

    const result = await run(() =>
      performPartSearch(semInventory, {
        term: 'placa fonte',
        unitId: tenant.unitId,
        includeExternal: false,
      }),
    );

    expect(result.internalSearched).toBe(false);
    expect(result.candidates.filter((c) => c.sourceType === 'internal_inventory')).toHaveLength(0);
  });
});

describe('estados do provedor externo (item 23/129/137)', () => {
  it('provedor nao configurado em producao: busca interna continua funcionando', async () => {
    const partId = await criarPeca(tenant, { partNumber: 'X123' });
    await darEstoque(tenant, partId);
    ligarProducao();

    const result = await run(() =>
      performPartSearch(tenant.context, { term: 'placa fonte', unitId: tenant.unitId }),
    );

    expect(result.externalOutcome).toBe('not_configured');
    expect(result.candidates.some((c) => c.sourceType === 'internal_inventory')).toBe(true);
    expect(result.status).toBe('partial');
  });

  it('resultado invalido do provedor (preco negativo) e descartado sem derrubar o restante', async () => {
    const capture = getCapturePartSearchProvider();
    capture?.respondNext({
      outcome: 'ok',
      items: [
        {
          providerResultId: 'r1',
          title: 'Peca valida',
          partNumber: null,
          manufacturer: null,
          sourceName: 'Loja X',
          price: { amount: '10.00', currency: 'BRL' },
          availability: 'available',
          leadTimeDays: 2,
          url: 'https://loja.exemplo.com/1',
          compatibilityData: null,
          observedAt: new Date(),
        },
        {
          providerResultId: 'r2',
          title: 'Peca com preco invalido',
          partNumber: null,
          manufacturer: null,
          sourceName: 'Loja Y',
          // Preco negativo, proposital, para provar a rejeicao pelo schema (item 107).
          price: { amount: '-5.00', currency: 'BRL' },
          availability: 'available',
          leadTimeDays: 2,
          url: 'https://loja.exemplo.com/2',
          compatibilityData: null,
          observedAt: new Date(),
        },
      ],
    });

    const result = await run(() =>
      performPartSearch(tenant.context, { term: 'peca x', unitId: tenant.unitId }),
    );

    const external = result.candidates.filter((c) => c.sourceType === 'external');
    expect(external).toHaveLength(1);
    expect(external[0]?.title).toBe('Peca valida');
  });

  it('URL javascript: do provedor nunca alcanca o candidate (item 33)', async () => {
    const capture = getCapturePartSearchProvider();
    capture?.respondNext({
      outcome: 'ok',
      items: [
        {
          providerResultId: 'r1',
          title: 'Peca com link malicioso',
          partNumber: null,
          manufacturer: null,
          sourceName: 'Loja X',
          price: null,
          availability: null,
          leadTimeDays: null,
          url: 'javascript:alert(1)',
          compatibilityData: null,
          observedAt: new Date(),
        },
      ],
    });

    const result = await run(() =>
      performPartSearch(tenant.context, { term: 'peca x', unitId: tenant.unitId }),
    );

    const external = result.candidates.find((c) => c.sourceType === 'external');
    expect(external?.offers[0]?.url).toBeNull();
  });

  it('timeout do provedor: busca interna nao e afetada', async () => {
    const partId = await criarPeca(tenant, { partNumber: 'X123' });
    await darEstoque(tenant, partId);
    setPartSearchProviderTimeoutMsForTesting(50);
    const capture = getCapturePartSearchProvider();
    capture?.respondNext({ outcome: 'ok', items: [] }, 500);

    const result = await run(() =>
      performPartSearch(tenant.context, {
        term: 'placa fonte',
        partNumberHint: 'X123',
        unitId: tenant.unitId,
      }),
    );

    expect(result.externalOutcome).toBe('timeout');
    expect(result.candidates.some((c) => c.sourceType === 'internal_inventory')).toBe(true);
  });
});

describe('compatibilidade e selecao humana (itens 88 a 98)', () => {
  it('incompativel bloqueia selectCandidate', async () => {
    const capture = getCapturePartSearchProvider();
    capture?.respondNext({
      outcome: 'ok',
      items: [
        {
          providerResultId: 'r1',
          title: 'Peca incompativel',
          partNumber: null,
          manufacturer: null,
          sourceName: 'Loja X',
          price: { amount: '10.00', currency: 'BRL' },
          availability: 'available',
          leadTimeDays: null,
          url: null,
          compatibilityData: {
            exactFit: false,
            incompatible: true,
            note: 'Nao serve neste modelo',
          },
          observedAt: new Date(),
        },
      ],
    });

    const result = await run(() =>
      performPartSearch(tenant.context, { term: 'peca x', unitId: tenant.unitId }),
    );
    const incompatible = result.candidates.find((c) => c.compatibilityLabel === 'incompativel');
    expect(incompatible).toBeDefined();

    const erro = await run(() =>
      selectCandidate(tenant.context, {
        sessionId: result.sessionId,
        candidateId: incompatible!.id,
      }),
    ).catch((e: unknown) => e);

    expect(errorCode(erro)).toBe('PART_SEARCH_INCOMPATIBLE_SELECTION');
  });

  it('nao_verificada exige confirmacao consciente explicita', async () => {
    await criarPeca(tenant, { partNumber: 'ZZZ' }); // nao bate com nenhuma ancora do termo -> nao_verificada

    const result = await run(() =>
      performPartSearch(tenant.context, {
        term: 'placa fonte',
        unitId: tenant.unitId,
        includeExternal: false,
      }),
    );
    const unverified = result.candidates.find((c) => c.compatibilityLabel === 'nao_verificada');
    expect(unverified).toBeDefined();

    const semConfirmar = await run(() =>
      selectCandidate(tenant.context, { sessionId: result.sessionId, candidateId: unverified!.id }),
    ).catch((e: unknown) => e);
    expect(errorCode(semConfirmar)).toBe('PART_SEARCH_UNVERIFIED_CONFIRMATION_REQUIRED');

    const comConfirmacao = await run(() =>
      selectCandidate(tenant.context, {
        sessionId: result.sessionId,
        candidateId: unverified!.id,
        unverifiedAcknowledged: true,
      }),
    );
    expect(comConfirmacao.selectionId).toBeTruthy();
  });
});

describe('human confirmation / nenhuma compra automatica (itens 88, 95 a 98, 146)', () => {
  it('buscar sozinho nao cria nenhuma selecao nem necessidade de compra', async () => {
    const partId = await criarPeca(tenant, { partNumber: 'X123' });
    await darEstoque(tenant, partId);

    await run(() =>
      performPartSearch(tenant.context, {
        term: 'placa fonte',
        partNumberHint: 'X123',
        unitId: tenant.unitId,
      }),
    );

    expect(await contarSelecoes()).toBe(0);
    expect(await contarNecessidades(tenant.unitId)).toBe(0);
  });

  it('selecionar nao compra nem reserva nada', async () => {
    const partId = await criarPeca(tenant, { partNumber: 'X123' });
    await darEstoque(tenant, partId);

    const result = await run(() =>
      performPartSearch(tenant.context, {
        term: 'placa fonte',
        partNumberHint: 'X123',
        unitId: tenant.unitId,
      }),
    );
    const candidate = result.candidates.find((c) => c.sourceType === 'internal_inventory')!;

    await run(() =>
      selectCandidate(tenant.context, { sessionId: result.sessionId, candidateId: candidate.id }),
    );

    expect(await contarNecessidades(tenant.unitId)).toBe(0);
  });

  it('candidate externo (sem partId) nunca pode virar necessidade de compra sozinho', async () => {
    const capture = getCapturePartSearchProvider();
    capture?.respondNext({
      outcome: 'ok',
      items: [
        {
          providerResultId: 'r1',
          title: 'Peca externa',
          partNumber: null,
          manufacturer: null,
          sourceName: 'Loja X',
          price: { amount: '10.00', currency: 'BRL' },
          availability: 'available',
          leadTimeDays: null,
          url: null,
          compatibilityData: null,
          observedAt: new Date(),
        },
      ],
    });

    const result = await run(() =>
      performPartSearch(tenant.context, { term: 'peca x', unitId: tenant.unitId }),
    );
    const external = result.candidates.find((c) => c.sourceType === 'external')!;

    const { selectionId } = await run(() =>
      selectCandidate(tenant.context, {
        sessionId: result.sessionId,
        candidateId: external.id,
        unverifiedAcknowledged: true,
      }),
    );

    const erro = await run(() =>
      createPurchaseNeedFromSelection(tenant.context, { selectionId, quantity: '1' }),
    ).catch((e: unknown) => e);

    expect(isAppError(erro) && erro.code).toBe('BUSINESS_RULE');
    expect(await contarNecessidades(tenant.unitId)).toBe(0);
  });

  it('necessidade de compra so apos confirmacao explicita, e e idempotente (item 98)', async () => {
    const serviceOrderId = await abrirOs(tenant);
    // Sem chamar `darEstoque`: nenhuma linha em stock_balances ainda -> saldo zero por padrao, nao erro.
    await criarPeca(tenant, { partNumber: 'X123' });

    const result = await run(() =>
      performPartSearch(tenant.context, {
        term: 'placa fonte',
        partNumberHint: 'X123',
        serviceOrderId,
      }),
    );
    const candidate = result.candidates.find((c) => c.sourceType === 'internal_inventory')!;

    const selection1 = await run(() =>
      selectCandidate(tenant.context, { sessionId: result.sessionId, candidateId: candidate.id }),
    );
    const need1 = await run(() =>
      createPurchaseNeedFromSelection(tenant.context, {
        selectionId: selection1.selectionId,
        quantity: '2',
      }),
    );
    expect(need1.reused).toBe(false);
    expect(await contarNecessidades(tenant.unitId)).toBe(1);

    // Segunda busca + selecao para a MESMA peca/OS: deve reaproveitar a necessidade aberta.
    const result2 = await run(() =>
      performPartSearch(tenant.context, {
        term: 'placa fonte',
        partNumberHint: 'X123',
        serviceOrderId,
      }),
    );
    const candidate2 = result2.candidates.find((c) => c.sourceType === 'internal_inventory')!;
    const selection2 = await run(() =>
      selectCandidate(tenant.context, { sessionId: result2.sessionId, candidateId: candidate2.id }),
    );
    const need2 = await run(() =>
      createPurchaseNeedFromSelection(tenant.context, {
        selectionId: selection2.selectionId,
        quantity: '1',
      }),
    );

    expect(need2.reused).toBe(true);
    expect(need2.purchaseNeedId).toBe(need1.purchaseNeedId);
    expect(await contarNecessidades(tenant.unitId)).toBe(1);
  });

  it('a OS nao muda de status em nenhum momento do fluxo (busca -> selecao -> necessidade)', async () => {
    const serviceOrderId = await abrirOs(tenant);
    const partId = await criarPeca(tenant, { partNumber: 'X123' });
    await darEstoque(tenant, partId);

    const antes = await run(() => findServiceOrderDetail(tenant.context, serviceOrderId));

    const result = await run(() =>
      performPartSearch(tenant.context, {
        term: 'placa fonte',
        partNumberHint: 'X123',
        serviceOrderId,
      }),
    );
    const candidate = result.candidates.find((c) => c.sourceType === 'internal_inventory')!;
    const selection = await run(() =>
      selectCandidate(tenant.context, { sessionId: result.sessionId, candidateId: candidate.id }),
    );
    await run(() =>
      createPurchaseNeedFromSelection(tenant.context, {
        selectionId: selection.selectionId,
        quantity: '1',
      }),
    );

    const depois = await run(() => findServiceOrderDetail(tenant.context, serviceOrderId));
    expect(depois!.order.status).toBe(antes!.order.status);
  });
});

describe('isolamento de tenant e unidade (itens 77, 78, 141, 142)', () => {
  it('Tenant B nunca ve sessao/candidate do Tenant A', async () => {
    const partId = await criarPeca(tenant, { partNumber: 'X123' });
    await darEstoque(tenant, partId);
    const result = await run(() =>
      performPartSearch(tenant.context, {
        term: 'placa fonte',
        partNumberHint: 'X123',
        unitId: tenant.unitId,
      }),
    );

    const outroTenant = await createTenantFixture('ps-integ-outro', planId);
    await ligarBusca(outroTenant);

    const erro = await run(() => getSessionResults(outroTenant.context, result.sessionId)).catch(
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(NotFoundError);
  });

  it('unidade nao autorizada: PART_SEARCH_CONTEXT_NOT_FOUND, sem vazar dado', async () => {
    const outraUnidade = await createUnit(tenant.tenantId, 'Unidade B');
    const usuarioUnidadeA = await usuarioCom(tenant, [PERMISSIONS.PARTS_SEARCH], tenant.unitId);

    const erro = await run(() =>
      performPartSearch(usuarioUnidadeA, { term: 'placa fonte', unitId: outraUnidade }),
    ).catch((e: unknown) => e);

    expect(errorCode(erro)).toBe('PART_SEARCH_CONTEXT_NOT_FOUND');
  });

  it('OS de outro tenant como contexto: PART_SEARCH_CONTEXT_NOT_FOUND', async () => {
    const outroTenant = await createTenantFixture('ps-integ-os-outro', planId);
    await ligarBusca(outroTenant);
    const serviceOrderDeOutroTenant = await abrirOs(outroTenant);

    const erro = await run(() =>
      performPartSearch(tenant.context, {
        term: 'placa fonte',
        serviceOrderId: serviceOrderDeOutroTenant,
      }),
    ).catch((e: unknown) => e);

    expect(errorCode(erro)).toBe('PART_SEARCH_CONTEXT_NOT_FOUND');
  });

  it('candidates/evidence/offers gravados carregam o tenant correto (FK tenant-safe)', async () => {
    const partId = await criarPeca(tenant, { partNumber: 'X123' });
    await darEstoque(tenant, partId);
    const result = await run(() =>
      performPartSearch(tenant.context, {
        term: 'placa fonte',
        partNumberHint: 'X123',
        unitId: tenant.unitId,
      }),
    );

    const [session] = await getDb()
      .select({ tenantId: partSearchSessions.tenantId })
      .from(partSearchSessions)
      .where(eq(partSearchSessions.id, result.sessionId));
    expect(session?.tenantId).toBe(tenant.tenantId);

    const candidateRows = await getDb()
      .select({ tenantId: partSearchCandidates.tenantId })
      .from(partSearchCandidates)
      .where(eq(partSearchCandidates.sessionId, result.sessionId));
    expect(candidateRows.every((c) => c.tenantId === tenant.tenantId)).toBe(true);
  });
});

describe('leitura de resultados persistidos (getSessionResults)', () => {
  it('devolve os candidates ja ordenados pela prioridade oficial', async () => {
    const partId = await criarPeca(tenant, { partNumber: 'X123' });
    await darEstoque(tenant, partId);

    const result = await run(() =>
      performPartSearch(tenant.context, {
        term: 'placa fonte',
        partNumberHint: 'X123',
        unitId: tenant.unitId,
      }),
    );

    const fetched = await run(() => getSessionResults(tenant.context, result.sessionId));
    expect(fetched.candidates.map((c) => c.id)).toEqual(result.candidates.map((c) => c.id));
  });

  it('selecao registrada em part_search_selections referencia session/candidate corretos', async () => {
    const partId = await criarPeca(tenant, { partNumber: 'X123' });
    await darEstoque(tenant, partId);
    const result = await run(() =>
      performPartSearch(tenant.context, {
        term: 'placa fonte',
        partNumberHint: 'X123',
        unitId: tenant.unitId,
      }),
    );
    const candidate = result.candidates[0]!;
    const { selectionId } = await run(() =>
      selectCandidate(tenant.context, { sessionId: result.sessionId, candidateId: candidate.id }),
    );

    const [row] = await getDb()
      .select()
      .from(partSearchSelections)
      .where(
        and(
          eq(partSearchSelections.id, selectionId),
          eq(partSearchSelections.tenantId, tenant.tenantId),
        ),
      );
    expect(row?.sessionId).toBe(result.sessionId);
    expect(row?.candidateId).toBe(candidate.id);
  });
});

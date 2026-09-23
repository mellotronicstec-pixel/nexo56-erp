import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { AuthenticationError, NotFoundError } from '@/core/errors';
import { getRateLimitStore } from '@/core/rate-limit/rate-limiter';
import { getCaptureProvider, resetCaptureProviderForTesting } from '@/modules/communications/infrastructure/provider-registry';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  consumePortalLoginToken,
  requestPortalLogin,
} from '@/modules/portal/application/portal-login-service';
import { loadPortalContextForSession } from '@/modules/portal/application/portal-context';
import { findActivePortalSession } from '@/modules/portal/application/portal-session-service';
import {
  getMyServiceOrder,
  listMyServiceOrders,
  listMyEquipment,
  listMyWarranties,
} from '@/modules/portal/application/portal-query-service';
import { readPortalWarrantyCertificate } from '@/modules/portal/application/portal-warranty-certificate-service';
import { portalIdentities, portalLoginTokens } from '@/modules/portal/infrastructure/schema';
import { issueCertificate } from '@/modules/warranties/application/warranty-certificate-service';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { contextFor, createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';
import {
  createPortalScenario,
  insertWarrantyFixture,
  type PortalScenario,
} from '../helpers/portal-fixtures';

/**
 * PORTAL DO CLIENTE — autenticacao, ownership e desligamento (Prompt 17).
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let cenarioA: PortalScenario;

function run<T>(work: () => Promise<T>): Promise<T> {
  return runWithContext({ origin: 'test' }, work);
}

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  resetCaptureProviderForTesting();

  const planId = await seedCatalog();
  tenantA = await createTenantFixture('portal-a', planId);
  tenantB = await createTenantFixture('portal-b', planId);

  for (const t of [tenantA, tenantB]) {
    await run(() => setTenantFeature(t.context, { featureKey: FEATURES.CUSTOMER_PORTAL, enabled: true }));
    await run(() => setTenantFeature(t.context, { featureKey: FEATURES.OPERATIONS_WARRANTIES, enabled: true }));
  }
  tenantA.context = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);
  tenantB.context = await contextFor(tenantB.tenantId, tenantB.adminUserId, tenantB.unitId);

  cenarioA = await run(() => createPortalScenario(tenantA.context, { emailSuffix: 'a1' }));

  /**
   * O rate limit e um singleton em memoria de PROCESSO (item 43 do prompt da
   * fundacao) — `truncateAll()` limpa o banco, nunca este estado. Sem
   * reset aqui, o segundo teste do arquivo ja encontraria o contato
   * "gasto" pelo primeiro, mesmo em bancos de dados diferentes.
   */
  await getRateLimitStore().reset(`portal-login:${cenarioA.contactEmail}`);
});

describe('pedido de link — resposta identica sempre (item 17)', () => {
  it('envia mensagem quando o contato existe', async () => {
    await run(() => requestPortalLogin(cenarioA.contactEmail));
    expect(getCaptureProvider()?.messages().length).toBe(1);
  });

  it('nao envia nada quando o contato nao existe, e nao lanca erro', async () => {
    await expect(run(() => requestPortalLogin('ninguem@exemplo.invalid'))).resolves.toBeUndefined();
    expect(getCaptureProvider()?.messages().length).toBe(0);
  });

  it('nao envia nada para cliente de tenant com o Portal desligado', async () => {
    await run(() =>
      setTenantFeature(tenantA.context, { featureKey: FEATURES.CUSTOMER_PORTAL, enabled: false }),
    );
    await run(() => requestPortalLogin(cenarioA.contactEmail));
    expect(getCaptureProvider()?.messages().length).toBe(0);
  });

  it('um contato pode bater em tenants diferentes e cada um recebe o proprio link', async () => {
    const cenarioB = await run(() =>
      createPortalScenario(tenantB.context, { emailSuffix: 'compartilhado' }),
    );
    // Mesmo sufixo de e-mail em tenants diferentes — contatos distintos na pratica,
    // mas o teste relevante e que cada tenant só produz UM envio para o SEU cliente.
    await run(() => requestPortalLogin(cenarioA.contactEmail));
    await run(() => requestPortalLogin(cenarioB.contactEmail));
    expect(getCaptureProvider()?.messages().length).toBe(2);
  });
});

async function extractLatestToken(): Promise<string> {
  const message = getCaptureProvider()!.messages().at(-1)!;
  const match = message.body.match(/entrar\/([^\s\\]+)/);
  const token = match?.[1];
  if (!token) throw new Error('Link nao encontrado no corpo da mensagem capturada.');
  return token;
}

describe('consumo do link (ADR-044: CAS)', () => {
  it('cria sessao valida na primeira consumacao', async () => {
    await run(() => requestPortalLogin(cenarioA.contactEmail));
    const token = await extractLatestToken();

    const session = await run(() => consumePortalLoginToken(token));
    expect(session.tenantId).toBe(tenantA.tenantId);

    const ativa = await findActivePortalSession(session.token);
    expect(ativa?.customerId).toBe(cenarioA.customerId);
  });

  it('a segunda consumacao do MESMO token falha (duplo clique/duplo uso)', async () => {
    await run(() => requestPortalLogin(cenarioA.contactEmail));
    const token = await extractLatestToken();

    await run(() => consumePortalLoginToken(token));
    await expect(run(() => consumePortalLoginToken(token))).rejects.toThrow(AuthenticationError);
  });

  it('token expirado nunca autentica', async () => {
    await run(() => requestPortalLogin(cenarioA.contactEmail));
    const token = await extractLatestToken();

    await getDb()
      .update(portalLoginTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(portalLoginTokens.tenantId, tenantA.tenantId));

    await expect(run(() => consumePortalLoginToken(token))).rejects.toThrow(AuthenticationError);
  });

  it('token invalido/inventado nunca autentica', async () => {
    await expect(run(() => consumePortalLoginToken('token-que-nunca-existiu'))).rejects.toThrow(
      AuthenticationError,
    );
  });

  it('identidade bloqueada nao consegue nova sessao', async () => {
    await run(() => requestPortalLogin(cenarioA.contactEmail));
    const primeiroToken = await extractLatestToken();
    await run(() => consumePortalLoginToken(primeiroToken));

    await getDb()
      .update(portalIdentities)
      .set({ status: 'blocked' })
      .where(eq(portalIdentities.customerId, cenarioA.customerId));

    await run(() => requestPortalLogin(cenarioA.contactEmail));
    const segundoToken = await extractLatestToken();
    await expect(run(() => consumePortalLoginToken(segundoToken))).rejects.toThrow(AuthenticationError);
  });
});

describe('desligar a feature no MEIO da sessao (item 122)', () => {
  it('uma sessao ativa para de resolver contexto assim que a feature e desligada', async () => {
    await run(() => requestPortalLogin(cenarioA.contactEmail));
    const token = await extractLatestToken();
    const session = await run(() => consumePortalLoginToken(token));

    const antes = await run(async () => {
      const ativa = await findActivePortalSession(session.token);
      return ativa ? loadPortalContextForSession(ativa) : null;
    });
    expect(antes).not.toBeNull();

    await run(() =>
      setTenantFeature(tenantA.context, { featureKey: FEATURES.CUSTOMER_PORTAL, enabled: false }),
    );

    const depois = await run(async () => {
      const ativa = await findActivePortalSession(session.token);
      return ativa ? loadPortalContextForSession(ativa) : null;
    });
    expect(depois).toBeNull();
  });
});

describe('ownership: IDOR e enumeracao (item 46)', () => {
  it('OS de outro cliente do MESMO tenant devolve NotFoundError, igual a inexistente', async () => {
    const outroCliente = await run(() => createPortalScenario(tenantA.context, { emailSuffix: 'a2' }));

    const contextoIntruso = {
      tenantId: tenantA.tenantId,
      customerId: outroCliente.customerId,
      portalIdentityId: 'irrelevante',
      sessionId: 'irrelevante',
      sessionExpiresAt: new Date(),
    };

    const erroAlheio = await run(() =>
      getMyServiceOrder(contextoIntruso, cenarioA.serviceOrderId).catch((e: unknown) => e),
    );
    const erroInexistente = await run(() =>
      getMyServiceOrder(contextoIntruso, 'id-que-nunca-existiu').catch((e: unknown) => e),
    );

    expect(erroAlheio).toBeInstanceOf(NotFoundError);
    expect(erroInexistente).toBeInstanceOf(NotFoundError);
    expect((erroAlheio as NotFoundError).message).toBe((erroInexistente as NotFoundError).message);
  });

  it('OS de outro TENANT tambem devolve NotFoundError', async () => {
    const contextoOutroTenant = {
      tenantId: tenantB.tenantId,
      customerId: 'qualquer',
      portalIdentityId: 'irrelevante',
      sessionId: 'irrelevante',
      sessionExpiresAt: new Date(),
    };

    await expect(
      run(() => getMyServiceOrder(contextoOutroTenant, cenarioA.serviceOrderId)),
    ).rejects.toThrow(NotFoundError);
  });

  it('lista de OS nunca mistura clientes do mesmo tenant', async () => {
    const outroCliente = await run(() => createPortalScenario(tenantA.context, { emailSuffix: 'a3' }));

    const contextoA = {
      tenantId: tenantA.tenantId,
      customerId: cenarioA.customerId,
      portalIdentityId: 'x',
      sessionId: 'x',
      sessionExpiresAt: new Date(),
    };

    const ordens = await run(() => listMyServiceOrders(contextoA));
    expect(ordens).toHaveLength(1);
    expect(ordens[0]?.id).toBe(cenarioA.serviceOrderId);
    void outroCliente;
  });

  it('a linha do tempo so mostra tipos da lista de permissao (item 41)', async () => {
    const contextoA = {
      tenantId: tenantA.tenantId,
      customerId: cenarioA.customerId,
      portalIdentityId: 'x',
      sessionId: 'x',
      sessionExpiresAt: new Date(),
    };

    const detalhe = await run(() => getMyServiceOrder(contextoA, cenarioA.serviceOrderId));
    /** A fixture grava `technician_assigned`, fora da lista — nunca deve aparecer. */
    expect(detalhe.timeline.some((entry) => entry.summary.includes('Tecnico Fulano'))).toBe(false);
  });

  it('relato interno nunca vaza: so `customerReport` sai, nunca `internal_notes`', async () => {
    const contextoA = {
      tenantId: tenantA.tenantId,
      customerId: cenarioA.customerId,
      portalIdentityId: 'x',
      sessionId: 'x',
      sessionExpiresAt: new Date(),
    };

    const detalhe = await run(() => getMyServiceOrder(contextoA, cenarioA.serviceOrderId));
    expect(detalhe.customerReport).toBe('Nao liga.');
    expect(JSON.stringify(detalhe)).not.toContain('Nota interna');
  });
});

describe('garantias: rascunho nunca aparece, custo nunca vaza (item 47)', () => {
  it('garantia `draft` fica de fora da listagem', async () => {
    await insertWarrantyFixture({
      tenantId: tenantA.tenantId,
      customerId: cenarioA.customerId,
      equipmentId: cenarioA.equipmentId,
      unitId: tenantA.unitId,
      status: 'draft',
      number: 1,
    });

    const contextoA = {
      tenantId: tenantA.tenantId,
      customerId: cenarioA.customerId,
      portalIdentityId: 'x',
      sessionId: 'x',
      sessionExpiresAt: new Date(),
    };
    const garantias = await run(() => listMyWarranties(contextoA));
    expect(garantias).toHaveLength(0);
  });

  it('garantia `active` aparece, sem nenhum campo de custo no DTO', async () => {
    const warrantyId = await insertWarrantyFixture({
      tenantId: tenantA.tenantId,
      customerId: cenarioA.customerId,
      equipmentId: cenarioA.equipmentId,
      unitId: tenantA.unitId,
      status: 'active',
      number: 2,
    });

    const contextoA = {
      tenantId: tenantA.tenantId,
      customerId: cenarioA.customerId,
      portalIdentityId: 'x',
      sessionId: 'x',
      sessionExpiresAt: new Date(),
    };
    const garantias = await run(() => listMyWarranties(contextoA));
    expect(garantias.map((w) => w.id)).toContain(warrantyId);
    const chaves = Object.keys(garantias[0] ?? {});
    expect(chaves).not.toContain('amount');
    expect(chaves).not.toContain('cost');
  });

  it('serial do equipamento nunca sai por inteiro', async () => {
    const contextoA = {
      tenantId: tenantA.tenantId,
      customerId: cenarioA.customerId,
      portalIdentityId: 'x',
      sessionId: 'x',
      sessionExpiresAt: new Date(),
    };
    const equipamentos = await run(() => listMyEquipment(contextoA));
    expect(equipamentos[0]?.maskedSerial).toBe('•••• 90AB');
  });
});

describe('certificado de garantia — reutiliza o servico oficial (item 49/50)', () => {
  it('cliente dono baixa o mesmo artefato que o painel interno gera', async () => {
    const warrantyId = await insertWarrantyFixture({
      tenantId: tenantA.tenantId,
      customerId: cenarioA.customerId,
      equipmentId: cenarioA.equipmentId,
      unitId: tenantA.unitId,
      status: 'active',
      number: 3,
    });
    await run(() => issueCertificate(tenantA.context, warrantyId));

    const contextoA = {
      tenantId: tenantA.tenantId,
      customerId: cenarioA.customerId,
      portalIdentityId: 'x',
      sessionId: 'x',
      sessionExpiresAt: new Date(),
    };
    const pdf = await run(() => readPortalWarrantyCertificate(contextoA, warrantyId));
    expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('cliente de outro tenant recebe NotFoundError, nunca o arquivo', async () => {
    const warrantyId = await insertWarrantyFixture({
      tenantId: tenantA.tenantId,
      customerId: cenarioA.customerId,
      equipmentId: cenarioA.equipmentId,
      unitId: tenantA.unitId,
      status: 'active',
      number: 4,
    });
    await run(() => issueCertificate(tenantA.context, warrantyId));

    const contextoIntruso = {
      tenantId: tenantB.tenantId,
      customerId: 'qualquer',
      portalIdentityId: 'x',
      sessionId: 'x',
      sessionExpiresAt: new Date(),
    };
    await expect(run(() => readPortalWarrantyCertificate(contextoIntruso, warrantyId))).rejects.toThrow(
      NotFoundError,
    );
  });
});

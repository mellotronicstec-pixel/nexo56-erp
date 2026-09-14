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
  approveQuote,
  createQuote,
  rejectQuote,
  saveQuoteDraft,
  sendQuote,
} from '@/modules/quotes/application/quote-service';
import { quotes } from '@/modules/quotes/infrastructure/schema';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
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
 * PERMISSOES DO ORCAMENTO (Prompt 09, itens 70 a 74).
 *
 * O que estes testes travam:
 *
 *  1. Cada capacidade comercial exige a SUA permissao: montar a proposta nao e
 *     formaliza-la, e formalizar nao e decidir em nome do cliente.
 *  2. A permissao vale na UNIDADE DA ORDEM, nao na unidade ativa da sessao.
 *  3. Enviar e aprovar tambem exigem poder MOVER A OS — porque e isso que
 *     acontece de verdade quando alguem clica.
 */

let tenant: TenantFixture;
let ordemId: string;
let unidadeNorte: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

const TODAS_DE_ORCAMENTO: PermissionKey[] = [
  PERMISSIONS.QUOTES_VIEW,
  PERMISSIONS.QUOTES_CREATE,
  PERMISSIONS.QUOTES_UPDATE_DRAFT,
  PERMISSIONS.QUOTES_SEND,
  PERMISSIONS.QUOTES_APPROVE,
  PERMISSIONS.QUOTES_REJECT,
  PERMISSIONS.QUOTES_CANCEL,
];

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

async function abrirOrdem(context: TenantContext): Promise<string> {
  const customerId = (
    await run(() =>
      createCustomer(context, {
        kind: 'individual',
        name: 'Cliente',
        contacts: [
          {
            type: 'phone',
            value: `1197${Math.floor(1000000 + Math.random() * 8999999)}`,
            isWhatsapp: false,
          },
        ],
      }),
    )
  ).customerId;
  const equipmentId = (await run(() => createEquipment(context, { customerId, kind: 'Televisor' })))
    .equipmentId;
  return (
    await run(() => createServiceOrder(context, { equipmentId, customerReport: 'Nao liga.' }))
  ).serviceOrderId;
}

async function orcamentoPronto(): Promise<string> {
  const { quoteId } = await run(() => createQuote(tenant.context, { serviceOrderId: ordemId }));
  await run(() =>
    saveQuoteDraft(tenant.context, quoteId, {
      items: [{ kind: 'service', description: 'Bancada', quantity: '1', unitPrice: '100.00' }],
    }),
  );
  return quoteId;
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
  tenant = await createTenantFixture('orc-autz', planId);
  unidadeNorte = await createUnit(tenant.tenantId, 'Norte');
  ordemId = await abrirOrdem(tenant.context);
});

describe('cada capacidade exige a sua permissao (itens 70 e 71)', () => {
  it('quem so VE nao cria orcamento', async () => {
    const contexto = await usuarioCom(
      [PERMISSIONS.SERVICE_ORDERS_VIEW, PERMISSIONS.QUOTES_VIEW],
      tenant.unitId,
      'so-ve@orc.invalid',
    );

    await expect(run(() => createQuote(contexto, { serviceOrderId: ordemId }))).rejects.toThrow(
      AuthorizationError,
    );
  });

  it('quem MONTA a proposta nao a formaliza', async () => {
    const contexto = await usuarioCom(
      [
        PERMISSIONS.SERVICE_ORDERS_VIEW,
        PERMISSIONS.QUOTES_VIEW,
        PERMISSIONS.QUOTES_CREATE,
        PERMISSIONS.QUOTES_UPDATE_DRAFT,
      ],
      tenant.unitId,
      'monta@orc.invalid',
    );

    const { quoteId } = await run(() => createQuote(contexto, { serviceOrderId: ordemId }));
    await run(() =>
      saveQuoteDraft(contexto, quoteId, {
        items: [{ kind: 'service', description: 'Bancada', quantity: '1', unitPrice: '100.00' }],
      }),
    );

    await expect(run(() => sendQuote(contexto, quoteId))).rejects.toThrow(AuthorizationError);
    const [row] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
    expect(row!.status).toBe('draft');
  });

  it('quem formaliza nao decide em nome do cliente', async () => {
    const contexto = await usuarioCom(
      [
        PERMISSIONS.SERVICE_ORDERS_VIEW,
        PERMISSIONS.SERVICE_ORDERS_TRANSITION,
        PERMISSIONS.QUOTES_VIEW,
        PERMISSIONS.QUOTES_CREATE,
        PERMISSIONS.QUOTES_UPDATE_DRAFT,
        PERMISSIONS.QUOTES_SEND,
      ],
      tenant.unitId,
      'envia@orc.invalid',
    );

    const { quoteId } = await run(() => createQuote(contexto, { serviceOrderId: ordemId }));
    await run(() =>
      saveQuoteDraft(contexto, quoteId, {
        items: [{ kind: 'service', description: 'Bancada', quantity: '1', unitPrice: '100.00' }],
      }),
    );
    await run(() => sendQuote(contexto, quoteId));

    await expect(run(() => approveQuote(contexto, quoteId))).rejects.toThrow(AuthorizationError);
    await expect(
      run(() => rejectQuote(contexto, quoteId, { reason: 'Cliente recusou.' })),
    ).rejects.toThrow(AuthorizationError);
  });

  it('quem edita rascunho nao mexe em proposta enviada', async () => {
    const quoteId = await orcamentoPronto();
    await run(() => sendQuote(tenant.context, quoteId));

    const contexto = await usuarioCom(
      [PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_UPDATE_DRAFT],
      tenant.unitId,
      'edita@orc.invalid',
    );

    await expect(
      run(() =>
        saveQuoteDraft(contexto, quoteId, {
          items: [{ kind: 'service', description: 'x', quantity: '1', unitPrice: '1.00' }],
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('enviar e aprovar tambem exigem poder mover a OS (itens 18, 19 e 61)', () => {
  it('sem `service_orders.transition`, o envio e recusado e NADA e gravado', async () => {
    /**
     * Enviar o orcamento MOVE a Ordem de Servico. Quem nao pode conduzir o
     * atendimento nao pode provocar essa mudanca por um caminho lateral — e o
     * fato de a autorizacao acontecer no `planTransition`, antes de qualquer
     * gravacao, e o que garante que a recusa nao deixe meio caminho andado.
     */
    const contexto = await usuarioCom(
      [
        PERMISSIONS.SERVICE_ORDERS_VIEW,
        PERMISSIONS.QUOTES_VIEW,
        PERMISSIONS.QUOTES_CREATE,
        PERMISSIONS.QUOTES_UPDATE_DRAFT,
        PERMISSIONS.QUOTES_SEND,
      ],
      tenant.unitId,
      'sem-transicao@orc.invalid',
    );

    const { quoteId } = await run(() => createQuote(contexto, { serviceOrderId: ordemId }));
    await run(() =>
      saveQuoteDraft(contexto, quoteId, {
        items: [{ kind: 'service', description: 'Bancada', quantity: '1', unitPrice: '100.00' }],
      }),
    );

    await expect(run(() => sendQuote(contexto, quoteId))).rejects.toThrow(AuthorizationError);

    const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
    const [order] = await getDb()
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, ordemId))
      .limit(1);

    expect(quote!.status).toBe('draft');
    expect(order!.status).toBe('awaiting_technical_opinion');
  });
});

describe('a permissao vale na UNIDADE DA ORDEM (itens 72 e 73)', () => {
  it('papel concedido so na outra loja nao opera o orcamento desta', async () => {
    const quoteId = await orcamentoPronto();

    const userId = await createPlainUser(tenant.tenantId, 'duas@orc.invalid', 'Duas Lojas');
    await grantMembership(tenant.tenantId, userId, tenant.unitId);
    await grantMembership(tenant.tenantId, userId, unidadeNorte);

    const roleId = await createRoleWithPermissions(tenant.tenantId, 'papel-norte', [
      ...TODAS_DE_ORCAMENTO,
      PERMISSIONS.SERVICE_ORDERS_VIEW,
      PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    ]);
    await assignUnitRole(tenant.tenantId, userId, roleId, unidadeNorte);

    // Sessao com o NORTE ativo; a ordem e da unidade principal.
    const contexto = await contextFor(tenant.tenantId, userId, unidadeNorte);
    expect(contexto.activeUnitId).toBe(unidadeNorte);

    await expect(run(() => sendQuote(contexto, quoteId))).rejects.toThrow(AuthorizationError);
  });

  it('papel de nivel TENANT vale em qualquer unidade que a pessoa acesse', async () => {
    const quoteId = await orcamentoPronto();

    const userId = await createPlainUser(tenant.tenantId, 'tenant@orc.invalid', 'Tenant Wide');
    await grantMembership(tenant.tenantId, userId, tenant.unitId);
    await grantMembership(tenant.tenantId, userId, unidadeNorte);

    const roleId = await createRoleWithPermissions(tenant.tenantId, 'papel-tenant', [
      ...TODAS_DE_ORCAMENTO,
      PERMISSIONS.SERVICE_ORDERS_VIEW,
      PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    ]);
    await assignTenantRole(tenant.tenantId, userId, roleId);

    const contexto = await contextFor(tenant.tenantId, userId, unidadeNorte);
    await run(() => sendQuote(contexto, quoteId));

    const [row] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
    expect(row!.status).toBe('sent');
  });

  it('sem vinculo com a unidade, o orcamento sequer e encontrado (item 74)', async () => {
    const quoteId = await orcamentoPronto();

    const userId = await createPlainUser(tenant.tenantId, 'sem@orc.invalid', 'Sem Vinculo');
    await grantMembership(tenant.tenantId, userId, unidadeNorte);
    const roleId = await createRoleWithPermissions(tenant.tenantId, 'papel-amplo', [
      ...TODAS_DE_ORCAMENTO,
      PERMISSIONS.SERVICE_ORDERS_VIEW,
      PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    ]);
    await assignTenantRole(tenant.tenantId, userId, roleId);

    const contexto = await contextFor(tenant.tenantId, userId, unidadeNorte);

    // "Nao encontrado", nunca "sem permissao": a segunda confirmaria a existencia.
    await expect(run(() => sendQuote(contexto, quoteId))).rejects.toThrow(NotFoundError);
  });
});

describe('Effective Access (itens 75 e 79)', () => {
  it('Orcamentos e CORE e depende de Ordens de Servico', async () => {
    // Desligar deixaria OS paradas em Aguardando Aprovacao sem saida comercial.
    await expect(
      run(() =>
        setTenantFeature(tenant.context, { featureKey: FEATURES.CORE_QUOTES, enabled: false }),
      ),
    ).rejects.toThrow();

    const decisao = await can(tenant.context, {
      permission: PERMISSIONS.QUOTES_CREATE,
      featureKey: FEATURES.CORE_QUOTES,
      unitId: tenant.unitId,
    });
    expect(decisao.allowed).toBe(true);
  });

  it('a permissao NAO contorna feature indisponivel', async () => {
    const decisao = await can(tenant.context, {
      permission: PERMISSIONS.QUOTES_CREATE,
      featureKey: 'core.inexistente',
      unitId: tenant.unitId,
    });
    expect(decisao.allowed).toBe(false);
    expect(decisao.reason).toBe('FEATURE_UNAVAILABLE');
  });
});

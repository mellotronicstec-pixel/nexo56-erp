import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { AuthorizationError, NotFoundError } from '@/core/errors';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import {
  createFinancialAccount,
  ensureFinanceDefaults,
  listActivePaymentMethods,
} from '@/modules/finance/application/finance-settings-service';
import {
  cancelFinancialTitle,
  createFinancialTitle,
  listInstallmentsOfTitle,
  loadFinancialTitle,
} from '@/modules/finance/application/title-service';
import {
  reverseSettlement,
  settleFinancialTitle,
} from '@/modules/finance/application/settlement-service';
import { openCashSession, closeCashSession } from '@/modules/finance/application/cash-service';
import { listFinancialTitles } from '@/modules/finance/application/finance-queries';
import { financialMovements } from '@/modules/finance/infrastructure/schema';
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
 * RBAC DO FINANCEIRO (Prompt 12, itens 51, 52 e 61).
 *
 * O BACKEND E A AUTORIDADE. Todos os testes chamam os casos de uso
 * DIRETAMENTE, sem passar por tela nenhuma — e e assim que um atacante
 * chamaria.
 *
 * O ponto mais importante deste arquivo: `service_orders.view` NAO concede
 * `finance.view` (item 52). O tecnico ve a Ordem de Servico e nao ve o caixa,
 * a margem, as contas bancarias nem quanto a empresa paga aos fornecedores.
 */

let tenant: TenantFixture;
let contaId: string;
let metodoId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

let sequencial = 0;

async function usuarioCom(
  permissoes: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][],
  unitId = tenant.unitId,
) {
  sequencial += 1;
  const userId = await createPlainUser(tenant.tenantId, `fin-${sequencial}@rbac.invalid`);
  await grantMembership(tenant.tenantId, userId, unitId);
  const roleId = await createRoleWithPermissions(
    tenant.tenantId,
    `perfil-financeiro-${sequencial}`,
    permissoes,
  );
  await assignTenantRole(tenant.tenantId, userId, roleId);
  return { userId, contexto: await contextFor(tenant.tenantId, userId, unitId) };
}

async function cobranca(amount = '500.00') {
  sequencial += 1;
  const telefone = `11${String(900000000 + sequencial * 61)}`.slice(0, 11);
  const { customerId } = await run(() =>
    createCustomer(tenant.context, {
      kind: 'individual',
      name: `Cliente RBAC ${sequencial}`,
      contacts: [{ type: 'phone', value: telefone, isWhatsapp: false }],
    }),
  );

  const criado = await run(() =>
    createFinancialTitle(tenant.context, {
      unitId: tenant.unitId,
      direction: 'receivable',
      customerId,
      description: 'Cobranca de teste',
      amount,
      dueDate: '2026-10-15',
    }),
  );
  const parcelas = await run(() => listInstallmentsOfTitle(tenant.context, criado.titleId));
  return { ...criado, installmentId: parcelas[0]?.id ?? '' };
}

async function contaAPagar(amount = '500.00') {
  const criado = await run(() =>
    createFinancialTitle(tenant.context, {
      unitId: tenant.unitId,
      direction: 'payable',
      payeeName: 'Fornecedor RBAC',
      description: 'Despesa de teste',
      amount,
      dueDate: '2026-10-15',
    }),
  );
  const parcelas = await run(() => listInstallmentsOfTitle(tenant.context, criado.titleId));
  return { ...criado, installmentId: parcelas[0]?.id ?? '' };
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
  tenant = await createTenantFixture('rbac-fin', planId);
  await run(() =>
    setTenantFeature(tenant.context, { featureKey: FEATURES.FINANCE_CORE, enabled: true }),
  );
  await run(() => ensureFinanceDefaults(tenant.context));

  contaId = await run(() =>
    createFinancialAccount(tenant.context, { name: 'Banco RBAC', kind: 'bank' }),
  );
  const metodos = await run(() => listActivePaymentMethods(tenant.context));
  metodoId = metodos[0]?.id ?? '';
});

// ---------------------------------------------------------------------------
// Visibilidade financeira (item 52)
// ---------------------------------------------------------------------------

describe('financeiro nao vem de graca com a Ordem de Servico (item 52)', () => {
  it('quem ve OS NAO ve financeiro', async () => {
    const { contexto } = await usuarioCom([
      PERMISSIONS.SERVICE_ORDERS_VIEW,
      PERMISSIONS.CUSTOMERS_VIEW,
    ]);

    /**
     * A listagem devolve vazio — e nao a lista filtrada — porque a permissao
     * nem sequer existe para esta pessoa. Nao ha "ver menos": nao ha ver.
     */
    await expect(
      run(() =>
        createFinancialTitle(contexto, {
          unitId: tenant.unitId,
          direction: 'payable',
          payeeName: 'Qualquer',
          description: 'Tentativa',
          amount: '10.00',
          dueDate: '2026-10-15',
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('quem so consulta financeiro nao cria nem liquida nada', async () => {
    const { contexto } = await usuarioCom([PERMISSIONS.FINANCE_VIEW]);
    const titulo = await cobranca();

    const pagina = await run(() => listFinancialTitles(contexto, 'receivable', {}));
    expect(pagina.items.length).toBeGreaterThan(0);

    await expect(
      run(() =>
        createFinancialTitle(contexto, {
          unitId: tenant.unitId,
          direction: 'receivable',
          customerId: 'x',
          description: 'Tentativa',
          amount: '10.00',
          dueDate: '2026-10-15',
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      run(() =>
        settleFinancialTitle(contexto, titulo.titleId, {
          installmentId: titulo.installmentId,
          amount: '100.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

// ---------------------------------------------------------------------------
// Receber nao e pagar (item 51)
// ---------------------------------------------------------------------------

describe('receber e pagar sao capacidades diferentes (item 51)', () => {
  it('quem recebe do cliente NAO paga fornecedor', async () => {
    const { contexto } = await usuarioCom([PERMISSIONS.FINANCE_VIEW, PERMISSIONS.FINANCE_RECEIVE]);
    const receber = await cobranca();
    const pagar = await contaAPagar();

    await expect(
      run(() =>
        settleFinancialTitle(contexto, receber.titleId, {
          installmentId: receber.installmentId,
          amount: '100.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ).resolves.toMatchObject({ titleStatus: 'partially_settled' });

    await expect(
      run(() =>
        settleFinancialTitle(contexto, pagar.titleId, {
          installmentId: pagar.installmentId,
          amount: '100.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('quem paga fornecedor NAO recebe do cliente', async () => {
    const { contexto } = await usuarioCom([PERMISSIONS.FINANCE_VIEW, PERMISSIONS.FINANCE_PAY]);
    const receber = await cobranca();

    await expect(
      run(() =>
        settleFinancialTitle(contexto, receber.titleId, {
          installmentId: receber.installmentId,
          amount: '100.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('quem recebe NAO estorna: desfazer tem permissao propria', async () => {
    const { contexto } = await usuarioCom([PERMISSIONS.FINANCE_VIEW, PERMISSIONS.FINANCE_RECEIVE]);
    const titulo = await cobranca();

    const liquidacao = await run(() =>
      settleFinancialTitle(contexto, titulo.titleId, {
        installmentId: titulo.installmentId,
        amount: '500.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    await expect(
      run(() => reverseSettlement(contexto, liquidacao.settlementId, 'Tentativa de estorno.')),
    ).rejects.toBeInstanceOf(AuthorizationError);

    /** O estorno recusado nao deixou contramovimento. */
    const movimentos = await getDb()
      .select({ id: financialMovements.id })
      .from(financialMovements)
      .where(eq(financialMovements.financialAccountId, contaId));
    expect(movimentos).toHaveLength(1);
  });

  it('quem administra a receber NAO administra a pagar', async () => {
    const { contexto } = await usuarioCom([
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.FINANCE_RECEIVABLES_MANAGE,
    ]);

    await expect(
      run(() =>
        createFinancialTitle(contexto, {
          unitId: tenant.unitId,
          direction: 'payable',
          payeeName: 'Aluguel',
          description: 'Aluguel',
          amount: '1000.00',
          dueDate: '2026-10-05',
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('cancelar titulo exige a permissao de administrar daquela direcao', async () => {
    const { contexto } = await usuarioCom([PERMISSIONS.FINANCE_VIEW, PERMISSIONS.FINANCE_RECEIVE]);
    const titulo = await cobranca();

    await expect(
      run(() => cancelFinancialTitle(contexto, titulo.titleId, 'Tentativa de cancelamento.')),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

// ---------------------------------------------------------------------------
// Caixa (itens 23 a 26)
// ---------------------------------------------------------------------------

describe('caixa tem permissoes proprias', () => {
  it('quem abre o caixa nao necessariamente o fecha', async () => {
    const caixaId = await run(() =>
      createFinancialAccount(tenant.context, {
        name: 'Caixa balcao',
        kind: 'cash',
        unitId: tenant.unitId,
      }),
    );

    const abridor = await usuarioCom([PERMISSIONS.FINANCE_VIEW, PERMISSIONS.FINANCE_CASH_OPEN]);
    const sessao = await run(() =>
      openCashSession(abridor.contexto, { financialAccountId: caixaId, openingAmount: '100.00' }),
    );

    await expect(
      run(() => closeCashSession(abridor.contexto, sessao.sessionId, { countedAmount: '100.00' })),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const fechador = await usuarioCom([PERMISSIONS.FINANCE_VIEW, PERMISSIONS.FINANCE_CASH_CLOSE]);
    await expect(
      run(() => closeCashSession(fechador.contexto, sessao.sessionId, { countedAmount: '100.00' })),
    ).resolves.toMatchObject({ differenceAmount: '0.00' });
  });

  it('configurar o financeiro tem permissao propria', async () => {
    const { contexto } = await usuarioCom([PERMISSIONS.FINANCE_VIEW, PERMISSIONS.FINANCE_RECEIVE]);

    await expect(
      run(() => createFinancialAccount(contexto, { name: 'Conta pirata', kind: 'bank' })),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

// ---------------------------------------------------------------------------
// Unidade (item 97)
// ---------------------------------------------------------------------------

describe('a permissao vale na unidade em que foi concedida (item 97)', () => {
  it('receber na unidade Norte nao autoriza receber na principal', async () => {
    const norte = await createUnit(tenant.tenantId, 'Unidade Norte');
    await grantMembership(tenant.tenantId, tenant.adminUserId, norte);
    tenant.context = await contextFor(tenant.tenantId, tenant.adminUserId, tenant.unitId);

    sequencial += 1;
    const userId = await createPlainUser(tenant.tenantId, `norte-${sequencial}@rbac.invalid`);
    await grantMembership(tenant.tenantId, userId, norte);
    await grantMembership(tenant.tenantId, userId, tenant.unitId);
    const roleId = await createRoleWithPermissions(tenant.tenantId, `so-norte-${sequencial}`, [
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.FINANCE_RECEIVE,
    ]);
    /** Papel concedido SO na unidade Norte. */
    await assignUnitRole(tenant.tenantId, userId, roleId, norte);
    const contexto = await contextFor(tenant.tenantId, userId, norte);

    const titulo = await cobranca(); // unidade principal

    await expect(
      run(() =>
        settleFinancialTitle(contexto, titulo.titleId, {
          installmentId: titulo.installmentId,
          amount: '500.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('quem nao e membro da unidade do titulo nem sabe que ele existe', async () => {
    const norte = await createUnit(tenant.tenantId, 'Unidade Norte');
    await grantMembership(tenant.tenantId, tenant.adminUserId, norte);
    tenant.context = await contextFor(tenant.tenantId, tenant.adminUserId, tenant.unitId);

    const titulo = await cobranca(); // unidade principal

    sequencial += 1;
    const userId = await createPlainUser(tenant.tenantId, `alheio-${sequencial}@rbac.invalid`);
    await grantMembership(tenant.tenantId, userId, norte);
    const roleId = await createRoleWithPermissions(tenant.tenantId, `alheio-${sequencial}`, [
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.FINANCE_RECEIVE,
    ]);
    await assignTenantRole(tenant.tenantId, userId, roleId);
    const contexto = await contextFor(tenant.tenantId, userId, norte);

    /** NAO ENCONTRADO, e nao "sem permissao": um 403 confirmaria que existe. */
    await expect(run(() => loadFinancialTitle(contexto, titulo.titleId))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// Modulo desligado (itens 57 e 61)
// ---------------------------------------------------------------------------

describe('modulo desligado recusa mesmo quem tem a permissao (item 61)', () => {
  it('com o Financeiro desligado, nem o administrador cria titulo', async () => {
    await run(() =>
      setTenantFeature(tenant.context, { featureKey: FEATURES.FINANCE_CORE, enabled: false }),
    );

    await expect(
      run(() =>
        createFinancialTitle(tenant.context, {
          unitId: tenant.unitId,
          direction: 'payable',
          payeeName: 'Aluguel',
          description: 'Aluguel',
          amount: '1000.00',
          dueDate: '2026-10-05',
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('com o Financeiro desligado, titulo antigo tambem nao recebe', async () => {
    const titulo = await cobranca();

    await run(() =>
      setTenantFeature(tenant.context, { featureKey: FEATURES.FINANCE_CORE, enabled: false }),
    );

    await expect(
      run(() =>
        settleFinancialTitle(tenant.context, titulo.titleId, {
          installmentId: titulo.installmentId,
          amount: '500.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('com o Financeiro desligado, o dado permanece e volta ao reativar (itens 57 a 59)', async () => {
    const titulo = await cobranca();
    await run(() =>
      settleFinancialTitle(tenant.context, titulo.titleId, {
        installmentId: titulo.installmentId,
        amount: '200.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    await run(() =>
      setTenantFeature(tenant.context, { featureKey: FEATURES.FINANCE_CORE, enabled: false }),
    );

    /** O dado NAO foi apagado: ele continua no banco, so inalcancavel pela app. */
    const movimentos = await getDb()
      .select({ id: financialMovements.id })
      .from(financialMovements)
      .where(eq(financialMovements.financialAccountId, contaId));
    expect(movimentos).toHaveLength(1);

    await run(() =>
      setTenantFeature(tenant.context, { featureKey: FEATURES.FINANCE_CORE, enabled: true }),
    );

    /** Reativar NAO recria titulo nenhum: ele estava la o tempo todo. */
    const recuperado = await run(() => loadFinancialTitle(tenant.context, titulo.titleId));
    expect(recuperado.settledAmount).toBe('200.00');
    expect(recuperado.status).toBe('partially_settled');
  });
});

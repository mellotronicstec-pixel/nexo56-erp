import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import {
  createFinancialAccount,
  ensureFinanceDefaults,
  listActivePaymentMethods,
} from '@/modules/finance/application/finance-settings-service';
import {
  createFinancialTitle,
  listInstallmentsOfTitle,
  loadFinancialTitle,
} from '@/modules/finance/application/title-service';
import {
  reconcileAccountBalance,
  reverseSettlement,
  settleFinancialTitle,
} from '@/modules/finance/application/settlement-service';
import { closeCashSession, openCashSession } from '@/modules/finance/application/cash-service';
import {
  cashSessions,
  financialMovements,
  financialSettlements,
} from '@/modules/finance/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

/**
 * CONCORRENCIA E IDEMPOTENCIA DE VERDADE (Prompt 12, itens 43 a 45 e 94 a 95).
 *
 * Estes testes disputam O MESMO TITULO NO MESMO BANCO, em paralelo. Nao ha
 * mock, nao ha relogio falso, nao ha simulacao. Se a condicao sair do `WHERE`
 * do `UPDATE` um dia, e aqui que o projeto para.
 *
 * O item 117 e explicito: nao se declara "sem over-settlement" se duas
 * transacoes simultaneas puderem ultrapassar o saldo, nem "idempotente" sem
 * retry real, nem "concorrencia segura" sem MariaDB paralelo. Este arquivo e o
 * que autoriza essas tres frases no relatorio.
 */

let tenant: TenantFixture;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

let sequencial = 0;

function contar(resultados: PromiseSettledResult<unknown>[]): { ganhou: number; perdeu: number } {
  return {
    ganhou: resultados.filter((r) => r.status === 'fulfilled').length,
    perdeu: resultados.filter((r) => r.status === 'rejected').length,
  };
}

async function criarConta(kind = 'bank', unitId?: string): Promise<string> {
  sequencial += 1;
  return run(() =>
    createFinancialAccount(tenant.context, { name: `Conta ${sequencial}`, kind, unitId }),
  );
}

async function metodo(): Promise<string> {
  const metodos = await run(() => listActivePaymentMethods(tenant.context));
  return metodos[0]?.id ?? '';
}

/** Titulo a receber com uma parcela, pronto para a disputa. */
async function titulo(amount: string) {
  sequencial += 1;
  const telefone = `11${String(900000000 + sequencial * 53)}`.slice(0, 11);
  const { customerId } = await run(() =>
    createCustomer(tenant.context, {
      kind: 'individual',
      name: `Cliente da corrida ${sequencial}`,
      contacts: [{ type: 'phone', value: telefone, isWhatsapp: false }],
    }),
  );

  const criado = await run(() =>
    createFinancialTitle(tenant.context, {
      unitId: tenant.unitId,
      direction: 'receivable',
      customerId,
      description: 'Cobranca disputada',
      amount,
      dueDate: '2026-10-15',
    }),
  );

  const parcelas = await run(() => listInstallmentsOfTitle(tenant.context, criado.titleId));
  return { titleId: criado.titleId, installmentId: parcelas[0]?.id ?? '' };
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
  tenant = await createTenantFixture('corrida-fin', planId);
  await run(() =>
    setTenantFeature(tenant.context, { featureKey: FEATURES.FINANCE_CORE, enabled: true }),
  );
  await run(() => ensureFinanceDefaults(tenant.context));
});

// ---------------------------------------------------------------------------
// Item 95, caso A — liquidacao final concorrente
// ---------------------------------------------------------------------------

describe('caso A: duas transacoes recebendo os mesmos R$ 500', () => {
  it('somente uma vence, e o recebido termina em 500 e nao em 1.000', async () => {
    const contaId = await criarConta();
    const metodoId = await metodo();
    const { titleId, installmentId } = await titulo('500.00');

    const resultados = await Promise.allSettled([
      run(() =>
        settleFinancialTitle(tenant.context, titleId, {
          installmentId,
          amount: '500.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
      run(() =>
        settleFinancialTitle(tenant.context, titleId, {
          installmentId,
          amount: '500.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    const t = await run(() => loadFinancialTitle(tenant.context, titleId));
    expect(t.settledAmount).toBe('500.00');
    expect(t.status).toBe('settled');

    /** A perdedora nao deixou rastro: nem liquidacao, nem movimento. */
    const liquidacoes = await getDb()
      .select({ id: financialSettlements.id })
      .from(financialSettlements);
    expect(liquidacoes).toHaveLength(1);

    const movimentos = await getDb().select({ id: financialMovements.id }).from(financialMovements);
    expect(movimentos).toHaveLength(1);

    const reconciliacao = await run(() => reconcileAccountBalance(tenant.context, contaId));
    expect(reconciliacao.computed).toBe('500.00');
    expect(reconciliacao.matches).toBe(true);
  });

  it('cinco tentativas simultaneas de receber o titulo inteiro entregam uma so', async () => {
    const contaId = await criarConta();
    const metodoId = await metodo();
    const { titleId, installmentId } = await titulo('500.00');

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() =>
          settleFinancialTitle(tenant.context, titleId, {
            installmentId,
            amount: '500.00',
            financialAccountId: contaId,
            paymentMethodId: metodoId,
          }),
        ),
      ),
    );

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 4 });

    const t = await run(() => loadFinancialTitle(tenant.context, titleId));
    expect(t.settledAmount).toBe('500.00');
  });
});

// ---------------------------------------------------------------------------
// Item 95, caso B — duas parciais que somadas ultrapassam
// ---------------------------------------------------------------------------

describe('caso B: saldo R$ 1.000 e dois recebimentos de R$ 600 ao mesmo tempo', () => {
  it('o total NUNCA passa de R$ 1.000', async () => {
    const contaId = await criarConta();
    const metodoId = await metodo();
    const { titleId, installmentId } = await titulo('1000.00');

    const resultados = await Promise.allSettled([
      run(() =>
        settleFinancialTitle(tenant.context, titleId, {
          installmentId,
          amount: '600.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
      run(() =>
        settleFinancialTitle(tenant.context, titleId, {
          installmentId,
          amount: '600.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    const t = await run(() => loadFinancialTitle(tenant.context, titleId));
    expect(t.settledAmount).toBe('600.00');
    expect(Number(t.settledAmount)).toBeLessThanOrEqual(1000);
    expect(t.status).toBe('partially_settled');
  });

  it('quatro recebimentos de R$ 300 num titulo de R$ 1.000 entregam no maximo 900', async () => {
    const contaId = await criarConta();
    const metodoId = await metodo();
    const { titleId, installmentId } = await titulo('1000.00');

    const resultados = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        run(() =>
          settleFinancialTitle(tenant.context, titleId, {
            installmentId,
            amount: '300.00',
            financialAccountId: contaId,
            paymentMethodId: metodoId,
          }),
        ),
      ),
    );

    const { ganhou } = contar(resultados);
    expect(ganhou).toBeLessThanOrEqual(3);

    const t = await run(() => loadFinancialTitle(tenant.context, titleId));
    expect(Number(t.settledAmount)).toBe(ganhou * 300);
    expect(Number(t.settledAmount)).toBeLessThanOrEqual(1000);

    /** O saldo da conta bate com o ledger, aconteca o que acontecer. */
    const reconciliacao = await run(() => reconcileAccountBalance(tenant.context, contaId));
    expect(reconciliacao.matches).toBe(true);
  });

  it('pagamento tem a mesma trava: dois pagamentos de R$ 600 em R$ 1.000', async () => {
    const contaId = await criarConta();
    const metodoId = await metodo();

    const criado = await run(() =>
      createFinancialTitle(tenant.context, {
        unitId: tenant.unitId,
        direction: 'payable',
        payeeName: 'Fornecedor disputado',
        description: 'Conta a pagar disputada',
        amount: '1000.00',
        dueDate: '2026-10-15',
      }),
    );
    const parcelas = await run(() => listInstallmentsOfTitle(tenant.context, criado.titleId));
    const installmentId = parcelas[0]?.id ?? '';

    const resultados = await Promise.allSettled([
      run(() =>
        settleFinancialTitle(tenant.context, criado.titleId, {
          installmentId,
          amount: '600.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
      run(() =>
        settleFinancialTitle(tenant.context, criado.titleId, {
          installmentId,
          amount: '600.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    const t = await run(() => loadFinancialTitle(tenant.context, criado.titleId));
    expect(t.settledAmount).toBe('600.00');
  });
});

// ---------------------------------------------------------------------------
// Item 95, caso C — estorno concorrente
// ---------------------------------------------------------------------------

describe('caso C: duas pessoas estornando a mesma liquidacao', () => {
  it('somente um estorno vale, e ha UM contramovimento', async () => {
    const contaId = await criarConta();
    const metodoId = await metodo();
    const { titleId, installmentId } = await titulo('400.00');

    const liquidacao = await run(() =>
      settleFinancialTitle(tenant.context, titleId, {
        installmentId,
        amount: '400.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    const resultados = await Promise.allSettled([
      run(() => reverseSettlement(tenant.context, liquidacao.settlementId, 'Primeiro estorno.')),
      run(() => reverseSettlement(tenant.context, liquidacao.settlementId, 'Segundo estorno.')),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    /** Tres movimentos seriam o defeito: a entrada e DOIS contramovimentos. */
    const movimentos = await getDb()
      .select({
        direction: financialMovements.direction,
        reversalOf: financialMovements.reversalOfMovementId,
      })
      .from(financialMovements)
      .where(eq(financialMovements.financialAccountId, contaId));

    expect(movimentos).toHaveLength(2);
    expect(movimentos.filter((m) => m.reversalOf !== null)).toHaveLength(1);

    const t = await run(() => loadFinancialTitle(tenant.context, titleId));
    expect(t.settledAmount).toBe('0.00');
    expect(t.status).toBe('open');

    const reconciliacao = await run(() => reconcileAccountBalance(tenant.context, contaId));
    expect(reconciliacao.computed).toBe('0.00');
    expect(reconciliacao.matches).toBe(true);
  });

  it('cinco tentativas simultaneas de estorno produzem um efeito so', async () => {
    const contaId = await criarConta();
    const metodoId = await metodo();
    const { titleId, installmentId } = await titulo('400.00');

    const liquidacao = await run(() =>
      settleFinancialTitle(tenant.context, titleId, {
        installmentId,
        amount: '400.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() =>
          reverseSettlement(tenant.context, liquidacao.settlementId, 'Estorno concorrente.'),
        ),
      ),
    );

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 4 });

    const movimentos = await getDb()
      .select({ id: financialMovements.id })
      .from(financialMovements)
      .where(eq(financialMovements.financialAccountId, contaId));
    expect(movimentos).toHaveLength(2);

    void titleId;
  });
});

// ---------------------------------------------------------------------------
// Item 95, caso D — abertura de caixa concorrente
// ---------------------------------------------------------------------------

describe('caso D: duas tentativas de abrir o mesmo caixa', () => {
  it('somente uma sessao existe', async () => {
    const caixaId = await criarConta('cash', tenant.unitId);

    const resultados = await Promise.allSettled([
      run(() =>
        openCashSession(tenant.context, { financialAccountId: caixaId, openingAmount: '100.00' }),
      ),
      run(() =>
        openCashSession(tenant.context, { financialAccountId: caixaId, openingAmount: '100.00' }),
      ),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });

    const sessoes = await getDb()
      .select({ id: cashSessions.id, status: cashSessions.status })
      .from(cashSessions)
      .where(eq(cashSessions.financialAccountId, caixaId));

    expect(sessoes).toHaveLength(1);
    expect(sessoes[0]?.status).toBe('open');
  });

  it('cinco aberturas simultaneas ainda produzem uma sessao', async () => {
    const caixaId = await criarConta('cash', tenant.unitId);

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() => openCashSession(tenant.context, { financialAccountId: caixaId })),
      ),
    );

    const sessoes = await getDb()
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(eq(cashSessions.financialAccountId, caixaId));

    expect(sessoes).toHaveLength(1);
  });

  it('depois de fechar, o caixa aceita uma nova sessao', async () => {
    const caixaId = await criarConta('cash', tenant.unitId);

    const primeira = await run(() =>
      openCashSession(tenant.context, { financialAccountId: caixaId, openingAmount: '50.00' }),
    );
    await run(() =>
      closeCashSession(tenant.context, primeira.sessionId, { countedAmount: '50.00' }),
    );

    await expect(
      run(() => openCashSession(tenant.context, { financialAccountId: caixaId })),
    ).resolves.toMatchObject({ sessionId: expect.any(String) });

    const sessoes = await getDb()
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(eq(cashSessions.financialAccountId, caixaId));
    expect(sessoes).toHaveLength(2);
  });

  it('dois fechamentos simultaneos: so um vence', async () => {
    const caixaId = await criarConta('cash', tenant.unitId);
    const sessao = await run(() =>
      openCashSession(tenant.context, { financialAccountId: caixaId, openingAmount: '100.00' }),
    );

    const resultados = await Promise.allSettled([
      run(() => closeCashSession(tenant.context, sessao.sessionId, { countedAmount: '100.00' })),
      run(() => closeCashSession(tenant.context, sessao.sessionId, { countedAmount: '100.00' })),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 1, perdeu: 1 });
  });
});

// ---------------------------------------------------------------------------
// Item 94 — idempotencia sequencial e simultanea
// ---------------------------------------------------------------------------

describe('idempotencia sob concorrencia (item 94)', () => {
  it('cinco chamadas SIMULTANEAS com a mesma chave produzem um efeito so', async () => {
    const contaId = await criarConta();
    const metodoId = await metodo();
    const { titleId, installmentId } = await titulo('1000.00');
    const chave = 'duplo-clique-do-balcao';

    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        run(() =>
          settleFinancialTitle(tenant.context, titleId, {
            installmentId,
            amount: '400.00',
            financialAccountId: contaId,
            paymentMethodId: metodoId,
            idempotencyKey: chave,
          }),
        ),
      ),
    );

    const liquidacoes = await getDb()
      .select({ id: financialSettlements.id })
      .from(financialSettlements);
    expect(liquidacoes).toHaveLength(1);

    const movimentos = await getDb().select({ id: financialMovements.id }).from(financialMovements);
    expect(movimentos).toHaveLength(1);

    const t = await run(() => loadFinancialTitle(tenant.context, titleId));
    expect(t.settledAmount).toBe('400.00');

    const reconciliacao = await run(() => reconcileAccountBalance(tenant.context, contaId));
    expect(reconciliacao.matches).toBe(true);
  });

  it('a mesma chave dez vezes SEQUENCIAIS produz um efeito so', async () => {
    const contaId = await criarConta();
    const metodoId = await metodo();
    const { titleId, installmentId } = await titulo('1000.00');
    const chave = 'retry-de-rede';

    for (let tentativa = 0; tentativa < 10; tentativa += 1) {
      await run(() =>
        settleFinancialTitle(tenant.context, titleId, {
          installmentId,
          amount: '250.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
          idempotencyKey: chave,
        }),
      );
    }

    const t = await run(() => loadFinancialTitle(tenant.context, titleId));
    expect(t.settledAmount).toBe('250.00');

    const movimentos = await getDb().select({ id: financialMovements.id }).from(financialMovements);
    expect(movimentos).toHaveLength(1);
  });

  it('o mesmo vale para pagamento', async () => {
    const contaId = await criarConta();
    const metodoId = await metodo();

    const criado = await run(() =>
      createFinancialTitle(tenant.context, {
        unitId: tenant.unitId,
        direction: 'payable',
        payeeName: 'Fornecedor do retry',
        description: 'Pagamento repetido',
        amount: '800.00',
        dueDate: '2026-10-15',
      }),
    );
    const parcelas = await run(() => listInstallmentsOfTitle(tenant.context, criado.titleId));

    for (let tentativa = 0; tentativa < 10; tentativa += 1) {
      await run(() =>
        settleFinancialTitle(tenant.context, criado.titleId, {
          installmentId: parcelas[0]?.id ?? '',
          amount: '300.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
          idempotencyKey: 'pagamento-repetido',
        }),
      );
    }

    const t = await run(() => loadFinancialTitle(tenant.context, criado.titleId));
    expect(t.settledAmount).toBe('300.00');

    const reconciliacao = await run(() => reconcileAccountBalance(tenant.context, contaId));
    expect(reconciliacao.computed).toBe('-300.00');
    expect(reconciliacao.matches).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Parcelas diferentes ao mesmo tempo
// ---------------------------------------------------------------------------

describe('duas pessoas recebendo PARCELAS diferentes do mesmo titulo', () => {
  it('as duas entram, e o titulo termina liquidado', async () => {
    const contaId = await criarConta();
    const metodoId = await metodo();

    sequencial += 1;
    const telefone = `11${String(900000000 + sequencial * 59)}`.slice(0, 11);
    const { customerId } = await run(() =>
      createCustomer(tenant.context, {
        kind: 'individual',
        name: 'Cliente das parcelas',
        contacts: [{ type: 'phone', value: telefone, isWhatsapp: false }],
      }),
    );

    const criado = await run(() =>
      createFinancialTitle(tenant.context, {
        unitId: tenant.unitId,
        direction: 'receivable',
        customerId,
        description: 'Cobranca em duas parcelas',
        amount: '600.00',
        dueDate: '2026-10-15',
        installmentCount: 2,
      }),
    );
    const parcelas = await run(() => listInstallmentsOfTitle(tenant.context, criado.titleId));

    const resultados = await Promise.allSettled([
      run(() =>
        settleFinancialTitle(tenant.context, criado.titleId, {
          installmentId: parcelas[0]?.id ?? '',
          amount: '300.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
      run(() =>
        settleFinancialTitle(tenant.context, criado.titleId, {
          installmentId: parcelas[1]?.id ?? '',
          amount: '300.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ]);

    expect(contar(resultados)).toEqual({ ganhou: 2, perdeu: 0 });

    const t = await run(() => loadFinancialTitle(tenant.context, criado.titleId));
    expect(t.settledAmount).toBe('600.00');
    expect(t.status).toBe('settled');

    const reconciliacao = await run(() => reconcileAccountBalance(tenant.context, contaId));
    expect(reconciliacao.computed).toBe('600.00');
    expect(reconciliacao.matches).toBe(true);
  });
});

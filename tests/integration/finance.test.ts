import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { runWithContext } from '@/core/context/request-context';
import { getDb } from '@/core/db/client';
import { BusinessRuleError, NotFoundError, ValidationError } from '@/core/errors';
import { Money } from '@/core/money/money';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import {
  createFinancialAccount,
  ensureFinanceDefaults,
  listAccountsForUnit,
  listActiveCategories,
  listActivePaymentMethods,
} from '@/modules/finance/application/finance-settings-service';
import { nextTitleStatus } from '@/modules/finance/domain/finance';
import {
  cancelFinancialTitle,
  createFinancialTitle,
  listInstallmentsOfTitle,
  loadFinancialTitle,
  reconcileTitle,
} from '@/modules/finance/application/title-service';
import {
  reconcileAccountBalance,
  reverseSettlement,
  settleFinancialTitle,
} from '@/modules/finance/application/settlement-service';
import { createExpense } from '@/modules/finance/application/finance-integration-service';
import {
  financialMovements,
  financialSettlements,
  financialTitles,
} from '@/modules/finance/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  contextFor,
  createTenantFixture,
  createUnit,
  grantMembership,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/**
 * FINANCEIRO — CICLO COMPLETO (Prompt 12, itens 91, 96 e 97).
 *
 * O eixo destes testes: uma obrigacao nao e dinheiro, dinheiro so se move por
 * liquidacao, liquidacao nunca ultrapassa o saldo, e nada disso atravessa a
 * fronteira da empresa nem da unidade.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let planId: string;

const run = <T>(work: () => Promise<T>) => runWithContext({ origin: 'test' }, work);

let sequencial = 0;

async function habilitarFinanceiro(fixture: TenantFixture): Promise<void> {
  await run(() =>
    setTenantFeature(fixture.context, { featureKey: FEATURES.FINANCE_CORE, enabled: true }),
  );
  await run(() => ensureFinanceDefaults(fixture.context));
}

async function criarCliente(fixture: TenantFixture, contexto = fixture.context): Promise<string> {
  sequencial += 1;
  const telefone = `11${String(900000000 + sequencial * 47)}`.slice(0, 11);
  const { customerId } = await run(() =>
    createCustomer(contexto, {
      kind: 'individual',
      name: `Cliente financeiro ${sequencial}`,
      contacts: [{ type: 'phone', value: telefone, isWhatsapp: false }],
    }),
  );
  return customerId;
}

async function criarConta(
  fixture: TenantFixture,
  overrides: { name?: string; kind?: string; unitId?: string } = {},
): Promise<string> {
  sequencial += 1;
  return run(() =>
    createFinancialAccount(fixture.context, {
      name: overrides.name ?? `Conta ${sequencial}`,
      kind: overrides.kind ?? 'bank',
      unitId: overrides.unitId,
    }),
  );
}

async function primeiraFormaDePagamento(fixture: TenantFixture): Promise<string> {
  const metodos = await run(() => listActivePaymentMethods(fixture.context));
  return metodos[0]?.id ?? '';
}

/** Titulo a receber pronto para liquidar, com o numero de parcelas pedido. */
async function cobranca(
  fixture: TenantFixture,
  options: { amount?: string; installments?: number; customerId?: string; unitId?: string } = {},
) {
  const customerId = options.customerId ?? (await criarCliente(fixture));
  const criado = await run(() =>
    createFinancialTitle(fixture.context, {
      unitId: options.unitId ?? fixture.unitId,
      direction: 'receivable',
      customerId,
      description: 'Conserto de televisor',
      amount: options.amount ?? '1000.00',
      dueDate: '2026-10-15',
      installmentCount: options.installments ?? 1,
    }),
  );
  const parcelas = await run(() => listInstallmentsOfTitle(fixture.context, criado.titleId));
  return { ...criado, customerId, installments: parcelas };
}

beforeAll(async () => {
  await migrateTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  planId = await seedCatalog();
  tenantA = await createTenantFixture('fin-a', planId);
  tenantB = await createTenantFixture('fin-b', planId);
  await habilitarFinanceiro(tenantA);
  await habilitarFinanceiro(tenantB);
});

// ---------------------------------------------------------------------------
// Configuracao (itens 16 a 19 e 28)
// ---------------------------------------------------------------------------

describe('configuracao do financeiro', () => {
  it('conta financeira e forma de pagamento sao coisas diferentes (item 16)', async () => {
    const metodos = await run(() => listActivePaymentMethods(tenantA.context));
    const contaId = await criarConta(tenantA, { name: 'Banco Itau', kind: 'bank' });

    /** "PIX" e uma forma; "Banco Itau" e onde o dinheiro fica. */
    expect(metodos.some((m) => m.kind === 'pix')).toBe(true);
    expect(contaId).toBeTruthy();

    const colunas = (await getDb().execute(
      sql`SELECT column_name AS name FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'payment_methods'`,
    )) as unknown as Array<Array<{ name: string }>>;
    const nomes = (colunas[0] ?? []).map((linha) => linha.name);

    /** Forma de pagamento nao tem saldo: quem tem saldo e a conta. */
    expect(nomes).not.toContain('current_balance');
  });

  it('a conta nasce com saldo zero: saldo inicial entra pelo ledger (item 18)', async () => {
    const contaId = await criarConta(tenantA);
    const reconciliacao = await run(() => reconcileAccountBalance(tenantA.context, contaId));

    expect(reconciliacao.stored).toBe('0.00');
    expect(reconciliacao.computed).toBe('0.00');
    expect(reconciliacao.matches).toBe(true);
  });

  it('categorias padrao existem, separadas por receita e despesa (item 28)', async () => {
    const receitas = await run(() => listActiveCategories(tenantA.context, 'revenue'));
    const despesas = await run(() => listActiveCategories(tenantA.context, 'expense'));

    expect(receitas.length).toBeGreaterThan(0);
    expect(despesas.length).toBeGreaterThan(0);
    expect(receitas.every((c) => c.kind === 'revenue')).toBe(true);
  });

  it('categoria de despesa nao entra em conta a receber (item 28)', async () => {
    const despesas = await run(() => listActiveCategories(tenantA.context, 'expense'));
    const customerId = await criarCliente(tenantA);

    await expect(
      run(() =>
        createFinancialTitle(tenantA.context, {
          unitId: tenantA.unitId,
          direction: 'receivable',
          customerId,
          description: 'Cobranca com categoria errada',
          categoryId: despesas[0]?.id,
          amount: '100.00',
          dueDate: '2026-10-15',
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('conta de outra empresa nao aparece nem por id (item 96)', async () => {
    const contaB = await criarConta(tenantB);
    const contas = await run(() => listAccountsForUnit(tenantA.context, tenantA.unitId));
    expect(contas.map((c) => c.id)).not.toContain(contaB);
  });
});

// ---------------------------------------------------------------------------
// Titulos e parcelamento (itens 6, 7 e 9)
// ---------------------------------------------------------------------------

describe('criacao de titulos', () => {
  it('conta a receber exige cliente (item 8)', async () => {
    await expect(
      run(() =>
        createFinancialTitle(tenantA.context, {
          unitId: tenantA.unitId,
          direction: 'receivable',
          description: 'Sem cliente',
          amount: '100.00',
          dueDate: '2026-10-15',
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('conta a pagar aceita beneficiario sem cadastro (item 7)', async () => {
    const criado = await run(() =>
      createFinancialTitle(tenantA.context, {
        unitId: tenantA.unitId,
        direction: 'payable',
        payeeName: 'Companhia de energia',
        description: 'Energia eletrica de setembro',
        amount: '480.00',
        dueDate: '2026-10-10',
      }),
    );

    expect(criado.formattedNumber).toMatch(/^CP \d{6}$/);

    const titulo = await run(() => loadFinancialTitle(tenantA.context, criado.titleId));
    expect(titulo.supplierId).toBeNull();
  });

  it('valor zero ou negativo e recusado (item 6)', async () => {
    const customerId = await criarCliente(tenantA);

    for (const amount of ['0.00', '-50.00']) {
      await expect(
        run(() =>
          createFinancialTitle(tenantA.context, {
            unitId: tenantA.unitId,
            direction: 'receivable',
            customerId,
            description: 'Valor invalido',
            amount,
            dueDate: '2026-10-15',
          }),
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('R$ 900 em 3 parcelas gera 3 vencimentos que somam exatamente 900 (item 9)', async () => {
    const criado = await cobranca(tenantA, { amount: '900.00', installments: 3 });

    expect(criado.installments).toHaveLength(3);
    expect(criado.installments.map((p) => p.amount)).toEqual(['300.00', '300.00', '300.00']);
    expect(criado.installments.map((p) => p.dueDate)).toEqual([
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
    ]);
  });

  it('R$ 100 em 3 parcelas nao vira 99,99 nem 100,02 (item 9)', async () => {
    const criado = await cobranca(tenantA, { amount: '100.00', installments: 3 });

    const soma = criado.installments.reduce(
      (total, parcela) => total + Number(parcela.amount.replace('.', '')),
      0,
    );
    expect(soma).toBe(10000);
    expect(criado.installments.map((p) => p.amount)).toEqual(['33.34', '33.33', '33.33']);
  });

  it('a vista tambem tem parcela: 1/1, e nao um caso especial', async () => {
    const criado = await cobranca(tenantA, { amount: '149.90' });
    expect(criado.installments).toHaveLength(1);
    expect(criado.installments[0]?.number).toBe(1);
  });

  it('a numeracao e por empresa e por direcao (item 47)', async () => {
    const a = await cobranca(tenantA, { amount: '10.00' });
    const b = await cobranca(tenantB, { amount: '10.00' });

    expect(a.number).toBe(1);
    expect(b.number).toBe(1);

    const pagar = await run(() =>
      createFinancialTitle(tenantA.context, {
        unitId: tenantA.unitId,
        direction: 'payable',
        payeeName: 'Aluguel',
        description: 'Aluguel',
        amount: '2000.00',
        dueDate: '2026-10-05',
      }),
    );
    /** A receber e a pagar tem sequencias proprias: as duas comecam do 1. */
    expect(pagar.number).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// O ciclo do item 91
// ---------------------------------------------------------------------------

describe('ciclo completo a receber (item 91)', () => {
  it('R$ 1.000 -> recebe 400 -> aberto 600 -> recebe 600 -> aberto zero', async () => {
    const contaId = await criarConta(tenantA, { name: 'Banco', kind: 'bank' });
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '1000.00' });
    const parcelaId = criado.installments[0]?.id ?? '';

    const primeira = await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: parcelaId,
        amount: '400.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
        effectiveDate: '2026-09-20',
      }),
    );

    expect(primeira.titleStatus).toBe('partially_settled');
    expect(primeira.outstanding).toBe('600.00');
    expect(primeira.titleFullySettled).toBe(false);

    const segunda = await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: parcelaId,
        amount: '600.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
        effectiveDate: '2026-09-21',
      }),
    );

    expect(segunda.titleStatus).toBe('settled');
    expect(segunda.outstanding).toBe('0.00');
    expect(segunda.titleFullySettled).toBe(true);

    /** DUAS entradas no ledger, e o saldo da conta bate com elas. */
    const movimentos = await getDb()
      .select({ direction: financialMovements.direction, amount: financialMovements.amount })
      .from(financialMovements)
      .where(eq(financialMovements.financialAccountId, contaId));

    expect(movimentos).toHaveLength(2);
    expect(movimentos.every((m) => m.direction === 'inflow')).toBe(true);

    const reconciliacao = await run(() => reconcileAccountBalance(tenantA.context, contaId));
    expect(reconciliacao.computed).toBe('1000.00');
    expect(reconciliacao.matches).toBe(true);
  });
});

describe('ciclo completo a pagar (item 91)', () => {
  it('R$ 750 -> paga 250 -> aberto 500 -> paga 500 -> aberto zero, com duas saidas', async () => {
    const contaId = await criarConta(tenantA, { name: 'Banco pagamentos', kind: 'bank' });
    const metodoId = await primeiraFormaDePagamento(tenantA);

    const criado = await run(() =>
      createFinancialTitle(tenantA.context, {
        unitId: tenantA.unitId,
        direction: 'payable',
        payeeName: 'Fornecedor avulso',
        description: 'Compra de material',
        amount: '750.00',
        dueDate: '2026-10-20',
      }),
    );
    const parcelas = await run(() => listInstallmentsOfTitle(tenantA.context, criado.titleId));
    const parcelaId = parcelas[0]?.id ?? '';

    const primeira = await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: parcelaId,
        amount: '250.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );
    expect(primeira.outstanding).toBe('500.00');

    const segunda = await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: parcelaId,
        amount: '500.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );
    expect(segunda.outstanding).toBe('0.00');
    expect(segunda.titleStatus).toBe('settled');

    const movimentos = await getDb()
      .select({ direction: financialMovements.direction })
      .from(financialMovements)
      .where(eq(financialMovements.financialAccountId, contaId));

    expect(movimentos).toHaveLength(2);
    expect(movimentos.every((m) => m.direction === 'outflow')).toBe(true);

    /** Pagar tira dinheiro da conta: o saldo fica negativo se nao havia nada. */
    const reconciliacao = await run(() => reconcileAccountBalance(tenantA.context, contaId));
    expect(reconciliacao.computed).toBe('-750.00');
    expect(reconciliacao.matches).toBe(true);
  });
});

describe('a situacao sai da aritmetica, e a aritmetica e a do dominio', () => {
  /**
   * Estes testes existem por causa de um defeito real encontrado no Prompt 12.
   *
   * O `CASE` do `UPDATE` somava o valor duas vezes, porque o MySQL avalia as
   * atribuicoes da esquerda para a direita ja com os valores novos. Um titulo
   * de R$ 1.000 que recebia R$ 600 era classificado como LIQUIDADO. O caminho
   * feliz (receber tudo de uma vez) escondia o erro; so o pagamento parcial o
   * revelava.
   */
  it('receber 600 de 1.000 deixa o titulo PARCIAL, e nao liquidado', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '1000.00' });

    const resultado = await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: criado.installments[0]?.id ?? '',
        amount: '600.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    expect(resultado.titleStatus).toBe('partially_settled');
    expect(resultado.titleFullySettled).toBe(false);
    expect(resultado.outstanding).toBe('400.00');

    const parcelas = await run(() => listInstallmentsOfTitle(tenantA.context, criado.titleId));
    expect(parcelas[0]?.status).toBe('partially_settled');
    expect(parcelas[0]?.settledAmount).toBe('600.00');
  });

  it('a situacao gravada concorda com `nextTitleStatus()` do dominio', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);

    for (const [valor, esperado] of [
      ['1.00', 'partially_settled'],
      ['999.99', 'partially_settled'],
      ['1000.00', 'settled'],
    ] as const) {
      const criado = await cobranca(tenantA, { amount: '1000.00' });
      await run(() =>
        settleFinancialTitle(tenantA.context, criado.titleId, {
          installmentId: criado.installments[0]?.id ?? '',
          amount: valor,
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      );

      const titulo = await run(() => loadFinancialTitle(tenantA.context, criado.titleId));
      expect(titulo.status).toBe(esperado);

      /** A mesma resposta que o dominio daria, sem banco nenhum. */
      expect(
        nextTitleStatus(
          { amount: Money.parse(titulo.amount), settledAmount: Money.parse(titulo.settledAmount) },
          'open',
        ),
      ).toBe(esperado);
    }
  });

  it('estorno parcial deixa o titulo PARCIAL, e nao aberto', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '1000.00' });
    const parcelaId = criado.installments[0]?.id ?? '';

    await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: parcelaId,
        amount: '400.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );
    const segunda = await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: parcelaId,
        amount: '300.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    /** Estorna SO a segunda: sobram R$ 400 recebidos de R$ 1.000. */
    const estorno = await run(() =>
      reverseSettlement(
        tenantA.context,
        segunda.settlementId,
        'Segundo recebimento nao compensou.',
      ),
    );

    expect(estorno.titleStatus).toBe('partially_settled');
    expect(estorno.outstanding).toBe('600.00');

    const parcelas = await run(() => listInstallmentsOfTitle(tenantA.context, criado.titleId));
    expect(parcelas[0]?.settledAmount).toBe('400.00');
    expect(parcelas[0]?.status).toBe('partially_settled');
  });
});

// ---------------------------------------------------------------------------
// Over-settlement (item 12)
// ---------------------------------------------------------------------------

describe('over-settlement e bloqueado (item 12)', () => {
  it('titulo de R$ 500 nao recebe R$ 600', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '500.00' });

    await expect(
      run(() =>
        settleFinancialTitle(tenantA.context, criado.titleId, {
          installmentId: criado.installments[0]?.id ?? '',
          amount: '600.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    /** A recusa nao deixou rastro: nem movimento, nem liquidacao. */
    const movimentos = await getDb().select({ id: financialMovements.id }).from(financialMovements);
    expect(movimentos).toHaveLength(0);

    const titulo = await run(() => loadFinancialTitle(tenantA.context, criado.titleId));
    expect(titulo.settledAmount).toBe('0.00');
  });

  it('depois de receber 400 de 1000, receber 700 e recusado', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '1000.00' });
    const parcelaId = criado.installments[0]?.id ?? '';

    await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: parcelaId,
        amount: '400.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    await expect(
      run(() =>
        settleFinancialTitle(tenantA.context, criado.titleId, {
          installmentId: parcelaId,
          amount: '700.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('valor zero e recusado', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '100.00' });

    await expect(
      run(() =>
        settleFinancialTitle(tenantA.context, criado.titleId, {
          installmentId: criado.installments[0]?.id ?? '',
          amount: '0.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('o banco tambem recusa: a CHECK impede settled_amount maior que amount', async () => {
    const criado = await cobranca(tenantA, { amount: '100.00' });

    await expect(
      getDb().execute(sql`
        UPDATE financial_titles SET settled_amount = '200.00' WHERE id = ${criado.titleId}
      `),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Idempotencia (item 42)
// ---------------------------------------------------------------------------

describe('idempotencia da liquidacao (item 42)', () => {
  it('a mesma chave de comando dez vezes produz UM unico efeito', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '1000.00' });
    const chave = 'recebimento-do-balcao-2026-09-20';

    const respostas = [];
    for (let tentativa = 0; tentativa < 10; tentativa += 1) {
      respostas.push(
        await run(() =>
          settleFinancialTitle(tenantA.context, criado.titleId, {
            installmentId: criado.installments[0]?.id ?? '',
            amount: '400.00',
            financialAccountId: contaId,
            paymentMethodId: metodoId,
            idempotencyKey: chave,
          }),
        ),
      );
    }

    const ids = new Set(respostas.map((r) => r.settlementId));
    expect(ids.size).toBe(1);
    expect(respostas.filter((r) => r.reused)).toHaveLength(9);

    const liquidacoes = await getDb()
      .select({ id: financialSettlements.id })
      .from(financialSettlements);
    expect(liquidacoes).toHaveLength(1);

    const movimentos = await getDb().select({ id: financialMovements.id }).from(financialMovements);
    expect(movimentos).toHaveLength(1);

    const titulo = await run(() => loadFinancialTitle(tenantA.context, criado.titleId));
    expect(titulo.settledAmount).toBe('400.00');
  });

  it('chaves diferentes sao recebimentos diferentes, e ambos entram', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '1000.00' });
    const parcelaId = criado.installments[0]?.id ?? '';

    await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: parcelaId,
        amount: '400.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
        idempotencyKey: 'primeira',
      }),
    );
    await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: parcelaId,
        amount: '600.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
        idempotencyKey: 'segunda',
      }),
    );

    const titulo = await run(() => loadFinancialTitle(tenantA.context, criado.titleId));
    expect(titulo.settledAmount).toBe('1000.00');
    expect(titulo.status).toBe('settled');
  });
});

// ---------------------------------------------------------------------------
// Estorno (item 41)
// ---------------------------------------------------------------------------

describe('estorno cria contramovimento, nunca apaga (item 41)', () => {
  it('estornar devolve o saldo em aberto e deixa os dois movimentos no ledger', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '1000.00' });

    const liquidacao = await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: criado.installments[0]?.id ?? '',
        amount: '400.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    const estorno = await run(() =>
      reverseSettlement(
        tenantA.context,
        liquidacao.settlementId,
        'Cliente pediu o dinheiro de volta.',
      ),
    );

    expect(estorno.outstanding).toBe('1000.00');
    expect(estorno.titleStatus).toBe('open');

    /** A liquidacao CONTINUA la, marcada como estornada. */
    const [original] = await getDb()
      .select({ status: financialSettlements.status, amount: financialSettlements.amount })
      .from(financialSettlements)
      .where(eq(financialSettlements.id, liquidacao.settlementId));

    expect(original?.status).toBe('reversed');
    expect(original?.amount).toBe('400.00');

    /** DOIS movimentos: a entrada e o contramovimento de saida. */
    const movimentos = await getDb()
      .select({
        direction: financialMovements.direction,
        reversalOf: financialMovements.reversalOfMovementId,
      })
      .from(financialMovements)
      .where(eq(financialMovements.financialAccountId, contaId));

    expect(movimentos).toHaveLength(2);
    expect(movimentos.filter((m) => m.direction === 'inflow')).toHaveLength(1);
    expect(movimentos.filter((m) => m.direction === 'outflow')).toHaveLength(1);
    expect(movimentos.filter((m) => m.reversalOf !== null)).toHaveLength(1);

    /** O saldo da conta volta a zero, e continua reconciliavel. */
    const reconciliacao = await run(() => reconcileAccountBalance(tenantA.context, contaId));
    expect(reconciliacao.computed).toBe('0.00');
    expect(reconciliacao.matches).toBe(true);
  });

  it('estorno exige motivo com substancia', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '100.00' });
    const liquidacao = await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: criado.installments[0]?.id ?? '',
        amount: '100.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    await expect(
      run(() => reverseSettlement(tenantA.context, liquidacao.settlementId, 'ops')),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('estornar duas vezes a mesma liquidacao e recusado', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '100.00' });
    const liquidacao = await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: criado.installments[0]?.id ?? '',
        amount: '100.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    await run(() =>
      reverseSettlement(tenantA.context, liquidacao.settlementId, 'Primeiro estorno legitimo.'),
    );

    await expect(
      run(() => reverseSettlement(tenantA.context, liquidacao.settlementId, 'Segunda tentativa.')),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('depois do estorno o titulo volta a aceitar recebimento', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '100.00' });
    const parcelaId = criado.installments[0]?.id ?? '';

    const liquidacao = await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: parcelaId,
        amount: '100.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );
    await run(() =>
      reverseSettlement(tenantA.context, liquidacao.settlementId, 'Pagamento nao compensou.'),
    );

    const nova = await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: parcelaId,
        amount: '100.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    expect(nova.titleStatus).toBe('settled');
    expect(nova.outstanding).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// Cancelamento (item 72)
// ---------------------------------------------------------------------------

describe('cancelamento de titulo (item 72)', () => {
  it('titulo sem liquidacao cancela com motivo', async () => {
    const criado = await cobranca(tenantA, { amount: '300.00' });
    await run(() =>
      cancelFinancialTitle(tenantA.context, criado.titleId, 'Cliente desistiu do conserto.'),
    );

    const titulo = await run(() => loadFinancialTitle(tenantA.context, criado.titleId));
    expect(titulo.status).toBe('cancelled');
  });

  it('titulo com liquidacao NAO cancela: exige estornar antes', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '1000.00' });

    await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: criado.installments[0]?.id ?? '',
        amount: '400.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    await expect(
      run(() => cancelFinancialTitle(tenantA.context, criado.titleId, 'Tentativa de cancelar.')),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('titulo cancelado nao aceita mais liquidacao', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '300.00' });
    await run(() => cancelFinancialTitle(tenantA.context, criado.titleId, 'Nao havera cobranca.'));

    await expect(
      run(() =>
        settleFinancialTitle(tenantA.context, criado.titleId, {
          installmentId: criado.installments[0]?.id ?? '',
          amount: '300.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

// ---------------------------------------------------------------------------
// Reconciliacao (item 105)
// ---------------------------------------------------------------------------

describe('reconciliacao interna (item 105)', () => {
  it('o titulo bate com a soma das liquidacoes confirmadas', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '900.00', installments: 3 });

    await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: criado.installments[0]?.id ?? '',
        amount: '300.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    const reconciliacao = await run(() => reconcileTitle(tenantA.context, criado.titleId));
    expect(reconciliacao.matches).toBe(true);
    expect(reconciliacao.computed).toBe('300.00');
    expect(reconciliacao.outstanding).toBe('600.00');
  });

  it('a liquidacao estornada NAO conta na reconciliacao', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '500.00' });

    const liquidacao = await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: criado.installments[0]?.id ?? '',
        amount: '500.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );
    await run(() =>
      reverseSettlement(tenantA.context, liquidacao.settlementId, 'Estorno por engano do caixa.'),
    );

    const reconciliacao = await run(() => reconcileTitle(tenantA.context, criado.titleId));
    expect(reconciliacao.computed).toBe('0.00');
    expect(reconciliacao.matches).toBe(true);
  });

  it('a divergencia e DETECTADA, e nao corrigida em silencio', async () => {
    const contaId = await criarConta(tenantA);
    const criado = await cobranca(tenantA, { amount: '500.00' });

    /** Corrompe a projecao de proposito, por SQL direto. */
    await getDb().execute(sql`
      UPDATE financial_titles SET settled_amount = '100.00' WHERE id = ${criado.titleId}
    `);

    const reconciliacao = await run(() => reconcileTitle(tenantA.context, criado.titleId));
    expect(reconciliacao.matches).toBe(false);
    expect(reconciliacao.stored).toBe('100.00');
    expect(reconciliacao.computed).toBe('0.00');

    /** Consultar de novo NAO conserta: a divergencia continua visivel. */
    const denovo = await run(() => reconcileTitle(tenantA.context, criado.titleId));
    expect(denovo.matches).toBe(false);

    void contaId;
  });
});

// ---------------------------------------------------------------------------
// Fronteira de empresa e de unidade (itens 96 e 97)
// ---------------------------------------------------------------------------

describe('isolamento de empresa (item 96)', () => {
  it('titulo de outra empresa nao existe para quem consulta', async () => {
    const criado = await cobranca(tenantB, { amount: '100.00' });
    await expect(
      run(() => loadFinancialTitle(tenantA.context, criado.titleId)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('titulo de outra empresa nao pode ser liquidado daqui', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantB, { amount: '100.00' });

    await expect(
      run(() =>
        settleFinancialTitle(tenantA.context, criado.titleId, {
          installmentId: criado.installments[0]?.id ?? '',
          amount: '100.00',
          financialAccountId: contaId,
          paymentMethodId: metodoId,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('conta financeira de outra empresa nao recebe liquidacao daqui', async () => {
    const contaB = await criarConta(tenantB);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '100.00' });

    await expect(
      run(() =>
        settleFinancialTitle(tenantA.context, criado.titleId, {
          installmentId: criado.installments[0]?.id ?? '',
          amount: '100.00',
          financialAccountId: contaB,
          paymentMethodId: metodoId,
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('cliente de outra empresa nao entra em titulo daqui', async () => {
    const clienteB = await criarCliente(tenantB);

    await expect(
      run(() =>
        createFinancialTitle(tenantA.context, {
          unitId: tenantA.unitId,
          direction: 'receivable',
          customerId: clienteB,
          description: 'Cobranca invalida',
          amount: '100.00',
          dueDate: '2026-10-15',
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('estorno de liquidacao de outra empresa e recusado', async () => {
    const contaB = await criarConta(tenantB);
    const metodoB = await primeiraFormaDePagamento(tenantB);
    const criado = await cobranca(tenantB, { amount: '100.00' });
    const liquidacao = await run(() =>
      settleFinancialTitle(tenantB.context, criado.titleId, {
        installmentId: criado.installments[0]?.id ?? '',
        amount: '100.00',
        financialAccountId: contaB,
        paymentMethodId: metodoB,
      }),
    );

    await expect(
      run(() => reverseSettlement(tenantA.context, liquidacao.settlementId, 'Tentativa indevida.')),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('isolamento de unidade (item 97)', () => {
  it('a conta de uma unidade nao recebe liquidacao de titulo de outra', async () => {
    const norte = await createUnit(tenantA.tenantId, 'Unidade Norte');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, norte);
    tenantA.context = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    /** Caixa da loja Norte: conta amarrada aquela unidade. */
    const caixaNorte = await criarConta(tenantA, {
      name: 'Caixa Norte',
      kind: 'cash',
      unitId: norte,
    });
    const metodoId = await primeiraFormaDePagamento(tenantA);

    /** Titulo da unidade principal. */
    const criado = await cobranca(tenantA, { amount: '100.00' });

    await expect(
      run(() =>
        settleFinancialTitle(tenantA.context, criado.titleId, {
          installmentId: criado.installments[0]?.id ?? '',
          amount: '100.00',
          financialAccountId: caixaNorte,
          paymentMethodId: metodoId,
        }),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('a conta da EMPRESA serve a qualquer unidade', async () => {
    const norte = await createUnit(tenantA.tenantId, 'Unidade Norte');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, norte);
    tenantA.context = await contextFor(tenantA.tenantId, tenantA.adminUserId, tenantA.unitId);

    /** Conta bancaria sem unidade: e da empresa inteira. */
    const banco = await criarConta(tenantA, { name: 'Banco da empresa', kind: 'bank' });
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '100.00', unitId: norte });

    await expect(
      run(() =>
        settleFinancialTitle(tenantA.context, criado.titleId, {
          installmentId: criado.installments[0]?.id ?? '',
          amount: '100.00',
          financialAccountId: banco,
          paymentMethodId: metodoId,
        }),
      ),
    ).resolves.toMatchObject({ titleStatus: 'settled' });
  });

  it('quem so enxerga a unidade Norte nao carrega titulo da principal', async () => {
    const norte = await createUnit(tenantA.tenantId, 'Unidade Norte');
    await grantMembership(tenantA.tenantId, tenantA.adminUserId, norte);
    const soNorte = await contextFor(tenantA.tenantId, tenantA.adminUserId, norte);
    const restrito = { ...soNorte, authorizedUnitIds: [norte], activeUnitId: norte };

    const criado = await cobranca(tenantA, { amount: '100.00' });

    await expect(run(() => loadFinancialTitle(restrito, criado.titleId))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// Despesas (item 27)
// ---------------------------------------------------------------------------

describe('despesa avulsa (item 27)', () => {
  it('aluguel sem fornecedor cadastrado vira conta a pagar', async () => {
    const despesas = await run(() => listActiveCategories(tenantA.context, 'expense'));

    const criado = await run(() =>
      createExpense(tenantA.context, {
        unitId: tenantA.unitId,
        payeeName: 'Imobiliaria Central',
        description: 'Aluguel de setembro',
        categoryId: despesas.find((c) => c.name === 'Aluguel')?.id,
        amount: '2500.00',
        dueDate: '2026-10-05',
      }),
    );

    const titulo = await run(() => loadFinancialTitle(tenantA.context, criado.titleId));
    expect(titulo.direction).toBe('payable');
    expect(titulo.supplierId).toBeNull();
    expect(titulo.origin).toBe('manual');
  });

  it('despesa paga na hora ainda deixa o titulo registrado', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);

    const criado = await run(() =>
      createExpense(tenantA.context, {
        unitId: tenantA.unitId,
        payeeName: 'Motoboy',
        description: 'Entrega urgente',
        amount: '35.00',
        dueDate: '2026-09-20',
      }),
    );
    const parcelas = await run(() => listInstallmentsOfTitle(tenantA.context, criado.titleId));

    await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: parcelas[0]?.id ?? '',
        amount: '35.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );

    const titulo = await run(() => loadFinancialTitle(tenantA.context, criado.titleId));
    /** O titulo continua existindo: uma despesa paga ainda e uma despesa. */
    expect(titulo.status).toBe('settled');
  });

  it('duas contas de energia no mesmo mes sao dois fatos legitimos (item 38)', async () => {
    for (let i = 0; i < 2; i += 1) {
      await run(() =>
        createExpense(tenantA.context, {
          unitId: tenantA.unitId,
          payeeName: 'Companhia de energia',
          description: 'Energia eletrica',
          amount: '400.00',
          dueDate: '2026-10-10',
        }),
      );
    }

    const titulos = await getDb()
      .select({ id: financialTitles.id })
      .from(financialTitles)
      .where(
        and(eq(financialTitles.tenantId, tenantA.tenantId), eq(financialTitles.origin, 'manual')),
      );

    expect(titulos).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Auditoria e eventos (itens 48 e 50)
// ---------------------------------------------------------------------------

describe('rastreabilidade (itens 48 e 50)', () => {
  it('criar, receber e estornar deixam auditoria e evento', async () => {
    const contaId = await criarConta(tenantA);
    const metodoId = await primeiraFormaDePagamento(tenantA);
    const criado = await cobranca(tenantA, { amount: '100.00' });

    const liquidacao = await run(() =>
      settleFinancialTitle(tenantA.context, criado.titleId, {
        installmentId: criado.installments[0]?.id ?? '',
        amount: '100.00',
        financialAccountId: contaId,
        paymentMethodId: metodoId,
      }),
    );
    await run(() =>
      reverseSettlement(tenantA.context, liquidacao.settlementId, 'Estorno para o teste.'),
    );

    const acoes = (
      await getDb()
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.tenantId, tenantA.tenantId))
    ).map((linha) => linha.action);

    expect(acoes).toContain('financial_title.created');
    expect(acoes).toContain('financial_settlement.created');
    expect(acoes).toContain('financial_settlement.reversed');

    const tipos = (
      await getDb()
        .select({ type: domainEvents.type })
        .from(domainEvents)
        .where(eq(domainEvents.tenantId, tenantA.tenantId))
    ).map((linha) => linha.type);

    expect(tipos).toContain('RECEIVABLE_CREATED');
    expect(tipos).toContain('CUSTOMER_PAYMENT_RECEIVED');
    expect(tipos).toContain('FINANCIAL_SETTLEMENT_REVERSED');
  });

  it('o payload do evento nao carrega dado pessoal (item 109)', async () => {
    await cobranca(tenantA, { amount: '100.00' });

    const [evento] = await getDb()
      .select({ payload: domainEvents.payload })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.tenantId, tenantA.tenantId),
          eq(domainEvents.type, 'RECEIVABLE_CREATED'),
        ),
      );

    const texto = JSON.stringify(evento?.payload ?? {});
    expect(texto).not.toContain('Cliente financeiro');
    expect(texto).not.toContain('@');
  });
});

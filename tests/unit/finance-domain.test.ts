import { describe, expect, it } from 'vitest';
import { Money, sumMoney } from '@/core/money/money';
import {
  applyToBalance,
  canSettle,
  cashDifference,
  categoryMatchesDirection,
  counterpartyMatchesDirection,
  expectedCashAmount,
  formatTitleNumber,
  INSTALLMENTS_MAX,
  installmentsSumExactly,
  isTitleOverdue,
  isTitleSettleable,
  monthlyDueDates,
  movementDirectionFor,
  nextTitleStatus,
  normalizeReason,
  oppositeDirection,
  originKeyFor,
  outstandingOf,
  planInstallments,
  SETTLEMENT_NOUN,
  SETTLEMENT_PAST,
  SETTLEMENT_VERB,
  splitAmountIntoInstallments,
  supportsCardInstallments,
  supportsCashSession,
  titleStatusLabel,
} from '@/modules/finance/domain/finance';

/**
 * DOMINIO FINANCEIRO (Prompt 12, item 90).
 *
 * O que estes testes travam: a soma das parcelas e EXATAMENTE o total, vencido
 * e derivado e nao estado, receber mais do que se deve e impossivel, e a
 * direcao do movimento sai do titulo e nunca do formulario.
 */

// ---------------------------------------------------------------------------
// Parcelamento (item 9)
// ---------------------------------------------------------------------------

describe('parcelamento e centavos residuais (item 9)', () => {
  it('R$ 100 em 3 parcelas soma exatamente R$ 100', () => {
    const total = Money.parse('100.00');
    const parcelas = splitAmountIntoInstallments(total, 3);

    expect(parcelas.map((p) => p.toString())).toEqual(['33.34', '33.33', '33.33']);
    expect(sumMoney(parcelas).toString()).toBe('100.00');
    expect(installmentsSumExactly(parcelas, total)).toBe(true);
  });

  it('nunca produz 99,99 nem 100,02 — o caso que o item 9 cita', () => {
    const total = Money.parse('100.00');
    const soma = sumMoney(splitAmountIntoInstallments(total, 3));

    expect(soma.toString()).not.toBe('99.99');
    expect(soma.toString()).not.toBe('100.02');
  });

  it('a sobra vai para as PRIMEIRAS parcelas, sempre', () => {
    // 10,00 / 4 = 2,50 exato: sem sobra, todas iguais.
    expect(splitAmountIntoInstallments(Money.parse('10.00'), 4).map((p) => p.toString())).toEqual([
      '2.50',
      '2.50',
      '2.50',
      '2.50',
    ]);

    // 10,00 / 3 = 3,34 + 3,33 + 3,33: um centavo de sobra, na primeira.
    expect(splitAmountIntoInstallments(Money.parse('10.00'), 3).map((p) => p.toString())).toEqual([
      '3.34',
      '3.33',
      '3.33',
    ]);

    // 10,00 / 7 = 1000 centavos / 7 = 142, resto 6. Seis parcelas levam o
    // centavo extra, e a ultima fica com o valor cheio da divisao.
    const sete = splitAmountIntoInstallments(Money.parse('10.00'), 7);
    expect(sete.map((p) => p.toString())).toEqual([
      '1.43',
      '1.43',
      '1.43',
      '1.43',
      '1.43',
      '1.43',
      '1.42',
    ]);
    expect(sumMoney(sete).toString()).toBe('10.00');
  });

  it('a soma bate para qualquer valor e qualquer numero de parcelas', () => {
    const valores = ['0.03', '1.00', '9.99', '100.00', '333.33', '1000.01', '99999.97'];

    for (const valor of valores) {
      const total = Money.parse(valor);
      for (let n = 1; n <= 12; n += 1) {
        if (total.toCents() < BigInt(n)) continue;
        const parcelas = splitAmountIntoInstallments(total, n);
        expect(sumMoney(parcelas).toString()).toBe(total.toString());
        // Nenhuma parcela pode ser zero ou negativa.
        expect(parcelas.every((p) => p.isPositive())).toBe(true);
      }
    }
  });

  it('recusa dividir quando a parcela ficaria abaixo de um centavo', () => {
    // R$ 0,02 em 3 parcelas nao existe: alguma ficaria com zero.
    expect(() => splitAmountIntoInstallments(Money.parse('0.02'), 3)).toThrow(RangeError);
  });

  it('recusa zero, negativo e numero de parcelas fora do limite', () => {
    expect(() => splitAmountIntoInstallments(Money.zero(), 1)).toThrow(RangeError);
    expect(() => splitAmountIntoInstallments(Money.parse('10.00'), 0)).toThrow(RangeError);
    expect(() => splitAmountIntoInstallments(Money.parse('10.00'), INSTALLMENTS_MAX + 1)).toThrow(
      RangeError,
    );
  });
});

describe('vencimentos mensais', () => {
  it('tres parcelas a partir de 15/09 vencem 15/09, 15/10 e 15/11', () => {
    expect(monthlyDueDates('2026-09-15', 3)).toEqual(['2026-09-15', '2026-10-15', '2026-11-15']);
  });

  it('atravessa o ano corretamente', () => {
    expect(monthlyDueDates('2026-11-10', 4)).toEqual([
      '2026-11-10',
      '2026-12-10',
      '2027-01-10',
      '2027-02-10',
    ]);
  });

  it('dia 31 cai no ultimo dia do mes que nao o tem, sem "andar" depois', () => {
    // Fevereiro nao tem 31; marco tem. O dia original e preservado como
    // referencia, entao a terceira parcela volta para 31 — e nao fica em 28.
    expect(monthlyDueDates('2026-01-31', 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('respeita ano bissexto', () => {
    expect(monthlyDueDates('2028-01-31', 2)).toEqual(['2028-01-31', '2028-02-29']);
  });
});

describe('plano completo de parcelas', () => {
  it('o exemplo do item 92: R$ 900 em 3x de R$ 300', () => {
    const plano = planInstallments(Money.parse('900.00'), 3, '2026-09-15');

    expect(plano).toEqual([
      { number: 1, amount: Money.parse('300.00'), dueDate: '2026-09-15' },
      { number: 2, amount: Money.parse('300.00'), dueDate: '2026-10-15' },
      { number: 3, amount: Money.parse('300.00'), dueDate: '2026-11-15' },
    ]);
  });

  it('a vista e uma parcela de 1/1, e nao um caso especial', () => {
    const plano = planInstallments(Money.parse('149.90'), 1, '2026-09-15');
    expect(plano).toHaveLength(1);
    expect(plano[0]?.amount.toString()).toBe('149.90');
  });
});

// ---------------------------------------------------------------------------
// Aritmetica do titulo (itens 11 e 12)
// ---------------------------------------------------------------------------

describe('saldo em aberto e pagamento parcial (item 11)', () => {
  it('o exemplo do item 11: R$ 1.000, recebe R$ 400, restam R$ 600', () => {
    const snapshot = { amount: Money.parse('1000.00'), settledAmount: Money.parse('400.00') };
    expect(outstandingOf(snapshot).toString()).toBe('600.00');
    expect(nextTitleStatus(snapshot, 'open')).toBe('partially_settled');
  });

  it('depois de receber os R$ 600, o saldo zera e o titulo fica liquidado', () => {
    const snapshot = { amount: Money.parse('1000.00'), settledAmount: Money.parse('1000.00') };
    expect(outstandingOf(snapshot).toString()).toBe('0.00');
    expect(nextTitleStatus(snapshot, 'partially_settled')).toBe('settled');
  });

  it('titulo intocado continua aberto', () => {
    const snapshot = { amount: Money.parse('500.00'), settledAmount: Money.zero() };
    expect(nextTitleStatus(snapshot, 'open')).toBe('open');
  });

  it('cancelado permanece cancelado, mesmo com a aritmetica dizendo outra coisa', () => {
    const snapshot = { amount: Money.parse('500.00'), settledAmount: Money.parse('500.00') };
    expect(nextTitleStatus(snapshot, 'cancelled')).toBe('cancelled');
  });
});

describe('over-settlement e proibido (item 12)', () => {
  it('titulo de R$ 500 nao recebe R$ 600', () => {
    const snapshot = { amount: Money.parse('500.00'), settledAmount: Money.zero() };
    expect(canSettle(snapshot, Money.parse('600.00'))).toBe(false);
    expect(canSettle(snapshot, Money.parse('500.00'))).toBe(true);
  });

  it('com R$ 400 ja recebidos de R$ 1.000, R$ 700 e recusado e R$ 600 passa', () => {
    const snapshot = { amount: Money.parse('1000.00'), settledAmount: Money.parse('400.00') };
    expect(canSettle(snapshot, Money.parse('700.00'))).toBe(false);
    expect(canSettle(snapshot, Money.parse('600.00'))).toBe(true);
  });

  it('valor zero ou negativo nunca liquida', () => {
    const snapshot = { amount: Money.parse('500.00'), settledAmount: Money.zero() };
    expect(canSettle(snapshot, Money.zero())).toBe(false);
    expect(canSettle(snapshot, Money.parse('-10.00'))).toBe(false);
  });

  it('o saldo em aberto nunca fica negativo', () => {
    const snapshot = { amount: Money.parse('100.00'), settledAmount: Money.parse('150.00') };
    expect(outstandingOf(snapshot).toString()).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// Vencido derivado (item 10)
// ---------------------------------------------------------------------------

describe('vencido e derivado, nunca estado (item 10)', () => {
  const agora = new Date('2026-09-20T15:00:00Z');
  const fuso = 'America/Sao_Paulo';

  it('aberto, com saldo e vencimento no passado = vencido', () => {
    expect(
      isTitleOverdue(
        { status: 'open', dueDate: '2026-09-15', outstanding: Money.parse('300.00') },
        fuso,
        agora,
      ),
    ).toBe(true);
  });

  it('vencimento no futuro nao e vencido', () => {
    expect(
      isTitleOverdue(
        { status: 'open', dueDate: '2026-10-15', outstanding: Money.parse('300.00') },
        fuso,
        agora,
      ),
    ).toBe(false);
  });

  it('liquidado nunca e vencido, mesmo com vencimento antigo', () => {
    expect(
      isTitleOverdue(
        { status: 'settled', dueDate: '2026-01-15', outstanding: Money.zero() },
        fuso,
        agora,
      ),
    ).toBe(false);
  });

  it('cancelado nunca e vencido', () => {
    expect(
      isTitleOverdue(
        { status: 'cancelled', dueDate: '2026-01-15', outstanding: Money.parse('300.00') },
        fuso,
        agora,
      ),
    ).toBe(false);
  });

  it('sem saldo em aberto nao ha o que vencer', () => {
    expect(
      isTitleOverdue(
        { status: 'partially_settled', dueDate: '2026-01-15', outstanding: Money.zero() },
        fuso,
        agora,
      ),
    ).toBe(false);
  });

  it('"overdue" NAO existe como situacao persistida', async () => {
    const dominio = await import('@/modules/finance/domain/finance');
    expect(dominio.TITLE_STATUSES).not.toContain('overdue');
  });
});

// ---------------------------------------------------------------------------
// Direcao (itens 3 e 15)
// ---------------------------------------------------------------------------

describe('direcao do movimento (item 15)', () => {
  it('receber e entrada; pagar e saida', () => {
    expect(movementDirectionFor('receivable')).toBe('inflow');
    expect(movementDirectionFor('payable')).toBe('outflow');
  });

  it('o contrario de entrada e saida — e e isso que o estorno usa', () => {
    expect(oppositeDirection('inflow')).toBe('outflow');
    expect(oppositeDirection('outflow')).toBe('inflow');
  });

  it('entrada soma ao saldo, saida subtrai', () => {
    const saldo = Money.parse('1000.00');
    expect(applyToBalance(saldo, 'inflow', Money.parse('150.00')).toString()).toBe('1150.00');
    expect(applyToBalance(saldo, 'outflow', Money.parse('150.00')).toString()).toBe('850.00');
  });

  it('o saldo pode ficar negativo — e a conferencia precisa enxergar isso', () => {
    expect(applyToBalance(Money.parse('50.00'), 'outflow', Money.parse('80.00')).toString()).toBe(
      '-30.00',
    );
  });
});

describe('contraparte combina com a direcao (item 8)', () => {
  it('conta a receber e de cliente', () => {
    expect(counterpartyMatchesDirection('receivable', 'customer')).toBe(true);
    expect(counterpartyMatchesDirection('receivable', 'supplier')).toBe(false);
    expect(counterpartyMatchesDirection('receivable', 'other')).toBe(false);
  });

  it('conta a pagar e de fornecedor ou de beneficiario avulso', () => {
    expect(counterpartyMatchesDirection('payable', 'supplier')).toBe(true);
    expect(counterpartyMatchesDirection('payable', 'other')).toBe(true);
    expect(counterpartyMatchesDirection('payable', 'customer')).toBe(false);
  });
});

describe('categoria combina com a direcao (item 28)', () => {
  it('receita para receber, despesa para pagar', () => {
    expect(categoryMatchesDirection('revenue', 'receivable')).toBe(true);
    expect(categoryMatchesDirection('expense', 'receivable')).toBe(false);
    expect(categoryMatchesDirection('expense', 'payable')).toBe(true);
    expect(categoryMatchesDirection('revenue', 'payable')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rotulos e vocabulario (item 3)
// ---------------------------------------------------------------------------

describe('vocabulario: receber e pagar nao sao a mesma palavra (item 3)', () => {
  it('o rotulo de liquidado muda com a direcao', () => {
    expect(titleStatusLabel('settled', 'receivable')).toBe('Recebido');
    expect(titleStatusLabel('settled', 'payable')).toBe('Pago');
  });

  it('o parcial tambem', () => {
    expect(titleStatusLabel('partially_settled', 'receivable')).toBe('Recebido em parte');
    expect(titleStatusLabel('partially_settled', 'payable')).toBe('Pago em parte');
  });

  it('numeracao humana por direcao', () => {
    expect(formatTitleNumber('receivable', 123)).toBe('CR 000123');
    expect(formatTitleNumber('payable', 45)).toBe('CP 000045');
  });
});

// ---------------------------------------------------------------------------
// Chave de origem (item 38)
// ---------------------------------------------------------------------------

describe('chave de origem impede duplicar (item 38)', () => {
  it('OS e recebimento de compra tem chave; manual nao tem', () => {
    expect(originKeyFor('service_order', 'os-1')).toBe('service_order:os-1');
    expect(originKeyFor('purchase_receipt', 'rec-1')).toBe('purchase_receipt:rec-1');
    expect(originKeyFor('manual', 'qualquer')).toBeNull();
  });

  it('titulo manual sem chave permite duas contas de luz no mesmo mes', () => {
    // Duas despesas iguais sao dois fatos legitimos: travar isso transformaria
    // uma protecao em obstaculo.
    expect(originKeyFor('manual', 'a')).toBeNull();
    expect(originKeyFor('manual', 'b')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Caixa (itens 23 a 25)
// ---------------------------------------------------------------------------

describe('fechamento de caixa (item 25)', () => {
  it('o esperado e abertura mais entradas menos saidas', () => {
    expect(
      expectedCashAmount({
        openingAmount: Money.parse('100.00'),
        inflow: Money.parse('500.00'),
        outflow: Money.parse('150.00'),
      }).toString(),
    ).toBe('450.00');
  });

  it('sobra na gaveta produz diferenca positiva', () => {
    expect(
      cashDifference({
        openingAmount: Money.zero(),
        inflow: Money.parse('500.00'),
        outflow: Money.parse('100.00'),
        countedAmount: Money.parse('410.00'),
      }).toString(),
    ).toBe('10.00');
  });

  it('falta na gaveta produz diferenca negativa — e ela nao desaparece', () => {
    expect(
      cashDifference({
        openingAmount: Money.zero(),
        inflow: Money.parse('500.00'),
        outflow: Money.parse('100.00'),
        countedAmount: Money.parse('380.00'),
      }).toString(),
    ).toBe('-20.00');
  });

  it('caixa confere quando a contagem bate', () => {
    expect(
      cashDifference({
        openingAmount: Money.zero(),
        inflow: Money.parse('400.00'),
        outflow: Money.zero(),
        countedAmount: Money.parse('400.00'),
      }).isZero(),
    ).toBe(true);
  });

  it('so conta do tipo caixa abre sessao', () => {
    expect(supportsCashSession('cash')).toBe(true);
    expect(supportsCashSession('bank')).toBe(false);
    expect(supportsCashSession('digital_wallet')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Formas de pagamento (item 20)
// ---------------------------------------------------------------------------

describe('formas de pagamento (item 20)', () => {
  it('so cartao de credito registra parcelas de cartao', () => {
    expect(supportsCardInstallments('credit_card')).toBe(true);
    expect(supportsCardInstallments('debit_card')).toBe(false);
    expect(supportsCardInstallments('pix')).toBe(false);
    expect(supportsCardInstallments('cash')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Situacao liquidavel
// ---------------------------------------------------------------------------

describe('o que ainda aceita liquidacao', () => {
  it('aberto e parcial aceitam; liquidado e cancelado nao', () => {
    expect(isTitleSettleable('open')).toBe(true);
    expect(isTitleSettleable('partially_settled')).toBe(true);
    expect(isTitleSettleable('settled')).toBe(false);
    expect(isTitleSettleable('cancelled')).toBe(false);
  });
});

describe('motivos exigem substancia', () => {
  it('motivo curto demais e recusado', () => {
    expect(() => normalizeReason('ok', 5, 300, 'O motivo')).toThrow(RangeError);
  });

  it('espacos em excesso sao normalizados', () => {
    expect(normalizeReason('  cliente    desistiu  ', 5, 300, 'O motivo')).toBe('cliente desistiu');
  });
});

describe('vocabulario da liquidacao (item 62)', () => {
  it('o verbo serve para frase; o substantivo, para rotulo de acao', () => {
    // "Receber um titulo exige a permissao ..." — frase, precisa do verbo.
    expect(SETTLEMENT_VERB.receivable).toBe('Receber');
    expect(SETTLEMENT_VERB.payable).toBe('Pagar');

    /**
     * REGRESSAO: o botao usava o verbo em minuscula e dizia "Registrar
     * receber". O que se registra e um recebimento — e um rotulo em portugues
     * torto faz a pessoa reler a tela para ter certeza do que o botao faz.
     */
    expect(SETTLEMENT_NOUN.receivable).toBe('recebimento');
    expect(SETTLEMENT_NOUN.payable).toBe('pagamento');

    expect(`Registrar ${SETTLEMENT_NOUN.receivable}`).toBe('Registrar recebimento');
    expect(`Registrar ${SETTLEMENT_NOUN.payable}`).toBe('Registrar pagamento');
  });

  it('o particpio nomeia a coluna do que ja aconteceu', () => {
    expect(SETTLEMENT_PAST.receivable).toBe('Recebido');
    expect(SETTLEMENT_PAST.payable).toBe('Pago');
  });
});

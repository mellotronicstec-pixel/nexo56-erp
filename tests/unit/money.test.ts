import { describe, expect, it } from 'vitest';
import { Money, sumMoney } from '@/core/money/money';

/** DINHEIRO (Prompt 00 item 45; Prompt 02 itens 19 a 21). */

describe('o problema que esta classe existe para evitar', () => {
  it('ponto flutuante erra onde Money acerta', () => {
    // A armadilha classica:
    expect(0.1 + 0.2).not.toBe(0.3);

    const exact = Money.parse('0.10').add(Money.parse('0.20'));
    expect(exact.toString()).toBe('0.30');
  });

  it('somar centavos mil vezes nao acumula erro', () => {
    let total = Money.zero();
    for (let i = 0; i < 1000; i += 1) total = total.add(Money.parse('0.01'));
    expect(total.toString()).toBe('10.00');
  });

  it('recusa numero nao finito', () => {
    expect(() => Money.fromNumber(Number.NaN)).toThrow(TypeError);
    expect(() => Money.fromNumber(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('leitura e escrita', () => {
  it('le string decimal como o driver devolve DECIMAL', () => {
    expect(Money.parse('1234.56').toString()).toBe('1234.56');
    expect(Money.parse('1234').toString()).toBe('1234.00');
    expect(Money.parse('0').toString()).toBe('0.00');
  });

  it('serializa sem simbolo de moeda — formatacao e da apresentacao', () => {
    const value = Money.parse('1999.90');
    expect(value.toString()).toBe('1999.90');
    expect(value.toString()).not.toContain('R$');
    expect(value.toJSON()).toEqual({ amount: '1999.90', currency: 'BRL' });
  });

  it('trata valores negativos', () => {
    const value = Money.parse('-45.30');
    expect(value.toString()).toBe('-45.30');
    expect(value.isNegative()).toBe(true);
    expect(value.abs().toString()).toBe('45.30');
  });

  it('rejeita entrada malformada em vez de adivinhar', () => {
    expect(() => Money.parse('R$ 10,00')).toThrow(TypeError);
    expect(() => Money.parse('10,00')).toThrow(TypeError);
    expect(() => Money.parse('abc')).toThrow(TypeError);
    expect(() => Money.parse('')).toThrow(TypeError);
  });

  it('arredonda half-up na terceira casa', () => {
    expect(Money.parse('2.345').toString()).toBe('2.35');
    expect(Money.parse('2.344').toString()).toBe('2.34');
    expect(Money.parse('2.005').toString()).toBe('2.01');
  });
});

describe('aritmetica', () => {
  it('soma e subtrai', () => {
    expect(Money.parse('100.50').add(Money.parse('49.50')).toString()).toBe('150.00');
    expect(Money.parse('100.00').subtract(Money.parse('30.25')).toString()).toBe('69.75');
  });

  it('multiplica por quantidade fracionaria', () => {
    // 2,5 metros de cabo a 12,30
    expect(Money.parse('12.30').multiply('2.5').toString()).toBe('30.75');
  });

  it('arredonda o produto half-up', () => {
    expect(Money.parse('10.00').multiply('0.335').toString()).toBe('3.35');
  });

  it('aplica percentual', () => {
    expect(Money.parse('200.00').applyPercent('10').toString()).toBe('20.00');
    expect(Money.parse('99.90').applyPercent('15').toString()).toBe('14.99');
  });

  it('soma listas, devolvendo zero para lista vazia', () => {
    const total = sumMoney([Money.parse('10.00'), Money.parse('5.55'), Money.parse('0.45')]);
    expect(total.toString()).toBe('16.00');
    expect(sumMoney([]).toString()).toBe('0.00');
  });

  it('recusa operar moedas diferentes', () => {
    const brl = Money.parse('10.00', 'BRL');
    const outra = Money.fromCents(1000, 'USD' as never);
    expect(() => brl.add(outra)).toThrow(TypeError);
  });
});

describe('comparacao', () => {
  it('compara e ordena', () => {
    const values = [Money.parse('10.00'), Money.parse('2.50'), Money.parse('7.25')];
    const sorted = [...values].sort((a, b) => a.compare(b)).map((value) => value.toString());
    expect(sorted).toEqual(['2.50', '7.25', '10.00']);
  });

  it('igualdade considera valor e moeda', () => {
    expect(Money.parse('10.00').equals(Money.parse('10.00'))).toBe(true);
    expect(Money.parse('10.00').equals(Money.parse('10.01'))).toBe(false);
  });

  it('reconhece zero', () => {
    expect(Money.zero().isZero()).toBe(true);
    expect(Money.parse('0.00').isZero()).toBe(true);
  });
});

describe('representacao interna', () => {
  it('usa centavos inteiros, nunca float', () => {
    expect(Money.parse('1234.56').toCents()).toBe(123456n);
    expect(typeof Money.parse('1.00').toCents()).toBe('bigint');
  });

  it('suporta valores grandes sem perda de precisao', () => {
    // Acima do limite seguro de inteiro do JavaScript em centavos.
    const big = Money.parse('99999999999.99');
    expect(big.toString()).toBe('99999999999.99');
    expect(big.add(Money.parse('0.01')).toString()).toBe('100000000000.00');
  });

  it('fromCents recusa fracao de centavo', () => {
    expect(() => Money.fromCents(10.5)).toThrow(TypeError);
  });
});

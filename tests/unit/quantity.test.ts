import { describe, expect, it } from 'vitest';
import { Quantity, sumQuantity } from '@/core/quantity/quantity';

/**
 * QUANTIDADE EXATA (Prompt 10, itens 16, 132 e 133).
 *
 * O que estes testes protegem: um saldo de estoque que erra na quarta casa
 * produz "disponivel -0,0000000001", e uma reserva legitima passa a ser
 * recusada sem ninguem entender por que.
 */

describe('Quantity', () => {
  it('le e devolve DECIMAL(14,4) sem passar por float', () => {
    expect(Quantity.parse('5').toString()).toBe('5.0000');
    expect(Quantity.parse('2.5').toString()).toBe('2.5000');
    expect(Quantity.parse('0.0001').toString()).toBe('0.0001');
    expect(Quantity.parse('-3.25').toString()).toBe('-3.2500');
  });

  it('soma e subtrai sem o erro classico do ponto flutuante', () => {
    // 0.1 + 0.2 === 0.30000000000000004 em float.
    const resultado = Quantity.parse('0.1').add(Quantity.parse('0.2'));
    expect(resultado.toString()).toBe('0.3000');
    expect(resultado.equals(Quantity.parse('0.3'))).toBe(true);
  });

  it('arredonda a quinta casa half-up, a convencao do projeto', () => {
    expect(Quantity.parse('1.00005').toString()).toBe('1.0001');
    expect(Quantity.parse('1.00004').toString()).toBe('1.0000');
  });

  it('recusa texto que nao e numero decimal', () => {
    expect(() => Quantity.parse('cinco')).toThrow(TypeError);
    expect(() => Quantity.parse('')).toThrow(TypeError);
    expect(() => Quantity.parse('1,5')).toThrow(TypeError);
  });

  it('recusa quantidade acima do que DECIMAL(14,4) comporta', () => {
    expect(() => Quantity.parse('99999999999999')).toThrow(RangeError);
  });

  it('sabe distinguir inteiro de fracionado', () => {
    expect(Quantity.parse('3').hasFraction()).toBe(false);
    expect(Quantity.parse('3.0000').hasFraction()).toBe(false);
    expect(Quantity.parse('0.5').hasFraction()).toBe(true);
  });

  it('compara sem converter para number', () => {
    expect(Quantity.parse('2').compare(Quantity.parse('2.0000'))).toBe(0);
    expect(Quantity.parse('1.9999').compare(Quantity.parse('2'))).toBe(-1);
    expect(Quantity.parse('2.0001').compare(Quantity.parse('2'))).toBe(1);
  });

  it('soma lista vazia como zero, e nao como nulo', () => {
    expect(sumQuantity([]).toString()).toBe('0.0000');
    expect(
      sumQuantity([
        Quantity.parse('1.5'),
        Quantity.parse('2.25'),
        Quantity.parse('0.25'),
      ]).toString(),
    ).toBe('4.0000');
  });

  it('nega e absolutiza preservando a escala', () => {
    expect(Quantity.parse('2.5').negate().toString()).toBe('-2.5000');
    expect(Quantity.parse('-2.5').abs().toString()).toBe('2.5000');
  });
});

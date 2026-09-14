import { describe, expect, it } from 'vitest';
import { Money } from '@/core/money/money';
import {
  formatAmount,
  formatBRL,
  formatQuantity,
  normalizeAmountInput,
  normalizeQuantityInput,
} from '@/core/money/format';

/**
 * APRESENTACAO E ENTRADA DE DINHEIRO (Prompt 09, itens 89 a 91).
 *
 * O bug que este arquivo existe para impedir: alguem digita "1.234,56" no
 * celular, o backend recebe a string crua e interpreta "1.234" como um real e
 * vinte e tres centavos. O orcamento sai mil vezes menor e ninguem percebe ate
 * o cliente chegar para pagar.
 */

describe('formatacao', () => {
  it('mostra em pt-BR com simbolo', () => {
    expect(formatBRL(Money.parse('1234.56'))).toMatch(/R\$\s*1\.234,56/);
    expect(formatBRL(Money.parse('0'))).toMatch(/R\$\s*0,00/);
    expect(formatBRL(Money.parse('0.01'))).toMatch(/R\$\s*0,01/);
  });

  it('aceita a string decimal direto do banco', () => {
    expect(formatBRL('309.90')).toMatch(/R\$\s*309,90/);
  });

  it('sem simbolo, para coluna de tabela', () => {
    expect(formatAmount('1234.56')).toBe('1.234,56');
    expect(formatAmount('7.00')).toBe('7,00');
  });

  it('quantidade nao carrega casas a toa', () => {
    expect(formatQuantity('3.0000')).toBe('3');
    expect(formatQuantity('2.5000')).toBe('2,5');
    expect(formatQuantity('0.2500')).toBe('0,25');
  });
});

describe('entrada em pt-BR (item 90)', () => {
  it('virgula e o decimal, ponto e o milhar', () => {
    expect(normalizeAmountInput('1.234,56')).toBe('1234.56');
    expect(normalizeAmountInput('1234,56')).toBe('1234.56');
    expect(normalizeAmountInput('0,05')).toBe('0.05');
    expect(normalizeAmountInput('1.234.567,89')).toBe('1234567.89');
  });

  it('aceita tambem o formato tecnico com ponto decimal', () => {
    // O teclado numerico do celular oferece ponto; recusar seria hostil.
    expect(normalizeAmountInput('1234.56')).toBe('1234.56');
    expect(normalizeAmountInput('0.05')).toBe('0.05');
  });

  it('desempata "1.234": tres digitos depois do ponto e MILHAR', () => {
    expect(normalizeAmountInput('1.234')).toBe('1234');
    // Duas casas depois do ponto sao centavos, nao milhar.
    expect(normalizeAmountInput('1.23')).toBe('1.23');
  });

  it('ignora simbolo, espaco e texto solto', () => {
    expect(normalizeAmountInput('R$ 149,90')).toBe('149.90');
    expect(normalizeAmountInput('  89,00  ')).toBe('89.00');
  });

  it('devolve null quando nao ha numero', () => {
    expect(normalizeAmountInput('')).toBeNull();
    expect(normalizeAmountInput('   ')).toBeNull();
    expect(normalizeAmountInput('R$')).toBeNull();
    expect(normalizeAmountInput('abc')).toBeNull();
  });

  it('o resultado e sempre aceito pelo Money — e esse e o ponto', () => {
    for (const digitado of ['1.234,56', '149,90', '0,01', 'R$ 2.000,00', '7']) {
      const normalizado = normalizeAmountInput(digitado);
      expect(normalizado).not.toBeNull();
      expect(() => Money.parse(normalizado as string)).not.toThrow();
    }
  });

  it('quantidade usa a mesma conversao', () => {
    expect(normalizeQuantityInput('2,5')).toBe('2.5');
    expect(normalizeQuantityInput('1')).toBe('1');
  });
});

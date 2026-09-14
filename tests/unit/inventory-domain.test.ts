import { describe, expect, it } from 'vitest';
import { Money } from '@/core/money/money';
import { Quantity } from '@/core/quantity/quantity';
import {
  MOVEMENT_DIRECTION,
  MOVEMENT_TYPES,
  MOVEMENT_TYPE_PERMISSION,
  allowsFractionalQuantity,
  assertBalanceInvariants,
  assertTransferUnits,
  availableQuantity,
  canIssue,
  canReserve,
  explainInsufficientStock,
  formatQuantityValue,
  formatTransferNumber,
  hasMinimumConfigured,
  isBelowMinimum,
  movementDirection,
  movementTotalCost,
  nextAverageCost,
  nextReservationStatus,
  normalizeAdjustmentReason,
  normalizeBarcode,
  normalizePartCode,
  parseConfiguredQuantity,
  parseOperationQuantity,
  requiresReason,
  reservationRemaining,
  signedMovementQuantity,
  unitOfMeasureAbbreviation,
} from '@/modules/inventory/domain/inventory';

const q = (value: string) => Quantity.parse(value);

/**
 * DOMINIO DE ESTOQUE (Prompt 10, item 132).
 *
 * Cada bloco aqui corresponde a uma decisao que o modulo tomou e que precisa
 * continuar valendo depois de qualquer refactor.
 */

describe('unidade de medida', () => {
  it('unidade e pacote nao aceitam fracao; metro e grama aceitam', () => {
    expect(allowsFractionalQuantity('unit')).toBe(false);
    expect(allowsFractionalQuantity('package')).toBe(false);
    expect(allowsFractionalQuantity('meter')).toBe(true);
    expect(allowsFractionalQuantity('gram')).toBe(true);
  });

  it('recusa meia tela de LCD, aceita meio metro de cabo', () => {
    expect(() => parseOperationQuantity('0.5', 'unit')).toThrow(RangeError);
    expect(parseOperationQuantity('0.5', 'meter').toString()).toBe('0.5000');
  });

  it('abrevia para a tela', () => {
    expect(unitOfMeasureAbbreviation('unit')).toBe('un');
    expect(unitOfMeasureAbbreviation('kilogram')).toBe('kg');
  });
});

describe('quantidades', () => {
  it('operacao exige maior que zero', () => {
    expect(() => parseOperationQuantity('0')).toThrow(RangeError);
    expect(() => parseOperationQuantity('-1')).toThrow(RangeError);
    expect(parseOperationQuantity('1').toString()).toBe('1.0000');
  });

  it('aceita virgula, porque o teclado do celular oferece virgula', () => {
    expect(parseOperationQuantity('2,5', 'meter').toString()).toBe('2.5000');
  });

  it('configuracao aceita zero: minimo zero significa "nao acompanhe"', () => {
    expect(parseConfiguredQuantity('0').toString()).toBe('0.0000');
    expect(parseConfiguredQuantity('').toString()).toBe('0.0000');
    expect(() => parseConfiguredQuantity('-1')).toThrow(RangeError);
  });

  it('recusa quantidade absurda antes de chegar ao banco', () => {
    expect(() => parseOperationQuantity('1000000')).toThrow(RangeError);
  });

  it('formata para pt-BR sem zeros inuteis', () => {
    expect(formatQuantityValue(q('3'))).toBe('3');
    expect(formatQuantityValue(q('2.5'))).toBe('2,5');
    expect(formatQuantityValue(q('0.25'))).toBe('0,25');
  });
});

describe('saldo: on_hand, reserved e available', () => {
  it('available = on_hand - reserved', () => {
    expect(availableQuantity({ onHand: q('5'), reserved: q('2') }).toString()).toBe('3.0000');
  });

  it('reserva consome o disponivel, nao o fisico', () => {
    const saldo = { onHand: q('5'), reserved: q('3') };
    expect(canReserve(saldo, q('2'))).toBe(true);
    expect(canReserve(saldo, q('3'))).toBe(false);
    // O fisico continua 5 — a peca nao saiu da prateleira.
    expect(saldo.onHand.toString()).toBe('5.0000');
  });

  it('saida avulsa tambem respeita o disponivel, e nao o fisico', () => {
    const saldo = { onHand: q('5'), reserved: q('5') };
    expect(canIssue(saldo, q('1'))).toBe(false);
  });

  it('as tres invariantes recusam saldo incoerente', () => {
    expect(() => assertBalanceInvariants({ onHand: q('-1'), reserved: q('0') })).toThrow(
      RangeError,
    );
    expect(() => assertBalanceInvariants({ onHand: q('1'), reserved: q('-1') })).toThrow(
      RangeError,
    );
    expect(() => assertBalanceInvariants({ onHand: q('1'), reserved: q('2') })).toThrow(RangeError);
    expect(() => assertBalanceInvariants({ onHand: q('2'), reserved: q('2') })).not.toThrow();
  });

  it('explica a falta com os numeros reais, em portugues', () => {
    const mensagem = explainInsufficientStock(q('1'), q('3'), 'unit');
    expect(mensagem).toContain('1 un');
    expect(mensagem).toContain('3 un');
  });
});

describe('movimentacao', () => {
  it('todo tipo tem direcao, e nenhuma e neutra', () => {
    for (const tipo of MOVEMENT_TYPES) {
      expect([1, -1]).toContain(MOVEMENT_DIRECTION[tipo]);
    }
  });

  it('entrada soma, saida subtrai', () => {
    expect(movementDirection('receipt')).toBe(1);
    expect(movementDirection('issue')).toBe(-1);
    expect(movementDirection('transfer_out')).toBe(-1);
    expect(movementDirection('transfer_in')).toBe(1);
  });

  it('grava a quantidade COM SINAL, para a reconciliacao ser uma soma', () => {
    expect(signedMovementQuantity('receipt', q('5')).toString()).toBe('5.0000');
    expect(signedMovementQuantity('issue', q('5')).toString()).toBe('-5.0000');
  });

  it('recusa tipo desconhecido em vez de assumir uma direcao', () => {
    expect(() => movementDirection('teleporte')).toThrow(RangeError);
  });

  it('so ajuste exige motivo', () => {
    expect(requiresReason('adjustment_in')).toBe(true);
    expect(requiresReason('adjustment_out')).toBe(true);
    expect(requiresReason('receipt')).toBe(false);
    expect(requiresReason('issue')).toBe(false);
  });

  it('motivo de ajuste precisa dizer alguma coisa', () => {
    expect(() => normalizeAdjustmentReason('ok')).toThrow(RangeError);
    expect(normalizeAdjustmentReason('  contagem   fisica  ')).toBe('contagem fisica');
  });

  it('cada tipo aponta para a permissao que o autoriza', () => {
    expect(MOVEMENT_TYPE_PERMISSION.receipt).toBe('inventory.receive');
    expect(MOVEMENT_TYPE_PERMISSION.issue).toBe('inventory.issue');
    expect(MOVEMENT_TYPE_PERMISSION.adjustment_in).toBe('inventory.adjust');
    expect(MOVEMENT_TYPE_PERMISSION.adjustment_out).toBe('inventory.adjust');
    expect(MOVEMENT_TYPE_PERMISSION.transfer_out).toBe('inventory.transfer');
  });
});

describe('reserva', () => {
  const reserva = {
    quantity: q('3'),
    consumedQuantity: q('1'),
    releasedQuantity: q('0'),
    status: 'open',
  };

  it('o que sobra e o que ainda esta preso', () => {
    expect(reservationRemaining(reserva).toString()).toBe('2.0000');
  });

  it('a situacao deriva do que sobrou, nao do botao clicado', () => {
    expect(nextReservationStatus(reserva)).toBe('open');
    expect(
      nextReservationStatus({ ...reserva, consumedQuantity: q('1'), releasedQuantity: q('2') }),
    ).toBe('closed');
    expect(nextReservationStatus({ ...reserva, consumedQuantity: q('3') })).toBe('closed');
  });
});

describe('transferencia', () => {
  it('origem e destino precisam ser diferentes', () => {
    expect(() => assertTransferUnits('u1', 'u1')).toThrow(RangeError);
    expect(() => assertTransferUnits('u1', 'u2')).not.toThrow();
  });

  it('numero humano com prefixo e zeros a esquerda', () => {
    expect(formatTransferNumber(12)).toBe('TRF 000012');
  });
});

describe('estoque minimo', () => {
  it('minimo zero significa "nao acompanhe", nao "avise sempre"', () => {
    expect(hasMinimumConfigured(q('0'))).toBe(false);
    expect(isBelowMinimum({ onHand: q('0'), reserved: q('0') }, q('0'))).toBe(false);
  });

  it('compara contra o DISPONIVEL, nao contra o saldo fisico', () => {
    // 5 na prateleira, 5 comprometidas: disponivel zero, abaixo do minimo 2.
    expect(isBelowMinimum({ onHand: q('5'), reserved: q('5') }, q('2'))).toBe(true);
    expect(isBelowMinimum({ onHand: q('5'), reserved: q('0') }, q('2'))).toBe(false);
  });

  it('igual ao minimo ainda nao e abaixo dele', () => {
    expect(isBelowMinimum({ onHand: q('2'), reserved: q('0') }, q('2'))).toBe(false);
    expect(isBelowMinimum({ onHand: q('1.9999'), reserved: q('0') }, q('2'))).toBe(true);
  });
});

describe('custo', () => {
  it('custo da movimentacao arredonda UMA vez, no produto', () => {
    // 3 x R$ 0,335 -> o unitario ja e R$ 0,34 em DECIMAL(14,2).
    const total = movementTotalCost(Money.parse('0.335'), q('3'));
    expect(total?.toString()).toBe('1.02');
  });

  it('quantidade fracionada multiplica sem float', () => {
    expect(movementTotalCost(Money.parse('12.50'), q('2.5'))?.toString()).toBe('31.25');
    expect(movementTotalCost(Money.parse('0.07'), q('0.5'))?.toString()).toBe('0.04');
  });

  it('sem custo informado, nao ha custo de movimentacao', () => {
    expect(movementTotalCost(null, q('3'))).toBeNull();
  });

  it('media ponderada: primeira entrada define a media', () => {
    const media = nextAverageCost(q('0'), null, q('10'), Money.parse('5.00'));
    expect(media?.toString()).toBe('5.00');
  });

  it('media ponderada: segunda entrada pondera pela quantidade', () => {
    // 10 a R$ 5,00 + 10 a R$ 7,00 = 20 a R$ 6,00
    const media = nextAverageCost(q('10'), Money.parse('5.00'), q('10'), Money.parse('7.00'));
    expect(media?.toString()).toBe('6.00');
  });

  it('media ponderada arredonda half-up, como o resto do projeto', () => {
    // 1 a R$ 1,00 + 2 a R$ 2,00 = 3 a R$ 1,6667 -> R$ 1,67
    const media = nextAverageCost(q('1'), Money.parse('1.00'), q('2'), Money.parse('2.00'));
    expect(media?.toString()).toBe('1.67');
  });

  it('entrada SEM custo nao derruba a media para zero', () => {
    const media = nextAverageCost(q('10'), Money.parse('5.00'), q('10'), null);
    expect(media?.toString()).toBe('5.00');
  });

  it('saldo zerado recomeca a media do custo novo', () => {
    const media = nextAverageCost(q('0'), Money.parse('5.00'), q('4'), Money.parse('9.00'));
    expect(media?.toString()).toBe('9.00');
  });
});

describe('identificacao da peca', () => {
  it('codigo interno compara compacto e em maiuscula', () => {
    expect(normalizePartCode('tela 01')).toBe('TELA01');
    expect(normalizePartCode('TELA-01')).toBe('TELA01');
  });

  it('codigo de barras nao presume EAN e aceita letras', () => {
    expect(normalizeBarcode('abc-123 456')).toBe('ABC123456');
  });
});

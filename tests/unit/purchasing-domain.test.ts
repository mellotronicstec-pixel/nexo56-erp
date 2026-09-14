import { describe, expect, it } from 'vitest';
import { Money } from '@/core/money/money';
import { Quantity } from '@/core/quantity/quantity';
import {
  PURCHASE_ORDER_STATUSES,
  calculateItemTotals,
  calculatePurchaseOrderTotals,
  canReceive,
  explainOverReceipt,
  explainPurchaseOrderRefusal,
  findPurchaseOrderTransition,
  formatPurchaseOrderNumber,
  isPurchaseOrderEditable,
  isPurchaseOrderReceivable,
  itemPendingQuantity,
  needPendingToOrder,
  needPendingToReceive,
  nextNeedStatus,
  nextPurchaseOrderStatus,
  normalizeCancelReason,
  parsePurchaseQuantity,
  purchaseOrderTransitionsFrom,
  supplierDisplayName,
} from '@/modules/purchasing/domain/purchasing';

const q = (value: string) => Quantity.parse(value);

/**
 * DOMINIO DE COMPRAS (Prompt 11, item 72).
 *
 * Cada bloco corresponde a uma decisao que o modulo tomou e que precisa
 * continuar valendo depois de qualquer refactor.
 */

describe('fornecedor', () => {
  it('exibe a fantasia quando ha, e a razao social quando nao ha', () => {
    expect(supplierDisplayName({ name: 'Eletronica ABC Ltda', tradeName: 'ABC Pecas' })).toBe(
      'ABC Pecas',
    );
    expect(supplierDisplayName({ name: 'Jose da Silva', tradeName: null })).toBe('Jose da Silva');
    expect(supplierDisplayName({ name: 'Eletronica ABC Ltda', tradeName: '   ' })).toBe(
      'Eletronica ABC Ltda',
    );
  });
});

describe('quantidade', () => {
  it('precisa ser maior que zero', () => {
    expect(() => parsePurchaseQuantity('0')).toThrow(RangeError);
    expect(() => parsePurchaseQuantity('-1')).toThrow(RangeError);
    expect(parsePurchaseQuantity('10').toString()).toBe('10.0000');
  });

  it('aceita virgula, porque o teclado do celular oferece virgula', () => {
    expect(parsePurchaseQuantity('2,5', 'meter').toString()).toBe('2.5000');
  });

  it('respeita a unidade de medida do catalogo: unidade nao aceita fracao', () => {
    expect(() => parsePurchaseQuantity('0.5', 'unit')).toThrow(RangeError);
    expect(parsePurchaseQuantity('0.5', 'gram').toString()).toBe('0.5000');
  });

  it('recusa quantidade absurda antes de chegar ao banco', () => {
    expect(() => parsePurchaseQuantity('1000000')).toThrow(RangeError);
  });
});

describe('valores (item 15)', () => {
  it('arredonda UMA vez, no produto', () => {
    // 3 x R$ 0,335 -> o unitario ja e R$ 0,34 em DECIMAL(14,2).
    const linha = calculateItemTotals({ quantity: '3', unitCost: '0.335' });
    expect(linha.total.toString()).toBe('1.02');
  });

  it('multiplica quantidade fracionada sem float', () => {
    const linha = calculateItemTotals({ quantity: '2.5', unitCost: '12.50' });
    expect(linha.total.toString()).toBe('31.25');
  });

  it('recusa custo negativo', () => {
    expect(() => calculateItemTotals({ quantity: '1', unitCost: '-1.00' })).toThrow(RangeError);
  });

  it('total = subtotal - desconto + frete + outras despesas', () => {
    const totais = calculatePurchaseOrderTotals(
      [
        { quantity: '10', unitCost: '12.50' },
        { quantity: '2', unitCost: '30.00' },
      ],
      { discount: '5.00', freight: '20.00', otherCosts: '1.50' },
    );

    expect(totais.subtotal.toString()).toBe('185.00');
    expect(totais.total.toString()).toBe('201.50');
  });

  it('recusa desconto maior que o subtotal', () => {
    expect(() =>
      calculatePurchaseOrderTotals([{ quantity: '1', unitCost: '10.00' }], { discount: '11.00' }),
    ).toThrow(RangeError);
  });

  it('recusa frete negativo', () => {
    expect(() =>
      calculatePurchaseOrderTotals([{ quantity: '1', unitCost: '10.00' }], { freight: '-1.00' }),
    ).toThrow(RangeError);
  });

  it('pedido sem itens tem total zero, e nao erro', () => {
    expect(calculatePurchaseOrderTotals([]).total.toString()).toBe('0.00');
  });
});

describe('necessidade (itens 8 e 30)', () => {
  const base = {
    quantity: q('10'),
    orderedQuantity: q('0'),
    receivedQuantity: q('0'),
    status: 'open',
  };

  it('pendente para pedir e o que ainda nao entrou em pedido', () => {
    expect(needPendingToOrder({ ...base, orderedQuantity: q('4') }).toString()).toBe('6.0000');
  });

  it('pendente para receber e o que ainda nao chegou', () => {
    expect(needPendingToReceive({ ...base, receivedQuantity: q('4') }).toString()).toBe('6.0000');
  });

  it('pedir NAO atende a necessidade — so receber atende (item 30)', () => {
    expect(nextNeedStatus({ ...base, orderedQuantity: q('10') })).toBe('ordered');
    expect(nextNeedStatus({ ...base, orderedQuantity: q('10'), receivedQuantity: q('10') })).toBe(
      'fulfilled',
    );
  });

  it('recebimento parcial mantem a necessidade aberta', () => {
    expect(nextNeedStatus({ ...base, orderedQuantity: q('10'), receivedQuantity: q('6') })).toBe(
      'ordered',
    );
  });

  it('cancelada permanece cancelada, aconteca o que acontecer', () => {
    expect(nextNeedStatus({ ...base, status: 'cancelled', receivedQuantity: q('10') })).toBe(
      'cancelled',
    );
  });

  it('pendente nunca fica negativo, mesmo comprando mais do que precisa', () => {
    expect(needPendingToOrder({ ...base, orderedQuantity: q('15') }).toString()).toBe('0.0000');
  });
});

describe('estados do pedido (item 16)', () => {
  it('so o rascunho aceita edicao de itens e valores', () => {
    expect(isPurchaseOrderEditable('draft')).toBe(true);
    for (const status of PURCHASE_ORDER_STATUSES.filter((value) => value !== 'draft')) {
      expect(isPurchaseOrderEditable(status)).toBe(false);
    }
  });

  it('so pedido realizado e parcialmente recebido aceitam mercadoria', () => {
    expect(isPurchaseOrderReceivable('placed')).toBe(true);
    expect(isPurchaseOrderReceivable('partially_received')).toBe(true);
    expect(isPurchaseOrderReceivable('draft')).toBe(false);
    expect(isPurchaseOrderReceivable('approved')).toBe(false);
    expect(isPurchaseOrderReceivable('cancelled')).toBe(false);
    expect(isPurchaseOrderReceivable('received')).toBe(false);
  });

  it('o caminho normal e rascunho -> aprovado -> pedido realizado', () => {
    expect(findPurchaseOrderTransition('draft', 'approved')).not.toBeNull();
    expect(findPurchaseOrderTransition('approved', 'placed')).not.toBeNull();
  });

  it('nao se pula a aprovacao', () => {
    expect(findPurchaseOrderTransition('draft', 'placed')).toBeNull();
  });

  it('NAO existe transicao manual para recebido: e consequencia do que chegou', () => {
    expect(findPurchaseOrderTransition('placed', 'received')).toBeNull();
    expect(findPurchaseOrderTransition('placed', 'partially_received')).toBeNull();
    expect(explainPurchaseOrderRefusal('placed', 'received')).toContain('registre o recebimento');
  });

  it('cancelar exige motivo, exceto descartar rascunho', () => {
    expect(findPurchaseOrderTransition('draft', 'cancelled')?.requiresReason).toBeUndefined();
    expect(findPurchaseOrderTransition('placed', 'cancelled')?.requiresReason).toBe(true);
    expect(findPurchaseOrderTransition('partially_received', 'cancelled')?.requiresReason).toBe(
      true,
    );
  });

  it('de recebido e de cancelado nao se sai', () => {
    expect(purchaseOrderTransitionsFrom('received')).toHaveLength(0);
    expect(purchaseOrderTransitionsFrom('cancelled')).toHaveLength(0);
    expect(explainPurchaseOrderRefusal('cancelled', 'approved')).toContain('nao muda mais');
  });

  it('aprovar e realizar exigem a permissao de aprovacao (item 17)', () => {
    expect(findPurchaseOrderTransition('draft', 'approved')?.permission).toBe('purchases.approve');
    expect(findPurchaseOrderTransition('approved', 'placed')?.permission).toBe('purchases.approve');
    expect(findPurchaseOrderTransition('placed', 'cancelled')?.permission).toBe('purchases.cancel');
  });

  it('motivo de cancelamento precisa dizer alguma coisa', () => {
    expect(() => normalizeCancelReason('ok')).toThrow(RangeError);
    expect(normalizeCancelReason('  fornecedor  sem   estoque ')).toBe('fornecedor sem estoque');
  });
});

describe('recebimento (itens 21 e 22)', () => {
  it('pendente e o que falta chegar', () => {
    expect(itemPendingQuantity({ quantity: q('10'), receivedQuantity: q('6') }).toString()).toBe(
      '4.0000',
    );
  });

  it('NAO se recebe acima do pedido', () => {
    const item = { quantity: q('10'), receivedQuantity: q('6') };
    expect(canReceive(item, q('4'))).toBe(true);
    expect(canReceive(item, q('5'))).toBe(false);
    expect(explainOverReceipt(item, q('5'))).toContain('Faltam 4');
  });

  it('a situacao do pedido deriva do que chegou, e nao de um botao', () => {
    const linhas = (a: string, b: string) => [
      { quantity: q('10'), receivedQuantity: q(a) },
      { quantity: q('5'), receivedQuantity: q(b) },
    ];

    expect(nextPurchaseOrderStatus(linhas('0', '0'), 'placed')).toBe('placed');
    expect(nextPurchaseOrderStatus(linhas('6', '0'), 'placed')).toBe('partially_received');
    expect(nextPurchaseOrderStatus(linhas('10', '0'), 'placed')).toBe('partially_received');
    expect(nextPurchaseOrderStatus(linhas('10', '5'), 'partially_received')).toBe('received');
  });

  it('pedido cancelado nao volta a receber por aritmetica', () => {
    expect(
      nextPurchaseOrderStatus([{ quantity: q('10'), receivedQuantity: q('10') }], 'cancelled'),
    ).toBe('cancelled');
  });
});

describe('numeracao (item 12)', () => {
  it('numero humano com prefixo e zeros a esquerda', () => {
    expect(formatPurchaseOrderNumber(37)).toBe('PC 000037');
    expect(formatPurchaseOrderNumber(1)).toBe('PC 000001');
  });
});

describe('custo: frete NAO entra no custo da peca (item 27)', () => {
  it('o total do item e quantidade x custo unitario, sem rateio', () => {
    const totais = calculatePurchaseOrderTotals([{ quantity: '10', unitCost: '12.50' }], {
      freight: '50.00',
    });

    // O item continua valendo R$ 125,00 — o frete soma no PEDIDO, nao na peca.
    expect(totais.subtotal.toString()).toBe('125.00');
    expect(totais.freight.toString()).toBe('50.00');
    expect(totais.total.toString()).toBe('175.00');

    const linha = calculateItemTotals({ quantity: '10', unitCost: '12.50' });
    expect(linha.unitCost.equals(Money.parse('12.50'))).toBe(true);
  });
});

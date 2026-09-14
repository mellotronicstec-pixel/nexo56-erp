import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import {
  APPROVAL_SOURCES,
  QUOTE_ACTIVE_STATUSES,
  QUOTE_INITIAL_STATUS,
  QUOTE_ITEM_KINDS,
  QUOTE_STATUSES,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
  QUOTE_TERMINAL_STATUSES,
  QUOTE_TIMELINE_KINDS,
  QUOTE_TRANSITIONS,
  calculateItemTotals,
  calculateQuoteTotals,
  explainQuoteRefusal,
  findQuoteTransition,
  formatQuoteNumber,
  isKnownQuoteStatus,
  isQuoteActive,
  isQuoteEditable,
  isQuoteTerminal,
  manualQuoteTransitionsFrom,
  normalizeQuantity,
  parseQuoteNumber,
  quoteStatusLabel,
  quoteStatusTone,
  quoteTimelineLabel,
  type QuoteStatus,
} from '@/modules/quotes/domain/quote';

/**
 * DOMINIO DO ORCAMENTO (Prompt 09, itens 119 e 120).
 *
 * O que estes testes travam: a lista de situacoes e finita, a matriz de
 * mudancas e explicita, e o dinheiro nunca passa por ponto flutuante.
 */

describe('situacoes (itens 15 e 16)', () => {
  it('declara as situacoes oficiais, sem inventar nem faltar', () => {
    expect([...QUOTE_STATUSES]).toEqual([
      'draft',
      'sent',
      'approved',
      'rejected',
      'expired',
      'superseded',
      'cancelled',
    ]);
  });

  it('todo orcamento nasce rascunho (item 17)', () => {
    expect(QUOTE_INITIAL_STATUS).toBe('draft');
  });

  it('toda situacao tem rotulo em pt-BR e tom visual', () => {
    for (const status of QUOTE_STATUSES) {
      expect(QUOTE_STATUS_LABEL[status]).toBeTruthy();
      expect(QUOTE_STATUS_TONE[status]).toBeTruthy();
    }
  });

  it('situacao desconhecida nao ganha rotulo nem tom inventado', () => {
    expect(isKnownQuoteStatus('em_negociacao')).toBe(false);
    expect(quoteStatusLabel('em_negociacao')).toBe('em_negociacao');
    expect(quoteStatusTone('em_negociacao')).toBe('neutral');
  });

  it('a situacao do ORCAMENTO nao se confunde com a da OS (item 16)', () => {
    // Nenhum estado de OS vazou para ca: sao duas maquinas distintas.
    for (const estadoDeOS of [
      'awaiting_technical_opinion',
      'awaiting_approval',
      'awaiting_repair',
      'awaiting_part',
      'repair_completed',
      'completed',
    ]) {
      expect(isKnownQuoteStatus(estadoDeOS)).toBe(false);
    }
  });

  it('proposta viva e so rascunho ou enviado (item 65)', () => {
    expect([...QUOTE_ACTIVE_STATUSES]).toEqual(['draft', 'sent']);
    expect(isQuoteActive('draft')).toBe(true);
    expect(isQuoteActive('sent')).toBe(true);
    expect(isQuoteActive('approved')).toBe(false);
  });

  it('de uma situacao terminal nao se sai', () => {
    expect([...QUOTE_TERMINAL_STATUSES]).toEqual([
      'approved',
      'rejected',
      'expired',
      'superseded',
      'cancelled',
    ]);

    for (const terminal of QUOTE_TERMINAL_STATUSES) {
      expect(isQuoteTerminal(terminal)).toBe(true);
      expect(manualQuoteTransitionsFrom(terminal)).toEqual([]);
      expect(explainQuoteRefusal(terminal, 'sent')).toContain('nao muda mais');
    }
  });
});

describe('imutabilidade (itens 27 e 28)', () => {
  it('so o rascunho aceita edicao de valores', () => {
    expect(isQuoteEditable('draft')).toBe(true);
    for (const status of QUOTE_STATUSES.filter((s) => s !== 'draft')) {
      expect(isQuoteEditable(status)).toBe(false);
    }
  });
});

describe('matriz de mudancas (itens 15, 18, 20 e 21)', () => {
  const esperado: Record<string, string[]> = {
    draft: ['sent', 'cancelled'],
    sent: ['approved', 'rejected', 'cancelled', 'expired'],
    approved: [],
    rejected: [],
    expired: [],
    superseded: [],
    cancelled: [],
  };

  it('cada situacao oferece exatamente os destinos previstos', () => {
    for (const status of QUOTE_STATUSES) {
      const destinos = QUOTE_TRANSITIONS.filter((rule) => rule.from === status).map((r) => r.to);
      expect(destinos.sort()).toEqual([...(esperado[status] ?? [])].sort());
    }
  });

  it('salto de etapa e recusado com explicacao em portugues', () => {
    const proibidas: [QuoteStatus, QuoteStatus][] = [
      ['draft', 'approved'],
      ['draft', 'rejected'],
      ['draft', 'expired'],
      ['approved', 'rejected'],
      ['rejected', 'approved'],
      ['cancelled', 'sent'],
    ];

    for (const [from, to] of proibidas) {
      expect(findQuoteTransition(from, to)).toBeNull();
      expect(explainQuoteRefusal(from, to)).toBeTruthy();
    }
  });

  it('recusar e cancelar uma proposta enviada exigem motivo', () => {
    expect(findQuoteTransition('sent', 'rejected')?.requiresReason).toBe(true);
    expect(findQuoteTransition('sent', 'cancelled')?.requiresReason).toBe(true);
    // Descartar um rascunho que ninguem viu, nao.
    expect(findQuoteTransition('draft', 'cancelled')?.requiresReason).toBeUndefined();
  });

  it('cada mudanca exige a sua permissao (itens 70 e 71)', () => {
    expect(findQuoteTransition('draft', 'sent')?.permission).toBe(PERMISSIONS.QUOTES_SEND);
    expect(findQuoteTransition('sent', 'approved')?.permission).toBe(PERMISSIONS.QUOTES_APPROVE);
    expect(findQuoteTransition('sent', 'rejected')?.permission).toBe(PERMISSIONS.QUOTES_REJECT);
    expect(findQuoteTransition('sent', 'cancelled')?.permission).toBe(PERMISSIONS.QUOTES_CANCEL);
  });

  it('expirar NAO e oferecido como botao: quem expira e o prazo (item 23)', () => {
    const manuais = manualQuoteTransitionsFrom('sent').map((rule) => rule.to);
    expect(manuais).not.toContain('expired');
    expect(manuais.sort()).toEqual(['approved', 'cancelled', 'rejected']);
  });

  it('substituido nao e destino de botao nenhum: e consequencia da revisao', () => {
    for (const rule of QUOTE_TRANSITIONS) {
      expect(rule.to).not.toBe('superseded');
    }
  });
});

describe('tipos de item (itens 30 a 32)', () => {
  it('sao linhas comerciais, nao itens de estoque', () => {
    expect([...QUOTE_ITEM_KINDS]).toEqual(['service', 'part', 'other']);
  });
});

describe('numeracao (itens 10 e 14)', () => {
  it('formata com prefixo e zeros a esquerda', () => {
    expect(formatQuoteNumber(1)).toBe('ORC #000001');
    expect(formatQuoteNumber(1234)).toBe('ORC #001234');
  });

  it('a REVISAO aparece no rotulo a partir da segunda', () => {
    // O cliente precisa saber que o papel na mao dele nao e mais o vigente.
    expect(formatQuoteNumber(45, 1)).toBe('ORC #000045');
    expect(formatQuoteNumber(45, 2)).toBe('ORC #000045 rev. 2');
  });

  it('le o numero do jeito que a pessoa digita', () => {
    expect(parseQuoteNumber('45')).toBe(45);
    expect(parseQuoteNumber('ORC #000045')).toBe(45);
    expect(parseQuoteNumber('orc45')).toBe(45);
    expect(parseQuoteNumber('')).toBeNull();
    expect(parseQuoteNumber('abc')).toBeNull();
    expect(parseQuoteNumber('0')).toBeNull();
  });
});

describe('origem da decisao (itens 51 e 52)', () => {
  it('hoje so existe a origem interna', () => {
    expect(Object.values(APPROVAL_SOURCES)).toEqual(['internal']);
  });

  it('nao declara Portal nem canal externo que nao existem', () => {
    const valores = Object.values(APPROVAL_SOURCES) as string[];
    expect(valores).not.toContain('customer_portal');
    expect(valores).not.toContain('external_confirmation');
  });
});

describe('linha do tempo (item 58)', () => {
  it('so declara fatos que o codigo escreve', () => {
    expect(Object.values(QUOTE_TIMELINE_KINDS).sort()).toEqual([
      'approved',
      'cancelled',
      'created',
      'details_updated',
      'expired',
      'items_updated',
      'rejected',
      'revised',
      'sent',
      'superseded',
    ]);
  });

  it('todo tipo declarado tem rotulo legivel', () => {
    for (const kind of Object.values(QUOTE_TIMELINE_KINDS)) {
      expect(quoteTimelineLabel(kind)).not.toBe(kind);
    }
    expect(quoteTimelineLabel('fato_do_prompt_10')).toBe('fato_do_prompt_10');
  });
});

// ---------------------------------------------------------------------------
// Dinheiro
// ---------------------------------------------------------------------------

describe('quantidade (item 34)', () => {
  it('aceita inteiro e fracao, com virgula ou ponto', () => {
    expect(normalizeQuantity('1')).toBe('1');
    expect(normalizeQuantity('2.5')).toBe('2.5');
    expect(normalizeQuantity('0,5')).toBe('0.5');
    expect(normalizeQuantity(' 3 ')).toBe('3');
  });

  it('recusa zero, negativo e lixo', () => {
    for (const invalido of ['0', '-1', '', 'dois', '1.23456']) {
      expect(() => normalizeQuantity(invalido)).toThrow(RangeError);
    }
  });
});

describe('calculo de linha (itens 35 a 37 e 41)', () => {
  it('quantidade x valor unitario', () => {
    const linha = calculateItemTotals({
      kind: 'service',
      description: 'Bancada',
      quantity: '2',
      unitPrice: '80.00',
    });
    expect(linha.gross.toString()).toBe('160.00');
    expect(linha.total.toString()).toBe('160.00');
  });

  it('o VALOR UNITARIO tem duas casas: 0,335 e lido como R$ 0,34', () => {
    /**
     * `unit_price` e `DECIMAL(14,2)`, e o `Money` arredonda half-up ao ler.
     * Numa assistencia o preco unitario e sempre em centavos — sub-centavo e
     * problema de atacado e de combustivel, nao de bancada.
     */
    const linha = calculateItemTotals({
      kind: 'part',
      description: 'Parafuso',
      quantity: '3',
      unitPrice: '0.335',
    });
    expect(linha.gross.toString()).toBe('1.02');
  });

  it('a QUANTIDADE fracionada arredonda UMA VEZ, no produto', () => {
    /**
     * 2,5 x R$ 0,33 = R$ 0,825. Arredondando uma vez, half-up: R$ 0,83.
     *
     * O que isto trava e a alternativa ingenua: quebrar a quantidade em
     * parcelas e arredondar cada uma (0,33 + 0,33 + 0,17 = R$ 0,83 aqui, mas
     * divergente em outros valores). A diferenca aparece linha a linha e, no
     * fechamento do mes, ninguem consegue explicar de onde veio.
     */
    const linha = calculateItemTotals({
      kind: 'service',
      description: 'Fracao de hora',
      quantity: '2.5',
      unitPrice: '0.33',
    });
    expect(linha.gross.toString()).toBe('0.83');
  });

  it('meia hora de bancada a R$ 90,00 da R$ 45,00 exatos', () => {
    const linha = calculateItemTotals({
      kind: 'service',
      description: 'Meia hora',
      quantity: '0.5',
      unitPrice: '90.00',
    });
    expect(linha.total.toString()).toBe('45.00');
  });

  it('half-up na casa dos centavos', () => {
    expect(
      calculateItemTotals({
        kind: 'part',
        description: 'x',
        quantity: '1',
        unitPrice: '2.345',
      }).total.toString(),
    ).toBe('2.35');
  });

  it('desconto de linha entra no total', () => {
    const linha = calculateItemTotals({
      kind: 'service',
      description: 'Bancada',
      quantity: '1',
      unitPrice: '200.00',
      discount: '20.00',
    });
    expect(linha.discount.toString()).toBe('20.00');
    expect(linha.total.toString()).toBe('180.00');
  });

  it('valor ZERO e permitido — cortesia existe (item 43)', () => {
    const linha = calculateItemTotals({
      kind: 'service',
      description: 'Limpeza cortesia',
      quantity: '1',
      unitPrice: '0',
    });
    expect(linha.total.isZero()).toBe(true);
  });

  it('recusa negativo e desconto maior que a linha (item 42)', () => {
    expect(() =>
      calculateItemTotals({ kind: 'part', description: 'x', quantity: '1', unitPrice: '-1.00' }),
    ).toThrow(RangeError);

    expect(() =>
      calculateItemTotals({
        kind: 'part',
        description: 'x',
        quantity: '1',
        unitPrice: '10.00',
        discount: '10.01',
      }),
    ).toThrow(RangeError);
  });
});

describe('totais do orcamento (itens 37 a 41)', () => {
  const itens = [
    { kind: 'service' as const, description: 'Bancada', quantity: '2', unitPrice: '80.00' },
    { kind: 'part' as const, description: 'Fonte', quantity: '1', unitPrice: '149.90' },
  ];

  it('subtotal e a soma das linhas; total desconta o global', () => {
    const totais = calculateQuoteTotals(itens, '9.90');
    expect(totais.subtotal.toString()).toBe('309.90');
    expect(totais.discount.toString()).toBe('9.90');
    expect(totais.total.toString()).toBe('300.00');
  });

  it('orcamento vazio soma zero, sem estourar', () => {
    expect(calculateQuoteTotals([]).total.toString()).toBe('0.00');
  });

  it('centavo isolado sobrevive a soma de muitas linhas', () => {
    // 100 linhas de R$ 0,01 sao exatamente R$ 1,00 — nada de 0,9999999.
    const centavos = Array.from({ length: 100 }, () => ({
      kind: 'other' as const,
      description: 'centavo',
      quantity: '1',
      unitPrice: '0.01',
    }));
    expect(calculateQuoteTotals(centavos).total.toString()).toBe('1.00');
  });

  it('valores grandes dentro do limite de DECIMAL(14,2)', () => {
    const totais = calculateQuoteTotals([
      { kind: 'part', description: 'grande', quantity: '1', unitPrice: '999999.99' },
    ]);
    expect(totais.total.toString()).toBe('999999.99');
  });

  it('recusa desconto global maior que o subtotal', () => {
    expect(() => calculateQuoteTotals(itens, '400.00')).toThrow(RangeError);
  });

  it('recusa desconto negativo', () => {
    expect(() => calculateQuoteTotals(itens, '-1.00')).toThrow(RangeError);
  });
});

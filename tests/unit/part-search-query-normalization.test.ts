import { describe, expect, it } from 'vitest';
import { normalizeSearchQuery } from '@/modules/part-search/domain/query-normalization';

/**
 * Itens 29, 30, 105, 170, 171: normalizacao nunca altera parte tecnica do
 * termo. Reusa `extractTechnicalAnchors` do Nexo56 AI (ADR-085) — mesma
 * tabela de testes obrigatorios adaptada para a busca de pecas.
 */

describe('normalizeSearchQuery', () => {
  it('preserva o codigo tecnico exatamente — modelo X123 nunca vira X132 (item 30, tabela obrigatoria)', () => {
    const result = normalizeSearchQuery('preciso da peca para o modelo X123');
    expect(result.displayTerm).toContain('X123');
    expect(result.anchors).toContain('x123');
    expect(result.anchors).not.toContain('x132');
  });

  it('colapsa espacos internos sem tocar em digito', () => {
    const result = normalizeSearchQuery('placa   fonte    220V');
    expect(result.displayTerm).toBe('placa fonte 220V');
  });

  it('preserva acentuacao Unicode no termo de exibicao (item 170)', () => {
    const result = normalizeSearchQuery('válvula de segurança');
    expect(result.displayTerm).toBe('válvula de segurança');
  });

  it('a chave de busca interna e minuscula e sem acento, mas o termo de exibicao nao muda', () => {
    const result = normalizeSearchQuery('Válvula ABC');
    expect(result.searchKey).toBe('valvula abc');
    expect(result.displayTerm).toBe('Válvula ABC');
  });

  it('220V e 220 V normalizam para a mesma ancora — diferenca de apresentacao, nao de fato', () => {
    const a = normalizeSearchQuery('fonte 220V');
    const b = normalizeSearchQuery('fonte 220 V');
    expect(a.anchors).toEqual(b.anchors);
  });

  it('220V e 127V continuam ancoras DIFERENTES — mudanca de fato', () => {
    const result = normalizeSearchQuery('220V');
    expect(result.anchors).not.toContain('127v');
  });

  it('trunca no limite maximo de tamanho (item 165/167) sem lancar', () => {
    const result = normalizeSearchQuery('a'.repeat(500));
    expect(result.displayTerm.length).toBeLessThanOrEqual(200);
  });

  it('e determinístico: mesma entrada, mesma saida', () => {
    const a = normalizeSearchQuery('placa ABC-123');
    const b = normalizeSearchQuery('placa ABC-123');
    expect(a).toEqual(b);
  });
});

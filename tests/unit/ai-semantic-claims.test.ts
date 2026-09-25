import { describe, expect, it } from 'vitest';
import { checkSemanticClaims } from '@/modules/ai/domain/semantic-claims';

/**
 * SEMANTIC CLAIM GUARD — segunda camada do Technical Meaning Guard.
 *
 * A ancora tecnica (`ai-technical-anchors.test.ts`) protege digito/codigo.
 * Este arquivo cobre o que muda de sentido SEM nenhum digito envolvido:
 * certeza, acao de reparo, promessa de prazo, garantia, teste ja
 * realizado. Os 10 casos A-J sao exatamente os do pedido de correcao.
 */

describe('A: escalada de certeza — "possivel falha" -> "falha confirmada" (REJECTED)', () => {
  it('rejeita', () => {
    const result = checkSemanticClaims('possível falha na fonte', 'falha na fonte confirmada');
    expect(result.ok).toBe(false);
    expect(result.introducedFamilies).toContain('certainty');
  });
});

describe('B: "suspeita de falha na placa" -> "foi constatada falha na placa" (REJECTED)', () => {
  it('rejeita', () => {
    const result = checkSemanticClaims(
      'suspeita de falha na placa',
      'foi constatada falha na placa',
    );
    expect(result.ok).toBe(false);
    expect(result.introducedFamilies).toContain('certainty');
  });
});

describe('C: escalada de acao — "verificar placa" -> "substituir placa" (REJECTED)', () => {
  it('rejeita', () => {
    const result = checkSemanticClaims('verificar placa principal', 'substituir placa principal');
    expect(result.ok).toBe(false);
    expect(result.introducedFamilies).toContain('action_repair');
  });
});

describe('D: promessa — "previsao de analise amanha" -> "ficara pronto amanha" (REJECTED)', () => {
  it('rejeita', () => {
    const result = checkSemanticClaims(
      'previsão de análise amanhã',
      'equipamento ficará pronto amanhã',
    );
    expect(result.ok).toBe(false);
    expect(result.introducedFamilies).toContain('promise');
  });
});

describe('E: garantia inventada — entrada sem garantia -> saida com garantia (REJECTED)', () => {
  it('rejeita', () => {
    const result = checkSemanticClaims('Equipamento não liga.', 'Serviço coberto pela garantia.');
    expect(result.ok).toBe(false);
    expect(result.introducedFamilies).toContain('warranty');
  });
});

describe('F: teste/constatacao inventada (REJECTED)', () => {
  it('rejeita "apos os testes realizados, foi constatado defeito" sem base no contexto', () => {
    const result = checkSemanticClaims(
      'Equipamento: Televisor\nRelato do cliente: equipamento não liga.\nObservações técnicas registradas: verificar fonte.',
      'Após os testes realizados, foi constatado defeito na fonte.',
    );
    expect(result.ok).toBe(false);
    expect(result.introducedFamilies).toEqual(
      expect.arrayContaining(['performed_test_claim', 'certainty']),
    );
  });
});

describe('G: reescrita incerta valida — permanece incerta (ACCEPTED)', () => {
  it('aceita', () => {
    const result = checkSemanticClaims(
      'possível falha na fonte',
      'Há indícios de possível falha na fonte, ainda em análise.',
    );
    expect(result.ok).toBe(true);
    expect(result.introducedFamilies).toEqual([]);
  });
});

describe('H: acao de inspecao reescrita, sem virar reparo (ACCEPTED)', () => {
  it('aceita', () => {
    const result = checkSemanticClaims(
      'verificar placa principal',
      'É necessário verificar a placa principal.',
    );
    expect(result.ok).toBe(true);
    expect(result.introducedFamilies).toEqual([]);
  });
});

describe('I: teste realizado JA presente na origem, reescrito profissionalmente (ACCEPTED)', () => {
  it('aceita porque a origem ja afirma o teste', () => {
    const result = checkSemanticClaims(
      'teste realizado confirmou falha na fonte',
      'Os testes realizados confirmaram falha na fonte.',
    );
    expect(result.ok).toBe(true);
    expect(result.introducedFamilies).toEqual([]);
  });
});

describe('J: garantia ja mencionada no contexto, reafirmada sem inventar condicao nova (ACCEPTED)', () => {
  it('aceita porque a garantia ja existia na origem', () => {
    const result = checkSemanticClaims(
      'Garantia válida em vigor, cobertura de 90 dias.',
      'O produto está em garantia, com cobertura de 90 dias.',
    );
    expect(result.ok).toBe(true);
    expect(result.introducedFamilies).toEqual([]);
  });
});

describe('normalizacao (maiuscula/acento nao e fato novo)', () => {
  it('"GARANTIA" e "garantia" contam como a mesma familia', () => {
    const result = checkSemanticClaims('Produto em GARANTIA.', 'Produto em garantia ativa.');
    expect(result.ok).toBe(true);
  });

  it('familia acentuada na saida e reconhecida mesmo se a origem usa forma sem acento', () => {
    const result = checkSemanticClaims(
      'sem nenhuma familia protegida aqui',
      'ficará pronto amanhã',
    );
    expect(result.ok).toBe(false);
    expect(result.introducedFamilies).toContain('promise');
  });
});

describe('nao e verificador semantico universal (item 9 — documentado, nao testado exaustivamente)', () => {
  it('texto sem nenhuma familia protegida em nenhum dos dois lados passa livremente', () => {
    const result = checkSemanticClaims(
      'Aparelho com tela quebrada, cliente relata queda.',
      'O aparelho apresenta tela quebrada, conforme relatado pelo cliente após uma queda.',
    );
    expect(result.ok).toBe(true);
    expect(result.introducedFamilies).toEqual([]);
  });
});

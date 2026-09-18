import { describe, expect, it } from 'vitest';
import { addMonths } from '@/core/time/civil-date';
import {
  canCancel,
  canReclassify,
  canRevoke,
  classificationLabel,
  countsAsRecurrence,
  daysRemaining,
  expiresWithin,
  explainNotEnforceable,
  formatDuration,
  formatWarrantyNumber,
  isPartialCoverage,
  isWarrantyClassification,
  isWarrantyEnforceable,
  normalizeReclassificationReason,
  normalizeWarrantyReason,
  originatesInternalWarrantyService,
  shouldCreateWarrantyServiceOrder,
  temporalClassOf,
  warrantyEndDate,
  warrantyTypeLabel,
  WARRANTY_TYPES,
} from '@/modules/warranties/domain/warranty';
import { initialStatusForOrigin } from '@/modules/service-orders/domain/workflow';

/**
 * DOMINIO DE GARANTIAS (Prompt 13, item 96).
 *
 * O que estes testes travam e a aritmetica de calendario e as regras que
 * decidem se a loja vai consertar de graca. Cada borda aqui e uma discussao
 * de balcao que o sistema precisa resolver sozinho, sempre do mesmo jeito.
 */

describe('aritmetica de meses no calendario civil (item 97)', () => {
  it('31/01 + 1 mes cai em 28/02, porque 31 de fevereiro nao existe', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('31/01 + 1 mes cai em 29/02 no ano bissexto', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('31/01 + 2 meses VOLTA para 31/03, em vez de ficar preso em 28', () => {
    /**
     * O dia ORIGINAL e a referencia de cada calculo. Encadear a partir do mes
     * anterior faria a serie inteira migrar para 28 depois do primeiro
     * fevereiro — o erro classico de calendario.
     */
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
  });

  it('atravessa o ano sem escorregar', () => {
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-12-31', 1)).toBe('2027-01-31');
  });

  it('30/01 + 1 mes tambem cai em 28/02', () => {
    expect(addMonths('2026-01-30', 1)).toBe('2026-02-28');
  });
});

describe('fim da vigencia (itens 9 e 35)', () => {
  it('dias somam dias', () => {
    expect(warrantyEndDate('2026-01-01', 90, 'days')).toBe('2026-04-01');
    expect(warrantyEndDate('2026-01-01', 30, 'days')).toBe('2026-01-31');
  });

  it('meses somam meses, caindo no dia aniversario', () => {
    expect(warrantyEndDate('2026-01-15', 3, 'months')).toBe('2026-04-15');
    expect(warrantyEndDate('2026-01-15', 12, 'months')).toBe('2027-01-15');
  });

  it('MES NAO E 30 DIAS: as duas unidades divergem de proposito (item 9)', () => {
    /**
     * Um contrato que diz "1 mes" nao diz "30 dias". Converter um no outro
     * silenciosamente inventaria termo comercial que ninguem assinou.
     */
    expect(warrantyEndDate('2026-01-31', 1, 'months')).toBe('2026-02-28');
    expect(warrantyEndDate('2026-01-31', 30, 'days')).toBe('2026-03-02');
  });

  it('recusa duracao zero, negativa ou fracionada', () => {
    expect(() => warrantyEndDate('2026-01-01', 0, 'days')).toThrow(RangeError);
    expect(() => warrantyEndDate('2026-01-01', -5, 'months')).toThrow(RangeError);
    expect(() => warrantyEndDate('2026-01-01', 1.5, 'days')).toThrow(RangeError);
  });
});

describe('classificacao temporal e as bordas (itens 14 e 35)', () => {
  const periodo = { startsOn: '2026-01-01', endsOn: '2026-12-31' };

  it('antes do inicio e "ainda nao comecou"', () => {
    expect(temporalClassOf(periodo, '2025-12-31')).toBe('future');
  });

  it('o PRIMEIRO dia ja vale', () => {
    expect(temporalClassOf(periodo, '2026-01-01')).toBe('valid');
  });

  it('o ULTIMO dia AINDA vale — o fim e inclusivo (item 35)', () => {
    expect(temporalClassOf(periodo, '2026-12-31')).toBe('valid');
  });

  it('o dia SEGUINTE ao vencimento ja expirou', () => {
    expect(temporalClassOf(periodo, '2027-01-01')).toBe('expired');
  });

  it('dias restantes contam o ultimo dia como zero, e negativam depois', () => {
    expect(daysRemaining(periodo, '2026-12-31')).toBe(0);
    expect(daysRemaining(periodo, '2026-12-30')).toBe(1);
    expect(daysRemaining(periodo, '2027-01-02')).toBe(-2);
  });

  it('"vence em breve" exclui o que ja venceu', () => {
    expect(expiresWithin(periodo, '2026-12-20', 30)).toBe(true);
    expect(expiresWithin(periodo, '2026-01-01', 30)).toBe(false);
    expect(expiresWithin(periodo, '2027-01-05', 30)).toBe(false);
  });
});

describe('acionabilidade: situacao administrativa E vigencia (item 14)', () => {
  const base = { type: 'internal', startsOn: '2026-01-01', endsOn: '2026-12-31' };

  it('ativa e dentro do prazo vale', () => {
    expect(isWarrantyEnforceable({ ...base, status: 'active' }, '2026-06-15')).toBe(true);
  });

  it('ativa e VENCIDA nao vale', () => {
    expect(isWarrantyEnforceable({ ...base, status: 'active' }, '2027-01-01')).toBe(false);
  });

  it('REVOGADA dentro do prazo nao vale', () => {
    expect(isWarrantyEnforceable({ ...base, status: 'revoked' }, '2026-06-15')).toBe(false);
  });

  it('rascunho nao vale: emitir e o ato que faz a garantia existir', () => {
    expect(isWarrantyEnforceable({ ...base, status: 'draft' }, '2026-06-15')).toBe(false);
  });

  it('a recusa e explicada em portugues de balcao', () => {
    expect(explainNotEnforceable({ ...base, status: 'revoked' }, '2026-06-15')).toMatch(
      /revogada/i,
    );
    expect(explainNotEnforceable({ ...base, status: 'active' }, '2027-01-01')).toMatch(
      /terminou em 31\/12\/2026/,
    );
    expect(explainNotEnforceable({ ...base, status: 'active' }, '2025-06-01')).toMatch(
      /comeca em 01\/01\/2026/,
    );
    expect(explainNotEnforceable({ ...base, status: 'active' }, '2026-06-15')).toBeNull();
  });
});

describe('quem origina Ordem de Servico de garantia (itens 23 e 33)', () => {
  it('SO a Garantia Interna origina', () => {
    expect(originatesInternalWarrantyService('internal')).toBe(true);
    for (const tipo of ['factory', 'part', 'extended']) {
      expect(originatesInternalWarrantyService(tipo)).toBe(false);
    }
  });

  it('exige as TRES condicoes: interna, vigente e avaliada como coberta', () => {
    const ok = { warrantyType: 'internal', enforceable: true, assessment: 'covered' };
    expect(shouldCreateWarrantyServiceOrder(ok)).toBe(true);

    expect(shouldCreateWarrantyServiceOrder({ ...ok, enforceable: false })).toBe(false);
    expect(shouldCreateWarrantyServiceOrder({ ...ok, assessment: 'not_covered' })).toBe(false);
    expect(shouldCreateWarrantyServiceOrder({ ...ok, warrantyType: 'factory' })).toBe(false);
  });

  it('"a avaliar" NAO gera OS de garantia', () => {
    /**
     * Duvida nao e compromisso de conserto gratuito. Transformar
     * `undetermined` em garantia aceita e o que faz a loja pagar pelo que
     * nunca prometeu.
     */
    expect(
      shouldCreateWarrantyServiceOrder({
        warrantyType: 'internal',
        enforceable: true,
        assessment: 'undetermined',
      }),
    ).toBe(false);
  });
});

describe('excecao do estado inicial da OS (itens 27 e 110)', () => {
  it('origem comum nasce em Aguardando Parecer Tecnico', () => {
    expect(initialStatusForOrigin({ kind: 'standard' })).toBe('awaiting_technical_opinion');
  });

  it('retorno de garantia nasce em Aguardando Conserto', () => {
    expect(
      initialStatusForOrigin({
        kind: 'warranty_return',
        warrantyId: 'g-1',
        originalServiceOrderId: 'os-1',
      }),
    ).toBe('awaiting_repair');
  });

  it('a funcao recebe ORIGEM, nunca um estado — a excecao nao e parametrizavel', () => {
    /**
     * Prova de forma: as unicas entradas possiveis sao as duas variantes da
     * uniao. Nao existe combinacao de dados que produza um terceiro estado
     * inicial, porque nao existe caminho que aceite `status` de fora.
     */
    const resultados = new Set([
      initialStatusForOrigin({ kind: 'standard' }),
      initialStatusForOrigin({
        kind: 'warranty_return',
        warrantyId: 'a',
        originalServiceOrderId: 'b',
      }),
    ]);
    expect(resultados).toEqual(new Set(['awaiting_technical_opinion', 'awaiting_repair']));
  });
});

describe('classificacao nao e estado (item 28)', () => {
  it('rotula em pt-BR e reconhece a de garantia', () => {
    expect(classificationLabel('warranty_internal')).toBe('Garantia Interna');
    expect(classificationLabel('standard')).toBe('Atendimento normal');
    expect(isWarrantyClassification('warranty_internal')).toBe(true);
    expect(isWarrantyClassification('standard')).toBe(false);
  });

  it('so OS de garantia se reclassifica', () => {
    expect(canReclassify('warranty_internal')).toBe(true);
    expect(canReclassify('standard')).toBe(false);
  });
});

describe('cobertura parcial (item 16)', () => {
  it('parcial e o complemento de "cobre o servico inteiro"', () => {
    expect(isPartialCoverage(false)).toBe(true);
    expect(isPartialCoverage(true)).toBe(false);
  });
});

describe('justificativa da reclassificacao (item 31)', () => {
  it('recusa vazio, espaco em branco e texto curto demais', () => {
    for (const ruim of ['', '   ', '\n\t ', 'nao coberto', 'sem garantia']) {
      expect(() => normalizeReclassificationReason(ruim)).toThrow(RangeError);
    }
  });

  it('aceita explicacao tecnica de verdade, normalizando espacos', () => {
    const texto = normalizeReclassificationReason(
      '  Oxidacao   por liquido na regiao do conector,\n posterior ao reparo da fonte. ',
    );
    expect(texto).toBe('Oxidacao por liquido na regiao do conector, posterior ao reparo da fonte.');
  });

  it('recusa texto absurdamente longo', () => {
    expect(() => normalizeReclassificationReason('a'.repeat(1001))).toThrow(RangeError);
  });
});

describe('cancelamento e revogacao sao coisas diferentes (item 62)', () => {
  it('cancelar vale para rascunho e ativa; revogar, so para ativa', () => {
    expect(canCancel('draft')).toBe(true);
    expect(canCancel('active')).toBe(true);
    expect(canCancel('revoked')).toBe(false);

    expect(canRevoke('active')).toBe(true);
    expect(canRevoke('draft')).toBe(false);
    expect(canRevoke('cancelled')).toBe(false);
  });

  it('os dois exigem motivo escrito', () => {
    expect(() => normalizeWarrantyReason('curto', 'do cancelamento')).toThrow(RangeError);
    expect(normalizeWarrantyReason('  Emitida  na OS errada por engano ', 'do cancelamento')).toBe(
      'Emitida na OS errada por engano',
    );
  });
});

describe('numeracao e rotulos', () => {
  it('formata o numero do certificado com prefixo e zeros', () => {
    expect(formatWarrantyNumber(1)).toBe('GAR 000001');
    expect(formatWarrantyNumber(123456)).toBe('GAR 123456');
  });

  it('todo tipo tem rotulo em pt-BR', () => {
    for (const tipo of WARRANTY_TYPES) {
      expect(warrantyTypeLabel(tipo)).not.toBe(tipo);
      expect(warrantyTypeLabel(tipo).length).toBeGreaterThan(3);
    }
  });

  it('duracao e escrita como as pessoas falam', () => {
    expect(formatDuration(1, 'months')).toBe('1 mes');
    expect(formatDuration(3, 'months')).toBe('3 meses');
    expect(formatDuration(1, 'days')).toBe('1 dia');
    expect(formatDuration(90, 'days')).toBe('90 dias');
  });
});

describe('reincidencia tem definicao escrita (item 87)', () => {
  it('conta so retorno de garantia interna vigente e coberto', () => {
    expect(
      countsAsRecurrence({
        warrantyType: 'internal',
        enforceableAtReturn: true,
        assessment: 'covered',
      }),
    ).toBe(true);
  });

  it('NAO conta retorno fora da cobertura nem garantia vencida', () => {
    expect(
      countsAsRecurrence({
        warrantyType: 'internal',
        enforceableAtReturn: true,
        assessment: 'not_covered',
      }),
    ).toBe(false);
    expect(
      countsAsRecurrence({
        warrantyType: 'internal',
        enforceableAtReturn: false,
        assessment: 'covered',
      }),
    ).toBe(false);
  });
});

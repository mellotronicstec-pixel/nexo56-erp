import { describe, expect, it } from 'vitest';
import {
  addDays,
  civilDateRangeToUtc,
  civilDaysFromNow,
  formatCivilDate,
  formatCivilDateBR,
  isDueOrOverdue,
  isOverdue,
  startOfCivilDayUtc,
  todayIn,
} from '@/core/time/civil-date';

/**
 * DATA CIVIL (ADR-017; Prompt 08, itens 37, 96 e 129).
 *
 * "Vence em +2 dias" e um DIA no fuso de quem opera, nao um instante. O bug que
 * estes testes existem para impedir e o classico: a data virar para o dia
 * anterior conforme o fuso do servidor, e uma ordem que vence "hoje" no balcao
 * aparecer como "ontem" no sistema — ou nem aparecer.
 */

describe('dia civil no fuso do tenant', () => {
  it('a MESMA hora e dia diferente em fusos diferentes', () => {
    // 03:00 UTC = 00:00 em Sao Paulo (UTC-3) e 23:00 do dia anterior em Manaus.
    const instante = new Date('2026-03-15T03:00:00.000Z');
    expect(formatCivilDate(instante, 'America/Sao_Paulo')).toBe('2026-03-15');
    expect(formatCivilDate(instante, 'America/Manaus')).toBe('2026-03-14');
    expect(formatCivilDate(instante, 'UTC')).toBe('2026-03-15');
  });

  it('a virada do dia acompanha o fuso, nao o servidor', () => {
    // 02:30 UTC ainda e dia 14 em Sao Paulo; 03:30 UTC ja e dia 15.
    expect(todayIn('America/Sao_Paulo', new Date('2026-03-15T02:30:00.000Z'))).toBe('2026-03-14');
    expect(todayIn('America/Sao_Paulo', new Date('2026-03-15T03:30:00.000Z'))).toBe('2026-03-15');
  });
});

describe('soma de dias corridos', () => {
  it('soma dias sem deslocar por horario de verao', () => {
    expect(addDays('2026-03-14', 2)).toBe('2026-03-16');
    expect(addDays('2026-10-17', 1)).toBe('2026-10-18');
  });

  it('atravessa mes, ano e ano bissexto', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('aceita dias negativos e zero', () => {
    expect(addDays('2026-03-16', -2)).toBe('2026-03-14');
    expect(addDays('2026-03-16', 0)).toBe('2026-03-16');
  });

  it('recusa data civil invalida em vez de devolver lixo', () => {
    expect(() => addDays('ontem', 1)).toThrow();
    expect(() => addDays('', 1)).toThrow();
  });

  it('+2 e +3 dias partem do dia do TENANT', () => {
    // 02:00 UTC ainda e dia 14 em Sao Paulo: o prazo conta a partir dali.
    const agora = new Date('2026-03-15T02:00:00.000Z');
    expect(civilDaysFromNow('America/Sao_Paulo', 2, agora)).toBe('2026-03-16');
    expect(civilDaysFromNow('America/Sao_Paulo', 3, agora)).toBe('2026-03-17');
    // O mesmo instante, em UTC, ja e dia 15: o prazo sai um dia depois.
    expect(civilDaysFromNow('UTC', 2, agora)).toBe('2026-03-17');
  });
});

describe('vencimento', () => {
  const agora = new Date('2026-03-15T12:00:00.000Z');

  it('vencido e ONTEM ou antes; hoje ainda nao esta vencido', () => {
    expect(isOverdue('2026-03-14', 'America/Sao_Paulo', agora)).toBe(true);
    expect(isOverdue('2026-03-15', 'America/Sao_Paulo', agora)).toBe(false);
    expect(isOverdue('2026-03-16', 'America/Sao_Paulo', agora)).toBe(false);
  });

  it('"vence hoje" entra no radar, mas nao e atraso', () => {
    expect(isDueOrOverdue('2026-03-15', 'America/Sao_Paulo', agora)).toBe(true);
    expect(isDueOrOverdue('2026-03-16', 'America/Sao_Paulo', agora)).toBe(false);
  });
});

describe('exibicao', () => {
  it('mostra em pt-BR sem passar por Date (que reintroduziria fuso)', () => {
    expect(formatCivilDateBR('2026-03-15')).toBe('15/03/2026');
  });

  it('texto que nao e data civil volta como veio', () => {
    expect(formatCivilDateBR('sem data')).toBe('sem data');
  });
});

describe('civil -> UTC boundary (ADR-084, Prompt 19.1)', () => {
  it('UTC: inicio do dia civil e literalmente 00:00:00.000Z', () => {
    expect(startOfCivilDayUtc('2026-09-24', 'UTC').toISOString()).toBe('2026-09-24T00:00:00.000Z');
  });

  it('America/Sao_Paulo (UTC-3, sem DST): meia-noite local e 03:00 UTC', () => {
    expect(startOfCivilDayUtc('2026-09-24', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-09-24T03:00:00.000Z',
    );
  });

  it('fuso POSITIVO (Asia/Tokyo, UTC+9): meia-noite local cai no dia UTC ANTERIOR — prova que a solucao nao e "UTC-3 hardcoded"', () => {
    expect(startOfCivilDayUtc('2026-09-24', 'Asia/Tokyo').toISOString()).toBe(
      '2026-09-23T15:00:00.000Z',
    );
  });

  it('range de 1 dia civil em America/Sao_Paulo: [03:00Z do dia, 03:00Z do dia seguinte)', () => {
    const { startUtc, endExclusiveUtc } = civilDateRangeToUtc(
      '2026-09-24',
      '2026-09-24',
      'America/Sao_Paulo',
    );
    expect(startUtc.toISOString()).toBe('2026-09-24T03:00:00.000Z');
    expect(endExclusiveUtc.toISOString()).toBe('2026-09-25T03:00:00.000Z');
  });

  it('fronteira de MES: ultimo dia de setembro ainda entra; 1o de outubro fica de fora (limite exclusivo)', () => {
    const { endExclusiveUtc } = civilDateRangeToUtc(
      '2026-09-01',
      '2026-09-30',
      'America/Sao_Paulo',
    );
    expect(endExclusiveUtc.toISOString()).toBe('2026-10-01T03:00:00.000Z');
  });

  it('fronteira de ANO: 31/dez ainda entra; 1o/jan do ano seguinte fica de fora', () => {
    const { endExclusiveUtc } = civilDateRangeToUtc(
      '2026-12-01',
      '2026-12-31',
      'America/Sao_Paulo',
    );
    expect(endExclusiveUtc.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('ANTIGA JANELA UTC 00:00-03:00: um instante gravado nessa janela pertence ao dia civil ANTERIOR em America/Sao_Paulo, e o range o inclui corretamente', () => {
    // 2026-09-24T02:00:00Z e, em Sao Paulo, ainda 2026-09-23 23:00 — dentro
    // do dia civil de 23/09, nao de 24/09. Esta e exatamente a janela que
    // causava o bug deterministico medido no fechamento do Prompt 19.
    const instanteNaJanelaProblematica = new Date('2026-09-24T02:00:00.000Z');
    const { startUtc, endExclusiveUtc } = civilDateRangeToUtc(
      '2026-09-23',
      '2026-09-23',
      'America/Sao_Paulo',
    );
    expect(instanteNaJanelaProblematica >= startUtc).toBe(true);
    expect(instanteNaJanelaProblematica < endExclusiveUtc).toBe(true);

    // E o range do dia 24 (o que o codigo antigo calcularia erroneamente
    // como dono desse instante) corretamente o EXCLUI.
    const rangeDoDia24 = civilDateRangeToUtc('2026-09-24', '2026-09-24', 'America/Sao_Paulo');
    expect(instanteNaJanelaProblematica >= rangeDoDia24.startUtc).toBe(false);
  });

  it('DST (America/New_York, spring-forward 2026-03-08): o dia civil tem 23 horas, nao 24 — prova que a implementacao usa fuso IANA real, nao offset fixo', () => {
    const inicioDia8 = startOfCivilDayUtc('2026-03-08', 'America/New_York');
    const inicioDia9 = startOfCivilDayUtc('2026-03-09', 'America/New_York');
    const horasNoDia = (inicioDia9.getTime() - inicioDia8.getTime()) / (60 * 60 * 1000);
    expect(horasNoDia).toBe(23);
    expect(inicioDia8.toISOString()).toBe('2026-03-08T05:00:00.000Z'); // ainda EST (UTC-5)
    expect(inicioDia9.toISOString()).toBe('2026-03-09T04:00:00.000Z'); // ja EDT (UTC-4)
  });

  it('timezone invalido lanca erro (nunca produz um instante silenciosamente errado)', () => {
    expect(() => startOfCivilDayUtc('2026-09-24', 'Nao/Existe')).toThrow();
  });

  it('data civil invalida lanca erro (formato errado, mes/dia fora do intervalo)', () => {
    expect(() => startOfCivilDayUtc('2026-13-01', 'UTC')).toThrow();
    expect(() => startOfCivilDayUtc('24-09-2026', 'UTC')).toThrow();
    expect(() => startOfCivilDayUtc('nao e uma data', 'UTC')).toThrow();
  });
});

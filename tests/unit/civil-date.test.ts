import { describe, expect, it } from 'vitest';
import {
  addDays,
  civilDaysFromNow,
  formatCivilDate,
  formatCivilDateBR,
  isDueOrOverdue,
  isOverdue,
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

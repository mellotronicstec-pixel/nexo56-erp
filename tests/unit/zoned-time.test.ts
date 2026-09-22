import { describe, expect, it } from 'vitest';
import {
  formatZonedTime,
  instantToZonedCivil,
  isCivilDateTime,
  zonedCivilToInstant,
  zoneOffsetAt,
} from '@/core/time/zoned-time';

/**
 * A CONVERSAO CIVIL <-> INSTANTE, com o fuso dito explicitamente.
 *
 * Sao Paulo nao tem horario de verao desde 2019, entao testar DST so com ele
 * nao provaria nada. Nova York e Lisboa tem, e o sistema e multiempresa: o
 * fuso e coluna configuravel, nao constante.
 */

describe('deslocamento do fuso', () => {
  it('Sao Paulo esta tres horas atras de Greenwich', () => {
    expect(zoneOffsetAt(new Date('2026-09-22T12:00:00.000Z'), 'America/Sao_Paulo')).toBe(
      -3 * 3_600_000,
    );
  });

  it('UTC tem deslocamento zero', () => {
    expect(zoneOffsetAt(new Date('2026-09-22T12:00:00.000Z'), 'UTC')).toBe(0);
  });

  it('Nova York muda de deslocamento conforme a epoca do ano', () => {
    const inverno = zoneOffsetAt(new Date('2026-01-15T12:00:00.000Z'), 'America/New_York');
    const verao = zoneOffsetAt(new Date('2026-07-15T12:00:00.000Z'), 'America/New_York');

    expect(inverno).toBe(-5 * 3_600_000);
    expect(verao).toBe(-4 * 3_600_000);
  });
});

describe('horario civil vira instante no fuso certo', () => {
  it('14h em Sao Paulo sao 17h UTC', () => {
    const { instant, kind } = zonedCivilToInstant('2026-09-22T14:00', 'America/Sao_Paulo');
    expect(kind).toBe('exact');
    expect(instant.toISOString()).toBe('2026-09-22T17:00:00.000Z');
  });

  it('14h em Toquio sao 5h UTC do mesmo dia', () => {
    const { instant } = zonedCivilToInstant('2026-09-22T14:00', 'Asia/Tokyo');
    expect(instant.toISOString()).toBe('2026-09-22T05:00:00.000Z');
  });

  it('22h em Sao Paulo ainda sao do MESMO dia civil, embora ja seja o dia seguinte em UTC', () => {
    const { instant } = zonedCivilToInstant('2026-09-22T22:00', 'America/Sao_Paulo');

    /** Em UTC virou dia 23 — e e exatamente por isso que o dia civil importa. */
    expect(instant.toISOString()).toBe('2026-09-23T01:00:00.000Z');
    expect(instantToZonedCivil(instant, 'America/Sao_Paulo')).toBe('2026-09-22T22:00');
  });

  it('o mesmo horario civil em fusos diferentes produz instantes diferentes', () => {
    const sp = zonedCivilToInstant('2026-09-22T14:00', 'America/Sao_Paulo').instant;
    const ny = zonedCivilToInstant('2026-09-22T14:00', 'America/New_York').instant;

    expect(sp.getTime()).not.toBe(ny.getTime());
  });

  it('a volta fecha: instante -> civil -> instante', () => {
    for (const fuso of ['America/Sao_Paulo', 'America/New_York', 'Europe/Lisbon', 'UTC']) {
      for (const civil of ['2026-01-15T08:30', '2026-07-15T19:45', '2026-12-31T23:59']) {
        const { instant } = zonedCivilToInstant(civil, fuso);
        expect(instantToZonedCivil(instant, fuso)).toBe(civil);
      }
    }
  });
});

describe('bordas de horario de verao', () => {
  /**
   * Nova York, 8 de marco de 2026: as 2h o relogio pula para as 3h. As 2h30
   * NAO EXISTEM naquele dia.
   */
  it('hora inexistente e sinalizada como `gap` e empurrada para depois da virada', () => {
    const { instant, kind } = zonedCivilToInstant('2026-03-08T02:30', 'America/New_York');

    expect(kind).toBe('gap');
    /** O instante devolvido e real e cai depois da virada. */
    expect(zoneOffsetAt(instant, 'America/New_York')).toBe(-4 * 3_600_000);
  });

  /**
   * Nova York, 1 de novembro de 2026: as 2h o relogio volta para 1h. As 1h30
   * acontecem DUAS vezes.
   */
  it('hora repetida e sinalizada como `ambiguous` e resolve para a PRIMEIRA ocorrencia', () => {
    const { instant, kind } = zonedCivilToInstant('2026-11-01T01:30', 'America/New_York');

    expect(kind).toBe('ambiguous');
    /** A primeira ocorrencia ainda esta no horario de verao (-4h). */
    expect(zoneOffsetAt(instant, 'America/New_York')).toBe(-4 * 3_600_000);
    expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('horario comum no mesmo dia da virada continua exato', () => {
    expect(zonedCivilToInstant('2026-03-08T10:00', 'America/New_York').kind).toBe('exact');
    expect(zonedCivilToInstant('2026-11-01T10:00', 'America/New_York').kind).toBe('exact');
  });

  it('um fuso sem horario de verao nunca produz borda', () => {
    for (const civil of ['2026-03-08T02:30', '2026-11-01T01:30', '2026-10-18T00:30']) {
      expect(zonedCivilToInstant(civil, 'America/Sao_Paulo').kind).toBe('exact');
    }
  });
});

describe('formato de entrada', () => {
  it('aceita com e sem segundos', () => {
    expect(isCivilDateTime('2026-09-22T14:00')).toBe(true);
    expect(isCivilDateTime('2026-09-22T14:00:30')).toBe(true);
  });

  it('recusa instante ISO com fuso, que e outra coisa', () => {
    expect(isCivilDateTime('2026-09-22T14:00:00.000Z')).toBe(false);
    expect(isCivilDateTime('2026-09-22')).toBe(false);
    expect(isCivilDateTime('qualquer coisa')).toBe(false);
  });

  it('recusa entrada invalida com erro, nao com data invalida silenciosa', () => {
    expect(() => zonedCivilToInstant('2026-09-22', 'UTC')).toThrow();
  });
});

describe('hora do dia para a tela', () => {
  it('mostra a hora no fuso da empresa, nao no de quem olha', () => {
    const instante = new Date('2026-09-23T01:00:00.000Z');

    expect(formatZonedTime(instante, 'America/Sao_Paulo')).toBe('22:00');
    expect(formatZonedTime(instante, 'UTC')).toBe('01:00');
  });
});

/**
 * Data civil no fuso do tenant (ADR-017; Prompt 08, itens 37 e 96).
 *
 * "Follow-up em +2 dias" nao e um instante: e um DIA inteiro no fuso de quem
 * opera. Guardar isso como timestamp produz o bug classico de a data virar
 * para o dia anterior conforme o servidor — e uma OS que vence "hoje" para o
 * banco e "ontem" para o atendente perde exatamente o proposito do prazo.
 *
 * Por isso tudo aqui e texto ISO `YYYY-MM-DD`, e toda conversao passa pelo
 * fuso do tenant explicitamente.
 */

/** Data civil de hoje no fuso indicado. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return formatCivilDate(now, timeZone);
}

/** Converte um instante para a data civil correspondente no fuso indicado. */
export function formatCivilDate(instant: Date, timeZone: string): string {
  // `en-CA` produz exatamente `YYYY-MM-DD`, sem depender de montagem manual.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Soma dias CORRIDOS a uma data civil.
 *
 * A aritmetica roda em UTC sobre a data ja resolvida no fuso do tenant, entao
 * horario de verao nao desloca o resultado: somar 2 dias a `2026-03-14` da
 * `2026-03-16` em qualquer fuso.
 */
export function addDays(civil: string, days: number): string {
  const [year, month, day] = civil.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`Data civil invalida: ${civil}`);

  const base = Date.UTC(year, month - 1, day);
  const moved = new Date(base + days * 86_400_000);

  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}-${String(
    moved.getUTCDate(),
  ).padStart(2, '0')}`;
}

/**
 * Soma MESES a uma data civil, preservando o dia como REFERENCIA.
 *
 * Dia 31 nao existe em todo mes, e o comportamento precisa ser previsivel:
 * o resultado cai no ULTIMO DIA do mes que nao tiver o dia escolhido.
 *
 *   2026-01-31 + 1 mes  ->  2026-02-28
 *   2026-01-31 + 2 meses ->  2026-03-31   (volta para 31, nao fica em 28)
 *   2024-01-31 + 1 mes  ->  2024-02-29    (ano bissexto)
 *
 * O dia ORIGINAL e a referencia de cada calculo, e nao o resultado do mes
 * anterior. Encadear a partir do anterior faria a serie inteira migrar para
 * o dia 28 depois do primeiro fevereiro — que e o erro classico.
 *
 * MES NAO E 30 DIAS. `addMonths(civil, 1)` e `addDays(civil, 30)` produzem
 * resultados diferentes de proposito: um contrato que diz "1 mes" nao diz
 * "30 dias", e o dominio precisa distinguir os dois (Prompt 13, item 9).
 */
export function addMonths(civil: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil);
  if (!match) throw new Error(`Data civil invalida: ${civil}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const total = month - 1 + months;
  const targetYear = year + Math.floor(total / 12);
  /** `%` em JavaScript devolve negativo para entrada negativa; o ajuste normaliza. */
  const targetMonth = ((total % 12) + 12) % 12;

  /** Dia 0 do mes SEGUINTE e o ultimo dia do mes alvo. */
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);

  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

/** Data civil de hoje mais `days` dias corridos, no fuso do tenant. */
export function civilDaysFromNow(timeZone: string, days: number, now: Date = new Date()): string {
  return addDays(todayIn(timeZone, now), days);
}

/** `true` quando a data civil ja passou ou e hoje, no fuso indicado. */
export function isDueOrOverdue(civil: string, timeZone: string, now: Date = new Date()): boolean {
  return civil <= todayIn(timeZone, now);
}

/** `true` quando a data civil ficou para tras (ontem ou antes). */
export function isOverdue(civil: string, timeZone: string, now: Date = new Date()): boolean {
  return civil < todayIn(timeZone, now);
}

/** Exibicao curta em pt-BR, sem passar por `Date` (que reintroduziria fuso). */
export function formatCivilDateBR(civil: string): string {
  const [year, month, day] = civil.split('-');
  if (!year || !month || !day) return civil;
  return `${day}/${month}/${year}`;
}

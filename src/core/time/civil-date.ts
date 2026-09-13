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

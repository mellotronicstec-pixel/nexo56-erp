import { zonedCivilToInstant } from '@/core/time/zoned-time';

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

/**
 * Dias corridos ENTRE duas datas civis (`to - from`). Aritmetica em UTC sobre
 * as datas ja resolvidas, mesma base de `addDays` — nao reintroduz fuso.
 *
 * Substitui `DATEDIFF(DATE(coluna_instante), ...)` (ADR-084, Prompt 19.1):
 * a data civil de cada lado deve vir de `formatCivilDate(instante, timeZone)`,
 * nao de `DATE()` do MariaDB, que usa o fuso da SESSAO (UTC) e nao o do
 * tenant.
 */
export function civilDaysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  if (!fromYear || !fromMonth || !fromDay) throw new Error(`Data civil invalida: ${from}`);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  if (!toYear || !toMonth || !toDay) throw new Error(`Data civil invalida: ${to}`);

  const fromMs = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toMs = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.round((toMs - fromMs) / 86_400_000);
}

/** `true` quando a data civil ja passou ou e hoje, no fuso indicado. */
export function isDueOrOverdue(civil: string, timeZone: string, now: Date = new Date()): boolean {
  return civil <= todayIn(timeZone, now);
}

/** `true` quando a data civil ficou para tras (ontem ou antes). */
export function isOverdue(civil: string, timeZone: string, now: Date = new Date()): boolean {
  return civil < todayIn(timeZone, now);
}

/**
 * Hora civil `HH:mm` de agora, no fuso indicado (Prompt 19, item 19).
 *
 * O Schedule Coordinator compara isto contra o horario configurado na regra
 * — nunca `now.getUTCHours()`, que daria "09:00" errado para qualquer fuso
 * diferente de UTC (a mesma armadilha que `todayIn` evita para datas).
 */
export function nowTimeIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

/** Exibicao curta em pt-BR, sem passar por `Date` (que reintroduziria fuso). */
export function formatCivilDateBR(civil: string): string {
  const [year, month, day] = civil.split('-');
  if (!year || !month || !day) return civil;
  return `${day}/${month}/${year}`;
}

// ---------------------------------------------------------------------------
// Fronteira civil -> instante UTC (Prompt 19.1 — ADR-084)
// ---------------------------------------------------------------------------

/**
 * DATA CIVIL NAO E INSTANTE UTC (ADR-084).
 *
 * Um periodo como "hoje" ou "ultimos 30 dias" e sempre um par de DATAS CIVIS
 * no fuso do tenant/unidade — nunca um par de instantes UTC. Tratar
 * `2026-09-24T00:00:00.000Z` como "o inicio do dia 24 de setembro" so esta
 * certo quando o fuso E UTC. Para qualquer outro fuso (`America/Sao_Paulo`,
 * UTC-3), a meia-noite local do dia 24 e `2026-09-24T03:00:00.000Z` — nao
 * `2026-09-24T00:00:00.000Z`. O bug classico (medido e corrigido no
 * fechamento do Prompt 19): comparar uma coluna `DATETIME` UTC contra o
 * limite ingenuo `${civil}T00:00:00.000Z`/`${civil}T23:59:59.999Z` exclui
 * dados reais gravados nas primeiras horas UTC do dia, sempre que o fuso do
 * tenant estiver ATRAS de UTC.
 *
 * A funcao abaixo e o UNICO lugar do sistema que resolve essa fronteira para
 * PERIODOS/RANGES — nenhum modulo deve reimplementar a conversao (item 24 do
 * hotfix). Ela NAO reimplementa a aritmetica de fuso: delega para
 * `zonedCivilToInstant` (`@/core/time/zoned-time`), o mesmo primitivo ja
 * usado pela Agenda (`appointment-service.ts`) para resolver
 * `startAtLocal`/`endAtLocal` — que ja trata corretamente as bordas de
 * horario de verao (`gap`/`ambiguous`), entao criar uma segunda formula aqui
 * so divergiria dele com o tempo. Nunca depende do fuso do processo Node
 * (`process.env.TZ`) nem da sessao do MariaDB: a aplicacao produz o instante
 * UTC explicitamente antes de consultar a coluna.
 */

function parseCivilDateStrict(civil: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil);
  if (!match) throw new Error(`Data civil invalida: ${civil}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Data civil invalida: ${civil}`);
  }
  return { year, month, day };
}

/** Instante UTC do INICIO (00:00:00.000 local) da data civil, no fuso indicado. */
export function startOfCivilDayUtc(civil: string, timeZone: string): Date {
  parseCivilDateStrict(civil); // valida formato/limites antes de delegar
  return zonedCivilToInstant(`${civil}T00:00`, timeZone).instant;
}

/**
 * Converte um par de datas civis INCLUSIVO `[from, to]`, no fuso indicado,
 * para um intervalo de instantes UTC MEIO-ABERTO `[startUtc, endExclusiveUtc)`
 * — a forma segura de consultar uma coluna `DATETIME` UTC (item 11/55 do
 * hotfix): nunca depende de `23:59:59.999`, nunca perde milissegundos, e
 * continua correta mesmo quando o dia civil final tem 23 ou 25 horas (DST) —
 * `endExclusiveUtc` e o INICIO REAL do dia seguinte, calculado independente
 * da duracao do dia anterior, nunca `start + 24h`.
 *
 * Uso pretendido: `WHERE column >= startUtc AND column < endExclusiveUtc`.
 */
export function civilDateRangeToUtc(
  from: string,
  to: string,
  timeZone: string,
): { startUtc: Date; endExclusiveUtc: Date } {
  return {
    startUtc: startOfCivilDayUtc(from, timeZone),
    endExclusiveUtc: startOfCivilDayUtc(addDays(to, 1), timeZone),
  };
}

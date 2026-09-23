import { addDays, todayIn } from '@/core/time/civil-date';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Escopo do Painel (Prompt 18).
 *
 * TUDO que uma metrica precisa para ser consultada com seguranca vive aqui,
 * resolvido UMA vez no servidor: nunca em cada adaptador de dominio.
 *
 * "TODAS AS UNIDADES" NUNCA E O TENANT INTEIRO (itens 19 a 22). `selectedUnitIds`
 * e sempre um subconjunto de `authorizedUnitIds` — nunca o contrario, e nunca
 * calculado a partir de um valor bruto vindo do browser. `resolveAnalyticsScope`
 * e o UNICO lugar que faz essa intersecao; nenhum adaptador de dominio aceita
 * `unitId` de fora deste objeto.
 */
export interface AnalyticsScope {
  readonly tenantId: string;
  readonly timezone: string;
  /** Unidades que o usuario pode acessar (membership do TenantContext). */
  readonly authorizedUnitIds: readonly string[];
  /**
   * Unidades efetivamente consultadas nesta chamada. SEMPRE subconjunto de
   * `authorizedUnitIds` (item 122). Vazio quando a pessoa pediu apenas
   * unidades que nao pode ver (item 123) — nunca cai para "todas".
   */
  readonly selectedUnitIds: readonly string[];
  /** `true` quando `selectedUnitIds` e exatamente `authorizedUnitIds` (item 22). */
  readonly allUnitsSelected: boolean;
  readonly period: DashboardPeriod;
  /** Hoje, na data civil do tenant — nunca no fuso do browser (ADR-076). */
  readonly today: string;
}

// ---------------------------------------------------------------------------
// Periodo
// ---------------------------------------------------------------------------

export const PERIOD_KEYS = [
  'today',
  '7d',
  '30d',
  'this_month',
  'last_month',
  '90d',
  'custom',
] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export function isPeriodKey(value: string): value is PeriodKey {
  return (PERIOD_KEYS as readonly string[]).includes(value);
}

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: 'Hoje',
  '7d': 'Ultimos 7 dias',
  '30d': 'Ultimos 30 dias',
  this_month: 'Este mes',
  last_month: 'Mes anterior',
  '90d': 'Ultimos 90 dias',
  custom: 'Personalizado',
};

export interface DashboardPeriod {
  readonly key: PeriodKey;
  /** Data civil inicial, INCLUSIVA, no fuso do tenant. */
  readonly from: string;
  /** Data civil final, INCLUSIVA, no fuso do tenant. */
  readonly to: string;
  readonly label: string;
}

/** Filtro personalizado nao pode varrer mais que isto (item 16). */
export const MAX_CUSTOM_RANGE_DAYS = 366;

const DEFAULT_PERIOD_KEY: PeriodKey = '30d';

function firstDayOfMonth(civil: string): string {
  return `${civil.slice(0, 7)}-01`;
}

function lastDayOfMonth(civil: string): string {
  const [year, month] = civil.split('-').map(Number);
  if (!year || !month) return civil;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Resolve o periodo a partir da URL — ENTRADA NAO CONFIAVEL (item 92 e mesma
 * regra da Central): chave desconhecida ou datas invalidas nunca quebram a
 * pagina, sempre caem no padrao seguro de 30 dias, em silencio, exatamente
 * como `parseView`/`parseQueue` da Central de Trabalho.
 */
export function resolvePeriod(
  timezone: string,
  input: { key?: string; from?: string; to?: string } = {},
  now: Date = new Date(),
): DashboardPeriod {
  const today = todayIn(timezone, now);
  const key = input.key && isPeriodKey(input.key) ? input.key : DEFAULT_PERIOD_KEY;

  if (key === 'today') return { key, from: today, to: today, label: PERIOD_LABEL.today };
  if (key === '7d') {
    return { key, from: addDays(today, -6), to: today, label: PERIOD_LABEL['7d'] };
  }
  if (key === '30d') {
    return { key, from: addDays(today, -29), to: today, label: PERIOD_LABEL['30d'] };
  }
  if (key === '90d') {
    return { key, from: addDays(today, -89), to: today, label: PERIOD_LABEL['90d'] };
  }
  if (key === 'this_month') {
    return { key, from: firstDayOfMonth(today), to: today, label: PERIOD_LABEL.this_month };
  }
  if (key === 'last_month') {
    const lastMonthAnyDay = addDays(firstDayOfMonth(today), -1);
    return {
      key,
      from: firstDayOfMonth(lastMonthAnyDay),
      to: lastDayOfMonth(lastMonthAnyDay),
      label: PERIOD_LABEL.last_month,
    };
  }

  // key === 'custom'
  const isCivilDate = (value: string | undefined): value is string =>
    !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (!isCivilDate(input.from) || !isCivilDate(input.to) || input.from > input.to) {
    return {
      key: DEFAULT_PERIOD_KEY,
      from: addDays(today, -29),
      to: today,
      label: PERIOD_LABEL['30d'],
    };
  }

  /**
   * Limite maximo, sem quebrar a pagina (item 16): em vez de rejeitar, o
   * inicio e trazido para perto do fim. A pessoa ve um periodo mais estreito
   * do que pediu, nunca um erro nem uma consulta sem limite.
   */
  const earliestAllowed = addDays(input.to, -(MAX_CUSTOM_RANGE_DAYS - 1));
  const from = input.from < earliestAllowed ? earliestAllowed : input.from;

  return { key: 'custom', from, to: input.to, label: PERIOD_LABEL.custom };
}

// ---------------------------------------------------------------------------
// Escopo de unidade
// ---------------------------------------------------------------------------

/**
 * "Todas as unidades" (item 22) = todas as AUTORIZADAS, nunca o tenant
 * inteiro. Unidade pedida que a pessoa nao pode acessar e descartada em
 * silencio (item 93) — conhecer o ID de outra unidade nao concede acesso.
 */
function resolveSelectedUnitIds(
  authorizedUnitIds: readonly string[],
  requested: readonly string[] | undefined,
): readonly string[] {
  if (!requested || requested.length === 0) return authorizedUnitIds;
  const wanted = new Set(requested);
  return authorizedUnitIds.filter((id) => wanted.has(id));
}

export function resolveAnalyticsScope(
  context: TenantContext,
  filters: { unitIds?: readonly string[]; period?: string; from?: string; to?: string } = {},
): AnalyticsScope {
  const selectedUnitIds = resolveSelectedUnitIds(context.authorizedUnitIds, filters.unitIds);

  return {
    tenantId: context.tenantId,
    timezone: context.tenantTimezone,
    authorizedUnitIds: context.authorizedUnitIds,
    selectedUnitIds,
    allUnitsSelected: selectedUnitIds.length === context.authorizedUnitIds.length,
    period: resolvePeriod(context.tenantTimezone, {
      key: filters.period,
      from: filters.from,
      to: filters.to,
    }),
    today: todayIn(context.tenantTimezone),
  };
}

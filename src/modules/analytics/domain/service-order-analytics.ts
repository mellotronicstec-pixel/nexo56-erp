/**
 * Regras PURAS de agregacao de OS para o Painel (Prompt 18).
 *
 * Nenhuma funcao aqui consulta o banco. Cada uma recebe numeros ja lidos e
 * devolve o resultado — por isso sao testaveis com fixture pequena e
 * matematicamente comprovavel (item 141), sem depender de MariaDB nem de
 * fuso horario.
 */

// ---------------------------------------------------------------------------
// Antiguidade do backlog (item 40)
// ---------------------------------------------------------------------------

export interface AgingBucketDefinition {
  key: string;
  label: string;
  /** Dias MINIMOS da faixa, inclusive. */
  minDays: number;
  /** Dias MAXIMOS da faixa, inclusive; `null` = sem teto (a ultima faixa). */
  maxDays: number | null;
}

/**
 * As faixas oficiais (item 40). A idade nasce SEMPRE de `opened_at` — "tempo
 * no estado atual" e outra metrica (item 41) e este modulo nao a mistura
 * aqui.
 */
export const AGING_BUCKETS: readonly AgingBucketDefinition[] = [
  { key: '0-2', label: '0-2 dias', minDays: 0, maxDays: 2 },
  { key: '3-7', label: '3-7 dias', minDays: 3, maxDays: 7 },
  { key: '8-15', label: '8-15 dias', minDays: 8, maxDays: 15 },
  { key: '16-30', label: '16-30 dias', minDays: 16, maxDays: 30 },
  { key: '30+', label: '30+ dias', minDays: 31, maxDays: null },
];

export interface AgingBucketResult {
  key: string;
  label: string;
  total: number;
}

/** Classifica UM dia de antiguidade na faixa oficial correspondente. */
export function agingBucketFor(ageDays: number): AgingBucketDefinition {
  for (const bucket of AGING_BUCKETS) {
    if (ageDays >= bucket.minDays && (bucket.maxDays === null || ageDays <= bucket.maxDays)) {
      return bucket;
    }
  }
  // Idade negativa (relogio do servidor) cai na primeira faixa, nunca quebra.
  return AGING_BUCKETS[0]!;
}

/**
 * Agrupa uma lista de idades (em dias) nas faixas oficiais. Faixa sem OS
 * aparece com 0 — nunca some (mesma regra de `WORK_QUEUES`/`queueCounts`).
 */
export function bucketBacklogAging(ageDaysList: readonly number[]): AgingBucketResult[] {
  const counts = new Map<string, number>();
  for (const bucket of AGING_BUCKETS) counts.set(bucket.key, 0);

  for (const ageDays of ageDaysList) {
    const bucket = agingBucketFor(ageDays);
    counts.set(bucket.key, (counts.get(bucket.key) ?? 0) + 1);
  }

  return AGING_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    total: counts.get(bucket.key) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Tempo de ciclo (itens 42 a 44)
// ---------------------------------------------------------------------------

export interface CycleTimeStats {
  sampleSize: number;
  medianDays: number;
  averageDays: number;
}

/**
 * Mediana e media de uma amostra de duracoes (item 43). Amostra vazia devolve
 * `null` — a UI mostra "Sem dados suficientes" (item 44), NUNCA "0 dias": zero
 * dias e uma duracao real, e nao pode significar "sem OS finalizada".
 */
export function computeCycleTimeStats(durationsInDays: readonly number[]): CycleTimeStats | null {
  if (durationsInDays.length === 0) return null;

  const sorted = [...durationsInDays].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianDays =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;

  const averageDays = sorted.reduce((total, value) => total + value, 0) / sorted.length;

  return { sampleSize: sorted.length, medianDays, averageDays };
}

// ---------------------------------------------------------------------------
// Taxa de aprovacao de orcamento (item 48)
// ---------------------------------------------------------------------------

/**
 * `approved / (approved + rejected)`. Pendentes NUNCA entram no denominador
 * (item 48) — decidir isso aqui, uma vez, impede que a UI "esqueca" a regra.
 * `null` quando nao houve NENHUMA decisao no periodo: a UI mostra "—"
 * (item 18), nunca `Infinity`/`NaN`.
 */
export function computeApprovalRate(approved: number, rejected: number): number | null {
  const denominator = approved + rejected;
  if (denominator === 0) return null;
  return approved / denominator;
}

import 'server-only';
import { pruneExpiredSessions } from '@/modules/auth/application/session-service';
import { requeueStaleJobs } from '@/modules/jobs/application/job-queue';
import { sweepOverdueFollowUps } from '@/modules/service-orders/application/follow-up-job';
import type { JobHandler } from '@/modules/jobs/domain/job';

/**
 * Registro de handlers (Prompt 01, itens 33 a 35).
 *
 * Jobs tecnicos da fundacao mais os jobs de NEGOCIO que os modulos trouxeram.
 * A regra de cada um vive no modulo dono; aqui fica so o nome e a
 * periodicidade, para que a expressao cron nunca precise conhecer negocio.
 */

/**
 * Limpeza de sessoes expiradas.
 * Naturalmente idempotente: a segunda execucao nao encontra o que remover.
 */
const pruneSessionsJob: JobHandler<Record<string, never>> = {
  name: 'session.prune-expired',
  async handle() {
    const removed = await pruneExpiredSessions();
    return { summary: 'sessoes expiradas removidas', affected: removed };
  },
};

/** Devolve a fila jobs travados por queda de processo. */
const requeueStaleJobsJob: JobHandler<{ olderThanMinutes?: number }> = {
  name: 'jobs.requeue-stale',
  async handle(payload) {
    const requeued = await requeueStaleJobs(payload?.olderThanMinutes ?? 15);
    return { summary: 'jobs travados devolvidos a fila', affected: requeued };
  },
};

/**
 * Marca as Ordens de Servico com acompanhamento vencido (Prompt 08).
 *
 * Idempotente por construcao: a ordem guarda para qual prazo o alerta ja saiu,
 * e a marcacao acontece no `WHERE` do proprio `UPDATE`. Rodar duas vezes no
 * mesmo dia nao emite dois eventos.
 *
 * NAO envia comunicacao: publica evento, que e o que existe hoje.
 */
const followUpSweepJob: JobHandler<Record<string, never>> = {
  name: 'service-order.follow-up-sweep',
  async handle() {
    const result = await sweepOverdueFollowUps();
    return { summary: 'ordens com acompanhamento vencido marcadas', affected: result.flagged };
  },
};

const HANDLERS: readonly JobHandler<never>[] = [
  pruneSessionsJob as JobHandler<never>,
  requeueStaleJobsJob as JobHandler<never>,
  followUpSweepJob as JobHandler<never>,
];

const BY_NAME = new Map(HANDLERS.map((handler) => [handler.name, handler]));

export function findJobHandler(name: string): JobHandler<never> | undefined {
  return BY_NAME.get(name);
}

export function listJobNames(): string[] {
  return [...BY_NAME.keys()];
}

/**
 * Agenda recorrente (Prompt 01, item 35).
 *
 * A expressao cron NAO vive dentro da regra de negocio: o hPanel chama um
 * unico comando (`npm run jobs:run`) e a periodicidade logica fica declarada
 * aqui, em um so lugar.
 */
export const RECURRING_JOBS = [
  { name: 'session.prune-expired', everyMinutes: 60 },
  { name: 'jobs.requeue-stale', everyMinutes: 15 },
  /**
   * De hora em hora, e nao uma vez por dia: empresas em fusos diferentes viram
   * a data em horas diferentes, e o job precisa alcancar cada uma logo depois
   * da virada dela. Como e idempotente, as execucoes a mais nao custam nada.
   */
  { name: 'service-order.follow-up-sweep', everyMinutes: 60 },
] as const;

import 'server-only';
import { pruneExpiredSessions } from '@/modules/auth/application/session-service';
import { requeueStaleJobs } from '@/modules/jobs/application/job-queue';
import type { JobHandler } from '@/modules/jobs/domain/job';

/**
 * Registro de handlers (Prompt 01, itens 33 a 35).
 *
 * Apenas jobs tecnicos REAIS da fundacao. Jobs de negocio (follow-up de OS,
 * alertas, automacoes) serao registrados pelos modulos correspondentes.
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

const HANDLERS: readonly JobHandler<never>[] = [
  pruneSessionsJob as JobHandler<never>,
  requeueStaleJobsJob as JobHandler<never>,
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
] as const;

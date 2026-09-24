import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import type { DomainEvent } from '@/modules/events/domain/event';
import type { JobHandler } from '@/modules/jobs/domain/job';
import { processAutomationEvent } from './event-processor';
import { runScheduleTick } from './schedule-coordinator';

/**
 * JOBS DO MOTOR (Prompt 19, item 82 a 84 e 243).
 *
 * "Engine != Job Queue" (item 83): o job e so o MECANISMO de processamento
 * (claim atomico, retry/backoff, recuperacao de orfa — tudo ja existente,
 * reaproveitado sem reescrever nada). A EXECUCAO (`automation_executions`) e
 * o fato de negocio; o job so chama quem sabe criar/retomar execucoes.
 *
 * PAYLOAD MINIMO (item 84): so o id do evento, nunca PII, nunca o payload
 * inteiro do evento — quem precisar do payload busca de novo em
 * `domain_events`, dentro do handler.
 */

export interface DispatchEventPayload {
  eventId: string;
}

export const dispatchEventJob: JobHandler<DispatchEventPayload> = {
  name: 'automation.dispatch-event',
  maxAttempts: 5,
  async handle(payload) {
    const [row] = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.id, payload.eventId))
      .limit(1);
    if (!row) return { summary: 'evento nao encontrado (pode ja ter sido limpo)' };

    const event: DomainEvent = {
      id: row.id,
      type: row.type as DomainEvent['type'],
      tenantId: row.tenantId,
      payload: row.payload as Record<string, unknown>,
      correlationId: row.correlationId,
      occurredAt: row.occurredAt,
    };

    await processAutomationEvent(event);
    return { summary: 'evento processado pelo motor de automacoes' };
  },
};

export const scheduleTickJob: JobHandler<Record<string, never>> = {
  name: 'automation.schedule-tick',
  maxAttempts: 3,
  async handle() {
    const result = await runScheduleTick();
    return { summary: 'regras agendadas avaliadas', affected: result.triggered };
  },
};

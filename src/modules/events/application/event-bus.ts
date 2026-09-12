import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { getContext } from '@/core/context/request-context';
import { newId } from '@/core/ids/id';
import { logger } from '@/core/logging/logger';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import type { DomainEvent, EventHandler, EventType } from '@/modules/events/domain/event';

/**
 * Barramento de eventos em processo (Prompt 01, itens 31 e 32).
 *
 * ESTRATEGIA TRANSACIONAL:
 *  1. `recordEvent` grava o evento na MESMA transacao da operacao de negocio;
 *  2. o despacho aos handlers acontece SOMENTE APOS o commit;
 *  3. se a transacao falhar, o evento desaparece junto — nenhum handler e
 *     chamado para algo que nao aconteceu.
 *
 * A tabela `domain_events` ja tem formato de outbox (`published_at`), entao
 * trocar o despacho em processo por um worker que le eventos nao publicados
 * nao exige mudanca no dominio.
 */

type HandlerRegistry = Map<EventType, EventHandler[]>;

const globalRegistry = globalThis as unknown as { __nexo56EventHandlers?: HandlerRegistry };

function registry(): HandlerRegistry {
  globalRegistry.__nexo56EventHandlers ??= new Map();
  return globalRegistry.__nexo56EventHandlers;
}

export function subscribe(type: EventType, handler: EventHandler): void {
  const handlers = registry().get(type) ?? [];
  handlers.push(handler);
  registry().set(type, handlers);
}

export function clearSubscriptions(): void {
  registry().clear();
}

export interface RecordEventInput {
  type: EventType;
  tenantId: string | null;
  payload: Record<string, unknown>;
}

type Executor = Pick<ReturnType<typeof getDb>, 'insert'>;

/**
 * Grava o evento. Deve ser chamado DENTRO da transacao da operacao,
 * passando o executor da transacao em `tx`.
 */
export async function recordEvent(input: RecordEventInput, tx?: Executor): Promise<DomainEvent> {
  const executor = tx ?? getDb();
  const event: DomainEvent = {
    id: newId(),
    type: input.type,
    tenantId: input.tenantId,
    payload: input.payload,
    correlationId: getContext()?.correlationId ?? null,
    occurredAt: new Date(),
  };

  await executor.insert(domainEvents).values({
    id: event.id,
    tenantId: event.tenantId,
    type: event.type,
    payload: event.payload,
    correlationId: event.correlationId,
    occurredAt: event.occurredAt,
    publishedAt: null,
  });

  return event;
}

/**
 * Entrega os eventos aos handlers. Chamado apos o commit.
 * A falha de um handler nunca derruba a operacao ja confirmada: e registrada
 * e o evento permanece com `published_at` nulo para reprocessamento futuro.
 */
export async function dispatch(events: readonly DomainEvent[]): Promise<void> {
  const db = getDb();

  for (const event of events) {
    const handlers = registry().get(event.type) ?? [];
    let allSucceeded = true;

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        allSucceeded = false;
        logger.error('Handler de evento falhou', {
          module: 'events',
          operation: 'dispatch',
          eventType: event.type,
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (allSucceeded) {
      await db
        .update(domainEvents)
        .set({ publishedAt: new Date() })
        .where(eq(domainEvents.id, event.id));
    }
  }
}

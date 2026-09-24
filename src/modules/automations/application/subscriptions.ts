import 'server-only';
import { subscribe } from '@/modules/events/application/event-bus';
import { enqueue } from '@/modules/jobs/application/job-queue';
import { AUTOMATION_TRIGGERS } from '@/modules/automations/domain/trigger-catalog';

/**
 * A COSTURA COM O EVENT BUS (Prompt 19, itens 74 e 75).
 *
 * Uma inscricao POR EVENTO DE ORIGEM do catalogo de gatilhos — nunca dentro
 * do produtor (item 74). O handler NAO faz o trabalho pesado aqui dentro:
 * ele so enfileira um job (`automation.dispatch-event`), com uma chave de
 * idempotencia derivada do ID do proprio evento. Isso tira o Motor do
 * caminho critico da requisicao original (item 151/152 — efeito externo
 * acontece DEPOIS do commit, fora da transacao que gerou o fato) e reusa a
 * MESMA garantia de "outbox pode ser redelivered sem duplicar" que o resto
 * do sistema ja tem (item 75): redeliver do evento so produz um segundo
 * `enqueue` com a MESMA `idempotencyKey`, que o proprio job-queue deduplica.
 *
 * Duas assinaturas hoje (uma por evento de origem distinto no catalogo de
 * gatilhos) — nao uma por REGRA. Quais regras casam com o evento e decidido
 * depois, dentro do job, por `processAutomationEvent`.
 */

const flag = globalThis as unknown as { __nexo56AutomationSubscriptions?: boolean };

const SOURCE_EVENTS = [
  ...new Set(
    Object.values(AUTOMATION_TRIGGERS)
      .map((t) => t.sourceEvent)
      .filter((e): e is NonNullable<typeof e> => e !== null),
  ),
];

export function registerAutomationSubscriptions(): void {
  /** Idempotente pelo mesmo motivo de `registerCommunicationSubscriptions`:
   *  o Next recarrega modulos em desenvolvimento. */
  if (flag.__nexo56AutomationSubscriptions) return;
  flag.__nexo56AutomationSubscriptions = true;

  for (const eventType of SOURCE_EVENTS) {
    subscribe(eventType, async (event) => {
      if (!event.tenantId) return;
      await enqueue({
        name: 'automation.dispatch-event',
        tenantId: event.tenantId,
        payload: { eventId: event.id },
        idempotencyKey: `automation:dispatch:${event.id}`,
      });
    });
  }
}

/** Desfaz a marca de registro. Existe para teste. */
export function resetAutomationSubscriptionsForTesting(): void {
  flag.__nexo56AutomationSubscriptions = false;
}

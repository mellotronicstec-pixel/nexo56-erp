import 'server-only';
import { sql } from 'drizzle-orm';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { logger } from '@/core/logging/logger';
import { todayIn } from '@/core/time/civil-date';
import { EVENT_TYPES } from '@/modules/events/domain/event';

/**
 * Varredura de follow-ups vencidos (Prompt 08, itens 44 a 46 e 100 a 103).
 *
 * O QUE ESTE JOB NAO FAZ: enviar mensagem para ninguem. Nao ha canal de
 * comunicacao no sistema (Prompt 16), e nao ha central de notificacao interna.
 * Ele publica um EVENTO por ordem recem-vencida, que fica no outbox a espera de
 * quem um dia va reagir — inclusive a notificacao ao administrador prevista na
 * Constituicao.
 *
 * A VISIBILIDADE das pendencias NAO depende dele: a tela consulta o banco
 * direto (`loadPendingWork`). Um alerta materializado por job sairia do ar
 * junto com o job, e a pergunta "o que venceu?" tem de ter a resposta que o
 * banco tem agora, nao a que alguem gravou de madrugada.
 *
 * IDEMPOTENCIA SEM TABELA DE ALERTAS (item 101)
 *
 * A ordem guarda `follow_up_alerted_for`: o prazo para o qual o alerta ja saiu.
 * O `UPDATE` que marca a linha carrega a condicao no proprio `WHERE`, entao
 * duas execucoes simultaneas nao emitem dois eventos — a segunda nao encontra
 * linha para marcar. Reagendar o follow-up limpa a marca, e um prazo novo
 * volta a merecer um alerta novo.
 *
 * A REGRA VIVE AQUI, NAO NO CRON (item 45). O cron da hospedagem chama
 * `npm run jobs:run`; a periodicidade logica esta declarada no registro de
 * jobs, e o que este arquivo sabe e o que significa "vencido".
 */

export interface FollowUpSweepResult {
  /** Ordens que passaram a estar vencidas nesta execucao. */
  flagged: number;
  /** Empresas inspecionadas. */
  tenants: number;
}

interface DueRow {
  id: string;
  tenantId: string;
  unitId: string;
  number: number;
  status: string;
  followUpAt: string;
}

/**
 * Percorre as empresas, cada uma no SEU fuso.
 *
 * "Vencido" depende do dia civil de quem opera: uma empresa em Sao Paulo e
 * outra em Manaus viram a data em horas diferentes, e usar UTC para as duas
 * marcaria uma delas um dia antes ou depois do que o atendente ve na tela.
 */
export async function sweepOverdueFollowUps(now: Date = new Date()): Promise<FollowUpSweepResult> {
  const db = getDb();

  const tenantRows = await db.execute(sql`
    SELECT id, timezone FROM tenants WHERE status = 'active'
  `);
  const tenants = ((tenantRows as unknown as Array<{ id: string; timezone: string }>[])[0] ??
    []) as Array<{ id: string; timezone: string }>;

  let flagged = 0;

  for (const tenant of tenants) {
    const today = todayIn(tenant.timezone, now);

    const dueRows = await db.execute(sql`
      SELECT id, tenant_id AS tenantId, unit_id AS unitId, number, status,
             follow_up_at AS followUpAt
        FROM service_orders
       WHERE tenant_id = ${tenant.id}
         AND follow_up_at IS NOT NULL
         AND follow_up_at <= ${today}
         AND status NOT IN ('completed', 'cancelled')
         AND (follow_up_alerted_for IS NULL OR follow_up_alerted_for <> follow_up_at)
       LIMIT 500
    `);

    const due = ((dueRows as unknown as DueRow[][])[0] ?? []) as DueRow[];

    for (const order of due) {
      await runInTransaction(async (tx, emit) => {
        /**
         * A MARCA E A TRAVA. A condicao repetida no `WHERE` garante que, se
         * outra execucao marcou a mesma ordem no intervalo, esta aqui nao
         * afeta linha nenhuma — e o evento nao e publicado.
         */
        const updated = await tx.execute(sql`
          UPDATE service_orders
             SET follow_up_alerted_for = ${order.followUpAt}
           WHERE id = ${order.id}
             AND tenant_id = ${order.tenantId}
             AND follow_up_at = ${order.followUpAt}
             AND (follow_up_alerted_for IS NULL OR follow_up_alerted_for <> follow_up_at)
        `);

        if (affectedRows(updated) === 0) return;

        flagged += 1;

        await emit({
          type: EVENT_TYPES.SERVICE_ORDER_FOLLOW_UP_OVERDUE,
          tenantId: order.tenantId,
          payload: {
            serviceOrderId: order.id,
            number: order.number,
            unitId: order.unitId,
            status: order.status,
            followUpAt: order.followUpAt,
          },
        });
      });
    }
  }

  logger.info('Varredura de follow-up concluida', {
    module: 'service-orders',
    operation: 'sweepOverdueFollowUps',
    tenants: tenants.length,
    flagged,
  });

  return { flagged, tenants: tenants.length };
}

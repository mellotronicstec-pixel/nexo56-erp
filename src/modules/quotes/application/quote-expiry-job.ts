import 'server-only';
import { sql } from 'drizzle-orm';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { logger } from '@/core/logging/logger';
import { todayIn } from '@/core/time/civil-date';
import { EVENT_TYPES } from '@/modules/events/domain/event';

/**
 * Expiracao de orcamentos vencidos (Prompt 09, itens 23 e 24).
 *
 * O QUE ELE FAZ: um orcamento ENVIADO cuja validade passou deixa de estar
 * esperando resposta e passa a `expired`, liberando o lugar de proposta viva
 * da Ordem de Servico para uma revisao.
 *
 * O QUE ELE NAO FAZ:
 *
 *  - NAO cancela a Ordem de Servico (item 23). O prazo comercial venceu; o
 *    aparelho continua na bancada, e o que fazer com ele e decisao de gente.
 *  - NAO avisa ninguem. Nao ha canal de comunicacao (Prompt 16); o evento fica
 *    no outbox a espera de quem um dia va reagir.
 *  - NAO mexe em orcamento sem validade. Sem prazo declarado nao ha o que
 *    vencer, e inventar um padrao seria criar regra que ninguem pediu.
 *
 * CADA EMPRESA NO SEU FUSO: "venceu" depende do dia civil de quem opera. Uma
 * loja em Sao Paulo e outra em Manaus viram a data em horas diferentes, e usar
 * UTC para as duas expiraria a proposta de uma delas um dia antes do que o
 * atendente ve na tela.
 *
 * IDEMPOTENCIA: a condicao vai no proprio `WHERE` do `UPDATE` (status ainda
 * `sent`). Duas execucoes simultaneas nao expiram o mesmo orcamento duas vezes
 * — a segunda nao encontra linha para afetar, e o evento nao e publicado.
 */

export interface QuoteExpirySweepResult {
  expired: number;
  tenants: number;
}

interface DueRow {
  id: string;
  tenantId: string;
  unitId: string;
  serviceOrderId: string;
  number: number;
  revision: number;
  validUntil: string;
}

export async function expireOverdueQuotes(now: Date = new Date()): Promise<QuoteExpirySweepResult> {
  const db = getDb();

  const tenantRows = await db.execute(sql`
    SELECT id, timezone FROM tenants WHERE status = 'active'
  `);
  const tenants = ((tenantRows as unknown as Array<{ id: string; timezone: string }>[])[0] ??
    []) as Array<{ id: string; timezone: string }>;

  let expired = 0;

  for (const tenant of tenants) {
    const today = todayIn(tenant.timezone, now);

    const dueRows = await db.execute(sql`
      SELECT id, tenant_id AS tenantId, unit_id AS unitId,
             service_order_id AS serviceOrderId, number, revision,
             valid_until AS validUntil
        FROM quotes
       WHERE tenant_id = ${tenant.id}
         AND status = 'sent'
         AND valid_until IS NOT NULL
         AND valid_until < ${today}
       LIMIT 500
    `);

    const due = ((dueRows as unknown as DueRow[][])[0] ?? []) as DueRow[];

    for (const quote of due) {
      await runInTransaction(async (tx, emit) => {
        /**
         * `status = 'sent'` repetido no WHERE: se alguem aprovou, recusou ou
         * revisou entre a leitura e esta gravacao, nada e afetado — e a
         * decisao da pessoa vence a do relogio.
         */
        const updated = await tx.execute(sql`
          UPDATE quotes
             SET status = 'expired',
                 active_marker = NULL,
                 version = version + 1,
                 updated_at = ${now}
           WHERE id = ${quote.id}
             AND tenant_id = ${quote.tenantId}
             AND status = 'sent'
        `);

        if (affectedRows(updated) === 0) return;

        await tx.execute(sql`
          INSERT INTO quote_timeline (id, tenant_id, quote_id, kind, summary, metadata, occurred_at)
          VALUES (UUID(), ${quote.tenantId}, ${quote.id}, 'expired',
                  ${'Validade vencida em ' + quote.validUntil},
                  ${JSON.stringify({ validUntil: quote.validUntil })}, ${now})
        `);

        expired += 1;

        await emit({
          type: EVENT_TYPES.QUOTE_EXPIRED,
          tenantId: quote.tenantId,
          payload: {
            quoteId: quote.id,
            serviceOrderId: quote.serviceOrderId,
            unitId: quote.unitId,
            number: quote.number,
            revision: quote.revision,
            validUntil: quote.validUntil,
          },
        });
      });
    }
  }

  logger.info('Varredura de validade de orcamentos concluida', {
    module: 'quotes',
    operation: 'expireOverdueQuotes',
    tenants: tenants.length,
    expired,
  });

  return { expired, tenants: tenants.length };
}

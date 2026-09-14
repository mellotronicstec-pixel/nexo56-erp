import 'server-only';
import { sql } from 'drizzle-orm';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { EVENT_TYPES } from '@/modules/events/domain/event';

/**
 * Varredura de estoque baixo (Prompt 10, itens 60 a 64).
 *
 * O QUE ESTE JOB FAZ, LITERALMENTE: marca os saldos cujo DISPONIVEL caiu
 * abaixo do minimo da unidade e publica um evento por saldo marcado.
 *
 * O QUE ELE NAO FAZ — e dizer o contrario seria mentira (item 175):
 *
 *   NAO notifica ninguem. Nao existe canal de comunicacao (Prompt 16).
 *   NAO cria pedido de compra (item 61). Compras e o Prompt 11.
 *   NAO chama fornecedor. Nao existe modulo de fornecedor.
 *
 * O evento `LOW_STOCK_DETECTED` fica gravado no outbox SEM CONSUMIDOR, que e
 * exatamente o que o item 62 pede: o gancho pronto para quando houver quem
 * escute.
 *
 * IDEMPOTENCIA (item 63)
 *
 * O alerta so sai UMA vez por queda. A marca fica em
 * `stock_balances.low_stock_alerted_at`, e a condicao `IS NULL` esta no `WHERE`
 * do proprio `UPDATE` — entao duas execucoes simultaneas do job nao emitem dois
 * eventos, e rodar de hora em hora nao enche o outbox com o mesmo aviso. A
 * marca volta a nulo sozinha quando o disponivel sobe acima do minimo, nas
 * proprias instrucoes de entrada e de liberacao de reserva.
 */

interface LowStockRow {
  id: string;
  tenantId: string;
  unitId: string;
  partId: string;
  onHand: string;
  reserved: string;
  minimumQuantity: string;
}

export interface LowStockSweepResult {
  flagged: number;
}

export async function sweepLowStock(): Promise<LowStockSweepResult> {
  const candidates = (await getDb().execute(sql`
    SELECT id, tenant_id AS tenantId, unit_id AS unitId, part_id AS partId,
           on_hand AS onHand, reserved, minimum_quantity AS minimumQuantity
    FROM stock_balances
    WHERE minimum_quantity > 0
      AND low_stock_alerted_at IS NULL
      AND (on_hand - reserved) < minimum_quantity
    LIMIT 500
  `)) as unknown as LowStockRow[][];

  const rows = candidates[0] ?? [];
  let flagged = 0;

  for (const row of rows) {
    await runInTransaction(async (tx, emit) => {
      /**
       * A CONDICAO VAI DE NOVO NO `WHERE`.
       *
       * Entre a consulta acima e este `UPDATE` alguem pode ter dado entrada na
       * peca. Reavaliar aqui e o que impede o alerta de sair para um estoque
       * que ja se recuperou — e o que garante que, com duas execucoes
       * simultaneas, so uma marque.
       */
      const result = await tx.execute(sql`
        UPDATE stock_balances
        SET low_stock_alerted_at = NOW(3), updated_at = NOW(3)
        WHERE id = ${row.id}
          AND low_stock_alerted_at IS NULL
          AND minimum_quantity > 0
          AND (on_hand - reserved) < minimum_quantity
      `);

      if (affectedRows(result) !== 1) return;

      flagged += 1;

      await emit({
        type: EVENT_TYPES.LOW_STOCK_DETECTED,
        tenantId: row.tenantId,
        payload: {
          unitId: row.unitId,
          partId: row.partId,
          onHand: row.onHand,
          reserved: row.reserved,
          minimumQuantity: row.minimumQuantity,
        },
      });
    });
  }

  return { flagged };
}

import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { logger } from '@/core/logging/logger';
import { processMessage } from './message-service';

/**
 * DESATOLAR, NÃO ENVIAR (itens 46, 50 e 51).
 *
 * Existe um instante entre o COMMIT que grava a mensagem e a chamada ao
 * provedor. Se o processo cair exatamente ali, a mensagem fica `queued` para
 * sempre — registrada, visível, e nunca tentada. E se cair durante a
 * tentativa, ela fica `sending`, um estado que ninguém mais reivindica, porque
 * a trava exige `queued`.
 *
 * Este job resolve os dois casos, e a distinção entre eles é toda a
 * dificuldade:
 *
 *   `queued` parada  → NINGUÉM tentou. É seguro tentar agora.
 *   `sending` parada → ALGUÉM PODE TER TENTADO. Não é seguro tentar de novo.
 *
 * O SEGUNDO CASO É O QUE SEPARA UM JOB CORRETO DE UM QUE MANDA MENSAGEM
 * DUPLICADA. O processo pode ter caído DEPOIS de o provedor aceitar e ANTES de
 * gravar o resultado — e nesse caso o cliente já recebeu. Reprocessar
 * automaticamente mandaria a segunda mensagem. Então a `sending` órfã vira
 * `failed` com um motivo que uma pessoa lê e decide: "a tentativa foi
 * interrompida e não sabemos se a mensagem saiu". Quem decide reenviar é
 * alguém que pode perguntar ao cliente — não um job às três da manhã.
 *
 * ESTE JOB NUNCA ANUNCIA ENTREGA E NUNCA MEXE EM ORDEM DE SERVIÇO.
 */

/** Tempo depois do qual uma mensagem parada é considerada órfã. */
const ABANDONED_AFTER_MINUTES = 10;

export interface StuckSweepResult {
  /** `queued` órfãs que foram processadas agora. */
  processed: number;
  /** `sending` órfãs marcadas como falha para decisão humana. */
  abandoned: number;
}

export async function sweepStuckMessages(
  olderThanMinutes = ABANDONED_AFTER_MINUTES,
): Promise<StuckSweepResult> {
  const limite = new Date(Date.now() - olderThanMinutes * 60_000);

  /**
   * `sending` órfãs primeiro: a mensagem interrompida é a que mais engana
   * quem olha a tela, porque "Processando" sugere que algo está acontecendo.
   *
   * A condição temporal vai no `WHERE` do próprio `UPDATE`: uma tentativa que
   * COMEÇOU há trinta segundos e ainda está em curso não pode ser derrubada
   * por este job, e um `SELECT` antes do `UPDATE` deixaria essa janela aberta.
   */
  const abandonadas = await getDb().execute(sql`
    UPDATE communication_messages
       SET status = 'failed',
           last_error_code = 'unknown',
           last_error_detail = 'A tentativa foi interrompida antes de registrar o resultado. Nao ha como saber se a mensagem chegou ao provedor: confirme com o cliente antes de reenviar.',
           updated_at = ${new Date()},
           version = version + 1
     WHERE status = 'sending'
       AND updated_at < ${limite}
  `);

  const marcadas = contarLinhas(abandonadas);

  /**
   * `queued` órfãs: ninguém tentou, então tentar agora é seguro.
   *
   * O lote é pequeno de propósito. Uma varredura que tenta mil mensagens de
   * uma vez transformaria uma queda de trinta minutos numa rajada contra o
   * provedor, que responderia com limite de taxa — e aí mil mensagens
   * falhariam por causa do conserto, não do problema.
   */
  const pendentes = await getDb().execute(sql`
    SELECT id, tenant_id
      FROM communication_messages
     WHERE status = 'queued'
       AND created_at < ${limite}
     ORDER BY created_at
     LIMIT 50
  `);

  const linhas = (pendentes as unknown as Array<Array<{ id: string; tenant_id: string }>>)[0] ?? [];

  let processadas = 0;
  for (const linha of linhas) {
    /**
     * `context: null` — o job não tem usuário. `processMessage` sabe o que
     * isso significa: mensagem com anexo não é enviada por aqui, porque ler o
     * documento anexado exige a permissão que um job não tem.
     */
    const resultado = await processMessage({
      messageId: linha.id,
      tenantId: linha.tenant_id,
      context: null,
    });

    if (resultado.claimed) processadas += 1;
  }

  if (marcadas > 0 || processadas > 0) {
    logger.info('Mensagens paradas tratadas', {
      module: 'communications',
      operation: 'sweepStuckMessages',
      abandoned: marcadas,
      processed: processadas,
    });
  }

  return { processed: processadas, abandoned: marcadas };
}

function contarLinhas(resultado: unknown): number {
  if (Array.isArray(resultado)) {
    const header = resultado[0] as { affectedRows?: number } | undefined;
    return header?.affectedRows ?? 0;
  }
  return 0;
}

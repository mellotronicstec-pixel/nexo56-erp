import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { BusinessRuleError } from '@/core/errors';
import { tenantSequences } from '@/modules/tenancy/infrastructure/schema';

/**
 * Numeracao humana por tenant (Prompt 02, itens 15, 17 e 18).
 *
 * COMO A CONCORRENCIA E RESOLVIDA
 *
 * Nunca `MAX(numero) + 1`: duas requisicoes simultaneas leriam o mesmo maximo e
 * devolveriam o mesmo numero.
 *
 * A alocacao usa o idioma atomico do MySQL/MariaDB — UMA unica instrucao que le
 * e incrementa sem janela entre as duas coisas:
 *
 *   INSERT ... VALUES (..., LAST_INSERT_ID(1), ...)
 *   ON DUPLICATE KEY UPDATE current_value = LAST_INSERT_ID(current_value + 1)
 *
 * `LAST_INSERT_ID(expr)` guarda o novo valor no estado da CONEXAO, recuperado
 * em seguida por `SELECT LAST_INSERT_ID()`. Por isso a alocacao roda sempre
 * dentro de uma transacao: o Drizzle fixa a conexao, e o valor lido e
 * garantidamente o desta chamada, nunca o de outra requisicao do pool.
 *
 * POR QUE NAO `SELECT ... FOR UPDATE`
 *
 * A primeira versao fazia `INSERT IGNORE` e depois `SELECT ... FOR UPDATE`.
 * Sob concorrencia real isso gera DEADLOCK (verificado em teste com 20
 * alocacoes simultaneas): varias transacoes pegam lock compartilhado na mesma
 * chave duplicada e depois tentam subir para exclusivo ao mesmo tempo. O
 * idioma atomico elimina a escalada de lock.
 *
 * RETENTATIVA
 *
 * Deadlock e lock timeout sao possiveis sob contencao alta mesmo com uma
 * instrucao atomica; o proprio manual do MariaDB trata retentativa como parte
 * normal da operacao. `allocateSequenceNumber` tenta novamente algumas vezes,
 * com espera crescente, e so entao desiste.
 *
 * LACUNAS NA SEQUENCIA
 *
 * Se a transacao do CHAMADOR abortar depois de alocar, o incremento volta atras
 * junto com ela. Ja uma retentativa interna pode, em teoria, consumir um valor.
 * Nao perseguimos ausencia absoluta de lacunas (Prompt 02, item 18): garantir
 * isso exigiria segurar o lock ate o fim da operacao de negocio inteira,
 * serializando toda a abertura de OS da empresa. Unicidade e ausencia de
 * colisao valem mais do que numeracao sem furos.
 */

export const SEQUENCE_TYPES = {
  SERVICE_ORDER: 'service_order',
  QUOTE: 'quote',
  /** Transferencia de estoque entre unidades (Prompt 10, item 51). */
  STOCK_TRANSFER: 'stock_transfer',
  PURCHASE_ORDER: 'purchase_order',
  WARRANTY: 'warranty',
  DOCUMENT: 'document',
} as const;

export type SequenceType = (typeof SEQUENCE_TYPES)[keyof typeof SEQUENCE_TYPES];

export interface AllocatedNumber {
  /** Valor numerico cru, util para ordenacao e consulta. */
  value: number;
  /** Valor formatado para exibicao, ex.: `OS 000123`. */
  formatted: string;
}

export interface SequenceOptions {
  /** Prefixo exibido junto ao numero. Aplicado apenas na criacao da linha. */
  prefix?: string;
  /** Digitos com zeros a esquerda. Aplicado apenas na criacao da linha. */
  padding?: number;
}

export function formatSequence(value: number, prefix: string, padding: number): string {
  const digits = String(value).padStart(padding, '0');
  return prefix ? `${prefix} ${digits}` : digits;
}

type Executor = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Aloca o proximo numero da sequencia.
 *
 * DEVE ser chamada dentro da transacao que grava o documento (passando `tx`),
 * para que numero e documento nascam ou falhem juntos.
 */
const MAX_ATTEMPTS = 5;

function isRetryableLockError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && current !== null) {
      const code = (current as { code?: string }).code;
      if (code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT') return true;
      current = (current as { cause?: unknown }).cause;
    } else {
      return false;
    }
  }
  return false;
}

async function allocateOnce(
  tx: Executor,
  tenantId: string,
  sequenceType: string,
  prefix: string,
  padding: number,
): Promise<AllocatedNumber> {
  // Uma unica instrucao: cria a linha com valor 1 ou incrementa a existente.
  await tx.execute(sql`
    INSERT INTO tenant_sequences (tenant_id, sequence_type, current_value, prefix, padding, updated_at)
    VALUES (${tenantId}, ${sequenceType}, LAST_INSERT_ID(1), ${prefix}, ${padding}, NOW(3))
    ON DUPLICATE KEY UPDATE
      current_value = LAST_INSERT_ID(current_value + 1),
      updated_at = NOW(3)
  `);

  const allocated = await tx.execute(sql`SELECT LAST_INSERT_ID() AS value`);
  const value = Number(
    (allocated as unknown as Array<Array<{ value: number | string }>>)[0]?.[0]?.value,
  );

  if (!Number.isInteger(value) || value < 1) {
    throw new BusinessRuleError('Nao foi possivel alocar o numero da sequencia.');
  }

  // Prefixo e padding vigentes da linha (podem ter sido configurados antes).
  const settings = await tx.execute(sql`
    SELECT prefix, padding FROM tenant_sequences
    WHERE tenant_id = ${tenantId} AND sequence_type = ${sequenceType}
  `);
  const row = (settings as unknown as Array<Array<{ prefix: string; padding: number }>>)[0]?.[0];

  return {
    value,
    formatted: formatSequence(
      value,
      String(row?.prefix ?? prefix),
      Number(row?.padding ?? padding),
    ),
  };
}

/**
 * Aloca o proximo numero da sequencia.
 *
 * DEVE ser chamada dentro da transacao que grava o documento (passando `tx`),
 * para que numero e documento nascam ou falhem juntos.
 */
export async function allocateSequenceNumber(
  tx: Executor,
  tenantId: string,
  sequenceType: SequenceType | string,
  options: SequenceOptions = {},
): Promise<AllocatedNumber> {
  const normalizedType = sequenceType.trim().toLowerCase();
  if (!normalizedType) throw new BusinessRuleError('Tipo de sequencia invalido.');

  const prefix = options.prefix ?? '';
  const padding = options.padding ?? 6;

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await allocateOnce(tx, tenantId, normalizedType, prefix, padding);
    } catch (error) {
      lastError = error;
      if (!isRetryableLockError(error)) throw error;
      // Espera crescente com jitter, para as transacoes nao reentrarem juntas.
      await new Promise((resolve) => setTimeout(resolve, attempt * 20 + Math.random() * 20));
    }
  }

  throw lastError;
}

/** Leitura do estado atual, sem alocar. Util para telas administrativas. */
export async function peekSequence(
  tenantId: string,
  sequenceType: SequenceType | string,
): Promise<{ currentValue: number; prefix: string; padding: number } | null> {
  const rows = await getDb()
    .select({
      currentValue: tenantSequences.currentValue,
      prefix: tenantSequences.prefix,
      padding: tenantSequences.padding,
    })
    .from(tenantSequences)
    .where(
      and(
        eq(tenantSequences.tenantId, tenantId),
        eq(tenantSequences.sequenceType, sequenceType.trim().toLowerCase()),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Estrategia de identificadores (Prompt 01, item 10).
 *
 * IDs tecnicos usam UUIDv7: nao enumeravel externamente, mas ordenado por
 * tempo, o que preserva a localidade de insercao no indice clusterizado do
 * InnoDB (o problema classico do UUIDv4 em MySQL).
 *
 * ID tecnico NAO e numero humano/comercial. A numeracao visivel da Ordem de
 * Servico sera uma coluna propria, definida no prompt do modulo de OS.
 */

const UUID_LENGTH = 36;

/** Gera um UUID versao 7 (time-ordered). */
export function newId(): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Date.now());

  // 48 bits de timestamp em milissegundos
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  // versao 7
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  // variante RFC 4122
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Identificador de correlacao de request/job. */
export function newCorrelationId(): string {
  return randomUUID();
}

export function isValidId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length === UUID_LENGTH && /^[0-9a-f-]{36}$/i.test(value)
  );
}

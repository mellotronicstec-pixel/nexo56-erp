import { and, asc, desc, lt, gt, or, eq, type SQL } from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import { ValidationError } from '@/core/errors';

/**
 * Convencao de paginacao (Prompt 02, itens 57 e 58).
 *
 * DUAS ESTRATEGIAS, CADA UMA COM SEU LUGAR
 *
 * `offset` — telas administrativas com "pagina 3 de 12": listas curtas e
 * estaveis (usuarios, unidades, perfis). Simples, permite pular paginas, mas
 * degrada em tabelas grandes (o banco varre e descarta) e pode repetir ou
 * pular linhas se algo for inserido durante a navegacao.
 *
 * `cursor` — listas longas e que crescem pela ponta: timeline de OS,
 * movimentacao de estoque, auditoria, eventos. Custo constante e imune a
 * insercoes concorrentes, em troca de nao permitir "ir para a pagina 7".
 *
 * ORDENACAO DETERMINISTICA (item 58)
 *
 * Toda consulta paginada ordena por `<coluna> DESC, id DESC`. O desempate por
 * `id` nao e opcional: com UUIDv7 (ordenado por tempo) duas linhas do mesmo
 * milissegundo teriam ordem indefinida, e uma pagina poderia repetir ou perder
 * um registro. Nunca depender da ordem natural do banco.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function normalizePageSize(requested?: number): number {
  if (requested === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new ValidationError('Tamanho de pagina invalido.');
  }
  return Math.min(requested, MAX_PAGE_SIZE);
}

// ---------------------------------------------------------------------------
// Offset
// ---------------------------------------------------------------------------

export interface OffsetPageRequest {
  page?: number;
  pageSize?: number;
}

export interface OffsetPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function resolveOffset(request: OffsetPageRequest): {
  limit: number;
  offset: number;
  page: number;
} {
  const pageSize = normalizePageSize(request.pageSize);
  const page = request.page === undefined ? 1 : request.page;

  if (!Number.isInteger(page) || page < 1) {
    throw new ValidationError('Numero de pagina invalido.');
  }

  return { limit: pageSize, offset: (page - 1) * pageSize, page };
}

export function buildOffsetPage<T>(
  items: T[],
  total: number,
  request: OffsetPageRequest,
): OffsetPage<T> {
  const { limit, page } = resolveOffset(request);
  return {
    items,
    page,
    pageSize: limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export interface Cursor {
  /** Valor da coluna de ordenacao na ultima linha da pagina anterior. */
  sortValue: string;
  /** ID da ultima linha, usado como desempate estavel. */
  id: string;
}

export interface CursorPageRequest {
  cursor?: string;
  pageSize?: number;
}

export interface CursorPage<T> {
  items: T[];
  /** Cursor da proxima pagina; ausente quando acabou. */
  nextCursor?: string;
  hasMore: boolean;
}

/** Cursor opaco: base64url de `sortValue|id`. Nao carrega PII nem ID sequencial. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.sortValue}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new ValidationError('Cursor de paginacao invalido.');
  }

  const separator = decoded.lastIndexOf('|');
  if (separator <= 0) throw new ValidationError('Cursor de paginacao invalido.');

  return { sortValue: decoded.slice(0, separator), id: decoded.slice(separator + 1) };
}

/**
 * Condicao "estritamente depois do cursor" para ordenacao DESC:
 *
 *   (sortColumn < sortValue) OR (sortColumn = sortValue AND id < cursorId)
 *
 * A segunda metade e o que garante que linhas com o mesmo instante nao sejam
 * puladas nem repetidas na virada de pagina.
 */
export function cursorCondition(
  sortColumn: MySqlColumn,
  idColumn: MySqlColumn,
  cursor: Cursor,
  direction: 'desc' | 'asc' = 'desc',
): SQL {
  const compare = direction === 'desc' ? lt : gt;
  return or(
    compare(sortColumn, cursor.sortValue),
    and(eq(sortColumn, cursor.sortValue), compare(idColumn, cursor.id)),
  ) as SQL;
}

/** Ordenacao deterministica padrao. */
export function deterministicOrder(
  sortColumn: MySqlColumn,
  idColumn: MySqlColumn,
  direction: 'desc' | 'asc' = 'desc',
) {
  const order = direction === 'desc' ? desc : asc;
  return [order(sortColumn), order(idColumn)];
}

/**
 * Monta a pagina a partir de `pageSize + 1` linhas lidas: a linha extra indica
 * que ha mais, sem exigir um COUNT adicional.
 */
export function buildCursorPage<T extends Record<string, unknown>>(
  rows: T[],
  pageSize: number,
  sortKey: keyof T,
  idKey: keyof T,
): CursorPage<T> {
  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const last = items[items.length - 1];

  if (!hasMore || !last) return { items, hasMore: false };

  const sortValue = last[sortKey];
  return {
    items,
    hasMore: true,
    nextCursor: encodeCursor({
      sortValue: sortValue instanceof Date ? sortValue.toISOString() : String(sortValue),
      id: String(last[idKey]),
    }),
  };
}

import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/core/errors';
import {
  buildCursorPage,
  buildOffsetPage,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  encodeCursor,
  MAX_PAGE_SIZE,
  normalizePageSize,
  resolveOffset,
} from '@/core/db/pagination';

/** PAGINACAO (Prompt 02, itens 57 e 58). */

describe('tamanho de pagina', () => {
  it('usa o padrao quando nao informado', () => {
    expect(normalizePageSize()).toBe(DEFAULT_PAGE_SIZE);
  });

  it('limita ao maximo, em vez de aceitar pedido abusivo', () => {
    expect(normalizePageSize(5000)).toBe(MAX_PAGE_SIZE);
  });

  it('recusa valores invalidos', () => {
    expect(() => normalizePageSize(0)).toThrow(ValidationError);
    expect(() => normalizePageSize(-1)).toThrow(ValidationError);
    expect(() => normalizePageSize(1.5)).toThrow(ValidationError);
  });
});

describe('offset', () => {
  it('calcula limite e deslocamento', () => {
    expect(resolveOffset({ page: 1, pageSize: 20 })).toEqual({ limit: 20, offset: 0, page: 1 });
    expect(resolveOffset({ page: 3, pageSize: 20 })).toEqual({ limit: 20, offset: 40, page: 3 });
  });

  it('recusa pagina invalida', () => {
    expect(() => resolveOffset({ page: 0 })).toThrow(ValidationError);
    expect(() => resolveOffset({ page: -2 })).toThrow(ValidationError);
  });

  it('monta a pagina com total e quantidade de paginas', () => {
    const page = buildOffsetPage(['a', 'b'], 45, { page: 2, pageSize: 20 });
    expect(page).toMatchObject({ page: 2, pageSize: 20, total: 45, totalPages: 3 });
  });

  it('lista vazia nao produz paginas', () => {
    expect(buildOffsetPage([], 0, {}).totalPages).toBe(0);
  });
});

describe('cursor', () => {
  it('codifica e decodifica sem perder o conteudo', () => {
    const cursor = { sortValue: '2026-03-01T10:00:00.000Z', id: 'abc-123' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('o cursor e opaco — nao expoe o conteudo em claro', () => {
    const encoded = encodeCursor({ sortValue: '2026-03-01T10:00:00.000Z', id: 'abc-123' });
    expect(encoded).not.toContain('abc-123');
    expect(encoded).not.toContain('2026');
  });

  it('preserva valores que contem o separador', () => {
    const cursor = { sortValue: 'valor|com|barras', id: 'id-final' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('recusa cursor malformado', () => {
    expect(() => decodeCursor('nao-e-cursor')).toThrow(ValidationError);
    expect(() => decodeCursor('')).toThrow(ValidationError);
  });

  it('detecta que ha mais paginas pela linha extra lida', () => {
    const rows = Array.from({ length: 4 }, (_, index) => ({
      id: `id-${index}`,
      createdAt: new Date(`2026-03-0${index + 1}T00:00:00Z`),
    }));

    const page = buildCursorPage(rows, 3, 'createdAt', 'id');
    expect(page.items).toHaveLength(3);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBeTruthy();

    // O cursor aponta para a ultima linha DEVOLVIDA, nao para a extra.
    expect(decodeCursor(page.nextCursor as string).id).toBe('id-2');
  });

  it('ultima pagina nao devolve cursor', () => {
    const rows = [{ id: 'a', createdAt: new Date('2026-03-01T00:00:00Z') }];
    const page = buildCursorPage(rows, 3, 'createdAt', 'id');
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeUndefined();
  });

  it('pagina vazia e tratada sem erro', () => {
    expect(buildCursorPage([], 10, 'createdAt', 'id')).toEqual({ items: [], hasMore: false });
  });
});

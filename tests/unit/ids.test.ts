import { describe, expect, it } from 'vitest';
import { isValidId, newId } from '@/core/ids/id';

describe('identificadores', () => {
  it('gera UUID valido na versao 7', () => {
    const id = newId();
    expect(isValidId(id)).toBe(true);
    expect(id[14]).toBe('7');
  });

  it('gera IDs unicos', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId()));
    expect(ids.size).toBe(2000);
  });

  it('gera IDs ordenados por tempo (localidade de indice no InnoDB)', async () => {
    const first = newId();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = newId();
    expect(second > first).toBe(true);
  });

  it('rejeita valores que nao sao ID tecnico', () => {
    expect(isValidId('123')).toBe(false);
    expect(isValidId(42)).toBe(false);
    expect(isValidId(null)).toBe(false);
  });
});

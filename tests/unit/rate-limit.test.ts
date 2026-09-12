import { describe, expect, it } from 'vitest';
import { MemoryRateLimitStore } from '@/core/rate-limit/rate-limiter';

describe('rate limiting', () => {
  it('permite ate o limite e bloqueia em seguida', async () => {
    const store = new MemoryRateLimitStore();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await store.hit('login:teste', 3, 60_000);
      expect(result.allowed).toBe(true);
    }

    const blocked = await store.hit('login:teste', 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('conta cada chave separadamente', async () => {
    const store = new MemoryRateLimitStore();
    await store.hit('a', 1, 60_000);
    const other = await store.hit('b', 1, 60_000);
    expect(other.allowed).toBe(true);
  });

  it('libera apos reset explicito (login bem-sucedido)', async () => {
    const store = new MemoryRateLimitStore();
    await store.hit('a', 1, 60_000);
    expect((await store.hit('a', 1, 60_000)).allowed).toBe(false);
    await store.reset('a');
    expect((await store.hit('a', 1, 60_000)).allowed).toBe(true);
  });
});

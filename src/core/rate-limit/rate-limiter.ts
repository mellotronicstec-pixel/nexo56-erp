/**
 * Rate limiting (Prompt 01, item 43).
 *
 * A interface `RateLimitStore` e o ponto de troca: hoje existe apenas a
 * implementacao em memoria; amanha um store Redis entra sem que o codigo
 * chamador mude.
 *
 * LIMITACAO CONHECIDA E DELIBERADA: o store em memoria conta por PROCESSO.
 * Em hospedagem compartilhada com um unico processo Node isso e efetivo; se a
 * aplicacao passar a rodar em varias instancias, o limite se multiplica pelo
 * numero de processos. Documentado em docs/architecture/security.md.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      this.sweep(now);
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    bucket.count += 1;

    if (bucket.count > limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  /** Remove janelas expiradas para a memoria nao crescer indefinidamente. */
  private sweep(now: number): void {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

const globalStore = globalThis as unknown as { __nexo56RateLimitStore?: RateLimitStore };

/** Singleton — sobrevive ao hot reload do Next em desenvolvimento. */
export function getRateLimitStore(): RateLimitStore {
  globalStore.__nexo56RateLimitStore ??= new MemoryRateLimitStore();
  return globalStore.__nexo56RateLimitStore;
}

export const RATE_LIMITS = {
  /** Tentativas de login por identificador, por janela. */
  login: { limit: 5, windowMs: 5 * 60 * 1000 },
  /**
   * Pedidos de link magico do Portal, por CONTATO normalizado (Prompt 17,
   * item 17). Janela mais longa que o login interno: um link por e-mail a
   * cada poucos minutos e generoso para uso legitimo e caro para quem tenta
   * descobrir, por tentativa e erro, quais contatos existem no sistema.
   */
  portalLoginRequest: { limit: 3, windowMs: 10 * 60 * 1000 },
} as const;

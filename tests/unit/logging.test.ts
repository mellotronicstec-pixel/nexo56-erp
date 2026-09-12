import { describe, expect, it } from 'vitest';
import { redact } from '@/core/logging/logger';

describe('redacao de dados sensiveis', () => {
  it('remove senha, hash, token e segredo', () => {
    const result = redact({
      email: 'pessoa@empresa.com',
      password: 'senha-real',
      passwordHash: 'scrypt$...',
      token: 'abc123',
      session_secret: 'segredo',
      cpf: '000.000.000-00',
    }) as Record<string, unknown>;

    expect(result.password).toBe('[REDACTED]');
    expect(result.passwordHash).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
    expect(result.session_secret).toBe('[REDACTED]');
    expect(result.cpf).toBe('[REDACTED]');
    expect(result.email).toBe('pessoa@empresa.com');
  });

  it('redige em estruturas aninhadas e listas', () => {
    const result = redact({ users: [{ name: 'Ana', password: 'x' }] }) as {
      users: Array<Record<string, unknown>>;
    };
    expect(result.users[0]?.password).toBe('[REDACTED]');
    expect(result.users[0]?.name).toBe('Ana');
  });

  it('nao serializa stack trace de erro', () => {
    const result = redact(new Error('falhou')) as Record<string, unknown>;
    expect(result).toEqual({ name: 'Error', message: 'falhou' });
    expect(result.stack).toBeUndefined();
  });
});

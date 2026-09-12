import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  needsRehash,
  simulatePasswordVerification,
  verifyPassword,
} from '@/modules/auth/domain/password';

describe('hashing de senha', () => {
  it('nunca armazena a senha em texto puro', async () => {
    const hash = await hashPassword('senha-super-secreta-123');
    expect(hash).not.toContain('senha-super-secreta-123');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('gera hashes diferentes para a mesma senha (salt aleatorio)', async () => {
    const [a, b] = await Promise.all([hashPassword('mesma-senha'), hashPassword('mesma-senha')]);
    expect(a).not.toBe(b);
  });

  it('valida a senha correta e recusa a incorreta', async () => {
    const hash = await hashPassword('senha-correta-abc');
    await expect(verifyPassword('senha-correta-abc', hash)).resolves.toBe(true);
    await expect(verifyPassword('senha-errada-abc', hash)).resolves.toBe(false);
  });

  it('recusa hash malformado sem lancar excecao', async () => {
    await expect(verifyPassword('qualquer', 'formato-invalido')).resolves.toBe(false);
    await expect(verifyPassword('qualquer', '')).resolves.toBe(false);
  });

  it('marca para rehash hashes com parametros abaixo do padrao atual', async () => {
    const current = await hashPassword('x-para-teste-123');
    expect(needsRehash(current)).toBe(false);
    expect(needsRehash('scrypt$16384$8$1$c2FsdA==$aGFzaA==')).toBe(true);
  });

  it('equaliza tempo quando o usuario nao existe', async () => {
    await expect(simulatePasswordVerification()).resolves.toBeUndefined();
  });
});

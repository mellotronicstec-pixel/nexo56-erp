import { afterEach, describe, expect, it } from 'vitest';
import { getEnv, resetEnvCache } from '@/core/config/env';

/**
 * A VALVULA `ALLOW_INSECURE_APP_URL` (Prompt 14, correcao final).
 *
 * Ela existe para rodar a verificacao de ponta a ponta contra um servidor
 * local em http. O risco e alguem levar essa variavel para producao e derrubar
 * junto o `Secure` dos cookies de sessao — em silencio, porque o sistema
 * continuaria subindo. Por isso a valvula so abre para a propria maquina.
 */

/**
 * NODE_ENV=production de proposito: e ali que a regra existe. Em
 * desenvolvimento http e legitimo, e barrar seria atrapalhar sem proteger
 * nada.
 */
const BASE = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/db',
  SESSION_SECRET: 'x'.repeat(48),
  JOB_SECRET: 'y'.repeat(48),
};

function comAmbiente(extra: Record<string, string>): NodeJS.ProcessEnv {
  const anterior = { ...process.env };
  for (const chave of ['APP_URL', 'ALLOW_INSECURE_APP_URL', ...Object.keys(BASE)]) {
    delete process.env[chave];
  }
  Object.assign(process.env, BASE, extra);
  resetEnvCache();
  return anterior;
}

let anterior: NodeJS.ProcessEnv | null = null;

afterEach(() => {
  if (anterior) {
    for (const chave of Object.keys(process.env)) delete process.env[chave];
    Object.assign(process.env, anterior);
    anterior = null;
  }
  resetEnvCache();
});

describe('fora de producao a regra nao atrapalha', () => {
  it('http em desenvolvimento passa sem valvula nenhuma', () => {
    anterior = comAmbiente({
      NODE_ENV: 'development',
      APP_URL: 'http://app.exemplo.invalid',
    });
    expect(getEnv().APP_URL).toBe('http://app.exemplo.invalid');
  });
});

describe('APP_URL em https', () => {
  it('https passa sem valvula nenhuma', () => {
    anterior = comAmbiente({ APP_URL: 'https://app.exemplo.invalid' });
    expect(getEnv().APP_URL).toBe('https://app.exemplo.invalid');
  });

  it('http sem a valvula e recusado', () => {
    anterior = comAmbiente({ APP_URL: 'http://app.exemplo.invalid' });
    expect(() => getEnv()).toThrow(/https/i);
  });
});

describe('a valvula so abre para a propria maquina', () => {
  it('http em localhost passa', () => {
    anterior = comAmbiente({
      APP_URL: 'http://localhost:3123',
      ALLOW_INSECURE_APP_URL: 'true',
    });
    expect(getEnv().APP_URL).toBe('http://localhost:3123');
  });

  it('http em 127.0.0.1 passa', () => {
    anterior = comAmbiente({
      APP_URL: 'http://127.0.0.1:3123',
      ALLOW_INSECURE_APP_URL: 'true',
    });
    expect(getEnv().APP_URL).toBe('http://127.0.0.1:3123');
  });

  it('a valvula NAO abre para um host real, por mais que esteja ligada', () => {
    anterior = comAmbiente({
      APP_URL: 'http://app.exemplo.invalid',
      ALLOW_INSECURE_APP_URL: 'true',
    });
    expect(() => getEnv()).toThrow(/ALLOW_INSECURE_APP_URL/);
  });

  it('nem para um endereco que apenas PARECE local', () => {
    anterior = comAmbiente({
      APP_URL: 'http://localhost.exemplo.invalid',
      ALLOW_INSECURE_APP_URL: 'true',
    });
    expect(() => getEnv()).toThrow(/ALLOW_INSECURE_APP_URL/);
  });
});

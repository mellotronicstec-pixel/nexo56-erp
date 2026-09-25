import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/core/config/env';
import { InternalError } from '@/core/errors';
import { CapturePartSearchProvider } from '@/modules/part-search/infrastructure/capture-provider';

/** Mesma guarda de producao do AI Gateway (ADR-085) e de Comunicacao (Prompt 16), agora para Busca de Pecas. */

const BASE = {
  DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/db',
  SESSION_SECRET: 'x'.repeat(48),
  JOB_SECRET: 'y'.repeat(48),
  APP_URL: 'https://app.exemplo.invalid',
};

let anterior: NodeJS.ProcessEnv | null = null;

function comAmbiente(nodeEnv: string): void {
  anterior = { ...process.env };
  for (const chave of ['NODE_ENV', ...Object.keys(BASE)]) delete process.env[chave];
  Object.assign(process.env, BASE, { NODE_ENV: nodeEnv });
  resetEnvCache();
}

afterEach(() => {
  if (anterior) {
    for (const chave of Object.keys(process.env)) delete process.env[chave];
    Object.assign(process.env, anterior);
    anterior = null;
  }
  resetEnvCache();
});

const QUERY = {
  term: 'placa fonte',
  partNumberHint: null,
  equipmentKind: null,
  equipmentBrand: null,
  equipmentModel: null,
};

describe('CapturePartSearchProvider', () => {
  it('por padrao devolve lista vazia — nunca inventa peca', async () => {
    comAmbiente('test');
    const provider = new CapturePartSearchProvider();
    const result = await provider.search(QUERY, { timeoutMs: 1000 });
    expect(result).toEqual({ outcome: 'ok', items: [] });
  });

  it('registra as chamadas recebidas para inspecao do teste', async () => {
    comAmbiente('test');
    const provider = new CapturePartSearchProvider();
    await provider.search(QUERY, { timeoutMs: 1000 });
    expect(provider.requests()).toHaveLength(1);
    expect(provider.requests()[0]?.term).toBe('placa fonte');
  });

  it('respondNext programa respostas na ordem, uma por chamada', async () => {
    comAmbiente('test');
    const provider = new CapturePartSearchProvider();
    provider.respondNext({ outcome: 'error', kind: 'provider_error', detail: 'falha programada' });
    provider.respondNext({ outcome: 'ok', items: [] });

    const first = await provider.search(QUERY, { timeoutMs: 1000 });
    const second = await provider.search(QUERY, { timeoutMs: 1000 });

    expect(first).toEqual({ outcome: 'error', kind: 'provider_error', detail: 'falha programada' });
    expect(second).toEqual({ outcome: 'ok', items: [] });
  });

  it('reset() zera roteiro e chamadas registradas', async () => {
    comAmbiente('test');
    const provider = new CapturePartSearchProvider();
    provider.respondNext({ outcome: 'ok', items: [] });
    await provider.search(QUERY, { timeoutMs: 1000 });

    provider.reset();
    expect(provider.requests()).toHaveLength(0);
  });

  it('a guarda de producao lanca ao ser acionada com NODE_ENV=production', async () => {
    comAmbiente('production');
    const provider = new CapturePartSearchProvider();

    await expect(provider.search(QUERY, { timeoutMs: 1000 })).rejects.toBeInstanceOf(InternalError);
  });
});

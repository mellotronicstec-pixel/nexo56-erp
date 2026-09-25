import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/core/config/env';
import { InternalError } from '@/core/errors';
import { CaptureAiProvider } from '@/modules/ai/infrastructure/capture-provider';

/** Itens 36, 37, 111, 157: mesma guarda de producao de Comunicacao (Prompt 16), agora para IA. */

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

const REQUEST = {
  taskKey: 'CORRIGIR_PORTUGUES' as const,
  promptVersion: 'v1',
  systemPrompt: 'sistema',
  userContent: 'ola mundo',
  language: 'pt-BR' as const,
  maxOutputChars: 100,
};

describe('CaptureAiProvider', () => {
  it('e deterministico por padrao: mesma entrada, mesma saida, sem rede', async () => {
    comAmbiente('test');
    const provider = new CaptureAiProvider();

    const first = await provider.generate(REQUEST, { timeoutMs: 1000 });
    const second = await provider.generate(REQUEST, { timeoutMs: 1000 });
    expect(first).toEqual(second);
  });

  it('registra as chamadas recebidas para inspecao do teste (item 110)', async () => {
    comAmbiente('test');
    const provider = new CaptureAiProvider();
    await provider.generate({ ...REQUEST, taskKey: 'RESUMIR' }, { timeoutMs: 1000 });

    expect(provider.requests()).toHaveLength(1);
    expect(provider.requests()[0]?.taskKey).toBe('RESUMIR');
  });

  it('respondNext programa respostas na ordem, uma por chamada (item 173)', async () => {
    comAmbiente('test');
    const provider = new CaptureAiProvider();
    provider.respondNext({ outcome: 'error', kind: 'provider_error', detail: 'falha programada' });
    provider.respondNext({ outcome: 'generated', text: 'ok', inputTokens: 5, outputTokens: 2 });

    const first = await provider.generate(REQUEST, { timeoutMs: 1000 });
    const second = await provider.generate(REQUEST, { timeoutMs: 1000 });

    expect(first).toEqual({ outcome: 'error', kind: 'provider_error', detail: 'falha programada' });
    expect(second).toEqual({ outcome: 'generated', text: 'ok', inputTokens: 5, outputTokens: 2 });
  });

  it('reset() zera roteiro e chamadas registradas', async () => {
    comAmbiente('test');
    const provider = new CaptureAiProvider();
    provider.respondNext({
      outcome: 'generated',
      text: 'x',
      inputTokens: null,
      outputTokens: null,
    });
    await provider.generate(REQUEST, { timeoutMs: 1000 });

    provider.reset();
    expect(provider.requests()).toHaveLength(0);
  });

  it('a guarda de producao lanca ao ser acionada com NODE_ENV=production (item 37/111)', async () => {
    comAmbiente('production');
    const provider = new CaptureAiProvider();

    await expect(provider.generate(REQUEST, { timeoutMs: 1000 })).rejects.toBeInstanceOf(
      InternalError,
    );
  });
});

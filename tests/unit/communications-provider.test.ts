import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/core/config/env';
import { InternalError } from '@/core/errors';
import { sanitizeProviderDetail } from '@/modules/communications/application/communication-provider';
import {
  assertNotProduction,
  CaptureProvider,
} from '@/modules/communications/infrastructure/capture-provider';
import {
  getCommunicationProvider,
  setCommunicationProviderForTesting,
} from '@/modules/communications/infrastructure/provider-registry';

/**
 * A FRONTEIRA COM O MUNDO, e a guarda que impede o sistema de mentir.
 *
 * O Nexo56 nao tem provedor de envio contratado. Isso e um fato, e o codigo
 * precisa dizer esse fato em vez de fingir sucesso — em qualquer caminho, por
 * qualquer porta.
 */

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
  setCommunicationProviderForTesting(null);
  if (anterior) {
    for (const chave of Object.keys(process.env)) delete process.env[chave];
    Object.assign(process.env, anterior);
    anterior = null;
  }
  resetEnvCache();
});

describe('provedor de captura', () => {
  it('registra o que teria sido enviado e responde aceito', async () => {
    comAmbiente('test');
    const provider = new CaptureProvider();

    const resultado = await provider.send({
      messageId: 'msg-1',
      channel: 'whatsapp',
      recipient: '11999998888',
      subject: null,
      body: 'Seu aparelho esta pronto.',
      attachments: [],
      correlationId: null,
    });

    expect(resultado.outcome).toBe('accepted');
    expect(provider.messages()).toHaveLength(1);
    expect(provider.messages()[0]?.body).toBe('Seu aparelho esta pronto.');
  });

  it('o protocolo e derivado do id, nao sorteado', async () => {
    /*
      Um protocolo aleatorio faria um teste de igualdade passar hoje e falhar
      na sexta-feira, sem nada ter mudado.
    */
    comAmbiente('test');
    const a = new CaptureProvider();
    const b = new CaptureProvider();

    const base = {
      messageId: 'msg-igual',
      channel: 'sms' as const,
      recipient: '11999998888',
      subject: null,
      body: 'Texto',
      attachments: [],
      correlationId: null,
    };

    const r1 = await a.send(base);
    const r2 = await b.send(base);
    expect(r1).toEqual(r2);
  });

  it('a falha e programada pelo teste, nunca por valor magico no destino', async () => {
    comAmbiente('test');
    const provider = new CaptureProvider();
    provider.failNext('provider_unavailable', 'Fora do ar.');

    const primeira = await provider.send({
      messageId: 'msg-1',
      channel: 'sms',
      recipient: '11999998888',
      subject: null,
      body: 'Texto',
      attachments: [],
      correlationId: null,
    });
    expect(primeira.outcome).toBe('failed');

    /* A segunda volta a funcionar: o roteiro tem uma entrada, nao um modo. */
    const segunda = await provider.send({
      messageId: 'msg-2',
      channel: 'sms',
      recipient: '11999998888',
      subject: null,
      body: 'Texto',
      attachments: [],
      correlationId: null,
    });
    expect(segunda.outcome).toBe('accepted');
  });

  it('o nome do provedor vai para o historico e e `capture`', () => {
    comAmbiente('test');
    expect(new CaptureProvider().name).toBe('capture');
  });
});

describe('a guarda de producao', () => {
  it('a captura RECUSA enviar em producao, mesmo se alguem a injetar', async () => {
    comAmbiente('production');
    const provider = new CaptureProvider();

    await expect(
      provider.send({
        messageId: 'msg-1',
        channel: 'sms',
        recipient: '11999998888',
        subject: null,
        body: 'Texto',
        attachments: [],
        correlationId: null,
      }),
    ).rejects.toThrow(InternalError);
  });

  it('a guarda lanca em producao e cala fora dela', () => {
    comAmbiente('production');
    expect(() => assertNotProduction()).toThrow(InternalError);

    comAmbiente('development');
    expect(() => assertNotProduction()).not.toThrow();
  });

  it('em producao o registro nao entrega provedor nenhum', () => {
    /*
      `null` e a resposta honesta: nao ha provedor. A mensagem sera registrada
      e a tentativa falhara com `provider_not_configured`, que e exatamente o
      que esta acontecendo.
    */
    comAmbiente('production');
    expect(getCommunicationProvider()).toBeNull();
  });

  it('fora de producao o registro entrega a captura', () => {
    comAmbiente('development');
    const provider = getCommunicationProvider();
    expect(provider?.name).toBe('capture');
  });

  it('NAO existe variavel de ambiente que ligue a captura em producao', () => {
    /*
      A ausencia e o recurso. Uma chave assim seria, mais cedo ou mais tarde,
      ligada em producao por engano — e a partir dai o sistema afirmaria ter
      avisado clientes que nunca foram avisados.
    */
    const codigo = String(getCommunicationProvider);
    expect(codigo).not.toContain('process.env');
    expect(codigo).not.toContain('COMMUNICATION_PROVIDER');
  });
});

describe('higienizacao do detalhe de erro', () => {
  it('redige token no cabecalho de autorizacao', () => {
    const limpo = sanitizeProviderDetail(
      'POST falhou: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc-123_x',
    );
    expect(limpo).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(limpo).toContain('[redigido]');
  });

  it('redige chave, token e senha em pares chave-valor', () => {
    for (const cru of [
      'erro api_key=segredo-super-secreto',
      'erro access_token: "abc123"',
      'erro client_secret=zzz999',
      'erro senha=minha-senha',
    ]) {
      const limpo = sanitizeProviderDetail(cru);
      expect(limpo).toContain('[redigido]');
      expect(limpo).not.toMatch(/segredo-super-secreto|abc123|zzz999|minha-senha/);
    }
  });

  it('preserva o que ajuda a diagnosticar', () => {
    const limpo = sanitizeProviderDetail('HTTP 429: too many requests for number 5511');
    expect(limpo).toContain('429');
    expect(limpo).toContain('too many requests');
  });

  it('colapsa espacos e respeita o limite da coluna', () => {
    const limpo = sanitizeProviderDetail(`linha1\n\n   linha2 ${'x'.repeat(900)}`);
    expect(limpo?.length).toBeLessThanOrEqual(500);
    expect(limpo).toContain('linha1 linha2');
  });

  it('nulo continua nulo', () => {
    expect(sanitizeProviderDetail(null)).toBeNull();
    expect(sanitizeProviderDetail('')).toBeNull();
  });
});

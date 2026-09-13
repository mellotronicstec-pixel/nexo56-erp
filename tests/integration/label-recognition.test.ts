import { afterEach, describe, expect, it } from 'vitest';
import {
  getLabelRecognitionProvider,
  recognizeLabel,
  setLabelRecognitionProviderForTesting,
  UnavailableRecognitionProvider,
  type EquipmentLabelRecognitionProvider,
  type RecognitionResult,
} from '@/modules/equipment/application/label-recognition';
import { makeJpeg } from '../helpers/fake-storage';

/**
 * LEITURA DE ETIQUETA (Prompt 06, itens 39 a 43 e 110).
 *
 * NAO HA PROVIDER REAL. Estes testes exercitam o contrato com um provider
 * FALSO — declarado como falso, usado so aqui — e confirmam a regra que nao
 * muda: a leitura sugere, o humano decide, e falha nenhuma impede o cadastro
 * manual.
 */

/** Provider de teste. Nunca sai daqui: producao usa o `Unavailable`. */
class FakeProvider implements EquipmentLabelRecognitionProvider {
  readonly name = 'fake-provider';

  constructor(private readonly behaviour: () => Promise<RecognitionResult>) {}

  isAvailable(): boolean {
    return true;
  }

  recognize(): Promise<RecognitionResult> {
    return this.behaviour();
  }
}

const imagem = { image: makeJpeg(), mimeType: 'image/jpeg' };

afterEach(() => {
  setLabelRecognitionProviderForTesting(null);
});

describe('estado real do produto', () => {
  it('o provider PADRAO e indisponivel — nao ha integracao configurada (item 43)', () => {
    const provider = getLabelRecognitionProvider();
    expect(provider).toBeInstanceOf(UnavailableRecognitionProvider);
    expect(provider.isAvailable()).toBe(false);
    expect(provider.name).toBe('none');
  });

  it('indisponivel devolve status proprio e mensagem em portugues, NAO um resultado falso', async () => {
    const result = await recognizeLabel(imagem);

    expect(result.status).toBe('unavailable');
    expect(result.fields).toEqual({});
    expect(result.message).toMatch(/preencha os dados manualmente/i);
    // Nunca inventa marca, modelo ou serial para parecer que funcionou.
    expect(result.fields.brand).toBeUndefined();
  });
});

describe('leitura completa', () => {
  it('devolve os campos com confianca por campo (itens 36 e 37)', async () => {
    setLabelRecognitionProviderForTesting(
      new FakeProvider(async () => ({
        status: 'succeeded',
        provider: 'fake-provider',
        fields: {
          brand: { value: 'Yamaha', confidence: 'high' },
          model: { value: 'RX-V385', confidence: 'high' },
          serial: { value: 'Y12345678', confidence: 'medium' },
          voltage: { value: 'v127', confidence: 'high' },
        },
      })),
    );

    const result = await recognizeLabel(imagem);

    expect(result.status).toBe('succeeded');
    expect(result.fields.brand?.value).toBe('Yamaha');
    expect(result.fields.serial?.confidence).toBe('medium');
    expect(result.fields.voltage?.value).toBe('v127');
  });
});

describe('leitura parcial e campos ausentes', () => {
  it('um unico campo e PARCIAL — nao se anuncia como leitura completa', async () => {
    setLabelRecognitionProviderForTesting(
      new FakeProvider(async () => ({
        status: 'succeeded',
        provider: 'fake-provider',
        fields: { brand: { value: 'LG', confidence: 'low' } },
      })),
    );

    const result = await recognizeLabel(imagem);
    expect(result.status).toBe('partial');
    expect(result.fields.model).toBeUndefined();
  });

  it('campo vazio e descartado em vez de virar sugestao em branco', async () => {
    setLabelRecognitionProviderForTesting(
      new FakeProvider(async () => ({
        status: 'succeeded',
        provider: 'fake-provider',
        fields: {
          brand: { value: 'Sony', confidence: 'high' },
          model: { value: '   ', confidence: 'low' },
          serial: { value: '', confidence: 'low' },
        },
      })),
    );

    const result = await recognizeLabel(imagem);
    expect(result.fields.model).toBeUndefined();
    expect(result.fields.serial).toBeUndefined();
    expect(result.fields.brand?.value).toBe('Sony');
  });

  it('"sucesso" sem campo nenhum vira FALHA — nao existe sucesso vazio', async () => {
    setLabelRecognitionProviderForTesting(
      new FakeProvider(async () => ({
        status: 'succeeded',
        provider: 'fake-provider',
        fields: {},
      })),
    );

    expect((await recognizeLabel(imagem)).status).toBe('failed');
  });
});

describe('falha e timeout nunca bloqueiam o cadastro (itens 40 e 121)', () => {
  it('erro do provider vira mensagem compreensivel, sem vazar detalhe tecnico', async () => {
    setLabelRecognitionProviderForTesting(
      new FakeProvider(async () => {
        throw new Error('ECONNRESET socket hang up at provider.internal:443');
      }),
    );

    const result = await recognizeLabel(imagem);

    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/preencher manualmente/i);
    // A mensagem tecnica NAO chega ao atendente.
    expect(result.message).not.toMatch(/ECONNRESET|443/);
  });

  it('provider que nunca responde nao trava a operacao', async () => {
    setLabelRecognitionProviderForTesting(new FakeProvider(() => new Promise(() => {})));

    const result = await Promise.race([
      recognizeLabel(imagem),
      new Promise<'travou'>((resolve) => setTimeout(() => resolve('travou'), 16_500)),
    ]);

    expect(result).not.toBe('travou');
    expect((result as RecognitionResult).status).toBe('failed');
  }, 20_000);

  it('resultado "failed" do proprio provider e respeitado', async () => {
    setLabelRecognitionProviderForTesting(
      new FakeProvider(async () => ({
        status: 'failed',
        provider: 'fake-provider',
        fields: {},
        message: 'Etiqueta ilegivel.',
      })),
    );

    expect((await recognizeLabel(imagem)).status).toBe('failed');
  });
});

describe('a correcao humana e a autoridade (itens 39 e 49)', () => {
  it('o resultado e SUGESTAO: nada e persistido por ele', async () => {
    setLabelRecognitionProviderForTesting(
      new FakeProvider(async () => ({
        status: 'succeeded',
        provider: 'fake-provider',
        fields: {
          brand: { value: 'Yamaha', confidence: 'high' },
          model: { value: 'RX-V385', confidence: 'high' },
        },
      })),
    );

    const result = await recognizeLabel(imagem);

    /**
     * `recognizeLabel` nao escreve no banco — nao recebe contexto e nao tem
     * acesso a ele. Persistir e outro passo, disparado pela confirmacao
     * humana. Esta e a garantia estrutural de que OCR nunca e autoridade.
     */
    expect(result.fields.brand?.value).toBe('Yamaha');
    expect(Object.keys(result)).toEqual(expect.arrayContaining(['status', 'provider', 'fields']));
    expect(result).not.toHaveProperty('equipmentId');
  });
});

describe('barcode e QR (itens 45, 46 e 111)', () => {
  it('NAO ha decodificador implementado — o campo so existe no contrato', async () => {
    setLabelRecognitionProviderForTesting(
      new FakeProvider(async () => ({
        status: 'succeeded',
        provider: 'fake-provider',
        fields: {
          brand: { value: 'Sony', confidence: 'high' },
          barcode: { value: '7891234567890', confidence: 'high' },
        },
      })),
    );

    const result = await recognizeLabel(imagem);

    // O contrato transporta o codigo quando um provider souber ler; nenhum
    // decoder roda no Nexo56 hoje, e nada aqui alega o contrario.
    expect(result.fields.barcode?.value).toBe('7891234567890');
    expect(getLabelRecognitionProvider().name).toBe('fake-provider');
  });
});

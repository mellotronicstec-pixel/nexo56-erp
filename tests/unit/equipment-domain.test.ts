import { describe, expect, it } from 'vitest';
import {
  INSPECTION_CONDITIONS,
  VOLTAGE_LABEL,
  conditionLabel,
  equipmentTitle,
  isKnownCondition,
  normalizeSearchable,
  normalizeSerial,
} from '@/modules/equipment/domain/equipment';
import {
  CONFIDENCE_LABEL,
  normalizeRecognition,
  parseVoltage,
  type RecognitionResult,
} from '@/modules/equipment/application/label-recognition';
import { detectImage, hasExif, MAX_IMAGE_BYTES } from '@/core/storage/image-validation';

/** JPEG minimo valido: SOI + SOF0 declarando 40x30 + EOI. */
function fakeJpeg(width = 40, height = 30): Buffer {
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(9, 2); // tamanho do segmento
  sof.writeUInt8(8, 4); // precisao
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  // SOI seguido direto do SOF0: um APP0 sem campo de tamanho tornaria o
  // arquivo malformado e o leitor, corretamente, nao acharia as dimensoes.
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}

function fakePng(width = 100, height = 50): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe('tensao (item 14)', () => {
  it('cada tensao tem rotulo proprio — nao e booleano', () => {
    expect(VOLTAGE_LABEL.bivolt).toBe('Bivolt');
    expect(VOLTAGE_LABEL.not_applicable).toBe('Nao se aplica');
    expect(VOLTAGE_LABEL.unknown).toBe('Nao identificada');
  });

  it('"nao se aplica" e "nao identificada" sao estados DIFERENTES', () => {
    expect(VOLTAGE_LABEL.not_applicable).not.toBe(VOLTAGE_LABEL.unknown);
  });
});

describe('leitura de tensao na etiqueta', () => {
  it('reconhece as tensoes escritas', () => {
    expect(parseVoltage('Input: 127V~ 60Hz')).toBe('v127');
    expect(parseVoltage('220 V')).toBe('v220');
    expect(parseVoltage('110V')).toBe('v110');
  });

  it('BIVOLT vence 220 quando a etiqueta traz as duas — nao pode queimar o aparelho', () => {
    expect(parseVoltage('110/220V')).toBe('bivolt');
    expect(parseVoltage('100-240V ~ 50/60Hz')).toBe('bivolt');
    expect(parseVoltage('BIVOLT')).toBe('bivolt');
  });

  it('devolve nulo quando a etiqueta nao diz — nunca chuta', () => {
    expect(parseVoltage('Model RX-V385')).toBeNull();
    expect(parseVoltage('')).toBeNull();
  });
});

describe('normalizacao de serial (item 13)', () => {
  it('remove pontuacao e uniformiza a caixa', () => {
    expect(normalizeSerial('y1-2345')).toBe('Y12345');
    expect(normalizeSerial('SN: ABC 123')).toBe('SNABC123');
  });

  it('formas diferentes do mesmo serial convergem', () => {
    expect(normalizeSerial('Y12345678')).toBe(normalizeSerial('y-123 456 78'));
  });

  it('serial vazio continua vazio — nao inventa valor', () => {
    expect(normalizeSerial('')).toBe('');
    expect(normalizeSerial('---')).toBe('');
  });
});

describe('normalizacao de texto', () => {
  it('ignora acento e caixa, para a marca nao duplicar', () => {
    expect(normalizeSearchable('SAMSUNG')).toBe('samsung');
    expect(normalizeSearchable('Samsung')).toBe(normalizeSearchable('samsung'));
    expect(normalizeSearchable('Eletrônico')).toBe('eletronico');
  });

  it('colapsa espacos', () => {
    expect(normalizeSearchable('  Caixa   de  Som ')).toBe('caixa de som');
  });
});

describe('titulo do equipamento', () => {
  it('usa marca e modelo quando existem', () => {
    expect(equipmentTitle({ kind: 'Receiver', brand: 'Yamaha', model: 'RX-V385' })).toBe(
      'Yamaha RX-V385',
    );
  });

  it('cai para o tipo quando nao ha identificacao — etiqueta ilegivel e rotina', () => {
    expect(equipmentTitle({ kind: 'Micro-ondas', brand: null, model: null })).toBe('Micro-ondas');
  });

  it('usa o que houver quando so um dos dois existe', () => {
    expect(equipmentTitle({ kind: 'TV', brand: 'LG', model: null })).toBe('LG');
  });
});

describe('checklist de inspecao (itens 18 a 20)', () => {
  it('reconhece as condicoes do catalogo', () => {
    expect(isKnownCondition('scratches')).toBe(true);
    expect(isKnownCondition('oxidation')).toBe(true);
  });

  it('recusa chave desconhecida — o catalogo e a fonte da verdade', () => {
    expect(isKnownCondition('placa_queimada')).toBe(false);
  });

  it('todas as condicoes tem rotulo em portugues', () => {
    for (const condition of INSPECTION_CONDITIONS) {
      expect(conditionLabel(condition.key)).toBe(condition.label);
      expect(condition.label).not.toBe(condition.key);
    }
  });

  it('sao condicoes de ESTADO, nao diagnostico', () => {
    const chaves = INSPECTION_CONDITIONS.map((c) => c.key);
    // O checklist descreve o que se ve por fora; defeito eletronico e da OS.
    expect(chaves).toContain('cracks');
    expect(chaves).not.toContain('faulty_board');
  });
});

describe('deteccao de imagem pelos BYTES (item 29)', () => {
  it('identifica JPEG e le as dimensoes', () => {
    const detected = detectImage(fakeJpeg(40, 30));
    expect(detected.mime).toBe('image/jpeg');
    expect(detected.extension).toBe('jpg');
    expect(detected.width).toBe(40);
    expect(detected.height).toBe(30);
  });

  it('identifica PNG e le as dimensoes', () => {
    const detected = detectImage(fakePng(100, 50));
    expect(detected.mime).toBe('image/png');
    expect(detected.width).toBe(100);
    expect(detected.height).toBe(50);
  });

  it('RECUSA arquivo que so PARECE imagem pelo nome', () => {
    const php = Buffer.from('<?php system($_GET["c"]); ?>', 'utf8');
    expect(() => detectImage(php)).toThrow(/nao reconhecido como imagem/i);
  });

  it('recusa arquivo vazio', () => {
    expect(() => detectImage(Buffer.alloc(0))).toThrow(/vazio/i);
  });

  it('recusa arquivo acima do limite', () => {
    const enorme = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    Buffer.from([0xff, 0xd8, 0xff]).copy(enorme, 0);
    expect(() => detectImage(enorme)).toThrow(/8 MB/i);
  });

  it('explica o HEIC em portugues em vez de dizer "invalido"', () => {
    const heic = Buffer.alloc(32);
    heic.write('ftyp', 4, 'ascii');
    heic.write('heic', 8, 'ascii');
    expect(() => detectImage(heic)).toThrow(/HEIC/);
  });
});

describe('deteccao de EXIF (item 31)', () => {
  it('JPEG sem metadados nao acusa EXIF', () => {
    expect(hasExif(fakeJpeg())).toBe(false);
  });

  it('encontra o segmento Exif quando ele existe', () => {
    const app1 = Buffer.alloc(12);
    app1.writeUInt16BE(0xffe1, 0);
    app1.writeUInt16BE(10, 2);
    app1.write('Exif', 4, 'ascii');
    const comExif = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xd9])]);
    expect(hasExif(comExif)).toBe(true);
  });

  it('PNG nao e JPEG: nao procura EXIF ali', () => {
    expect(hasExif(fakePng())).toBe(false);
  });
});

describe('normalizacao do resultado de leitura (itens 35 a 37)', () => {
  const base = (fields: RecognitionResult['fields']): RecognitionResult => ({
    status: 'succeeded',
    provider: 'fake',
    fields,
  });

  it('limpa espacos e mantem a confianca', () => {
    const result = normalizeRecognition(
      base({ brand: { value: '  Yamaha ', confidence: 'high' } }),
    );
    expect(result.fields.brand).toEqual({ value: 'Yamaha', confidence: 'high' });
  });

  it('DESCARTA campo vazio — nunca sugere valor inventado (item 36)', () => {
    const result = normalizeRecognition(base({ model: { value: '   ', confidence: 'low' } }));
    expect(result.fields.model).toBeUndefined();
  });

  it('descarta serial sem nenhum caractere util', () => {
    const result = normalizeRecognition(base({ serial: { value: '---', confidence: 'low' } }));
    expect(result.fields.serial).toBeUndefined();
  });

  it('recusa tensao fora do dominio', () => {
    const result = normalizeRecognition(
      base({ voltage: { value: '380v' as never, confidence: 'high' } }),
    );
    expect(result.fields.voltage).toBeUndefined();
  });

  it('"sucesso" sem nenhum campo vira FALHA — nao ha sucesso vazio', () => {
    expect(normalizeRecognition(base({})).status).toBe('failed');
  });

  it('sucesso com um unico campo e PARCIAL, nao completo', () => {
    const result = normalizeRecognition(base({ brand: { value: 'LG', confidence: 'high' } }));
    expect(result.status).toBe('partial');
  });

  it('sucesso com varios campos permanece sucesso', () => {
    const result = normalizeRecognition(
      base({
        brand: { value: 'Yamaha', confidence: 'high' },
        model: { value: 'RX-V385', confidence: 'high' },
        serial: { value: 'Y12345678', confidence: 'medium' },
      }),
    );
    expect(result.status).toBe('succeeded');
  });

  it('a confianca tem rotulo em portugues, sem precisao ficticia', () => {
    expect(CONFIDENCE_LABEL.high).toBe('alta confianca');
    expect(CONFIDENCE_LABEL.medium).toBe('media confianca');
    expect(CONFIDENCE_LABEL.low).toBe('baixa confianca');
  });
});

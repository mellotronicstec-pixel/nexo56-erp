import 'server-only';
import { logger } from '@/core/logging/logger';
import { VOLTAGES, normalizeSerial, type Voltage } from '@/modules/equipment/domain/equipment';

/**
 * Leitura automatica de etiqueta (Prompt 06, itens 33 a 50).
 *
 * ESTADO REAL: NAO HA PROVIDER CONFIGURADO.
 *
 * O que existe e o CONTRATO, a normalizacao, o fluxo de confirmacao e o
 * caminho de falha — tudo testado com um provider falso. O que nao existe e
 * uma integracao com OpenAI, Google, AWS ou qualquer outro: sem credencial
 * configurada, `isAvailable()` responde `false`, a interface explica em
 * portugues e o cadastro segue manual (itens 40, 41 e 43).
 *
 * Nada aqui simula OCR em producao. Um provider falso que "reconhece" dados em
 * producao seria pior do que nenhum: o atendente confiaria num palpite.
 *
 * A REGRA QUE NAO MUDA (item 39): a leitura automatica NUNCA e autoridade. Ela
 * sugere; quem decide e a pessoa. O valor persistido e sempre o confirmado por
 * um humano, e uma correcao humana jamais e sobrescrita depois (item 49).
 */

export type FieldConfidence = 'high' | 'medium' | 'low';

export interface RecognizedField<T = string> {
  value: T;
  confidence: FieldConfidence;
}

/** Campos que uma etiqueta pode trazer (item 36). */
export interface RecognizedLabel {
  brand?: RecognizedField;
  model?: RecognizedField;
  serial?: RecognizedField;
  voltage?: RecognizedField<Voltage>;
  /** Codigo do produto / part number, quando impresso. */
  partNumber?: RecognizedField;
  /** Conteudo bruto de codigo de barras, quando houver decoder. */
  barcode?: RecognizedField;
}

export type RecognitionStatus = 'succeeded' | 'partial' | 'failed' | 'unavailable';

export interface RecognitionResult {
  status: RecognitionStatus;
  provider: string;
  fields: RecognizedLabel;
  /** Mensagem pronta para a interface. Sempre em portugues, sem codigo tecnico. */
  message?: string;
}

/**
 * Contrato do provider (item 42).
 *
 * O dominio conhece esta interface e mais nada. Trocar de fornecedor e
 * implementar `recognize` noutro arquivo — nenhum service, pagina ou teste do
 * modulo precisa mudar.
 */
export interface EquipmentLabelRecognitionProvider {
  readonly name: string;
  isAvailable(): boolean;
  recognize(input: { image: Buffer; mimeType: string }): Promise<RecognitionResult>;
}

/**
 * Provider padrao: INDISPONIVEL.
 *
 * Nao e um erro nem um placeholder esquecido — e a resposta honesta enquanto
 * nenhuma integracao estiver contratada e configurada.
 */
export class UnavailableRecognitionProvider implements EquipmentLabelRecognitionProvider {
  readonly name = 'none';

  isAvailable(): boolean {
    return false;
  }

  async recognize(): Promise<RecognitionResult> {
    return {
      status: 'unavailable',
      provider: this.name,
      fields: {},
      message:
        'A leitura automatica de etiqueta ainda nao esta disponivel. Preencha os dados manualmente.',
    };
  }
}

let provider: EquipmentLabelRecognitionProvider = new UnavailableRecognitionProvider();

export function getLabelRecognitionProvider(): EquipmentLabelRecognitionProvider {
  return provider;
}

/** Injecao de provider. Usada pelos testes com um provider falso (item 110). */
export function setLabelRecognitionProviderForTesting(
  next: EquipmentLabelRecognitionProvider | null,
): void {
  provider = next ?? new UnavailableRecognitionProvider();
}

/** Tempo maximo que a leitura pode tomar antes de devolver o controle (item 121). */
export const RECOGNITION_TIMEOUT_MS = 15_000;

/**
 * Executa a leitura com timeout e sem deixar falha alguma escapar.
 *
 * Falha de provider NUNCA bloqueia o cadastro (itens 40 e 121): o retorno e
 * sempre um `RecognitionResult`, e o pior caso e `failed` com uma frase que a
 * pessoa entende.
 */
export async function recognizeLabel(input: {
  image: Buffer;
  mimeType: string;
}): Promise<RecognitionResult> {
  const current = getLabelRecognitionProvider();

  if (!current.isAvailable()) {
    return current.recognize(input);
  }

  const startedAt = Date.now();

  try {
    const result = await Promise.race([
      current.recognize(input),
      new Promise<RecognitionResult>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), RECOGNITION_TIMEOUT_MS),
      ),
    ]);

    /**
     * Observabilidade sem PII (item 120): operacao, duracao, provider, status e
     * tamanho. A IMAGEM e o conteudo lido NAO vao para o log.
     */
    logger.info('Leitura de etiqueta concluida', {
      module: 'equipment',
      operation: 'recognizeLabel',
      provider: current.name,
      status: result.status,
      durationMs: Date.now() - startedAt,
      imageBytes: input.image.byteLength,
    });

    return normalizeRecognition(result);
  } catch (error) {
    logger.warn('Leitura de etiqueta falhou', {
      module: 'equipment',
      operation: 'recognizeLabel',
      provider: current.name,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      status: 'failed',
      provider: current.name,
      fields: {},
      message:
        'Nao conseguimos identificar os dados automaticamente. Voce pode preencher manualmente.',
    };
  }
}

const VOLTAGE_PATTERNS: ReadonlyArray<[RegExp, Voltage]> = [
  // Sem `\b` no fim: em "110/220V" o zero e o V sao ambos caracteres de
  // palavra, entao nao existe borda ali — e o padrao com borda falhava,
  // classificando um aparelho BIVOLT como 220 V.
  [/\bbivolt\b|\b100\s*-\s*240|\b110\s*\/\s*220|\b127\s*\/\s*220/i, 'bivolt'],
  [/\b127\s*v\b/i, 'v127'],
  [/\b110\s*v\b/i, 'v110'],
  [/\b220\s*v\b/i, 'v220'],
];

/**
 * Interpreta a tensao escrita na etiqueta.
 *
 * `bivolt` e testado PRIMEIRO: uma etiqueta "110/220V" contem "220V", e a
 * ordem errada classificaria um aparelho bivolt como 220 — o tipo de engano
 * que queima o equipamento do cliente.
 */
export function parseVoltage(raw: string): Voltage | null {
  for (const [pattern, voltage] of VOLTAGE_PATTERNS) {
    if (pattern.test(raw)) return voltage;
  }
  return null;
}

/**
 * Normaliza o que o provider devolveu (item 35).
 *
 * Limpa espacos, uniformiza o serial e descarta o que veio vazio — porque
 * sugerir campo em branco com ar de resultado e pior do que nao sugerir nada
 * (item 36: nunca inventar valor ausente).
 */
export function normalizeRecognition(result: RecognitionResult): RecognitionResult {
  const fields: RecognizedLabel = {};

  const text = (field?: RecognizedField): RecognizedField | undefined => {
    const value = field?.value?.trim();
    return value ? { value, confidence: field!.confidence } : undefined;
  };

  const brand = text(result.fields.brand);
  if (brand) fields.brand = brand;

  const model = text(result.fields.model);
  if (model) fields.model = model;

  const serial = text(result.fields.serial);
  if (serial && normalizeSerial(serial.value).length > 0) fields.serial = serial;

  const partNumber = text(result.fields.partNumber);
  if (partNumber) fields.partNumber = partNumber;

  const barcode = text(result.fields.barcode);
  if (barcode) fields.barcode = barcode;

  const voltage = result.fields.voltage;
  if (voltage && (VOLTAGES as readonly string[]).includes(voltage.value)) {
    fields.voltage = voltage;
  }

  const encontrados = Object.keys(fields).length;

  return {
    ...result,
    fields,
    // Sem nenhum campo util, "succeeded" seria mentira; com alguns, "partial"
    // e a descricao honesta do que aconteceu.
    status:
      result.status === 'succeeded' && encontrados === 0
        ? 'failed'
        : result.status === 'succeeded' && encontrados < 2
          ? 'partial'
          : result.status,
  };
}

export const CONFIDENCE_LABEL: Record<FieldConfidence, string> = {
  high: 'alta confianca',
  medium: 'media confianca',
  low: 'baixa confianca',
};

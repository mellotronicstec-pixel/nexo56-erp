import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib';

/**
 * LEITURA DO PDF NOS TESTES (Prompt 13.1, itens 11, 58, 59, 60 e 61).
 *
 * POR QUE NAO UMA BIBLIOTECA DE EXTRACAO. O que precisa ser provado aqui e
 * que os BYTES gravados codificam o texto certo — inclusive a acentuacao. Um
 * extrator de alto nivel normalizaria o resultado e esconderia justamente o
 * erro que se quer pegar (mojibake, caractere perdido, encoding trocado).
 *
 * Entao o helper faz o caminho curto e explicito: abre o documento com o
 * proprio parser, descomprime o fluxo de conteudo da pagina e le as cadeias
 * literais e hexadecimais como o leitor de PDF leria — WinAnsi, byte a byte.
 */

/** Os 32 caracteres em que o CP1252 difere do Latin-1 (faixa 0x80–0x9F). */
const CP1252_ALTO: Readonly<Record<number, string>> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

function decodeWinAnsi(bytes: Buffer): string {
  let saida = '';
  for (const byte of bytes) {
    saida += CP1252_ALTO[byte] ?? String.fromCharCode(byte);
  }
  return saida;
}

/** Desfaz os escapes do PDF numa cadeia literal `( ... )`. */
function decodeLiteral(raw: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i]!;
    if (c !== '\\') {
      bytes.push(raw.charCodeAt(i));
      continue;
    }
    const proximo = raw[i + 1] ?? '';
    i += 1;
    const simples: Record<string, number> = {
      n: 10,
      r: 13,
      t: 9,
      b: 8,
      f: 12,
      '(': 40,
      ')': 41,
      '\\': 92,
    };
    if (proximo in simples) {
      bytes.push(simples[proximo]!);
      continue;
    }
    if (/[0-7]/.test(proximo)) {
      let octal = proximo;
      while (octal.length < 3 && /[0-7]/.test(raw[i + 1] ?? '')) {
        i += 1;
        octal += raw[i];
      }
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    bytes.push(raw.charCodeAt(i));
  }
  return decodeWinAnsi(Buffer.from(bytes));
}

function contentStreams(page: ReturnType<PDFDocument['getPage']>): Buffer[] {
  const node = page.node;
  const ctx = node.context;
  const contents = node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];

  const saida: Buffer[] = [];
  for (const ref of refs) {
    const stream = ctx.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const raw = Buffer.from(stream.contents);
    const filtro = String(stream.dict.get(PDFName.of('Filter')) ?? '');
    saida.push(filtro.includes('FlateDecode') ? inflateSync(raw) : raw);
  }
  return saida;
}

export interface ExtractedPdf {
  pageCount: number;
  /** Texto de cada pagina, na ordem em que foi desenhado. */
  pages: string[];
  /** Todas as paginas concatenadas. */
  text: string;
  title: string | undefined;
  producer: string | undefined;
}

/**
 * Abre o PDF com o parser e devolve o texto realmente gravado nos fluxos.
 *
 * Falha se os bytes nao forem um PDF — que e exatamente o que se quer num
 * teste que existe para provar que o arquivo nao e HTML renomeado.
 */
export async function extractPdf(bytes: Buffer): Promise<ExtractedPdf> {
  /**
   * `updateMetadata: false` porque o leitor tem de OBSERVAR, nao alterar.
   *
   * Por padrao a biblioteca carimba `Producer` e `ModificationDate` ao abrir
   * o documento — e o teste passaria a verificar o que o proprio helper
   * escreveu, nao o que o renderizador gravou. Foi assim que um `Producer`
   * errado apareceu como se fosse defeito do renderizador.
   */
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages: string[] = [];

  for (let indice = 0; indice < doc.getPageCount(); indice += 1) {
    const page = doc.getPage(indice);
    let texto = '';

    for (const stream of contentStreams(page)) {
      const conteudo = stream.toString('latin1');
      const achados = conteudo.matchAll(/(?:\(((?:[^()\\]|\\.)*)\)|<([0-9A-Fa-f\s]*)>)\s*Tj/g);
      for (const achado of achados) {
        if (achado[1] !== undefined) {
          texto += `${decodeLiteral(achado[1])}\n`;
        } else if (achado[2] !== undefined) {
          const hex = achado[2].replace(/\s+/g, '');
          texto += `${decodeWinAnsi(Buffer.from(hex, 'hex'))}\n`;
        }
      }
    }

    pages.push(texto);
  }

  return {
    pageCount: doc.getPageCount(),
    pages,
    text: pages.join('\n'),
    title: doc.getTitle(),
    producer: doc.getProducer(),
  };
}

/** `true` quando os bytes comecam com a assinatura obrigatoria do formato. */
export function hasPdfMagicBytes(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

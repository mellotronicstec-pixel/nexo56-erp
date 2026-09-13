import { ValidationError } from '@/core/errors';

/**
 * Validacao de imagem no SERVIDOR (Prompt 06, itens 29 e 30).
 *
 * O navegador ja valida antes de enviar — e isso e conveniencia, nao barreira.
 * Um `curl` nao passa pelo formulario. Tudo aqui roda no servidor, sobre os
 * bytes que chegaram.
 *
 * O TIPO E LIDO DOS BYTES, nao do cabecalho nem da extensao (item 29). O
 * `Content-Type` e o nome do arquivo vem de quem envia, e quem envia pode
 * mentir: `virus.php` renomeado para `foto.jpg` chega com tipo `image/jpeg`.
 * A assinatura no inicio do arquivo, nao.
 */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface DetectedImage {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
  width: number | null;
  height: number | null;
}

function readUint32BE(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset);
}

/** Dimensoes de PNG: estao no chunk IHDR, em posicao fixa. */
function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  return { width: readUint32BE(buffer, 16), height: readUint32BE(buffer, 20) };
}

/**
 * Dimensoes de JPEG: exigem percorrer os segmentos ate um marcador SOF.
 * O JPEG nao tem cabecalho fixo — por isso a varredura.
 */
function jpegSize(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1]!;
    // SOF0..SOF15, exceto DHT(c4), JPG(c8) e DAC(cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

/** Dimensoes de WebP no formato VP8X/VP8L/VP8 simples. */
function webpSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30) return null;
  const format = buffer.toString('ascii', 12, 16);
  if (format === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (format === 'VP8 ') {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

/**
 * Identifica a imagem pelos bytes iniciais.
 *
 * HEIC/HEIF (item 30) NAO entra: decodificar HEIC no servidor exigiria
 * dependencia nativa, que o projeto evita desde o ADR-003 por causa da
 * hospedagem compartilhada. A solucao esta antes: o navegador converte a foto
 * para JPEG ao redimensiona-la, entao o iPhone envia JPEG mesmo fotografando
 * em HEIC. Quando o navegador nao consegue decodificar, a interface avisa em
 * portugues e o cadastro segue manual.
 */
export function detectImage(buffer: Buffer): DetectedImage {
  if (buffer.length === 0) throw new ValidationError('Arquivo vazio.');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ValidationError('Imagem maior que 8 MB. Reduza a resolucao e tente de novo.');
  }

  // JPEG: FF D8 FF
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    const size = jpegSize(buffer);
    return {
      mime: 'image/jpeg',
      extension: 'jpg',
      width: size?.width ?? null,
      height: size?.height ?? null,
    };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.length > 8 && buffer.toString('hex', 0, 8) === '89504e470d0a1a0a') {
    const size = pngSize(buffer);
    return {
      mime: 'image/png',
      extension: 'png',
      width: size?.width ?? null,
      height: size?.height ?? null,
    };
  }

  // WebP: "RIFF"...."WEBP"
  if (
    buffer.length > 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const size = webpSize(buffer);
    return {
      mime: 'image/webp',
      extension: 'webp',
      width: size?.width ?? null,
      height: size?.height ?? null,
    };
  }

  // HEIC/HEIF: caixa 'ftyp' com marca heic/heix/mif1 — reconhecido so para
  // poder EXPLICAR, em vez de devolver "arquivo invalido".
  if (buffer.length > 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand)) {
      throw new ValidationError(
        'Este formato de foto (HEIC) ainda nao e aceito. Envie como JPEG ou tire a foto pelo proprio sistema.',
      );
    }
  }

  throw new ValidationError('Arquivo nao reconhecido como imagem JPEG, PNG ou WebP.');
}

/**
 * O EXIF sai junto com o redimensionamento feito no navegador: desenhar a
 * imagem num canvas e reexportar produz um arquivo NOVO, sem os metadados
 * originais — incluindo GPS e identificacao do aparelho (item 31).
 *
 * Esta funcao existe para o caso de uma imagem chegar sem passar por ali (um
 * upload direto, por exemplo): ela detecta o marcador APP1/Exif e permite que
 * a aplicacao registre o fato, em vez de supor que nunca acontece.
 */
export function hasExif(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (!(buffer[0] === 0xff && buffer[1] === 0xd8)) return false;

  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) return false;
    const marker = buffer[offset + 1]!;
    if (marker === 0xe1 && buffer.toString('ascii', offset + 4, offset + 8) === 'Exif') return true;
    // Chegou ao inicio dos dados comprimidos: nao ha mais metadados a procurar.
    if (marker === 0xda) return false;
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return false;
}

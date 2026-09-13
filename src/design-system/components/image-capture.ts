'use client';

/**
 * Preparo da imagem NO NAVEGADOR (Prompt 06, itens 23, 25 e 31).
 *
 * POR QUE AQUI, E NAO NO SERVIDOR
 *
 * Redimensionar no servidor exigiria uma dependencia nativa (sharp), e o
 * projeto evita binario nativo desde o ADR-003 por causa da hospedagem
 * compartilhada. O navegador ja tem um decodificador de imagem e um canvas —
 * usar o que existe custa zero dependencia e ainda economiza banda: a foto de
 * 12 MP do celular vira ~300 KB ANTES de subir, em vez de trafegar inteira.
 *
 * O EXIF SAI DE GRACA (item 31): desenhar num canvas e reexportar produz um
 * arquivo NOVO, construido a partir dos pixels. GPS, modelo do aparelho e
 * horario nao atravessam — nao porque sejam removidos, mas porque nunca fazem
 * parte do que o canvas escreve.
 *
 * A ORIENTACAO E PRESERVADA porque `createImageBitmap` aplica a rotacao do
 * EXIF ao decodificar; o que vai para o canvas ja esta em pe.
 *
 * HEIC: em iOS o proprio navegador decodifica, entao a saida sai JPEG e o
 * servidor nem ve HEIC. Onde o navegador nao decodifica, a funcao falha com
 * mensagem em portugues e o cadastro segue manual.
 */

export const MAX_DIMENSION = 2000;
export const JPEG_QUALITY = 0.82;

export interface PreparedImage {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

export class ImagePreparationError extends Error {}

/**
 * Reduz e reexporta a imagem como JPEG.
 *
 * 2000px no maior lado: o suficiente para ler uma etiqueta de equipamento e
 * enxergar um risco na carcaca — que e a finalidade operacional da foto
 * (item 25) — sem carregar 12 MP de um celular moderno.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  let bitmap: ImageBitmap;

  try {
    // `imageOrientation: 'from-image'` aplica a rotacao do EXIF na decodificacao.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImagePreparationError(
      'Nao conseguimos ler esta imagem neste navegador. Tente enviar como JPEG.',
    );
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new ImagePreparationError('Nao foi possivel preparar a imagem neste dispositivo.');
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );

  if (!blob) throw new ImagePreparationError('Nao foi possivel preparar a imagem.');

  /**
   * O nome tambem e refeito. O que o navegador manda nao e usado como caminho
   * em lugar nenhum (o servidor gera a chave), mas nao carregar o nome
   * original evita expor "IMG_2024_casa_do_cliente.heic" em log e interface.
   */
  const prepared = new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' });

  return { file: prepared, previewUrl: URL.createObjectURL(prepared), width, height };
}

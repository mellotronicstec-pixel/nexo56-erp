/**
 * FRONTEIRA DO RENDERIZADOR DE PDF (Prompt 13.1, itens 7 e 15).
 *
 * O dominio declara O QUE precisa — bytes de um PDF a partir de um documento —
 * e NAO conhece a biblioteca que produz esses bytes. Nenhum import de
 * `@cantoo/pdf-lib` entra neste arquivo, e um teste de fronteira falha o build
 * se entrar. Trocar de renderizador amanha nao deve tocar em nada aqui.
 */

import type { CertificateDocument } from './certificate-document';

export interface RenderedCertificatePdf {
  bytes: Buffer;
  pageCount: number;
  /** Identificador do renderizador e versao — vai para o banco e para o log. */
  renderer: string;
}

export interface WarrantyCertificatePdfRenderer {
  readonly id: string;
  /**
   * `issuedAt` entra por parametro e NAO e `new Date()`: os metadados do PDF
   * carregam data de criacao, e deixa-la flutuar faria o mesmo snapshot
   * produzir bytes diferentes a cada chamada. Com a data da emissao, o
   * documento e reproduzivel byte a byte (item 23).
   */
  render(document: CertificateDocument, issuedAt: Date): Promise<RenderedCertificatePdf>;
}

export const CERTIFICATE_PDF_MIME = 'application/pdf';
export const CERTIFICATE_PDF_EXTENSION = 'pdf';
/** Escopo de armazenamento. Nao contem tenant, cliente nem numero legivel. */
export const CERTIFICATE_PDF_SCOPE = 'warranty-certificates';

/**
 * Nome sugerido para download (item 28).
 *
 * SEM PII: sai o numero da garantia, que e uma referencia interna da loja, e
 * nao o nome do cliente nem nada que identifique uma pessoa num arquivo que
 * vai parar na pasta de downloads e em anexos de e-mail.
 */
export function certificatePdfFilename(reference: string): string {
  const base = reference
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `certificado-garantia-${base || 'nexo56'}.pdf`;
}

// ---------------------------------------------------------------------------
// Texto seguro para as fontes padrao do PDF (itens 15, 16 e 76)
// ---------------------------------------------------------------------------

/**
 * As fontes padrao do PDF usam WinAnsi (CP1252), que cobre TODO o portugues:
 * a acentuacao, o cedilha e o til estao todos lá. O que NAO cabe e o resto do
 * Unicode — emoji, alfabetos nao latinos, simbolos matematicos.
 *
 * Texto de cliente e texto, nunca comando de renderizador (item 76). Um
 * caractere fora da tabela derrubaria a geracao inteira no meio; aqui ele e
 * convertido ou substituido, e o documento sai.
 */
const SUBSTITUICOES: ReadonlyArray<[RegExp, string]> = [
  // Espacos exoticos viram espaco comum.
  [/[\u00a0\u2007\u202f\u2009\u200a\u2002\u2003]/g, ' '],
  // Zero-width e marcas de direcao simplesmente somem.
  [/[\u200b-\u200f\u2028\u2029\ufeff]/g, ''],
  // Travessoes e hifens variados que o CP1252 nao tem.
  [/[\u2010\u2011\u2012\u2212]/g, '-'],
  // Aspas tipograficas que existem em CP1252 ficam; estas nao existem.
  [/[\u2032\u02bc]/g, "'"],
  [/\u2033/g, '"'],
  // Simbolos comuns em texto tecnico.
  [/\u2264/g, '<='],
  [/\u2265/g, '>='],
  [/\u00b1/g, '+/-'],
];

/** Os 32 caracteres que o CP1252 acrescenta ao Latin-1 na faixa 0x80–0x9F. */
const CP1252_EXTRAS: ReadonlySet<number> = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

function encodavel(codigo: number): boolean {
  if (codigo === 0x09 || codigo === 0x0a) return true;
  if (codigo >= 0x20 && codigo <= 0x7e) return true;
  if (codigo >= 0xa0 && codigo <= 0xff) return true;
  return CP1252_EXTRAS.has(codigo);
}

/**
 * Deixa o texto imprimivel pelas fontes padrao, sem perder acento nenhum.
 *
 * O que nao tem equivalente vira `?`: um marcador visivel e honesto e melhor
 * do que um buraco silencioso no meio de uma clausula de garantia.
 */
export function toPdfSafeText(raw: string): string {
  let texto = raw.normalize('NFC');
  for (const [padrao, troca] of SUBSTITUICOES) texto = texto.replace(padrao, troca);

  let saida = '';
  for (const caractere of texto) {
    const codigo = caractere.codePointAt(0) ?? 0;
    saida += encodavel(codigo) ? caractere : '?';
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Quebra de linha (itens 17 e 19)
// ---------------------------------------------------------------------------

/**
 * Quebra o texto em linhas que cabem em `maxWidth`.
 *
 * `measure` entra por parametro para que esta funcao continue pura e testavel
 * sem carregar uma fonte: o teste mede com uma regua falsa e verifica o
 * algoritmo; a producao mede com a fonte real.
 *
 * PALAVRA MAIOR QUE A LINHA e quebrada na forca. Sem isso, um numero de serie
 * de 80 digitos ou uma URL longa sairia pela margem — e "sair pela margem" no
 * PDF significa sumir, nao rolar.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
): string[] {
  const linhas: string[] = [];

  for (const paragrafo of text.split('\n')) {
    const palavras = paragrafo.split(/\s+/).filter((p) => p.length > 0);
    if (palavras.length === 0) {
      linhas.push('');
      continue;
    }

    let atual = '';
    for (const palavra of palavras) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (measure(tentativa) <= maxWidth) {
        atual = tentativa;
        continue;
      }

      if (atual) linhas.push(atual);

      if (measure(palavra) <= maxWidth) {
        atual = palavra;
        continue;
      }

      /** A palavra sozinha nao cabe: corta em pedacos que cabem. */
      let resto = palavra;
      while (resto.length > 0 && measure(resto) > maxWidth) {
        let corte = resto.length - 1;
        while (corte > 1 && measure(resto.slice(0, corte)) > maxWidth) corte -= 1;
        linhas.push(resto.slice(0, corte));
        resto = resto.slice(corte);
      }
      atual = resto;
    }

    if (atual) linhas.push(atual);
  }

  return linhas;
}

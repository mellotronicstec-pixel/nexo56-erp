import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import qrcode from 'qrcode-generator';
import type { CertificateDocument } from '@/modules/warranties/domain/certificate-document';
import {
  toPdfSafeText,
  wrapText,
  type RenderedCertificatePdf,
  type WarrantyCertificatePdfRenderer,
} from '@/modules/warranties/domain/certificate-pdf';

/**
 * RENDERIZADOR DE PDF DO CERTIFICADO (Prompt 13.1, itens 5, 6, 7, 12 a 20).
 *
 * ESTE E O UNICO ARQUIVO QUE CONHECE A BIBLIOTECA DE PDF. O dominio declara a
 * interface; a troca de renderizador amanha se resolve aqui dentro.
 *
 * POR QUE GERACAO PROGRAMATICA, E NAO NAVEGADOR HEADLESS (itens 4, 5 e 6).
 * A primeira hospedagem e compartilhada. Chromium exige binario de ~150 MB,
 * memoria que o plano nao tem e permissao de processo que a hospedagem nao
 * da — adotar Puppeteer aqui significaria migrar para VPS antes de existir
 * cliente pagante. `@cantoo/pdf-lib` e JavaScript puro: nenhum binario,
 * nenhum arquivo lido em tempo de execucao, nenhum servico separado.
 *
 * POR QUE AS FONTES PADRAO (item 15). A interface usa Sora e Inter via
 * `next/font/google`, que as baixa NO BUILD para servir ao navegador — nao ha
 * arquivo de fonte no repositorio para embutir, e buscar fonte pela rede
 * durante a geracao e exatamente o que o item 15 proibe. As fontes padrao do
 * PDF usam WinAnsi, que cobre todo o portugues; o custo e tipografico, nao
 * funcional, e esta registrado no ADR-072.
 */

/** A4 em pontos PostScript: 210 x 297 mm. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

const MARGIN_X = 56;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 64;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

/** Identidade Nexo56 (item 13), convertida para o espaco de cor do PDF. */
const BRAND = rgb(0 / 255, 102 / 255, 255 / 255);
const INK = rgb(16 / 255, 24 / 255, 40 / 255);
const MUTED = rgb(94 / 255, 103 / 255, 120 / 255);
const RULE = rgb(210 / 255, 214 / 255, 221 / 255);

const SIZE_TITLE = 20;
const SIZE_SECTION = 11.5;
const SIZE_BODY = 10;
const SIZE_SMALL = 8.5;
const LINE_GAP = 1.45;

interface Layout {
  pdf: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
  pages: PDFPage[];
}

function medir(font: PDFFont, size: number) {
  return (value: string) => font.widthOfTextAtSize(value, size);
}

function novaPagina(layout: Layout): void {
  layout.page = layout.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  layout.pages.push(layout.page);
  layout.y = PAGE_HEIGHT - MARGIN_TOP;
}

/**
 * Reserva espaco vertical; abre pagina nova quando o bloco nao cabe.
 *
 * E ESTA FUNCAO que garante o item 19: nenhum conteudo desaparece por
 * transbordo, porque nada e desenhado sem antes perguntar se cabe.
 */
function reservar(layout: Layout, altura: number): void {
  if (layout.y - altura < MARGIN_BOTTOM) novaPagina(layout);
}

function escreverLinhas(
  layout: Layout,
  linhas: string[],
  options: { font: PDFFont; size: number; color?: ReturnType<typeof rgb>; indent?: number },
): void {
  const alturaLinha = options.size * LINE_GAP;
  for (const linha of linhas) {
    reservar(layout, alturaLinha);
    layout.page.drawText(linha, {
      x: MARGIN_X + (options.indent ?? 0),
      y: layout.y - options.size,
      size: options.size,
      font: options.font,
      color: options.color ?? INK,
    });
    layout.y -= alturaLinha;
  }
}

function paragrafo(
  layout: Layout,
  texto: string,
  options: { font: PDFFont; size: number; color?: ReturnType<typeof rgb>; indent?: number },
): void {
  const largura = CONTENT_WIDTH - (options.indent ?? 0);
  const linhas = wrapText(toPdfSafeText(texto), largura, medir(options.font, options.size));
  escreverLinhas(layout, linhas, options);
}

function desenharQr(layout: Layout, conteudo: string, x: number, y: number, tamanho: number): void {
  /**
   * O QR e desenhado como retangulos, nao como imagem embutida: evita
   * codificar PNG, evita uma dependencia de imagem e produz vetor — que
   * imprime nitido em qualquer resolucao.
   */
  const qr = qrcode(0, 'M');
  qr.addData(conteudo);
  qr.make();

  const modulos = qr.getModuleCount();
  const celula = tamanho / modulos;

  for (let linha = 0; linha < modulos; linha += 1) {
    for (let coluna = 0; coluna < modulos; coluna += 1) {
      if (!qr.isDark(linha, coluna)) continue;
      layout.page.drawRectangle({
        x: x + coluna * celula,
        y: y + tamanho - (linha + 1) * celula,
        width: celula,
        height: celula,
        color: INK,
      });
    }
  }
}

function cabecalho(layout: Layout, documento: CertificateDocument): void {
  /**
   * NAO HA LOGOTIPO AQUI (item 14). Os ativos oficiais do Nexo56 ainda nao
   * foram entregues ao projeto, e a Constituicao proibe reconstruir a marca
   * com fonte. O que identifica o documento e o nome da EMPRESA que concedeu
   * a garantia — que e dado real do snapshot — sobre uma faixa na cor
   * institucional.
   */
  layout.page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 8,
    width: PAGE_WIDTH,
    height: 8,
    color: BRAND,
  });

  const empresa = toPdfSafeText(documento.issuer.company || 'Assistencia tecnica');
  layout.page.drawText(empresa, {
    x: MARGIN_X,
    y: layout.y - SIZE_BODY,
    size: SIZE_BODY,
    font: layout.bold,
    color: MUTED,
  });
  layout.y -= SIZE_BODY * 1.8;

  reservar(layout, SIZE_TITLE * 2);
  layout.page.drawText(toPdfSafeText(documento.title), {
    x: MARGIN_X,
    y: layout.y - SIZE_TITLE,
    size: SIZE_TITLE,
    font: layout.bold,
    color: INK,
  });

  const referencia = toPdfSafeText(documento.reference);
  const larguraReferencia = layout.bold.widthOfTextAtSize(referencia, SIZE_SECTION);
  layout.page.drawText(referencia, {
    x: PAGE_WIDTH - MARGIN_X - larguraReferencia,
    y: layout.y - SIZE_TITLE + 2,
    size: SIZE_SECTION,
    font: layout.bold,
    color: BRAND,
  });
  layout.y -= SIZE_TITLE * 1.5;

  const unidade = toPdfSafeText(documento.issuer.unit);
  if (unidade) {
    layout.page.drawText(`Unidade: ${unidade}`, {
      x: MARGIN_X,
      y: layout.y - SIZE_SMALL,
      size: SIZE_SMALL,
      font: layout.regular,
      color: MUTED,
    });
    layout.y -= SIZE_SMALL * 2;
  }

  regua(layout);
}

function regua(layout: Layout): void {
  reservar(layout, 12);
  layout.page.drawLine({
    start: { x: MARGIN_X, y: layout.y },
    end: { x: PAGE_WIDTH - MARGIN_X, y: layout.y },
    thickness: 0.75,
    color: RULE,
  });
  layout.y -= 14;
}

function aviso(layout: Layout, texto: string): void {
  const altura = SIZE_BODY * 2.4;
  reservar(layout, altura + 8);

  /**
   * O aviso de cobertura parcial NAO depende so de cor (item 13): tem moldura,
   * tem texto em caixa alta e continua legivel em escala de cinza, impresso
   * numa laser preto e branco de balcao.
   */
  layout.page.drawRectangle({
    x: MARGIN_X,
    y: layout.y - altura,
    width: CONTENT_WIDTH,
    height: altura,
    borderColor: INK,
    borderWidth: 1,
  });
  layout.page.drawText(toPdfSafeText(texto), {
    x: MARGIN_X + 10,
    y: layout.y - altura / 2 - SIZE_BODY / 2 + 1,
    size: SIZE_BODY,
    font: layout.bold,
    color: INK,
  });
  layout.y -= altura + 12;
}

function secao(layout: Layout, titulo: string): void {
  reservar(layout, SIZE_SECTION * 2.4);
  layout.page.drawText(toPdfSafeText(titulo).toUpperCase(), {
    x: MARGIN_X,
    y: layout.y - SIZE_SECTION,
    size: SIZE_SECTION,
    font: layout.bold,
    color: BRAND,
  });
  layout.y -= SIZE_SECTION * 1.9;
}

const LABEL_WIDTH = 132;

function campo(layout: Layout, label: string, valor: string): void {
  const linhas = wrapText(
    toPdfSafeText(valor),
    CONTENT_WIDTH - LABEL_WIDTH,
    medir(layout.regular, SIZE_BODY),
  );
  const altura = Math.max(1, linhas.length) * SIZE_BODY * LINE_GAP;
  reservar(layout, altura);

  const topo = layout.y;
  layout.page.drawText(toPdfSafeText(label), {
    x: MARGIN_X,
    y: topo - SIZE_BODY,
    size: SIZE_BODY,
    font: layout.regular,
    color: MUTED,
  });

  let y = topo;
  for (const linha of linhas) {
    layout.page.drawText(linha, {
      x: MARGIN_X + LABEL_WIDTH,
      y: y - SIZE_BODY,
      size: SIZE_BODY,
      font: layout.bold,
      color: INK,
    });
    y -= SIZE_BODY * LINE_GAP;
  }
  layout.y = topo - altura;
}

function marcador(layout: Layout, texto: string): void {
  const largura = CONTENT_WIDTH - 14;
  const linhas = wrapText(toPdfSafeText(texto), largura, medir(layout.regular, SIZE_BODY));
  const alturaLinha = SIZE_BODY * LINE_GAP;

  for (const [indice, linha] of linhas.entries()) {
    reservar(layout, alturaLinha);
    if (indice === 0) {
      layout.page.drawText('-', {
        x: MARGIN_X,
        y: layout.y - SIZE_BODY,
        size: SIZE_BODY,
        font: layout.bold,
        color: BRAND,
      });
    }
    layout.page.drawText(linha, {
      x: MARGIN_X + 14,
      y: layout.y - SIZE_BODY,
      size: SIZE_BODY,
      font: layout.regular,
      color: INK,
    });
    layout.y -= alturaLinha;
  }
}

function verificacao(layout: Layout, documento: CertificateDocument): void {
  const TAMANHO_QR = 96;

  /**
   * UMA reserva para o bloco INTEIRO — regua, QR e legenda.
   *
   * Reservar em duas etapas deixava a regua no pe de uma pagina e o QR na
   * seguinte, com um risco horizontal solto no rodape. O bloco de verificacao
   * e indivisivel: ou cabe inteiro, ou vai inteiro para a proxima pagina.
   */
  reservar(layout, 14 + TAMANHO_QR + 12);

  layout.page.drawLine({
    start: { x: MARGIN_X, y: layout.y },
    end: { x: PAGE_WIDTH - MARGIN_X, y: layout.y },
    thickness: 0.75,
    color: RULE,
  });
  layout.y -= 14;

  const topo = layout.y;
  desenharQr(layout, documento.verification.url, MARGIN_X, topo - TAMANHO_QR, TAMANHO_QR);

  const textoX = MARGIN_X + TAMANHO_QR + 18;
  const largura = PAGE_WIDTH - MARGIN_X - textoX;

  layout.page.drawText('VERIFICACAO', {
    x: textoX,
    y: topo - SIZE_SECTION,
    size: SIZE_SECTION,
    font: layout.bold,
    color: BRAND,
  });

  let y = topo - SIZE_SECTION * 2.2;
  const linhas = wrapText(
    toPdfSafeText(documento.verification.caption),
    largura,
    medir(layout.regular, SIZE_SMALL),
  );
  for (const linha of linhas) {
    layout.page.drawText(linha, {
      x: textoX,
      y,
      size: SIZE_SMALL,
      font: layout.regular,
      color: INK,
    });
    y -= SIZE_SMALL * LINE_GAP;
  }

  layout.y = topo - TAMANHO_QR - 10;
}

/** Rodape e paginacao, aplicados depois — so entao se sabe o total (item 19). */
function rodape(layout: Layout, documento: CertificateDocument): void {
  const total = layout.pages.length;
  const texto = toPdfSafeText(documento.footer);

  for (const [indice, page] of layout.pages.entries()) {
    page.drawLine({
      start: { x: MARGIN_X, y: MARGIN_BOTTOM - 18 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: MARGIN_BOTTOM - 18 },
      thickness: 0.5,
      color: RULE,
    });

    page.drawText(texto, {
      x: MARGIN_X,
      y: MARGIN_BOTTOM - 32,
      size: SIZE_SMALL,
      font: layout.regular,
      color: MUTED,
    });

    const paginacao = `${toPdfSafeText(documento.reference)}  |  Pagina ${indice + 1} de ${total}`;
    const largura = layout.regular.widthOfTextAtSize(paginacao, SIZE_SMALL);
    page.drawText(paginacao, {
      x: PAGE_WIDTH - MARGIN_X - largura,
      y: MARGIN_BOTTOM - 32,
      size: SIZE_SMALL,
      font: layout.regular,
      color: MUTED,
    });
  }
}

export class PdfLibCertificateRenderer implements WarrantyCertificatePdfRenderer {
  readonly id = 'pdf-lib@cantoo-2';

  async render(documento: CertificateDocument, issuedAt: Date): Promise<RenderedCertificatePdf> {
    /**
     * `updateMetadata: false` E O QUE TORNA O ARQUIVO REPRODUZIVEL (item 23).
     *
     * Por padrao a biblioteca carimba `Producer` e `ModificationDate` com o
     * instante da gravacao. Isso trocaria os bytes a cada chamada e faria o
     * checksum do arquivo mudar sem o documento mudar — quebrando a
     * idempotencia que os itens 24 e 55 exigem. Descoberto por teste: o
     * `Producer` declarado vinha sobrescrito na saida.
     */
    const pdf = await PDFDocument.create({ updateMetadata: false });

    /** Metadados FIXOS, derivados da emissao — nunca de `new Date()`. */
    pdf.setTitle(`${documento.title} ${documento.reference}`);
    pdf.setSubject('Certificado de garantia');
    pdf.setProducer('Nexo56 ERP');
    pdf.setCreator('Nexo56 ERP');
    pdf.setCreationDate(issuedAt);
    pdf.setModificationDate(issuedAt);

    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const layout: Layout = {
      pdf,
      regular,
      bold,
      page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
      y: PAGE_HEIGHT - MARGIN_TOP,
      pages: [],
    };
    layout.pages.push(layout.page);

    cabecalho(layout, documento);

    if (documento.notice) aviso(layout, documento.notice);

    for (const bloco of documento.sections) {
      if (bloco.title) secao(layout, bloco.title);
      for (const item of bloco.fields) campo(layout, item.label, item.value);
      if (bloco.fields.length > 0 && (bloco.paragraphs.length > 0 || bloco.bullets.length > 0)) {
        layout.y -= 4;
      }
      for (const texto of bloco.paragraphs) {
        paragrafo(layout, texto, { font: regular, size: SIZE_BODY });
        layout.y -= 4;
      }
      for (const texto of bloco.bullets) marcador(layout, texto);
      layout.y -= 10;
    }

    verificacao(layout, documento);
    rodape(layout, documento);

    /**
     * `useObjectStreams: false` mantem a estrutura previsivel e o arquivo
     * legivel por leitores antigos. O custo em bytes e irrelevante num
     * documento de uma a tres paginas.
     */
    const bytes = Buffer.from(await pdf.save({ useObjectStreams: false }));

    return { bytes, pageCount: layout.pages.length, renderer: this.id };
  }
}

let renderer: WarrantyCertificatePdfRenderer | null = null;

export function getCertificatePdfRenderer(): WarrantyCertificatePdfRenderer {
  if (!renderer) renderer = new PdfLibCertificateRenderer();
  return renderer;
}

/** Troca o renderizador. Existe para teste; producao usa o padrao. */
export function setCertificatePdfRendererForTesting(
  next: WarrantyCertificatePdfRenderer | null,
): void {
  renderer = next;
}

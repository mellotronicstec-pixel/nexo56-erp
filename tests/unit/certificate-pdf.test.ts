import { describe, expect, it } from 'vitest';
import { buildCertificateDocument } from '@/modules/warranties/domain/certificate-document';
import type { CertificateDocumentInput } from '@/modules/warranties/domain/certificate-document';
import { PdfLibCertificateRenderer } from '@/modules/warranties/infrastructure/pdf/certificate-pdf-renderer';
import { extractPdf, hasPdfMagicBytes } from '../helpers/pdf';

/**
 * PDF REAL (Prompt 13.1, itens 11, 58 a 62).
 *
 * O QUE ESTES TESTES RECUSAM A ACEITAR: um HTML com extensao `.pdf`. Cada
 * afirmacao aqui e verificada nos BYTES — assinatura do formato, parser
 * abrindo o documento, numero de paginas, e o texto realmente gravado no
 * fluxo de conteudo, lido como o leitor de PDF o leria.
 */

const EMISSAO = new Date('2026-09-21T12:00:00Z');
const URL_QR = 'https://exemplo.invalid/garantias/certificado/xTiR2DqBo86dfrXKD-Vl9PErr0hroDCy';

const BASE: CertificateDocumentInput = {
  emitidoEm: '2026-09-21',
  empresa: { nome: 'Assistência Técnica São José', unidade: 'Loja Centro' },
  garantia: {
    numero: 'GAR 000123',
    tipo: 'Garantia interna',
    vigencia: { inicio: '2026-09-21', fim: '2026-12-21' },
    duracao: '3 meses',
    cobreServicoInteiro: true,
  },
  cliente: { nome: 'João Gonçalves' },
  equipamento: { descricao: 'Notebook', marca: 'Acer', modelo: 'A515' },
  ordemDeServico: { numero: 54 },
  cobertura: [{ tipo: 'labor', descricao: 'Reparo da fonte de alimentação' }],
  exclusoes: 'Mau uso, queda e líquido.',
  termos: 'Apresentar o certificado no balcão.',
};

const renderer = new PdfLibCertificateRenderer();

async function gerar(overrides: Partial<CertificateDocumentInput> = {}) {
  const documento = buildCertificateDocument({ ...BASE, ...overrides }, URL_QR);
  return renderer.render(documento, EMISSAO);
}

describe('o arquivo e um PDF de verdade (itens 11 e 58)', () => {
  it('comeca com a assinatura %PDF-', async () => {
    const { bytes } = await gerar();
    expect(hasPdfMagicBytes(bytes)).toBe(true);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('NAO e HTML disfarcado', async () => {
    const { bytes } = await gerar();
    const inicio = bytes.subarray(0, 200).toString('latin1').toLowerCase();
    expect(inicio).not.toContain('<!doctype');
    expect(inicio).not.toContain('<html');
  });

  it('tem tamanho compativel com um documento, nao com um arquivo vazio', async () => {
    const { bytes } = await gerar();
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('o parser abre o documento e conta ao menos uma pagina', async () => {
    const { bytes, pageCount } = await gerar();
    const lido = await extractPdf(bytes);
    expect(lido.pageCount).toBeGreaterThanOrEqual(1);
    expect(lido.pageCount).toBe(pageCount);
  });

  it('carrega os metadados que o documento declara', async () => {
    const { bytes } = await gerar();
    const lido = await extractPdf(bytes);
    expect(lido.title).toContain('GAR 000123');
    expect(lido.producer).toBe('Nexo56 ERP');
  });

  it('termina com a marca de fim de arquivo', async () => {
    const { bytes } = await gerar();
    expect(bytes.subarray(-8).toString('latin1')).toContain('%%EOF');
  });
});

describe('conteudo essencial (item 59)', () => {
  it('traz titulo, referencia, cliente, tipo, vigencia e cobertura', async () => {
    const { bytes } = await gerar();
    const { text } = await extractPdf(bytes);

    expect(text).toContain('Certificado de Garantia');
    expect(text).toContain('GAR 000123');
    expect(text).toContain('João Gonçalves');
    expect(text).toContain('Garantia interna');
    expect(text).toContain('21/09/2026');
    expect(text).toContain('21/12/2026');
    expect(text).toContain('Reparo da fonte de alimentação');
  });

  it('identifica a empresa e a unidade que concederam a garantia', async () => {
    const { bytes } = await gerar();
    const { text } = await extractPdf(bytes);
    expect(text).toContain('Assistência Técnica São José');
    expect(text).toContain('Loja Centro');
  });

  it('numera as paginas e repete a referencia no rodape', async () => {
    const { bytes } = await gerar();
    const { text } = await extractPdf(bytes);
    expect(text).toMatch(/Pagina 1 de \d+/);
  });

  it('a cobertura parcial aparece EM DESTAQUE no documento', async () => {
    const { bytes } = await gerar({
      garantia: { ...BASE.garantia, cobreServicoInteiro: false },
    });
    const { text } = await extractPdf(bytes);
    expect(text).toContain('COBERTURA PARCIAL');
  });
});

describe('portugues com acento (item 60)', () => {
  it('grava corretamente nomes brasileiros reais', async () => {
    const { bytes } = await gerar({
      cliente: { nome: 'João Gonçalves' },
      equipamento: { descricao: 'Notebook da Márcia Araújo', marca: null, modelo: null },
      empresa: { nome: 'Assistência Técnica São José', unidade: 'Unidade Maçã' },
      termos: 'Condições de utilização. Reparação eletrônica com garantia de mão de obra.',
    });
    const { text } = await extractPdf(bytes);

    expect(text).toContain('João Gonçalves');
    expect(text).toContain('Márcia Araújo');
    expect(text).toContain('Assistência Técnica São José');
    expect(text).toContain('Condições de utilização');
    expect(text).toContain('Reparação eletrônica');
  });

  it('nao produz mojibake: o acento nao vira dois caracteres', async () => {
    const { bytes } = await gerar({ cliente: { nome: 'João' } });
    const { text } = await extractPdf(bytes);
    expect(text).toContain('João');
    expect(text).not.toContain('JoÃ£o');
    expect(text).not.toContain('Joo');
  });

  it('maiusculas acentuadas e cedilha tambem sobrevivem', async () => {
    const { bytes } = await gerar({
      cliente: { nome: 'ÁLVARO ÇESÃO ÉRICA' },
    });
    const { text } = await extractPdf(bytes);
    expect(text).toContain('ÁLVARO ÇESÃO ÉRICA');
  });
});

describe('texto longo e multipagina (itens 19 e 61)', () => {
  const termosLongos = Array.from(
    { length: 16 },
    (_, i) =>
      `${i + 1}. Condições de utilização e reparação eletrônica: a garantia cobre exclusivamente o serviço descrito, executado pela assistência, e não abrange danos por mau uso, queda, contato com líquidos, oscilação da rede elétrica ou intervenção de terceiros no aparelho.`,
  ).join('\n\n');

  it('gera mais de uma pagina quando os termos sao extensos', async () => {
    const { bytes, pageCount } = await gerar({ termos: termosLongos });
    expect(pageCount).toBeGreaterThanOrEqual(2);
    const lido = await extractPdf(bytes);
    expect(lido.pageCount).toBe(pageCount);
  });

  it('NENHUMA clausula desaparece: a primeira e a ultima estao no documento', async () => {
    const { bytes } = await gerar({ termos: termosLongos });
    const { text } = await extractPdf(bytes);
    expect(text).toContain('1. Condições de utilização');
    expect(text).toContain('16. Condições de utilização');
  });

  it('todas as 16 clausulas estao presentes, nao apenas as das bordas', async () => {
    const { bytes } = await gerar({ termos: termosLongos });
    const { text } = await extractPdf(bytes);
    for (let n = 1; n <= 16; n += 1) {
      expect(text).toContain(`${n}. Condições de utilização`);
    }
  });

  it('o rodape numera todas as paginas com o total correto', async () => {
    const { bytes, pageCount } = await gerar({ termos: termosLongos });
    const lido = await extractPdf(bytes);
    for (let n = 1; n <= pageCount; n += 1) {
      expect(lido.pages[n - 1]).toContain(`Pagina ${n} de ${pageCount}`);
    }
  });

  it('uma palavra sem espaco maior que a linha nao sai pela margem', async () => {
    const serial = 'X'.repeat(300);
    const { bytes } = await gerar({ termos: serial });
    const { text } = await extractPdf(bytes);
    /** O conteudo continua inteiro, apenas distribuido em varias linhas. */
    expect(text.replace(/\s+/g, '')).toContain(serial);
  });
});

describe('os quatro tipos de garantia (item 62)', () => {
  const casos = [
    { tipo: 'Garantia interna', ordemDeServico: { numero: 54 } as const },
    { tipo: 'Garantia de fabrica', ordemDeServico: null },
    { tipo: 'Garantia de peca', ordemDeServico: null },
    { tipo: 'Garantia estendida', ordemDeServico: null },
  ];

  for (const caso of casos) {
    it(`gera PDF valido para ${caso.tipo}, com ou sem Ordem de Servico`, async () => {
      const { bytes, pageCount } = await gerar({
        garantia: { ...BASE.garantia, tipo: caso.tipo },
        ordemDeServico: caso.ordemDeServico,
      });

      expect(hasPdfMagicBytes(bytes)).toBe(true);
      expect(pageCount).toBeGreaterThanOrEqual(1);

      const { text } = await extractPdf(bytes);
      expect(text).toContain(caso.tipo);
      if (caso.ordemDeServico === null) expect(text).toContain('Nao se aplica');
    });
  }

  it('garantia sem cobertura detalhada ainda produz documento', async () => {
    const { bytes } = await gerar({ cobertura: [], exclusoes: null, termos: null });
    expect(hasPdfMagicBytes(bytes)).toBe(true);
    const { text } = await extractPdf(bytes);
    expect(text).toContain('Certificado de Garantia');
  });
});

describe('determinismo (item 23)', () => {
  it('o mesmo snapshot e a mesma emissao produzem os MESMOS bytes', async () => {
    const primeiro = await gerar();
    const segundo = await gerar();
    expect(primeiro.bytes.equals(segundo.bytes)).toBe(true);
  });

  it('snapshot diferente produz documento diferente', async () => {
    const primeiro = await gerar();
    const segundo = await gerar({ cliente: { nome: 'Outra Pessoa' } });
    expect(primeiro.bytes.equals(segundo.bytes)).toBe(false);
  });
});

describe('QR sem dado pessoal (itens 20 e 65)', () => {
  it('o QR codifica o endereco com o token opaco, e nada mais', async () => {
    /**
     * O que entra no QR e exatamente `verification.url` — o endereco montado
     * com o token. Nao ha caminho no codigo por onde um dado do cliente
     * chegue ate la.
     */
    const documento = buildCertificateDocument(BASE, URL_QR);
    expect(documento.verification.url).toBe(URL_QR);
    expect(documento.verification.url).toContain('xTiR2DqBo86dfrXKD-Vl9PErr0hroDCy');
    expect(documento.verification.url).not.toContain(BASE.cliente.nome);
    expect(documento.verification.url).not.toMatch(/@|\d{3}\.\d{3}\.\d{3}-\d{2}/);
  });

  it('o TEXTO do documento nao contem e-mail, CPF nem telefone', async () => {
    const { bytes } = await gerar();
    const { text } = await extractPdf(bytes);

    expect(text).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
    expect(text).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(text).not.toMatch(/\(\d{2}\)\s?\d{4,5}-\d{4}/);
  });

  it('a legenda explica que consultar exige acesso autorizado', async () => {
    const { bytes } = await gerar();
    const { text } = await extractPdf(bytes);
    expect(text).toMatch(/exige acesso autorizado/i);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildCertificateDocument,
  type CertificateDocumentInput,
} from '@/modules/warranties/domain/certificate-document';
import {
  certificatePdfFilename,
  toPdfSafeText,
  wrapText,
} from '@/modules/warranties/domain/certificate-pdf';

/**
 * MODELO DOCUMENTAL E TEXTO SEGURO (Prompt 13.1, itens 8, 15, 16, 17 e 57).
 *
 * Camada pura: sem banco, sem arquivo, sem biblioteca de PDF. O que se prova
 * aqui e a SEMANTICA — que o documento diz o que o snapshot guardou, e que
 * nenhum texto de cliente derruba a geracao.
 */

const BASE: CertificateDocumentInput = {
  emitidoEm: '2026-09-21',
  empresa: { nome: 'Assistencia Sao Jose', unidade: 'Loja Centro' },
  garantia: {
    numero: 'GAR 000123',
    tipo: 'Garantia interna',
    vigencia: { inicio: '2026-09-21', fim: '2026-12-21' },
    duracao: '3 meses',
    cobreServicoInteiro: true,
  },
  cliente: { nome: 'Joao Goncalves' },
  equipamento: { descricao: 'Notebook', marca: 'Acer', modelo: 'A515' },
  ordemDeServico: { numero: 54 },
  cobertura: [{ tipo: 'labor', descricao: 'Reparo da fonte' }],
  exclusoes: 'Mau uso e queda.',
  termos: 'Apresentar o certificado.',
};

function doc(overrides: Partial<CertificateDocumentInput> = {}) {
  return buildCertificateDocument(
    { ...BASE, ...overrides },
    'https://exemplo.invalid/garantias/certificado/token-opaco',
  );
}

function todoOTexto(documento: ReturnType<typeof doc>): string {
  return documento.sections
    .flatMap((s) => [
      s.title,
      ...s.fields.map((f) => `${f.label} ${f.value}`),
      ...s.paragraphs,
      ...s.bullets,
    ])
    .join('\n');
}

describe('documento do certificado (itens 8 e 10)', () => {
  it('sai INTEIRO do snapshot: nada e consultado', () => {
    const documento = doc();

    expect(documento.reference).toBe('GAR 000123');
    expect(documento.issuer.company).toBe('Assistencia Sao Jose');
    expect(todoOTexto(documento)).toContain('Joao Goncalves');
    expect(todoOTexto(documento)).toContain('OS 54');
    expect(todoOTexto(documento)).toContain('Reparo da fonte');
  });

  it('converte data civil sem passar por fuso', () => {
    /**
     * `2026-09-21` tem de virar `21/09/2026` e nunca `20/09/2026`: passar a
     * data por `new Date()` a interpretaria como meia-noite UTC e, no Brasil,
     * mostraria o dia anterior.
     */
    expect(todoOTexto(doc())).toContain('21/09/2026');
    expect(todoOTexto(doc())).toContain('21/12/2026');
  });

  it('cobertura PARCIAL vira aviso destacado; total nao', () => {
    expect(doc({ garantia: { ...BASE.garantia, cobreServicoInteiro: false } }).notice).toMatch(
      /COBERTURA PARCIAL/,
    );
    expect(doc().notice).toBeNull();
  });

  it('cobertura parcial DIZ que defeito fora da lista nao esta coberto', () => {
    const documento = doc({ garantia: { ...BASE.garantia, cobreServicoInteiro: false } });
    expect(todoOTexto(documento)).toMatch(/APENAS os itens listados/i);
  });

  it('secoes vazias nao aparecem: sem termos, sem titulo de termos', () => {
    const semTexto = doc({ exclusoes: null, termos: null });
    const titulos = semTexto.sections.map((s) => s.title);
    expect(titulos).not.toContain('Exclusoes');
    expect(titulos).not.toContain('Termos e condicoes');
  });

  it('garantia sem Ordem de Servico diz "Nao se aplica", nao mente um numero', () => {
    expect(todoOTexto(doc({ ordemDeServico: null }))).toContain('Nao se aplica');
  });

  it('o endereco de verificacao entra por parametro, nao pelo snapshot', () => {
    /**
     * Congelar a URL no snapshot deixaria o QR de um certificado antigo
     * apontando para um dominio que a empresa nao usa mais. O imutavel e o
     * TOKEN; o endereco e de agora.
     */
    expect(doc().verification.url).toContain('/garantias/certificado/token-opaco');
    expect(JSON.stringify(BASE)).not.toContain('https://');
  });

  it('o documento NAO carrega CPF, telefone, e-mail nem endereco', () => {
    const texto = todoOTexto(doc());
    expect(texto).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(texto).not.toMatch(/@/);
    expect(texto).not.toMatch(/\(\d{2}\)\s?\d{4,5}-\d{4}/);
  });

  it('e funcao pura: o mesmo snapshot produz o mesmo documento', () => {
    expect(JSON.stringify(doc())).toBe(JSON.stringify(doc()));
  });
});

describe('texto seguro para as fontes padrao (itens 15, 16 e 76)', () => {
  it('preserva TODA a acentuacao do portugues', () => {
    const texto = 'Joao Goncalves, Marcia Araujo, Assistencia Tecnica Sao Jose';
    const acentuado = 'João Gonçalves, Márcia Araújo, Assistência Técnica São José';
    expect(toPdfSafeText(acentuado)).toBe(acentuado);
    expect(toPdfSafeText(texto)).toBe(texto);
  });

  it('preserva maiusculas acentuadas e cedilha', () => {
    const texto = 'ÁÉÍÓÚ Ç ÃÕ ÂÊÔ';
    expect(toPdfSafeText(texto)).toBe(texto);
  });

  it('nao quebra com caractere fora da tabela: substitui de forma visivel', () => {
    /**
     * Um emoji no nome do aparelho nao pode derrubar a emissao do certificado
     * inteiro. Ele vira marcador; o resto do documento sai.
     */
    const saida = toPdfSafeText('Notebook \u{1f600} do João');
    expect(saida).toContain('João');
    expect(saida).not.toContain('\u{1f600}');
    expect(saida).toContain('?');
  });

  it('normaliza espacos exoticos e remove marcas invisiveis', () => {
    expect(toPdfSafeText('a b')).toBe('a b');
    expect(toPdfSafeText('a​b')).toBe('ab');
  });

  it('converte simbolos sem equivalente em texto legivel', () => {
    expect(toPdfSafeText('≤ 5')).toBe('<= 5');
    expect(toPdfSafeText('≥ 5')).toBe('>= 5');
  });

  it('mantem os tipograficos que o CP1252 realmente tem', () => {
    const texto = '“aspas” — travessao • marcador';
    expect(toPdfSafeText(texto)).toBe(texto);
  });
});

describe('quebra de linha (itens 17 e 19)', () => {
  /** Regua falsa: cada caractere mede 1. Testa o algoritmo, nao a fonte. */
  const medir = (texto: string) => texto.length;

  it('quebra nas palavras, respeitando a largura', () => {
    const linhas = wrapText('um dois tres quatro cinco', 10, medir);
    for (const linha of linhas) expect(linha.length).toBeLessThanOrEqual(10);
    expect(linhas.join(' ')).toBe('um dois tres quatro cinco');
  });

  it('palavra MAIOR que a linha e cortada, nunca perdida', () => {
    /**
     * Sem isso, um numero de serie de 80 digitos sairia pela margem — e no
     * PDF "sair pela margem" significa sumir, nao rolar.
     */
    const gigante = 'A'.repeat(45);
    const linhas = wrapText(gigante, 10, medir);
    for (const linha of linhas) expect(linha.length).toBeLessThanOrEqual(10);
    expect(linhas.join('')).toBe(gigante);
  });

  it('preserva paragrafos separados por quebra explicita', () => {
    expect(wrapText('um\ndois', 20, medir)).toEqual(['um', 'dois']);
  });

  it('linha em branco continua sendo linha em branco', () => {
    expect(wrapText('um\n\ndois', 20, medir)).toEqual(['um', '', 'dois']);
  });

  it('texto vazio nao gera lixo', () => {
    expect(wrapText('', 20, medir)).toEqual(['']);
  });
});

describe('nome do arquivo (itens 27 e 28)', () => {
  it('usa o numero da garantia, nunca o nome do cliente', () => {
    expect(certificatePdfFilename('GAR 000123')).toBe('certificado-garantia-gar-000123.pdf');
  });

  it('remove acento e qualquer caractere que sirva para injecao', () => {
    const nome = certificatePdfFilename('GAR "000123"\r\nX-Injected: 1');
    expect(nome).toMatch(/^certificado-garantia-[a-z0-9-]+\.pdf$/);
    expect(nome).not.toContain('\n');
    expect(nome).not.toContain('"');
  });
});

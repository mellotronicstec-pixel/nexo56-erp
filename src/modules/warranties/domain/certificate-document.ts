import { COVERAGE_KIND_LABEL, type CoverageKind } from '@/modules/warranties/domain/warranty';

/**
 * MODELO DOCUMENTAL DO CERTIFICADO (Prompt 13.1, itens 8, 9 e 10).
 *
 * ESTA CAMADA NAO CONHECE PDF. Nenhum import de biblioteca de renderizacao
 * entra aqui, e isso e verificado por teste de fronteira. O que existe e a
 * SEMANTICA do documento: quais secoes ele tem, em que ordem, com que rotulos
 * e que texto. Quem transforma isso em bytes e a infraestrutura.
 *
 * POR QUE UMA CAMADA NO MEIO. Hoje o certificado tem duas representacoes: a
 * pagina HTML (Prompt 13) e o PDF (este complemento). Amanha o Portal e a
 * Comunicacao vao querer a terceira e a quarta. Sem um modelo comum, a regra
 * "o que aparece no certificado" seria reescrita em cada uma — e a quarta
 * copia divergiria da primeira sem ninguem perceber.
 *
 * O SNAPSHOT E A AUTORIDADE (item 9). `buildCertificateDocument` recebe o
 * snapshot congelado na emissao e NADA MAIS: nao consulta politica, nao le
 * cliente vivo, nao recalcula cobertura e nao toca no banco. Sua assinatura
 * torna isso verificavel — ela nao tem como consultar nada.
 */

export interface CertificateDocumentField {
  label: string;
  value: string;
}

export interface CertificateDocumentSection {
  /** Titulo da secao. Vazio quando a secao e apenas um bloco de campos. */
  title: string;
  fields: CertificateDocumentField[];
  /** Paragrafos livres — termos, exclusoes, resumo de cobertura. */
  paragraphs: string[];
  /** Itens de lista — a cobertura declarada item a item. */
  bullets: string[];
}

export interface CertificateDocument {
  /** Titulo impresso no alto da primeira pagina. */
  title: string;
  /** Numero humano da garantia, `GAR 000123`. */
  reference: string;
  /** Nome da empresa e da unidade que concedeu a garantia. */
  issuer: { company: string; unit: string };
  sections: CertificateDocumentSection[];
  /** Texto curto ao lado do QR, explicando o que ele e. */
  verification: { caption: string; url: string };
  footer: string;
  /** Aviso destacado quando a cobertura e parcial. Nulo quando e total. */
  notice: string | null;
}

/** Igual ao usado nas telas: data civil nunca passa por `new Date()`. */
function civil(value: string | null | undefined): string {
  if (!value) return '—';
  const [ano, mes, dia] = value.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : value;
}

function coverageKindLabel(kind: string): string {
  return COVERAGE_KIND_LABEL[kind as CoverageKind] ?? kind;
}

/**
 * O snapshot, exatamente como o Prompt 13 o gravou.
 *
 * Declarado aqui como forma estrutural — e nao importado do servico — para
 * que o dominio continue sem dependencia da camada de aplicacao. Os dois
 * formatos sao mantidos iguais por teste.
 */
export interface CertificateDocumentInput {
  emitidoEm: string;
  empresa: { nome: string; unidade: string };
  garantia: {
    numero: string;
    tipo: string;
    vigencia: { inicio: string; fim: string };
    duracao: string;
    cobreServicoInteiro: boolean;
  };
  cliente: { nome: string };
  equipamento: { descricao: string; marca: string | null; modelo: string | null };
  ordemDeServico: { numero: number } | null;
  cobertura: Array<{ tipo: string; descricao: string }>;
  exclusoes: string | null;
  termos: string | null;
}

/**
 * Snapshot -> documento. Funcao PURA: mesmo snapshot, mesmo documento.
 *
 * `verificationUrl` entra por parametro porque o endereco da aplicacao nao e
 * um dado do snapshot: o mesmo certificado historico continua valido se a
 * empresa mudar de dominio, e congelar a URL antiga no snapshot deixaria o QR
 * apontando para um lugar que nao existe mais.
 */
export function buildCertificateDocument(
  snapshot: CertificateDocumentInput,
  verificationUrl: string,
): CertificateDocument {
  const parcial = !snapshot.garantia.cobreServicoInteiro;

  const identificacao: CertificateDocumentSection = {
    title: 'Identificacao',
    fields: [
      { label: 'Cliente', value: snapshot.cliente.nome || '—' },
      { label: 'Aparelho', value: snapshot.equipamento.descricao || '—' },
      {
        label: 'Marca e modelo',
        value:
          [snapshot.equipamento.marca, snapshot.equipamento.modelo].filter(Boolean).join(' ') ||
          '—',
      },
      {
        label: 'Ordem de Servico',
        value: snapshot.ordemDeServico ? `OS ${snapshot.ordemDeServico.numero}` : 'Nao se aplica',
      },
    ],
    paragraphs: [],
    bullets: [],
  };

  const garantia: CertificateDocumentSection = {
    title: 'Garantia',
    fields: [
      { label: 'Tipo', value: snapshot.garantia.tipo },
      { label: 'Prazo concedido', value: snapshot.garantia.duracao },
      { label: 'Inicio da vigencia', value: civil(snapshot.garantia.vigencia.inicio) },
      { label: 'Ultimo dia coberto', value: civil(snapshot.garantia.vigencia.fim) },
    ],
    paragraphs: [
      /**
       * O documento diz que o ultimo dia conta inteiro. E a pergunta que o
       * cliente faz no balcao no dia do vencimento, e responde-la no papel
       * evita a discussao inteira.
       */
      'O ultimo dia de vigencia esta coberto por completo.',
    ],
    bullets: [],
  };

  const cobertura: CertificateDocumentSection = {
    title: 'Cobertura',
    fields: [],
    paragraphs: [
      parcial
        ? 'Esta garantia cobre APENAS os itens listados abaixo. Defeito fora desta lista nao esta coberto, mesmo dentro do prazo.'
        : 'Esta garantia cobre o servico realizado como um todo, exceto o que constar em Exclusoes.',
    ],
    bullets: snapshot.cobertura.map((item) => `${coverageKindLabel(item.tipo)}: ${item.descricao}`),
  };

  const sections: CertificateDocumentSection[] = [identificacao, garantia, cobertura];

  if (snapshot.exclusoes && snapshot.exclusoes.trim()) {
    sections.push({
      title: 'Exclusoes',
      fields: [],
      paragraphs: splitParagraphs(snapshot.exclusoes),
      bullets: [],
    });
  }

  if (snapshot.termos && snapshot.termos.trim()) {
    sections.push({
      title: 'Termos e condicoes',
      fields: [],
      paragraphs: splitParagraphs(snapshot.termos),
      bullets: [],
    });
  }

  sections.push({
    title: 'Emissao',
    fields: [
      { label: 'Emitido em', value: civil(snapshot.emitidoEm) },
      { label: 'Emitido por', value: snapshot.empresa.nome || '—' },
      { label: 'Unidade', value: snapshot.empresa.unidade || '—' },
    ],
    paragraphs: [],
    bullets: [],
  });

  return {
    title: 'Certificado de Garantia',
    reference: snapshot.garantia.numero,
    issuer: { company: snapshot.empresa.nome, unit: snapshot.empresa.unidade },
    sections,
    verification: {
      caption:
        'Leia o codigo para conferir este certificado. A consulta exige acesso autorizado ao sistema.',
      url: verificationUrl,
    },
    footer: 'Documento emitido pelo Nexo56 ERP a partir dos termos registrados na emissao.',
    notice: parcial ? 'COBERTURA PARCIAL — leia a secao Cobertura' : null,
  };
}

/** Paragrafos separados por linha em branco; linhas simples continuam juntas. */
function splitParagraphs(texto: string): string[] {
  return texto
    .split(/\n\s*\n/)
    .map((bloco) => bloco.replace(/\s*\n\s*/g, ' ').trim())
    .filter((bloco) => bloco.length > 0);
}

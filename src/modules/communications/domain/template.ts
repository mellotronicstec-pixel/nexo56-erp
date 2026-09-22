import {
  BODY_MAX,
  type CommunicationChannel,
  channelUsesSubject,
  type MessagePurpose,
  SUBJECT_MAX,
  TEMPLATE_NAME_MAX,
} from './communication';

/**
 * TEMPLATE É TEXTO COM LACUNAS, NÃO É PROGRAMA (itens 23, 24 e 25).
 *
 * A tentação aqui é óbvia e é um erro: deixar o usuário escrever expressão
 * dentro do template ("{{ os.numero > 100 ? ... }}") resolve o caso de hoje e
 * cria um interpretador dentro do ERP. Interpretador tem bug, tem loop
 * infinito, tem acesso a escopo, e roda com os privilégios do servidor.
 *
 * Por isso, aqui:
 *
 *   NÃO existe `eval`. NÃO existe `new Function`. NÃO existe execução
 *   arbitrária. NÃO existe condicional, laço, filtro nem chamada de método.
 *
 * O que existe é um CATÁLOGO FECHADO de variáveis. Se a chave não está no
 * catálogo, ela não é substituída — ela é RECUSADA. O template não salva e a
 * mensagem não sai.
 *
 * A REGRA QUE JUSTIFICA A RECUSA (item 24): falhar em silêncio significa
 * mandar literalmente "Olá {{cliente.nome}}, seu aparelho está pronto" para
 * uma pessoa real, no WhatsApp dela, com o nome da loja em cima. Uma
 * substituição vazia ("Olá , seu aparelho...") é igualmente indefensável.
 * Entre recusar antes e constranger depois, este módulo recusa antes.
 */

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

/**
 * ESCOPO DA VARIÁVEL.
 *
 * `always`: a mensagem sempre tem cliente, empresa e unidade — o destinatário
 * nasce de um contato do cliente, e a operação acontece dentro de uma unidade.
 *
 * `service_order`: só existe quando a mensagem foi criada a partir de uma OS.
 * Um template que usa `os.numero` não pode ser aplicado a uma mensagem avulsa,
 * e essa checagem acontece ANTES de qualquer envio.
 */
export const VARIABLE_SCOPES = ['always', 'service_order'] as const;
export type VariableScope = (typeof VARIABLE_SCOPES)[number];

export interface TemplateVariable {
  key: string;
  scope: VariableScope;
  label: string;
  /** O que a pessoa vê ao escolher a variável na tela de templates. */
  description: string;
  /** Valor de exemplo — usado só na pré-visualização, nunca no envio real. */
  example: string;
}

/**
 * O CATÁLOGO INTEIRO. Nada fora daqui é substituído.
 *
 * Cada entrada corresponde a um dado que JÁ EXISTE no banco hoje: nome do
 * cliente, nome do tenant, nome da unidade, número/estado/aparelho da OS.
 * Não há variável especulativa esperando um módulo futuro — uma lacuna que
 * nunca preenche é uma mensagem quebrada esperando acontecer.
 */
export const TEMPLATE_VARIABLES = [
  {
    key: 'cliente.nome',
    scope: 'always',
    label: 'Nome do cliente',
    description: 'Nome completo como está no cadastro.',
    example: 'Maria Aparecida de Souza',
  },
  {
    key: 'cliente.primeiro_nome',
    scope: 'always',
    label: 'Primeiro nome do cliente',
    description: 'Apenas a primeira palavra do nome, para um tratamento mais direto.',
    example: 'Maria',
  },
  {
    key: 'empresa.nome',
    scope: 'always',
    label: 'Nome da empresa',
    description: 'Razão pela qual o cliente sabe quem está falando com ele.',
    example: 'Assistência Central',
  },
  {
    key: 'unidade.nome',
    scope: 'always',
    label: 'Nome da unidade',
    description: 'A loja que está atendendo. Útil quando a empresa tem mais de um endereço.',
    example: 'Loja Centro',
  },
  {
    key: 'os.numero',
    scope: 'service_order',
    label: 'Número da ordem de serviço',
    description: 'Número humano já formatado, com prefixo e zeros à esquerda.',
    example: 'OS 000123',
  },
  {
    key: 'os.status',
    scope: 'service_order',
    label: 'Situação da ordem',
    description: 'A situação atual, escrita como aparece na tela.',
    example: 'Aguardando retirada',
  },
  {
    key: 'os.equipamento',
    scope: 'service_order',
    label: 'Aparelho',
    description: 'Tipo, marca e modelo do aparelho, quando informados.',
    example: 'Notebook Dell Inspiron 15',
  },
] as const satisfies readonly TemplateVariable[];

/**
 * O TIPO SAI DO CATÁLOGO, não o contrário.
 *
 * Assim, acrescentar variável é editar UMA lista, e esquecer de tratá-la em
 * algum lugar vira erro de compilação em vez de lacuna em branco no WhatsApp
 * de um cliente.
 */
export type TemplateVariableKey = (typeof TEMPLATE_VARIABLES)[number]['key'];

const VARIABLE_BY_KEY = new Map<string, TemplateVariable>(
  TEMPLATE_VARIABLES.map((variavel) => [variavel.key, variavel]),
);

export function findTemplateVariable(key: string): TemplateVariable | undefined {
  return VARIABLE_BY_KEY.get(key);
}

export function isTemplateVariableKey(value: string): value is TemplateVariableKey {
  return VARIABLE_BY_KEY.has(value);
}

export function variablesForScopes(scopes: readonly VariableScope[]): TemplateVariable[] {
  return TEMPLATE_VARIABLES.filter((variavel) => scopes.includes(variavel.scope));
}

/** Valores que a camada de aplicação resolve e entrega prontos ao renderizador. */
export type TemplateValues = Partial<Record<TemplateVariableKey, string | null>>;

// ---------------------------------------------------------------------------
// Leitura do texto
// ---------------------------------------------------------------------------

/**
 * A SINTAXE É UMA SÓ: `{{ chave }}`.
 *
 * Aceita espaço em volta porque quem digita coloca espaço. Não aceita mais
 * nada: sem ponto de exclamação, sem `#`, sem `/`, sem pipe. Qualquer `{{` que
 * não case exatamente com isto é considerado MALFORMADO e recusado — é
 * justamente a digitação errada que produziria chave literal na mensagem.
 */
const PLACEHOLDER = /\{\{\s*([a-z0-9_.]+)\s*\}\}/g;
const ANY_OPENING = /\{\{/g;

export interface TemplateInspection {
  /** Variáveis do catálogo efetivamente usadas, sem repetição, na ordem de uso. */
  used: TemplateVariableKey[];
  /** Chaves bem escritas mas que não existem no catálogo. */
  unknown: string[];
  /** Quantidade de `{{` que não formam uma lacuna válida. */
  malformed: number;
}

export function inspectTemplateText(text: string): TemplateInspection {
  const used: TemplateVariableKey[] = [];
  const unknown: string[] = [];
  let validos = 0;

  for (const encontrado of text.matchAll(PLACEHOLDER)) {
    const chave = encontrado[1];
    if (!chave) continue;
    validos += 1;
    if (isTemplateVariableKey(chave)) {
      if (!used.includes(chave)) used.push(chave);
    } else if (!unknown.includes(chave)) {
      unknown.push(chave);
    }
  }

  const aberturas = text.match(ANY_OPENING)?.length ?? 0;

  return { used, unknown, malformed: Math.max(0, aberturas - validos) };
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/**
 * Valida o TEXTO contra o catálogo e contra os escopos disponíveis.
 *
 * Roda em dois momentos diferentes e por dois motivos diferentes:
 *
 *   1. Ao salvar o template — com todos os escopos, porque um template de OS
 *      é legítimo mesmo que agora não haja OS nenhuma na tela.
 *   2. Ao aplicar o template a uma mensagem — só com os escopos que aquela
 *      mensagem realmente tem. É aqui que "template de OS em mensagem avulsa"
 *      é barrado, e a mensagem de erro diz exatamente qual variável sobrou.
 */
export function assertTemplateText(text: string, scopes: readonly VariableScope[]): void {
  const analise = inspectTemplateText(text);

  if (analise.malformed > 0) {
    throw new TemplateError(
      'Há uma lacuna escrita de forma incorreta no texto. Use exatamente {{ chave }}, com a chave da lista de variáveis.',
    );
  }

  if (analise.unknown.length > 0) {
    const lista = analise.unknown.map((chave) => `{{${chave}}}`).join(', ');
    throw new TemplateError(
      `Estas lacunas não existem na lista de variáveis: ${lista}. Corrija ou remova antes de continuar.`,
    );
  }

  const foraDeEscopo = analise.used.filter((chave) => {
    const variavel = findTemplateVariable(chave);
    return variavel !== undefined && !scopes.includes(variavel.scope);
  });

  if (foraDeEscopo.length > 0) {
    const lista = foraDeEscopo.map((chave) => `{{${chave}}}`).join(', ');
    throw new TemplateError(
      `Este texto usa dados da ordem de serviço (${lista}), e esta mensagem não está ligada a nenhuma ordem.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------

/**
 * Substitui as lacunas — uma única passada, sem reexpansão.
 *
 * SUBSTITUIÇÃO ÚNICA É DECISÃO DE SEGURANÇA, não detalhe de implementação. Se
 * o valor de `cliente.nome` fosse reexaminado, um cliente cadastrado como
 * "{{empresa.nome}}" faria o próprio cadastro injetar conteúdo na mensagem —
 * e uma substituição que se alimenta da anterior é, no limite, laço infinito.
 * O que sai de um valor é texto final, sempre.
 *
 * O corpo é TEXTO PURO. Não há escape de HTML aqui porque não há HTML aqui; se
 * um dia existir canal que exija marcação, o escape é responsabilidade do
 * adaptador daquele canal, que conhece o formato — nunca deste renderizador,
 * que não conhece.
 *
 * VALOR AUSENTE É RECUSA, não string vazia (item 24). "Olá , seu aparelho
 * está pronto" é uma mensagem que envergonha a loja na frente do cliente.
 */
export function renderTemplate(
  text: string,
  values: TemplateValues,
  scopes: readonly VariableScope[],
): string {
  assertTemplateText(text, scopes);

  const ausentes: TemplateVariableKey[] = [];

  const resultado = text.replace(PLACEHOLDER, (inteiro: string, chave: string) => {
    if (!isTemplateVariableKey(chave)) return inteiro;
    const valor = values[chave];
    if (valor === undefined || valor === null || valor.trim() === '') {
      if (!ausentes.includes(chave)) ausentes.push(chave);
      return '';
    }
    return valor;
  });

  if (ausentes.length > 0) {
    const lista = ausentes.map((chave) => findTemplateVariable(chave)?.label ?? chave).join(', ');
    throw new TemplateError(
      `Não foi possível preencher: ${lista}. A mensagem não foi enviada para não chegar incompleta ao cliente.`,
    );
  }

  return resultado;
}

/**
 * Pré-visualização com os valores de exemplo do catálogo.
 *
 * Serve à tela de templates e a nada mais. O texto que sai daqui NUNCA vai
 * para um canal: os valores são fictícios, e quem chama sabe disso porque
 * precisou chamar uma função com "preview" no nome.
 */
export function previewTemplate(text: string): string {
  const exemplos: TemplateValues = {};
  for (const variavel of TEMPLATE_VARIABLES) {
    exemplos[variavel.key] = variavel.example;
  }

  return renderTemplate(text, exemplos, [...VARIABLE_SCOPES]);
}

/** Primeiro nome, derivado do nome completo. Sem cadastro paralelo. */
export function firstName(fullName: string): string {
  const primeiro = fullName.trim().split(/\s+/)[0];
  return primeiro ?? fullName.trim();
}

// ---------------------------------------------------------------------------
// O template como entidade
// ---------------------------------------------------------------------------

export interface TemplateDraft {
  name: string;
  channel: CommunicationChannel;
  purpose: MessagePurpose;
  subject: string | null;
  body: string;
}

/**
 * Valida o rascunho inteiro antes de gravar.
 *
 * O assunto é validado CONTRA O CANAL: e-mail tem assunto, WhatsApp e SMS não.
 * Guardar assunto num template de WhatsApp criaria um campo que existe no
 * banco, aparece na tela e nunca chega ao cliente — a pior categoria de campo.
 */
export function assertTemplateDraft(draft: TemplateDraft): TemplateDraft {
  const nome = draft.name.trim();
  if (!nome) throw new TemplateError('Dê um nome ao modelo.');
  if (nome.length > TEMPLATE_NAME_MAX) {
    throw new TemplateError(`O nome do modelo deve ter no máximo ${TEMPLATE_NAME_MAX} caracteres.`);
  }

  const corpo = draft.body.trim();
  if (!corpo) throw new TemplateError('Escreva o texto do modelo.');
  if (corpo.length > BODY_MAX) {
    throw new TemplateError(`O texto deve ter no máximo ${BODY_MAX} caracteres.`);
  }

  const escopos = [...VARIABLE_SCOPES];
  assertTemplateText(corpo, escopos);

  let assunto: string | null = null;
  if (channelUsesSubject(draft.channel)) {
    const bruto = draft.subject?.trim() ?? '';
    if (!bruto) throw new TemplateError('Modelos de e-mail precisam de assunto.');
    if (bruto.length > SUBJECT_MAX) {
      throw new TemplateError(`O assunto deve ter no máximo ${SUBJECT_MAX} caracteres.`);
    }
    assertTemplateText(bruto, escopos);
    assunto = bruto;
  } else if (draft.subject && draft.subject.trim() !== '') {
    throw new TemplateError('Este canal não envia assunto. Deixe o campo em branco.');
  }

  return {
    name: nome,
    channel: draft.channel,
    purpose: draft.purpose,
    subject: assunto,
    body: corpo,
  };
}

/**
 * AI TASK CATALOG — FECHADO (Prompt 20, itens 6 a 8).
 *
 * Estas cinco chaves sao TODA a superficie de acao do Nexo56 AI na V1. Nao
 * existe execucao de uma task que nao esteja aqui — `findAiTask` devolve
 * `undefined` para qualquer outra coisa, e a camada de aplicacao trata isso
 * como `AI_TASK_NOT_ALLOWED`, nunca como uma chamada generica ao provedor.
 *
 * Nao ha prompt livre, nao ha chat, nao ha task parametrizavel pelo cliente
 * (item 7).
 */

export const AI_TASK_KEYS = [
  'CORRIGIR_PORTUGUES',
  'DEIXAR_MAIS_PROFISSIONAL',
  'RESUMIR',
  'DEIXAR_MAIS_CLARO_PARA_CLIENTE',
  'GERAR_PARECER_TECNICO',
] as const;
export type AiTaskKey = (typeof AI_TASK_KEYS)[number];

/**
 * Como a task pode se relacionar com "ancoras tecnicas" (numeros, unidades,
 * codigos, modelos — ver `technical-anchors.ts`).
 *
 *   `preserve_anchors`          — toda ancora do texto ORIGINAL precisa
 *                                  reaparecer, identica, no resultado.
 *   `preserve_anchors_allow_omission` — ancora pode SUMIR (resumo cortou um
 *                                  detalhe secundario), mas nenhuma ancora
 *                                  nova pode aparecer e nenhuma existente
 *                                  pode ser trocada por outra.
 *   `no_new_technical_facts`    — nao ha "texto original" para comparar (a
 *                                  task gera a partir de CONTEXTO, nao
 *                                  reescreve um texto): toda ancora do
 *                                  resultado precisa ja existir no contexto
 *                                  fornecido.
 */
export const TECHNICAL_MEANING_POLICIES = [
  'preserve_anchors',
  'preserve_anchors_allow_omission',
  'no_new_technical_facts',
] as const;
export type TechnicalMeaningPolicy = (typeof TECHNICAL_MEANING_POLICIES)[number];

export interface AiTaskDefinition {
  key: AiTaskKey;
  /** Rotulo oficial em pt-BR (item 6), exibido literalmente na UI. */
  label: string;
  description: string;
  /**
   * Versao do prompt interno usado por esta task (item 47). Muda quando o
   * texto de instrucao muda — nunca em silencio junto de outra alteracao.
   */
  promptVersion: string;
  outputLanguage: 'pt-BR';
  /**
   * `false` somente para `GERAR_PARECER_TECNICO`: as outras quatro exigem um
   * texto de entrada (item 132) — sem ele, a acao nem chama o provedor.
   */
  requiresInputText: boolean;
  /**
   * `true` somente para `GERAR_PARECER_TECNICO`: e a unica task que monta
   * contexto estruturado a partir da entidade, em vez de reescrever um texto
   * solto (item 8, "se aceita contexto estruturado").
   */
  acceptsStructuredContext: boolean;
  /** `true` somente para `RESUMIR` (item 12: "pode omitir detalhe secundario"). */
  canOmitInformation: boolean;
  /**
   * Nenhuma das cinco pode inventar FATO novo (numero, codigo, peca,
   * conclusao) — mesmo `GERAR_PARECER_TECNICO`, que produz PROSA nova mas
   * nao FATO novo (itens 14, 61 e 62). Documentado explicitamente, sempre
   * `false`, para que o catalogo nunca vire local de acao livre.
   */
  canGenerateNewFacts: false;
  technicalPolicy: TechnicalMeaningPolicy;
  maxInputChars: number;
  maxOutputChars: number;
}

const COMMON_MAX_INPUT = 4000;
const COMMON_MAX_OUTPUT = 4000;

export const AI_TASK_CATALOG: readonly AiTaskDefinition[] = [
  {
    key: 'CORRIGIR_PORTUGUES',
    label: 'Corrigir português',
    description:
      'Corrige ortografia, concordância, pontuação e acentuação. Não muda o que o texto diz.',
    promptVersion: '2026-09-25.1',
    outputLanguage: 'pt-BR',
    requiresInputText: true,
    acceptsStructuredContext: false,
    canOmitInformation: false,
    canGenerateNewFacts: false,
    technicalPolicy: 'preserve_anchors',
    maxInputChars: COMMON_MAX_INPUT,
    maxOutputChars: COMMON_MAX_OUTPUT,
  },
  {
    key: 'DEIXAR_MAIS_PROFISSIONAL',
    label: 'Deixar mais profissional',
    description:
      'Melhora tom, organização e clareza. Preserva os fatos técnicos e a incerteza original.',
    promptVersion: '2026-09-25.1',
    outputLanguage: 'pt-BR',
    requiresInputText: true,
    acceptsStructuredContext: false,
    canOmitInformation: false,
    canGenerateNewFacts: false,
    technicalPolicy: 'preserve_anchors',
    maxInputChars: COMMON_MAX_INPUT,
    maxOutputChars: COMMON_MAX_OUTPUT,
  },
  {
    key: 'RESUMIR',
    label: 'Resumir',
    description:
      'Reduz o texto. Pode omitir detalhe secundário, nunca cria fato, valor ou conclusão novos.',
    promptVersion: '2026-09-25.1',
    outputLanguage: 'pt-BR',
    requiresInputText: true,
    acceptsStructuredContext: false,
    canOmitInformation: true,
    canGenerateNewFacts: false,
    technicalPolicy: 'preserve_anchors_allow_omission',
    maxInputChars: COMMON_MAX_INPUT,
    maxOutputChars: COMMON_MAX_OUTPUT,
  },
  {
    key: 'DEIXAR_MAIS_CLARO_PARA_CLIENTE',
    label: 'Deixar mais claro para o cliente',
    description:
      'Converte linguagem técnica em linguagem compreensível. Não fabrica diagnóstico, prazo, preço ou garantia.',
    promptVersion: '2026-09-25.1',
    outputLanguage: 'pt-BR',
    requiresInputText: true,
    acceptsStructuredContext: false,
    canOmitInformation: false,
    canGenerateNewFacts: false,
    technicalPolicy: 'preserve_anchors',
    maxInputChars: COMMON_MAX_INPUT,
    maxOutputChars: COMMON_MAX_OUTPUT,
  },
  {
    key: 'GERAR_PARECER_TECNICO',
    label: 'Gerar parecer técnico',
    description:
      'Monta um rascunho de parecer somente a partir de dados reais já registrados e autorizados da entidade.',
    promptVersion: '2026-09-25.1',
    outputLanguage: 'pt-BR',
    requiresInputText: false,
    acceptsStructuredContext: true,
    canOmitInformation: false,
    canGenerateNewFacts: false,
    technicalPolicy: 'no_new_technical_facts',
    maxInputChars: COMMON_MAX_INPUT,
    maxOutputChars: COMMON_MAX_OUTPUT,
  },
];

const BY_KEY = new Map<string, AiTaskDefinition>(AI_TASK_CATALOG.map((task) => [task.key, task]));

export function findAiTask(key: string): AiTaskDefinition | undefined {
  return BY_KEY.get(key);
}

/**
 * SEMANTIC CLAIM GUARD (Prompt 20 — correcao final do Technical Meaning
 * Guard).
 *
 * `technical-anchors.ts` protege numero/unidade/codigo/modelo/data — mas
 * uma frase pode mudar de sentido inteiro SEM nenhum digito: "possivel
 * falha" virar "falha confirmada" nao mexe em ancora nenhuma, e ainda
 * assim e exatamente o tipo de mudanca de fato que o Prompt 20 proibe
 * (item 4: "melhorar o texto nao significa mudar o fato").
 *
 * MESMO PRINCIPIO DA ANCORA TECNICA, aplicado a CLASSES DE AFIRMACAO em vez
 * de digito: em vez de "todo trecho com um digito", aqui e "toda familia de
 * palavra que declara um FATO NOVO perigoso" — certeza, acao de reparo,
 * promessa de prazo, garantia, teste/medicao ja realizado. Uma familia so
 * pode aparecer na SAIDA se ela ja aparecia na ORIGEM (texto original, ou o
 * contexto estruturado de `GERAR_PARECER_TECNICO`) — exatamente a mesma
 * regra de "nenhuma ancora nova", so que para afirmacao em vez de numero.
 *
 * NAO E NLP GRANDE (mesma linha do item 56 da guarda de ancoras): listas
 * FECHADAS e PEQUENAS de palavras/expressoes pt-BR reais, normalizadas
 * (minusculo, sem acento) e comparadas por presenca de familia — nunca um
 * classificador, nunca um segundo provedor, nunca embedding. E uma guarda
 * DEFENSIVA contra classes de risco conhecidas, nao um verificador
 * semantico universal do portugues: ela pode deixar passar uma reformulacao
 * genuinamente equivalente que use vocabulario fora das listas, e pode, em
 * teoria, recusar uma frase legitima que colida com uma familia por
 * coincidencia lexical — por isso ela e a SEGUNDA camada, nunca a unica, e
 * falhar aqui sempre rejeita e preserva o original (nunca tenta reescrever
 * a saida do provedor).
 *
 * A REGRA E SEMPRE DE UMA MAO SO (diferente da ancora, que tem duas): uma
 * familia protegida so pode aparecer na saida se ja existia na origem.
 * Nao existe "familia obrigatoria de aparecer" aqui — RESUMIR, por
 * exemplo, pode legitimamente omitir uma garantia mencionada na origem sem
 * disparar a guarda; o que ela nunca pode e INVENTAR uma que nao existia.
 */

export type SemanticClaimFamily =
  'certainty' | 'action_repair' | 'promise' | 'warranty' | 'performed_test_claim';

interface ClaimFamilyDefinition {
  family: SemanticClaimFamily;
  pattern: RegExp;
}

/** Minusculo + sem acento (NFD, remove marcas de combinacao) — mesma normalizacao em origem e saida. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * ESCALADA DE CERTEZA: a origem pode dizer "possivel"/"suspeita"/"em
 * analise" (essas palavras nao precisam constar em nenhuma lista — sao
 * so o estado atual, nunca proibidas). O que a saida NUNCA pode introduzir
 * sozinha e uma palavra desta familia de CERTEZA/CONCLUSAO FECHADA.
 */
const CERTAINTY_FAMILY: ClaimFamilyDefinition = {
  family: 'certainty',
  pattern:
    /\b(confirmad[oa]s?|confirmou|confirmaram|confirma\b|constatad[oa]s?|constatou|constataram|identificad[oa]s?|identificou|identificaram|diagnosticad[oa]s?|diagnosticou|diagnosticaram|comprovad[oa]s?|comprovou|comprovaram|definitivamente|certamente)\b/,
};

/**
 * ESCALADA DE ACAO TECNICA: a origem pode recomendar so verificar/analisar
 * (verbo de INSPECAO, nunca listado aqui — nao e o que se protege). O que
 * a saida nunca pode introduzir sozinha e uma acao de REPARO EFETIVO.
 */
const ACTION_REPAIR_FAMILY: ClaimFamilyDefinition = {
  family: 'action_repair',
  pattern:
    /\b(substitu(?:ir|a|iu|ido|ida|ir[aá]|icao)|troc(?:ar|ou|a|ado|ada|ar[aá])|repar(?:ar|ou|o|ado|ada|ar[aá])|remov(?:er|eu|ido|ida|er[aá])|instal(?:ar|ou|ado|ada|ar[aá]))\b/,
};

/**
 * PROMESSA/PRAZO: previsao/estimativa na origem (tambem nao listadas — sao
 * o estado permitido) nunca pode virar COMPROMISSO FIRME na saida.
 */
const PROMISE_FAMILY: ClaimFamilyDefinition = {
  family: 'promise',
  pattern:
    /\b(ficar[aá] pronto[s]?|estar[aá] pronto[s]?|estar[aá] conclu[ií]do[s]?|ser[aá] entregue[s]?|ser[aã]o entregues|garantido para|prometemos|promessa|conclu[ií]do at[eé]|finalizado at[eé]|entregue at[eé])\b/,
};

/** GARANTIA: so pode aparecer na saida se a palavra ja existia na origem. */
const WARRANTY_FAMILY: ClaimFamilyDefinition = {
  family: 'warranty',
  pattern: /\bgarantia[s]?\b|\bgarantid[oa]s?\b/,
};

/**
 * TESTE/MEDICAO/VERIFICACAO JA REALIZADA: a saida nao pode afirmar como
 * FATO CONSUMADO que um teste/medicao/inspecao aconteceu, a menos que a
 * origem ja afirme isso.
 */
const PERFORMED_TEST_CLAIM_FAMILY: ClaimFamilyDefinition = {
  family: 'performed_test_claim',
  pattern:
    /\b(foi testad[oa]|foram testad[oa]s|foi medid[oa]|foram medid[oa]s|foi verificad[oa]|foram verificad[oa]s|foi constatad[oa]|foram constatad[oa]s|foi inspecionad[oa]|foram inspecionad[oa]s|foi identificad[oa]|foram identificad[oa]s|teste confirmou|testes confirmaram|medi[cç][aã]o mostrou|medi[cç][oõ]es mostraram|testes realizados|teste realizado|ap[oó]s os testes)\b/,
};

const PROTECTED_FAMILIES: readonly ClaimFamilyDefinition[] = [
  CERTAINTY_FAMILY,
  ACTION_REPAIR_FAMILY,
  PROMISE_FAMILY,
  WARRANTY_FAMILY,
  PERFORMED_TEST_CLAIM_FAMILY,
];

function extractFamilies(text: string): Set<SemanticClaimFamily> {
  const normalized = normalize(text);
  const present = new Set<SemanticClaimFamily>();
  for (const { family, pattern } of PROTECTED_FAMILIES) {
    if (pattern.test(normalized)) present.add(family);
  }
  return present;
}

export interface SemanticClaimCheckResult {
  ok: boolean;
  /** Familias que a saida introduziu sem base na origem — risco de fato inventado. */
  introducedFamilies: readonly SemanticClaimFamily[];
}

/**
 * Compara as familias de afirmacao de `sourceText` (texto original, ou o
 * contexto estruturado formatado no caso de `GERAR_PARECER_TECNICO`)
 * contra `outputText`. Igual em TODAS as tasks (item 10 do pedido de
 * correcao): nenhuma das cinco tem licenca para elevar certeza, inventar
 * acao de reparo, promessa, garantia ou teste realizado que a origem nao
 * sustente — RESUMIR pode omitir, nunca inventar.
 */
export function checkSemanticClaims(
  sourceText: string,
  outputText: string,
): SemanticClaimCheckResult {
  const sourceFamilies = extractFamilies(sourceText);
  const outputFamilies = extractFamilies(outputText);
  const introducedFamilies = [...outputFamilies].filter((family) => !sourceFamilies.has(family));
  return { ok: introducedFamilies.length === 0, introducedFamilies };
}

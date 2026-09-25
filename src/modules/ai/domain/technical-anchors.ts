import type { TechnicalMeaningPolicy } from './task-catalog';

/**
 * PROTECAO DETERMINISTICA DE SIGNIFICADO TECNICO (Prompt 20, itens 56 a 62
 * e 105 a 107, 166 a 169, 179).
 *
 * NAO E NLP GRANDE (item 56, explicito): um regex que encontra "ancoras" —
 * qualquer trecho com pelo menos um digito, com prefixo/sufixo de letras
 * opcional — e compara o CONJUNTO de ancoras antes/depois. Isso cobre
 * tensao (`220V`), corrente (`3,5A`), codigo de erro (`E01`), modelo
 * (`X123`), data (`05/09/2026`), sem precisar entender o texto.
 *
 * NORMALIZACAO (item 58): `220V` e `220 V` viram a mesma chave normalizada
 * (`220v`) — diferenca de apresentacao nao e mudanca de fato. `220V` e
 * `127V` viram chaves DIFERENTES (`220v` / `127v`) — mudanca de fato.
 *
 * A REGRA E SEMPRE DE DUAS MAOS:
 *
 *   1. Nenhuma ancora no RESULTADO pode ser nova (nao existir na origem) —
 *      vale para TODAS as tasks, sempre: nenhuma delas pode inventar
 *      numero/codigo (itens 61, 62, 105).
 *   2. Para `preserve_anchors`: toda ancora da ORIGEM precisa sobreviver no
 *      resultado — a task nao tem licenca para omitir dado tecnico.
 *      `preserve_anchors_allow_omission` e `no_new_technical_facts`
 *      dispensam esta segunda checagem: RESUMIR pode legitimamente cortar
 *      um detalhe secundario (item 12), e GERAR_PARECER_TECNICO nao precisa
 *      citar every campo do contexto.
 */

export interface TechnicalAnchor {
  raw: string;
  normalized: string;
}

/**
 * Lista fechada de unidades/siglas tecnicas reais que aparecem coladas OU
 * separadas por um espaco de um numero ("220V", "220 V", "3,5 A"). Nao e
 * uma lista de todas as unidades do mundo — e o bastante para as que
 * aparecem em laudo/OS/orcamento no dominio do Nexo56 (item 56: nao e NLP
 * grande, e uma lista pratica e fechada).
 */
const UNIT_ABBREVIATIONS =
  'kHz|MHz|GHz|Hz|kg|mg|g|mm|cm|km|ml|kW|mW|mA|rpm|psi|dB|MB|GB|KB|TB|min|seg|ms|Ω|ohm|V|A|W|l|h|%|°C';

const UNIT_SPACING_PATTERN = new RegExp(`(\\d)\\s(${UNIT_ABBREVIATIONS})\\b`, 'gu');

/**
 * Cola numero+unidade quando separados por UM espaco ("220 V" -> "220V"),
 * ANTES da extracao de ancoras. Sem isso, o padrao principal precisaria
 * aceitar um sufixo com espaco opcional — e ai qualquer palavra curta
 * comum do portugues ("nao", "liga", "foi") logo depois de um numero
 * tambem seria lida como se fosse unidade, so por ter poucas letras e uma
 * fronteira de palavra logo depois (toda palavra tem fronteira no fim).
 * Com o colapso previo, o padrao principal NAO aceita mais espaco nenhum
 * no sufixo: so cola letra que ja estava GRUDADA no numero, entao "X123
 * nao" nunca vira "x123nao" — "nao" fica de fora, sem digito, nao e ancora.
 */
function collapseUnitSpacing(text: string): string {
  return text.replace(UNIT_SPACING_PATTERN, '$1$2');
}

/**
 * Prefixo/sufixo de letra opcional (unidade, sigla, modelo) GRUDADO em um
 * trecho com pelo menos um digito, aceitando separador decimal/data (`.`,
 * `,`, `/`, `-`). Sem espaco nenhum entre numero e sufixo — quem precisa de
 * espaco (unidade real) ja foi colado por `collapseUnitSpacing` antes.
 *
 * O SUFIXO EXIGE FRONTEIRA DE PALAVRA (`\b`) logo depois de no maximo 4
 * letras: sem isso, um codigo seguido de mais letras grudadas correria o
 * risco de engolir alem do que devia. Com a fronteira, uma palavra de mais
 * de 4 letras nunca casa em nenhum corte de 1 a 4, entao o sufixo
 * simplesmente nao participa.
 *
 * `.`/`,`/`/`/`-` SO CONTINUAM O NUMERO SE O PROXIMO CARACTERE FOR DIGITO
 * (lookahead): sem essa exigencia, "E07, mais texto" virava
 * "e07,maistexto" — a virgula de pontuacao comum sendo lida como separador
 * decimal. "3,5" e "05/09/2026" continuam corretos porque, nesses casos,
 * SEMPRE ha digito logo depois do separador.
 */
const ANCHOR_PATTERN = /[A-Za-zÀ-ÿ]*\d(?:\d|[.,](?=\d)|[/-](?=\d))*[A-Za-zÀ-ÿ%]{0,4}\b/gu;

function normalizeAnchor(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '').replace(/[.,]$/g, '');
}

export function extractTechnicalAnchors(text: string): TechnicalAnchor[] {
  const collapsed = collapseUnitSpacing(text);
  const matches = collapsed.match(ANCHOR_PATTERN) ?? [];
  return matches
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => ({ raw, normalized: normalizeAnchor(raw) }));
}

export interface TechnicalAnchorCheckResult {
  ok: boolean;
  /** Ancoras da origem que sumiram do resultado (so reportado quando a policy exige preservacao total). */
  droppedAnchors: readonly string[];
  /** Ancoras do resultado que nao existiam na origem — risco em QUALQUER policy. */
  newAnchors: readonly string[];
}

/**
 * Compara as ancoras de `sourceText` (o texto original, ou o contexto
 * estruturado no caso de `GERAR_PARECER_TECNICO`) contra `outputText` (a
 * sugestao do provedor), segundo a `policy` declarada na task.
 */
export function checkTechnicalAnchors(
  sourceText: string,
  outputText: string,
  policy: TechnicalMeaningPolicy,
): TechnicalAnchorCheckResult {
  const sourceSet = new Set(extractTechnicalAnchors(sourceText).map((a) => a.normalized));
  const outputSet = new Set(extractTechnicalAnchors(outputText).map((a) => a.normalized));

  const newAnchors = [...outputSet].filter((anchor) => !sourceSet.has(anchor));
  const droppedAnchors =
    policy === 'preserve_anchors' ? [...sourceSet].filter((anchor) => !outputSet.has(anchor)) : [];

  return { ok: newAnchors.length === 0 && droppedAnchors.length === 0, droppedAnchors, newAnchors };
}

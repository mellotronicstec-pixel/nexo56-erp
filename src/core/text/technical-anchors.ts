/**
 * EXTRACAO DE ANCORAS TECNICAS — primitive de texto pura e generica.
 *
 * Nasceu no Nexo56 AI (Prompt 20, itens 56 a 62) para proteger o Technical
 * Anchor Guard contra troca silenciosa de numero/unidade/codigo/modelo/data.
 * Subiu para o core quando a Busca de Pecas (Prompt 21) precisou da MESMA
 * operacao para preservar codigo tecnico na normalizacao de consulta — mesmo
 * raciocinio de `normalize.ts`, acima: a alternativa seria Part Search
 * importar de `modules/ai` (uma dependencia de codigo que nao existe no
 * negocio — busca de peca nao e IA) ou duplicar a regex, e duas copias da
 * mesma regex divergem cedo ou tarde sobre o que conta como "ancora".
 *
 * NAO E NLP GRANDE: um regex que encontra "ancoras" — qualquer trecho com
 * pelo menos um digito, com prefixo/sufixo de letras opcional — e devolve o
 * bruto e a forma normalizada de cada uma. Isso cobre tensao (`220V`),
 * corrente (`3,5A`), codigo de erro (`E01`), modelo (`X123`), data
 * (`05/09/2026`), sem precisar entender o texto.
 *
 * NORMALIZACAO: `220V` e `220 V` viram a mesma chave normalizada (`220v`) —
 * diferenca de apresentacao nao e mudanca de fato. `220V` e `127V` viram
 * chaves DIFERENTES (`220v` / `127v`) — mudanca de fato.
 *
 * Esta funcao SO EXTRAI. Comparar um conjunto de ancoras contra outro (a
 * regra de "nenhuma ancora nova"/"nenhuma ancora perdida") e uma POLITICA de
 * quem consome — cada modulo decide a sua: o Nexo56 AI compara origem vs.
 * saida do provedor segundo a `TechnicalMeaningPolicy` da task
 * (`modules/ai/domain/technical-anchors.ts`, `checkTechnicalAnchors`); a
 * Busca de Pecas compara a ancora do termo digitado contra a do part number
 * do candidate (`modules/part-search/application/internal-sources.ts` e
 * `external-sources.ts`). Nenhuma dessas politicas e generica o bastante
 * para morar aqui.
 */

export interface TechnicalAnchor {
  raw: string;
  normalized: string;
}

/**
 * Lista fechada de unidades/siglas tecnicas reais que aparecem coladas OU
 * separadas por um espaco de um numero ("220V", "220 V", "3,5 A"). Nao e
 * uma lista de todas as unidades do mundo — e o bastante para as que
 * aparecem em laudo/OS/orcamento/peca no dominio do Nexo56.
 */
const UNIT_ABBREVIATIONS =
  'kHz|MHz|GHz|Hz|kg|mg|g|mm|cm|km|ml|kW|mW|mA|rpm|psi|dB|MB|GB|KB|TB|min|seg|ms|Ω|ohm|V|A|W|l|h|%|°C';

const UNIT_SPACING_PATTERN = new RegExp(`(\\d)\\s(${UNIT_ABBREVIATIONS})\\b`, 'gu');

/**
 * Cola numero+unidade quando separados por UM espaco ("220 V" -> "220V"),
 * ANTES da extracao de ancoras. Sem isso, o padrao principal precisaria
 * aceitar um sufixo com espaco opcional — e ai qualquer palavra curta comum
 * do portugues ("nao", "liga", "foi") logo depois de um numero tambem seria
 * lida como se fosse unidade, so por ter poucas letras e uma fronteira de
 * palavra logo depois (toda palavra tem fronteira no fim). Com o colapso
 * previo, o padrao principal NAO aceita mais espaco nenhum no sufixo: so
 * cola letra que ja estava GRUDADA no numero, entao "X123 nao" nunca vira
 * "x123nao" — "nao" fica de fora, sem digito, nao e ancora.
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

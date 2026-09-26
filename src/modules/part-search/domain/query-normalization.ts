import { extractTechnicalAnchors } from '@/core/text/technical-anchors';
import { normalizeSearchable } from '@/core/text/normalize';

/**
 * NORMALIZACAO DA CONSULTA (Prompt 21, itens 29, 30, 105, 170, 171).
 *
 * REUTILIZA a mesma extracao de "ancoras" tecnicas do core (primitive
 * compartilhada, `@/core/text/technical-anchors` — a mesma que o Nexo56 AI
 * usa no seu Technical Anchor Guard, ADR-085/086) em vez de reimplementar —
 * `extractTechnicalAnchors` ja resolve exatamente o problema do item 30
 * (`ABC-123` nunca pode virar `ABC-132`): qualquer trecho com digito, com
 * sufixo de unidade/letra colado, tratado como bloco atomico. Part Search
 * NAO importa nada de `modules/ai` — a primitive mora no core, usada pelos
 * dois de forma simetrica.
 *
 * DUAS SAIDAS, DOIS PROPOSITOS DIFERENTES:
 *
 *  - `displayTerm`  : o termo como o usuario digitou, so com espacos e
 *                      Unicode normalizados (NFC) — o que vai para o
 *                      provedor externo e para a tela. NUNCA muda
 *                      maiuscula/minuscula nem remove acento (item 170:
 *                      preservacao de Unicode).
 *  - `searchKey`    : chave DE BUSCA interna (minuscula, sem acento) via o
 *                      mesmo `normalizeSearchable` que Estoque/Equipamento
 *                      ja usam — so para comparar contra `nameSearch`/
 *                      `brandSearch` no banco, nunca exibida.
 *  - `anchors`      : ancoras tecnicas extraidas do termo (part
 *                      number/codigo/modelo) — usadas para a evidencia
 *                      `exact_part_number` quando um candidate compartilha a
 *                      mesma ancora normalizada.
 */
export interface NormalizedPartSearchQuery {
  displayTerm: string;
  searchKey: string;
  anchors: readonly string[];
}

const MAX_QUERY_LENGTH = 200;

export function normalizeSearchQuery(raw: string): NormalizedPartSearchQuery {
  const trimmed = raw.normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
  const anchors = extractTechnicalAnchors(trimmed).map((a) => a.normalized);
  return {
    displayTerm: trimmed,
    searchKey: normalizeSearchable(trimmed),
    anchors,
  };
}

export { MAX_QUERY_LENGTH };

import { extractTechnicalAnchors } from '@/core/text/technical-anchors';
import type { TechnicalMeaningPolicy } from './task-catalog';

/**
 * TECHNICAL ANCHOR GUARD — politica de comparacao ESPECIFICA do Nexo56 AI
 * (Prompt 20, itens 56 a 62 e 105 a 107, 166 a 169, 179).
 *
 * A EXTRACAO de ancoras (o que conta como numero/unidade/codigo/modelo/data)
 * e uma primitive de texto generica e mora em
 * `@/core/text/technical-anchors` — reutilizada por qualquer modulo que
 * precise da mesma protecao (a Busca de Pecas, Prompt 21, tambem a usa).
 *
 * O que fica AQUI, e so aqui, e a REGRA DE COMPARACAO do AI Gateway: dado um
 * texto de ORIGEM e uma SAIDA de provedor, decidir se a saida e aceitavel
 * segundo a `TechnicalMeaningPolicy` da task — isto e AI-specific, nao uma
 * primitive generica, porque a policy (`preserve_anchors`,
 * `preserve_anchors_allow_omission`, `no_new_technical_facts`) so faz
 * sentido no vocabulario de tasks de escrita assistida do Nexo56 AI.
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

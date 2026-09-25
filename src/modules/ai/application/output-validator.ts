import { checkTechnicalAnchors } from '../domain/technical-anchors';
import { checkSemanticClaims } from '../domain/semantic-claims';
import type { AiTaskDefinition } from '../domain/task-catalog';

/**
 * VALIDACAO DO RESULTADO (Prompt 20, itens 53, 54, 55, 59, 60, 61, 76 e 170
 * a 172).
 *
 * O resultado do provedor NUNCA vira rascunho direto. Passa por aqui
 * primeiro. Falhar aqui nunca tenta "consertar" o texto com regex e devolver
 * mesmo assim (item 60) — rejeita e o texto original do usuario continua
 * intacto.
 *
 * TECHNICAL MEANING GUARD = Technical Anchor Guard (numero/unidade/codigo/
 * modelo/data, `technical-anchors.ts`) + Semantic Claim Guard (certeza/
 * acao de reparo/promessa/garantia/teste realizado, `semantic-claims.ts`).
 * As duas camadas rodam sempre juntas, aqui: a ancora cobre o que MUDA sem
 * precisar entender o texto (digito trocado); a afirmacao semantica cobre
 * o que muda de sentido SEM nenhum digito envolvido ("possivel" virar
 * "confirmado"). Qualquer uma das duas reprovando e suficiente para
 * `technical_meaning_risk`.
 */

export type OutputRejectionReason =
  'invalid_output' | 'technical_meaning_risk' | 'insufficient_context';

export type OutputValidationResult =
  { ok: true; text: string } | { ok: false; reason: OutputRejectionReason };

const INSUFFICIENT_CONTEXT_SENTINEL = 'CONTEXTO_INSUFICIENTE';

/** Remove caracteres de controle indevidos, preservando quebra de linha e tab (item 170). */
function sanitizeControlChars(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

const HTML_LIKE_PATTERN = /<\/?[a-z][\s\S]*>/i;

/** Contagem Unicode-safe (item 172): conta CODE POINTS, nunca unidades UTF-16 cruas. */
export function unicodeSafeLength(text: string): number {
  return Array.from(text).length;
}

export function validateAiOutput(params: {
  rawText: string;
  task: AiTaskDefinition;
  surfaceMaxLength: number;
  sourceTextForAnchors: string;
}): OutputValidationResult {
  const { task, surfaceMaxLength, sourceTextForAnchors } = params;

  if (typeof params.rawText !== 'string') return { ok: false, reason: 'invalid_output' };

  const sanitized = sanitizeControlChars(params.rawText).trim();
  if (sanitized.length === 0) return { ok: false, reason: 'invalid_output' };

  if (task.key === 'GERAR_PARECER_TECNICO' && sanitized === INSUFFICIENT_CONTEXT_SENTINEL) {
    return { ok: false, reason: 'insufficient_context' };
  }

  // Campo e sempre plain_text no catalogo de superficies (item 54/55).
  if (HTML_LIKE_PATTERN.test(sanitized)) return { ok: false, reason: 'invalid_output' };

  const maxAllowed = Math.min(task.maxOutputChars, surfaceMaxLength);
  if (unicodeSafeLength(sanitized) > maxAllowed) return { ok: false, reason: 'invalid_output' };

  const anchors = checkTechnicalAnchors(sourceTextForAnchors, sanitized, task.technicalPolicy);
  if (!anchors.ok) return { ok: false, reason: 'technical_meaning_risk' };

  const claims = checkSemanticClaims(sourceTextForAnchors, sanitized);
  if (!claims.ok) return { ok: false, reason: 'technical_meaning_risk' };

  return { ok: true, text: sanitized };
}

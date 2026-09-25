import { describe, expect, it } from 'vitest';
import { unicodeSafeLength, validateAiOutput } from '@/modules/ai/application/output-validator';
import { findAiTask } from '@/modules/ai/domain/task-catalog';

const corrigirPortugues = findAiTask('CORRIGIR_PORTUGUES')!;
const gerarParecer = findAiTask('GERAR_PARECER_TECNICO')!;

/** Item 53: nada do provedor vira rascunho sem passar por aqui primeiro. */
describe('validateAiOutput', () => {
  it('aceita texto valido dentro do limite, sem risco tecnico', () => {
    const result = validateAiOutput({
      rawText: 'Texto corrigido.',
      task: corrigirPortugues,
      surfaceMaxLength: 2000,
      sourceTextForAnchors: 'Texto corigido.',
    });
    expect(result).toEqual({ ok: true, text: 'Texto corrigido.' });
  });

  it('rejeita texto vazio ou so espaco (item 60/133)', () => {
    expect(
      validateAiOutput({
        rawText: '   ',
        task: corrigirPortugues,
        surfaceMaxLength: 2000,
        sourceTextForAnchors: 'algo',
      }),
    ).toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('rejeita HTML (item 54: campo e sempre plain_text)', () => {
    const result = validateAiOutput({
      rawText: '<b>Texto</b> corrigido.',
      task: corrigirPortugues,
      surfaceMaxLength: 2000,
      sourceTextForAnchors: 'Texto corigido.',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('rejeita saida maior que o limite (item 76: nunca truncar, sempre rejeitar)', () => {
    const result = validateAiOutput({
      rawText: 'a'.repeat(50),
      task: corrigirPortugues,
      surfaceMaxLength: 10,
      sourceTextForAnchors: 'a'.repeat(50),
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('respeita o MENOR entre limite da task e limite da superficie', () => {
    const withinTaskButNotSurface = validateAiOutput({
      rawText: 'a'.repeat(20),
      task: corrigirPortugues, // maxOutputChars = 4000
      surfaceMaxLength: 15,
      sourceTextForAnchors: 'a'.repeat(20),
    });
    expect(withinTaskButNotSurface).toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('contagem e Unicode-safe (item 172): nao corta surrogate pair ao contar', () => {
    const emoji = '🙂'; // 1 code point, 2 UTF-16 code units
    expect(unicodeSafeLength(emoji)).toBe(1);
  });

  it('reconhece o sentinela de contexto insuficiente SOMENTE em GERAR_PARECER_TECNICO', () => {
    const result = validateAiOutput({
      rawText: 'CONTEXTO_INSUFICIENTE',
      task: gerarParecer,
      surfaceMaxLength: 2000,
      sourceTextForAnchors: 'Equipamento: Televisor',
    });
    expect(result).toEqual({ ok: false, reason: 'insufficient_context' });
  });

  it('sentinela literal em OUTRA task e tratado como texto comum (nunca insufficient_context por engano)', () => {
    const result = validateAiOutput({
      rawText: 'CONTEXTO_INSUFICIENTE',
      task: corrigirPortugues,
      surfaceMaxLength: 2000,
      sourceTextForAnchors: 'contexto insuficiente',
    });
    expect(result.ok).toBe(true);
  });

  it('rejeita risco tecnico (ancora trocada) como technical_meaning_risk, preservando o texto original em outro lugar (item 59)', () => {
    const result = validateAiOutput({
      rawText: 'Equipamento opera em 127V.',
      task: corrigirPortugues,
      surfaceMaxLength: 2000,
      sourceTextForAnchors: 'Equipamento opera em 220V.',
    });
    expect(result).toEqual({ ok: false, reason: 'technical_meaning_risk' });
  });

  it('remove caracteres de controle indevidos sem rejeitar o texto (item 170)', () => {
    const result = validateAiOutput({
      rawText: 'Texto\u0007 limpo.',
      task: corrigirPortugues,
      surfaceMaxLength: 2000,
      sourceTextForAnchors: 'Texto limpo.',
    });
    expect(result).toEqual({ ok: true, text: 'Texto limpo.' });
  });
});

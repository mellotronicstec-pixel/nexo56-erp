import { describe, expect, it } from 'vitest';
import { AI_TASK_CATALOG, AI_TASK_KEYS, findAiTask } from '@/modules/ai/domain/task-catalog';
import {
  AI_SURFACE_CATALOG,
  AI_SURFACE_KEYS,
  findAiSurface,
  isTaskAllowedOnSurface,
} from '@/modules/ai/domain/surface-catalog';

/**
 * CATALOGOS FECHADOS (Prompt 20, itens 6 a 8 e 31/32).
 *
 * Estes testes nao sao sobre comportamento de IA — sao sobre a FORMA do
 * catalogo em si: exatamente cinco tasks, exatamente as duas superficies
 * reais, nenhuma delas aceitando conteudo/valor arbitrario.
 */

describe('AI Task Catalog', () => {
  it('tem exatamente as cinco tasks oficiais, nenhuma a mais', () => {
    expect(AI_TASK_KEYS).toEqual([
      'CORRIGIR_PORTUGUES',
      'DEIXAR_MAIS_PROFISSIONAL',
      'RESUMIR',
      'DEIXAR_MAIS_CLARO_PARA_CLIENTE',
      'GERAR_PARECER_TECNICO',
    ]);
    expect(AI_TASK_CATALOG).toHaveLength(5);
  });

  it('nenhuma task pode gerar fato novo', () => {
    for (const task of AI_TASK_CATALOG) {
      expect(task.canGenerateNewFacts).toBe(false);
    }
  });

  it('toda task declara idioma de saida pt-BR', () => {
    for (const task of AI_TASK_CATALOG) {
      expect(task.outputLanguage).toBe('pt-BR');
    }
  });

  it('so GERAR_PARECER_TECNICO aceita rodar sem texto de entrada e com contexto estruturado', () => {
    for (const task of AI_TASK_CATALOG) {
      if (task.key === 'GERAR_PARECER_TECNICO') {
        expect(task.requiresInputText).toBe(false);
        expect(task.acceptsStructuredContext).toBe(true);
      } else {
        expect(task.requiresInputText).toBe(true);
        expect(task.acceptsStructuredContext).toBe(false);
      }
    }
  });

  it('so RESUMIR pode omitir informacao', () => {
    for (const task of AI_TASK_CATALOG) {
      expect(task.canOmitInformation).toBe(task.key === 'RESUMIR');
    }
  });

  it('key desconhecida devolve undefined (nunca uma task generica)', () => {
    expect(findAiTask('TASK_QUE_NAO_EXISTE')).toBeUndefined();
    expect(findAiTask('')).toBeUndefined();
  });
});

describe('AI Surface Catalog', () => {
  it('tem exatamente as duas superficies reais (item 5)', () => {
    expect(AI_SURFACE_KEYS).toEqual(['service_order.internal_notes', 'quote.customer_notes']);
    expect(AI_SURFACE_CATALOG).toHaveLength(2);
  });

  it('key desconhecida devolve undefined (item 32 — allowlist fechada)', () => {
    expect(findAiSurface('service_order.customer_report')).toBeUndefined();
    expect(findAiSurface('quote.internal_notes')).toBeUndefined();
    expect(findAiSurface('')).toBeUndefined();
  });

  it('GERAR_PARECER_TECNICO so aparece na superficie tecnica da OS, nunca na do cliente (item 131)', () => {
    const os = findAiSurface('service_order.internal_notes')!;
    const quote = findAiSurface('quote.customer_notes')!;
    expect(isTaskAllowedOnSurface(os, 'GERAR_PARECER_TECNICO')).toBe(true);
    expect(isTaskAllowedOnSurface(quote, 'GERAR_PARECER_TECNICO')).toBe(false);
  });

  it('DEIXAR_MAIS_CLARO_PARA_CLIENTE so aparece na superficie voltada ao cliente (item 65)', () => {
    const os = findAiSurface('service_order.internal_notes')!;
    const quote = findAiSurface('quote.customer_notes')!;
    expect(isTaskAllowedOnSurface(os, 'DEIXAR_MAIS_CLARO_PARA_CLIENTE')).toBe(false);
    expect(isTaskAllowedOnSurface(quote, 'DEIXAR_MAIS_CLARO_PARA_CLIENTE')).toBe(true);
  });

  it('toda superficie declara permissao de dominio, feature de dominio e tamanho maximo', () => {
    for (const surface of AI_SURFACE_CATALOG) {
      expect(surface.domainPermission).toBeTruthy();
      expect(surface.domainFeatureKey).toBeTruthy();
      expect(surface.maxLength).toBeGreaterThan(0);
      expect(surface.contentType).toBe('plain_text');
    }
  });
});

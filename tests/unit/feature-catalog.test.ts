import { describe, expect, it } from 'vitest';
import {
  FEATURE_CATALOG,
  FEATURES,
  findDependencyCycle,
  findFeature,
  isCore,
} from '@/modules/features/domain/catalog';
import { PERMISSION_CATALOG } from '@/modules/access-control/domain/permissions';

describe('catalogo de features', () => {
  it('nao possui ciclo de dependencia', () => {
    expect(findDependencyCycle()).toBeNull();
  });

  it('detecta ciclo quando ele existe', () => {
    const cycle = findDependencyCycle([
      { key: 'a', name: 'A', description: '', type: 'OPTIONAL', dependsOn: ['b'] },
      { key: 'b', name: 'B', description: '', type: 'OPTIONAL', dependsOn: ['a'] },
    ] as never);
    expect(cycle).not.toBeNull();
  });

  it('so declara dependencias que existem no catalogo', () => {
    const keys = new Set(FEATURE_CATALOG.map((feature) => feature.key));
    for (const feature of FEATURE_CATALOG) {
      for (const dependency of feature.dependsOn) {
        expect(keys.has(dependency)).toBe(true);
      }
    }
  });

  it('classifica corretamente CORE e opcional', () => {
    expect(isCore('core.auth')).toBe(true);
    expect(isCore('platform.multi_unit')).toBe(false);
  });

  it('toda permissao aponta para uma feature existente', () => {
    const keys = new Set(FEATURE_CATALOG.map((feature) => feature.key));
    for (const permission of PERMISSION_CATALOG) {
      expect(keys.has(permission.featureKey as never)).toBe(true);
    }
  });
});

/**
 * CORRECAO DE MODULARIDADE POS-CI #33 (Prompt 21): `operations.part_search`
 * (a Busca de Pecas) NUNCA pode depender, direta ou transitivamente, de
 * `ai.core` — desligar o Nexo56 AI inteiro nao pode desligar a busca
 * deterministica junto (Prompt 03, item 12: AI nao e dependencia necessaria
 * para o ERP funcionar).
 */
function transitiveDependencies(key: string): Set<string> {
  const seen = new Set<string>();
  const stack = [key];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const dependency of findFeature(current)?.dependsOn ?? []) {
      if (!seen.has(dependency)) {
        seen.add(dependency);
        stack.push(dependency);
      }
    }
  }
  return seen;
}

describe('Busca de Pecas e independente do Nexo56 AI (correcao pos-CI #33)', () => {
  it('operations.part_search nao declara dependsOn algum (YAGNI — nenhum AI enrichment real existe hoje)', () => {
    expect(findFeature(FEATURES.OPERATIONS_PART_SEARCH)?.dependsOn).toEqual([]);
  });

  it('operations.part_search nunca depende, nem transitivamente, de ai.core', () => {
    const deps = transitiveDependencies(FEATURES.OPERATIONS_PART_SEARCH);
    expect(deps.has(FEATURES.AI_CORE)).toBe(false);
  });

  it('a chave antiga ai.part_search nao existe mais no catalogo (renomeada, nao duplicada)', () => {
    expect(findFeature('ai.part_search')).toBeUndefined();
  });

  it('a permissao parts.search aponta para operations.part_search, nunca para uma feature de ai.*', () => {
    const permission = PERMISSION_CATALOG.find((p) => p.key === 'parts.search');
    expect(permission?.featureKey).toBe(FEATURES.OPERATIONS_PART_SEARCH);
  });
});

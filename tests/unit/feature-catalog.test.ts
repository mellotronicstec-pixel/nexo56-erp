import { describe, expect, it } from 'vitest';
import { FEATURE_CATALOG, findDependencyCycle, isCore } from '@/modules/features/domain/catalog';
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

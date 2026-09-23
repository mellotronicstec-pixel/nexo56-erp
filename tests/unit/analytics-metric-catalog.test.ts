import { describe, expect, it } from 'vitest';
import {
  METRIC_CATALOG,
  findMetric,
  metricsForDomain,
} from '@/modules/analytics/domain/metric-catalog';
import { FEATURE_CATALOG } from '@/modules/features/domain/catalog';
import { PERMISSION_CATALOG } from '@/modules/access-control/domain/permissions';

/**
 * TESTES DO METRIC CATALOG (Prompt 18, item 140).
 *
 * "Todo numero exibido precisa ter uma definicao e uma origem demonstraveis."
 * Este teste prova que cada entrada do catalogo e, no minimo, BEM FORMADA:
 * chave unica, requisitos de acesso que realmente existem nos outros dois
 * catalogos, e nenhum campo obrigatorio vazio.
 */

const FEATURE_KEYS = new Set(FEATURE_CATALOG.map((f) => f.key));
const PERMISSION_KEYS = new Set(PERMISSION_CATALOG.map((p) => p.key));

describe('o catalogo existe e tem conteudo', () => {
  it('ha pelo menos uma metrica por dominio coberto no Prompt 18', () => {
    const dominios = new Set(METRIC_CATALOG.map((m) => m.domain));
    expect(dominios).toEqual(
      new Set([
        'service_orders',
        'quotes',
        'finance',
        'inventory',
        'purchasing',
        'warranties',
        'agenda',
        'communications',
      ]),
    );
  });
});

describe('chaves unicas', () => {
  it('nenhuma chave de metrica se repete', () => {
    const chaves = METRIC_CATALOG.map((m) => m.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

describe('toda metrica aponta para requisitos que EXISTEM de verdade', () => {
  for (const metric of METRIC_CATALOG) {
    it(`${metric.key}: featureKey "${metric.requiredFeatureKey}" esta no Feature Catalog`, () => {
      expect(FEATURE_KEYS.has(metric.requiredFeatureKey)).toBe(true);
    });

    it(`${metric.key}: permission "${metric.requiredPermission}" esta no Permission Catalog`, () => {
      expect(PERMISSION_KEYS.has(metric.requiredPermission)).toBe(true);
    });
  }
});

describe('nenhum campo obrigatorio fica vazio', () => {
  for (const metric of METRIC_CATALOG) {
    it(`${metric.key}: label, description, formula e emptyBehavior nao estao vazios`, () => {
      expect(metric.label.trim().length).toBeGreaterThan(0);
      expect(metric.description.trim().length).toBeGreaterThan(0);
      expect(metric.formula.trim().length).toBeGreaterThan(0);
      expect(metric.emptyBehavior.trim().length).toBeGreaterThan(0);
    });
  }
});

describe('nenhuma metrica usa rotulo ambiguo proibido (item 11)', () => {
  const PROIBIDOS = ['faturamento', 'lucro', 'eficiencia', 'produtividade', 'conversao'];

  for (const metric of METRIC_CATALOG) {
    it(`${metric.key}: label nao contem termo generico sem definicao`, () => {
      const normalizado = metric.label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      for (const termo of PROIBIDOS) {
        expect(normalizado).not.toContain(termo);
      }
    });
  }
});

describe('comunicacao nunca promete entrega nem leitura (ADR-078, item 68)', () => {
  for (const metric of metricsForDomain('communications')) {
    it(`${metric.key}: nao menciona "entregue" nem "lido/lida"`, () => {
      const texto = `${metric.label} ${metric.description}`.toLowerCase();
      expect(texto).not.toMatch(/entregue|entrega confirmada|\blido\b|\blida\b|taxa de leitura/);
    });
  }
});

describe('findMetric / metricsForDomain', () => {
  it('encontra uma metrica conhecida pela chave', () => {
    expect(findMetric('os.open_total')?.domain).toBe('service_orders');
  });

  it('devolve undefined para chave desconhecida', () => {
    expect(findMetric('chave.que.nao.existe')).toBeUndefined();
  });

  it('filtra corretamente por dominio', () => {
    const financeiras = metricsForDomain('finance');
    expect(financeiras.length).toBeGreaterThan(0);
    expect(financeiras.every((m) => m.domain === 'finance')).toBe(true);
  });
});

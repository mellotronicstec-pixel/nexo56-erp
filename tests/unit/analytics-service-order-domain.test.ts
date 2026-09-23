import { describe, expect, it } from 'vitest';
import {
  agingBucketFor,
  AGING_BUCKETS,
  bucketBacklogAging,
  computeApprovalRate,
  computeCycleTimeStats,
} from '@/modules/analytics/domain/service-order-analytics';

describe('agingBucketFor / bucketBacklogAging (item 40)', () => {
  it('classifica cada faixa oficial pelo limite exato', () => {
    expect(agingBucketFor(0).key).toBe('0-2');
    expect(agingBucketFor(2).key).toBe('0-2');
    expect(agingBucketFor(3).key).toBe('3-7');
    expect(agingBucketFor(7).key).toBe('3-7');
    expect(agingBucketFor(8).key).toBe('8-15');
    expect(agingBucketFor(15).key).toBe('8-15');
    expect(agingBucketFor(16).key).toBe('16-30');
    expect(agingBucketFor(30).key).toBe('16-30');
    expect(agingBucketFor(31).key).toBe('30+');
    expect(agingBucketFor(400).key).toBe('30+');
  });

  it('idade negativa (relogio) nunca quebra: cai na primeira faixa', () => {
    expect(agingBucketFor(-1).key).toBe('0-2');
  });

  it('faixa sem OS aparece com 0 — nunca some da lista', () => {
    const resultado = bucketBacklogAging([]);
    expect(resultado).toHaveLength(AGING_BUCKETS.length);
    expect(resultado.every((bucket) => bucket.total === 0)).toBe(true);
  });

  it('agrupa uma amostra mista corretamente', () => {
    const resultado = bucketBacklogAging([0, 1, 2, 5, 10, 10, 20, 40, 40, 40]);
    const porChave = new Map(resultado.map((b) => [b.key, b.total]));
    expect(porChave.get('0-2')).toBe(3);
    expect(porChave.get('3-7')).toBe(1);
    expect(porChave.get('8-15')).toBe(2);
    expect(porChave.get('16-30')).toBe(1);
    expect(porChave.get('30+')).toBe(3);
    // Soma total = tamanho da amostra, nenhuma OS perdida.
    expect(resultado.reduce((total, b) => total + b.total, 0)).toBe(10);
  });
});

describe('computeCycleTimeStats (itens 42 a 44)', () => {
  it('amostra vazia devolve null — nunca "0 dias" (item 44)', () => {
    expect(computeCycleTimeStats([])).toBeNull();
  });

  it('mediana com quantidade IMPAR de amostras', () => {
    const resultado = computeCycleTimeStats([1, 3, 2]);
    expect(resultado).toEqual({ sampleSize: 3, medianDays: 2, averageDays: 2 });
  });

  it('mediana com quantidade PAR de amostras: media dos dois centrais', () => {
    const resultado = computeCycleTimeStats([1, 2, 3, 10]);
    expect(resultado?.sampleSize).toBe(4);
    expect(resultado?.medianDays).toBe(2.5); // (2+3)/2
    expect(resultado?.averageDays).toBe(4); // (1+2+3+10)/4
  });

  it('um outlier grande desloca a media muito mais que a mediana (item 43)', () => {
    const resultado = computeCycleTimeStats([1, 1, 1, 1, 100]);
    expect(resultado?.medianDays).toBe(1);
    expect(resultado?.averageDays).toBe(20.8);
  });

  it('amostra de um unico valor', () => {
    expect(computeCycleTimeStats([5])).toEqual({ sampleSize: 1, medianDays: 5, averageDays: 5 });
  });
});

describe('computeApprovalRate (item 48)', () => {
  it('denominador zero devolve null — nunca Infinity/NaN (item 18)', () => {
    expect(computeApprovalRate(0, 0)).toBeNull();
  });

  it('so aprovados: taxa 100%', () => {
    expect(computeApprovalRate(5, 0)).toBe(1);
  });

  it('so rejeitados: taxa 0%', () => {
    expect(computeApprovalRate(0, 5)).toBe(0);
  });

  it('mistura simples', () => {
    expect(computeApprovalRate(3, 1)).toBe(0.75);
  });

  it('pendentes nao entram no calculo: a funcao nem os recebe como parametro', () => {
    // A propria assinatura de `computeApprovalRate(approved, rejected)` torna
    // impossivel incluir pendentes por engano — natureza do teste e de tipo.
    expect(computeApprovalRate(2, 2)).toBe(0.5);
  });
});

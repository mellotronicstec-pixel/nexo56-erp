import { describe, expect, it } from 'vitest';
import { resolveAnalyticsScope, resolvePeriod } from '@/modules/analytics/domain/analytics-scope';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

const TZ = 'America/Sao_Paulo';

function fakeContext(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: 't1',
    tenantSlug: 'loja',
    tenantName: 'Loja',
    tenantTimezone: TZ,
    planId: 'plan',
    userId: 'u1',
    userName: 'Fulano',
    userEmail: 'fulano@exemplo.invalid',
    authorizedUnitIds: ['u-a', 'u-b', 'u-c'],
    activeUnitId: 'u-a',
    tenantRoles: [],
    unitRoles: [],
    tenantPermissions: new Set(),
    unitPermissions: new Map(),
    sessionId: 's1',
    sessionExpiresAt: new Date('2026-12-31T00:00:00.000Z'),
    ...overrides,
  };
}

describe('resolvePeriod', () => {
  const now = new Date('2026-03-17T12:00:00.000Z'); // terca, 17/03/2026

  it('hoje: inicio e fim sao o mesmo dia', () => {
    const period = resolvePeriod(TZ, { key: 'today' }, now);
    expect(period).toEqual({ key: 'today', from: '2026-03-17', to: '2026-03-17', label: 'Hoje' });
  });

  it('7d: 7 dias INCLUSIVOS terminando hoje', () => {
    const period = resolvePeriod(TZ, { key: '7d' }, now);
    expect(period.from).toBe('2026-03-11');
    expect(period.to).toBe('2026-03-17');
  });

  it('30d: 30 dias inclusivos terminando hoje', () => {
    const period = resolvePeriod(TZ, { key: '30d' }, now);
    expect(period.from).toBe('2026-02-16');
    expect(period.to).toBe('2026-03-17');
  });

  it('este mes: do dia 1 ate hoje', () => {
    const period = resolvePeriod(TZ, { key: 'this_month' }, now);
    expect(period).toMatchObject({ from: '2026-03-01', to: '2026-03-17' });
  });

  it('mes anterior: mes civil INTEIRO, nao apenas ate o dia de hoje', () => {
    const period = resolvePeriod(TZ, { key: 'last_month' }, now);
    expect(period).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('mes anterior em janeiro cai no dezembro do ano anterior', () => {
    const period = resolvePeriod(TZ, { key: 'last_month' }, new Date('2026-01-10T12:00:00.000Z'));
    expect(period).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('chave desconhecida na URL cai no padrao seguro (30d), sem quebrar', () => {
    const period = resolvePeriod(TZ, { key: 'um-valor-que-nao-existe' }, now);
    expect(period.key).toBe('30d');
  });

  it('personalizado valido e aceito como esta', () => {
    const period = resolvePeriod(TZ, { key: 'custom', from: '2026-01-01', to: '2026-01-31' }, now);
    expect(period).toMatchObject({ key: 'custom', from: '2026-01-01', to: '2026-01-31' });
  });

  it('personalizado com inicio depois do fim cai no padrao seguro', () => {
    const period = resolvePeriod(TZ, { key: 'custom', from: '2026-02-01', to: '2026-01-01' }, now);
    expect(period.key).toBe('30d');
  });

  it('personalizado com data malformada cai no padrao seguro', () => {
    const period = resolvePeriod(TZ, { key: 'custom', from: '17/03/2026', to: '2026-03-17' }, now);
    expect(period.key).toBe('30d');
  });

  it('personalizado alem do limite maximo e recortado, nao rejeitado (item 16)', () => {
    const period = resolvePeriod(TZ, { key: 'custom', from: '2000-01-01', to: '2026-03-17' }, now);
    expect(period.key).toBe('custom');
    expect(period.to).toBe('2026-03-17');
    // MAX_CUSTOM_RANGE_DAYS=366 dias INCLUSIVOS: from = to - 365 dias corridos.
    expect(period.from).toBe('2025-03-17');
  });
});

describe('resolveAnalyticsScope — escopo de unidade', () => {
  it('sem filtro, "todas as unidades" = todas as AUTORIZADAS (item 22)', () => {
    const context = fakeContext();
    const scope = resolveAnalyticsScope(context, {});
    expect(scope.selectedUnitIds).toEqual(['u-a', 'u-b', 'u-c']);
    expect(scope.allUnitsSelected).toBe(true);
  });

  it('unidade pedida e autorizada: escopo vira exatamente aquela unidade', () => {
    const context = fakeContext();
    const scope = resolveAnalyticsScope(context, { unitIds: ['u-b'] });
    expect(scope.selectedUnitIds).toEqual(['u-b']);
    expect(scope.allUnitsSelected).toBe(false);
  });

  it('unidade nao autorizada na URL nunca aparece no escopo (item 93)', () => {
    const context = fakeContext();
    const scope = resolveAnalyticsScope(context, { unitIds: ['u-de-outro-tenant'] });
    expect(scope.selectedUnitIds).toEqual([]);
  });

  it('mistura de autorizada + nao autorizada: so a autorizada sobrevive', () => {
    const context = fakeContext();
    const scope = resolveAnalyticsScope(context, { unitIds: ['u-b', 'u-de-outro-tenant'] });
    expect(scope.selectedUnitIds).toEqual(['u-b']);
  });

  it('somente unidades nao autorizadas: escopo vazio, NUNCA cai para "todas" (item 123)', () => {
    const context = fakeContext();
    const scope = resolveAnalyticsScope(context, {
      unitIds: ['u-de-outro-tenant', 'u-de-mais-outro'],
    });
    expect(scope.selectedUnitIds).toEqual([]);
    expect(scope.allUnitsSelected).toBe(false);
  });

  it('usuario com 2 de 3 unidades autorizadas: "todas" nunca inclui a terceira (item 146)', () => {
    const context = fakeContext({ authorizedUnitIds: ['u-a', 'u-b'] });
    const scope = resolveAnalyticsScope(context, {});
    expect(scope.selectedUnitIds).toEqual(['u-a', 'u-b']);
    expect(scope.selectedUnitIds).not.toContain('u-c');
  });
});

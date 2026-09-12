import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runWithContext } from '@/core/context/request-context';
import { AUDIT_ACTIONS } from '@/modules/audit/application/audit-service';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import { login } from '@/modules/auth/application/login-service';
import { getRateLimitStore } from '@/core/rate-limit/rate-limiter';
import { clearSubscriptions, subscribe } from '@/modules/events/application/event-bus';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { domainEvents } from '@/modules/events/infrastructure/schema';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { FEATURES } from '@/modules/features/domain/catalog';
import { runInTransaction } from '@/core/db/unit-of-work';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

let tenant: TenantFixture;

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  clearSubscriptions();
  const planId = await seedCatalog();
  tenant = await createTenantFixture('empresa-auditoria', planId);
  await getRateLimitStore().reset(`login:${tenant.email}`);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('auditoria', () => {
  it('acao relevante gera registro', async () => {
    await runWithContext({ origin: 'test' }, () =>
      login({ email: tenant.email, password: tenant.password }),
    );

    const rows = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, AUDIT_ACTIONS.USER_LOGIN_SUCCEEDED));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(tenant.tenantId);
    expect(rows[0]?.userId).toBe(tenant.adminUserId);
    expect(rows[0]?.correlationId).toBeTruthy();
    expect(rows[0]?.origin).toBe('test');
  });

  it('login malsucedido tambem e auditado', async () => {
    await runWithContext({ origin: 'test' }, () =>
      login({ email: tenant.email, password: 'errada' }).catch(() => null),
    );

    const rows = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, AUDIT_ACTIONS.USER_LOGIN_FAILED));

    expect(rows.length).toBeGreaterThan(0);
  });

  it('nenhum segredo aparece no registro de auditoria', async () => {
    await runWithContext({ origin: 'test' }, () =>
      login({ email: tenant.email, password: tenant.password }),
    );

    const rows = await getDb().select().from(auditLogs);
    const serialized = JSON.stringify(rows);

    expect(serialized).not.toContain(tenant.password);
    expect(serialized).not.toContain('scrypt$');
    expect(serialized).not.toContain(tenant.sessionToken);
  });

  it('redige campos sensiveis antes de gravar', async () => {
    await runWithContext({ origin: 'test' }, async () => {
      const { recordAudit } = await import('@/modules/audit/application/audit-service');
      await recordAudit({
        action: AUDIT_ACTIONS.USER_CREATED,
        entityType: 'user',
        tenantId: tenant.tenantId,
        after: { name: 'Teste', password: 'senha-em-claro', token: 'abc' },
      });
    });

    const rows = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, AUDIT_ACTIONS.USER_CREATED));

    const after = rows.find(
      (row) => (row.after as Record<string, unknown> | null)?.name === 'Teste',
    )?.after as Record<string, unknown>;

    expect(after.password).toBe('[REDACTED]');
    expect(after.token).toBe('[REDACTED]');
    expect(after.name).toBe('Teste');
  });

  it('alteracao de modularidade e auditada com estado anterior e posterior', async () => {
    await runWithContext({ origin: 'test' }, () =>
      setTenantFeature(tenant.context, { featureKey: FEATURES.PLATFORM_MULTI_UNIT, enabled: true }),
    );

    const rows = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, AUDIT_ACTIONS.FEATURE_ENABLED));

    expect(rows).toHaveLength(1);
    expect((rows[0]?.before as Record<string, unknown>).enabled).toBe(false);
    expect((rows[0]?.after as Record<string, unknown>).enabled).toBe(true);
  });
});

describe('eventos', () => {
  it('grava o evento e entrega ao handler apos o commit', async () => {
    const received: string[] = [];
    subscribe(EVENT_TYPES.FEATURE_ENABLED, (event) => {
      received.push(event.type);
    });

    await runWithContext({ origin: 'test' }, () =>
      setTenantFeature(tenant.context, { featureKey: FEATURES.PLATFORM_MULTI_UNIT, enabled: true }),
    );

    expect(received).toEqual([EVENT_TYPES.FEATURE_ENABLED]);

    const rows = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, EVENT_TYPES.FEATURE_ENABLED));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.publishedAt).not.toBeNull(); // marcado como despachado
  });

  it('transacao revertida nao gera evento nem chama handler', async () => {
    let handlerCalls = 0;
    subscribe(EVENT_TYPES.UNIT_CREATED, () => {
      handlerCalls += 1;
    });

    // O provisionamento do fixture ja emitiu UNIT_CREATED; medimos a variacao.
    const before = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, EVENT_TYPES.UNIT_CREATED));

    await expect(
      runWithContext({ origin: 'test' }, () =>
        runInTransaction(async (_tx, emit) => {
          await emit({
            type: EVENT_TYPES.UNIT_CREATED,
            tenantId: tenant.tenantId,
            payload: { unitId: 'x' },
          });
          throw new Error('falha proposital apos emitir o evento');
        }),
      ),
    ).rejects.toThrow('falha proposital');

    expect(handlerCalls).toBe(0);

    const after = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, EVENT_TYPES.UNIT_CREATED));

    // Nenhum evento novo sobreviveu ao rollback.
    expect(after).toHaveLength(before.length);
    expect(after.some((row) => (row.payload as { unitId?: string }).unitId === 'x')).toBe(false);
  });

  it('falha de handler nao derruba a operacao ja confirmada', async () => {
    subscribe(EVENT_TYPES.FEATURE_ENABLED, () => {
      throw new Error('handler quebrado');
    });

    await expect(
      runWithContext({ origin: 'test' }, () =>
        setTenantFeature(tenant.context, {
          featureKey: FEATURES.PLATFORM_MULTI_UNIT,
          enabled: true,
        }),
      ),
    ).resolves.toBeUndefined();

    const rows = await getDb()
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.type, EVENT_TYPES.FEATURE_ENABLED));

    // Permanece nao publicado, disponivel para reprocessamento (outbox).
    expect(rows[0]?.publishedAt).toBeNull();
  });
});

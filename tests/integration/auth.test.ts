import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runWithContext } from '@/core/context/request-context';
import { AuthenticationError, RateLimitError, ValidationError } from '@/core/errors';
import { getRateLimitStore } from '@/core/rate-limit/rate-limiter';
import { login } from '@/modules/auth/application/login-service';
import {
  findActiveSession,
  revokeSession,
  pruneExpiredSessions,
  createSession,
} from '@/modules/auth/application/session-service';
import { loadContextForSession } from '@/modules/auth/application/current-context';
import { sessions } from '@/modules/auth/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import { createTenantFixture, seedCatalog, type TenantFixture } from '../helpers/fixtures';

let tenant: TenantFixture;

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenant = await createTenantFixture('empresa-login', planId);
  await getRateLimitStore().reset(`login:${tenant.email}`);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('login', () => {
  it('autentica com credenciais validas e cria sessao', async () => {
    const result = await runWithContext({ origin: 'test' }, () =>
      login({ email: tenant.email, password: tenant.password }),
    );

    expect(result.tenantId).toBe(tenant.tenantId);
    const session = await findActiveSession(result.session.token);
    expect(session?.userId).toBe(tenant.adminUserId);
  });

  it('recusa senha incorreta', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        login({ email: tenant.email, password: 'senha-errada-xyz' }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('recusa e-mail inexistente com a MESMA mensagem da senha errada', async () => {
    const wrongPassword = await runWithContext({ origin: 'test' }, () =>
      login({ email: tenant.email, password: 'errada' }).catch((error: Error) => error.message),
    );
    const unknownEmail = await runWithContext({ origin: 'test' }, () =>
      login({ email: 'ninguem@nao-existe.invalid', password: 'errada' }).catch(
        (error: Error) => error.message,
      ),
    );

    expect(unknownEmail).toBe(wrongPassword);
  });

  it('recusa usuario inativo', async () => {
    await getDb().update(users).set({ status: 'inactive' }).where(eq(users.id, tenant.adminUserId));

    await expect(
      runWithContext({ origin: 'test' }, () =>
        login({ email: tenant.email, password: tenant.password }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('valida entrada malformada antes de consultar o banco', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () => login({ email: 'nao-e-email', password: 'x' })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('aplica rate limit apos tentativas seguidas', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await runWithContext({ origin: 'test' }, () =>
        login({ email: tenant.email, password: 'errada' }).catch(() => null),
      );
    }

    await expect(
      runWithContext({ origin: 'test' }, () =>
        login({ email: tenant.email, password: tenant.password }),
      ),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('exige identificador da empresa quando o e-mail existe em mais de uma', async () => {
    const planId = await seedCatalog();
    await createTenantFixture('empresa-duplicada', planId, {
      email: tenant.email,
      password: tenant.password,
    });
    await getRateLimitStore().reset(`login:${tenant.email}`);

    await expect(
      runWithContext({ origin: 'test' }, () =>
        login({ email: tenant.email, password: tenant.password }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    await getRateLimitStore().reset(`login:${tenant.email}`);
    const resolved = await runWithContext({ origin: 'test' }, () =>
      login({ email: tenant.email, password: tenant.password, tenantSlug: 'empresa-duplicada' }),
    );
    expect(resolved.tenantId).not.toBe(tenant.tenantId);
  });
});

describe('sessao', () => {
  it('token inexistente nao resolve sessao', async () => {
    expect(await findActiveSession('token-que-nao-existe')).toBeNull();
    expect(await findActiveSession('')).toBeNull();
  });

  it('sessao revogada deixa de ser valida (logout)', async () => {
    const result = await runWithContext({ origin: 'test' }, () =>
      login({ email: tenant.email, password: tenant.password }),
    );

    expect(await findActiveSession(result.session.token)).not.toBeNull();
    await revokeSession(result.session.sessionId);
    expect(await findActiveSession(result.session.token)).toBeNull();
  });

  it('sessao expirada deixa de ser valida', async () => {
    const session = await createSession(tenant.adminUserId, tenant.tenantId);
    await getDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, session.sessionId));

    expect(await findActiveSession(session.token)).toBeNull();
  });

  it('o banco guarda apenas o hash do token, nunca o token', async () => {
    const session = await createSession(tenant.adminUserId, tenant.tenantId);
    const rows = await getDb().select().from(sessions).where(eq(sessions.id, session.sessionId));

    expect(rows[0]?.tokenHash).not.toBe(session.token);
    expect(rows[0]?.tokenHash).toHaveLength(64);
    expect(JSON.stringify(rows[0])).not.toContain(session.token);
  });

  it('usuario desativado perde o contexto mesmo com sessao valida', async () => {
    const session = await createSession(tenant.adminUserId, tenant.tenantId);
    await getDb()
      .update(users)
      .set({ status: 'suspended' })
      .where(eq(users.id, tenant.adminUserId));

    const context = await loadContextForSession({
      id: session.sessionId,
      userId: tenant.adminUserId,
      tenantId: tenant.tenantId,
    });

    expect(context).toBeNull();
  });

  it('a limpeza de sessoes expiradas e idempotente', async () => {
    const session = await createSession(tenant.adminUserId, tenant.tenantId);
    await getDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.id, session.sessionId));

    const first = await pruneExpiredSessions();
    const second = await pruneExpiredSessions();

    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
  });
});

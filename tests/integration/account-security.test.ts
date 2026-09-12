import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runWithContext } from '@/core/context/request-context';
import { AuthenticationError, BusinessRuleError, ValidationError } from '@/core/errors';
import { getRateLimitStore } from '@/core/rate-limit/rate-limiter';
import { AUDIT_ACTIONS } from '@/modules/audit/application/audit-service';
import { auditLogs } from '@/modules/audit/infrastructure/schema';
import {
  changeOwnPassword,
  completePasswordReset,
  issuePasswordReset,
  MIN_PASSWORD_LENGTH,
} from '@/modules/auth/application/password-service';
import {
  countActiveSessions,
  listOwnSessions,
  revokeOtherOwnSessions,
  revokeOwnSession,
  revokeUserSessionsAsAdmin,
} from '@/modules/auth/application/session-management';
import {
  createSession,
  findActiveSession,
  summarizeUserAgent,
} from '@/modules/auth/application/session-service';
import { verifyPassword } from '@/modules/auth/domain/password';
import { login } from '@/modules/auth/application/login-service';
import { passwordResetTokens } from '@/modules/auth/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';
import { closeTestDatabase, migrateTestDatabase, truncateAll } from '../helpers/database';
import {
  contextFor,
  createPlainUser,
  createTenantFixture,
  grantMembership,
  seedCatalog,
  type TenantFixture,
} from '../helpers/fixtures';

/** SENHA E SESSOES (Prompt 03, itens 33 a 42, 82 e 89). */

let tenant: TenantFixture;

beforeAll(async () => {
  await migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll();
  const planId = await seedCatalog();
  tenant = await createTenantFixture('conta', planId);
  await getRateLimitStore().reset(`login:${tenant.email}`);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('politica de senha (item 34)', () => {
  it('recusa senha curta demais', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        changeOwnPassword(tenant.context, {
          currentPassword: tenant.password,
          newPassword: 'curta',
          confirmPassword: 'curta',
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('aceita frase longa sem exigir simbolo ou maiuscula', async () => {
    const frase = 'a minha bicicleta azul sobe a ladeira devagar';
    await expect(
      runWithContext({ origin: 'test' }, () =>
        changeOwnPassword(tenant.context, {
          currentPassword: tenant.password,
          newPassword: frase,
          confirmPassword: frase,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('recusa senha obviamente fraca mesmo com comprimento suficiente', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        changeOwnPassword(tenant.context, {
          currentPassword: tenant.password,
          newPassword: '1234567890',
          confirmPassword: '1234567890',
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('nao trunca senha longa em silencio', async () => {
    const longa = 'x'.repeat(200);
    await runWithContext({ origin: 'test' }, () =>
      changeOwnPassword(tenant.context, {
        currentPassword: tenant.password,
        newPassword: longa,
        confirmPassword: longa,
      }),
    );

    const rows = await getDb()
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, tenant.adminUserId));

    // A senha inteira vale; um prefixo nao autentica.
    expect(await verifyPassword(longa, rows[0]!.passwordHash)).toBe(true);
    expect(await verifyPassword('x'.repeat(72), rows[0]!.passwordHash)).toBe(false);
  });

  it('o minimo esta documentado no codigo', () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(10);
  });
});

describe('alteracao da propria senha (item 35)', () => {
  it('exige a senha atual correta', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        changeOwnPassword(tenant.context, {
          currentPassword: 'senha-errada-mesmo',
          newPassword: 'uma nova senha bem longa',
          confirmPassword: 'uma nova senha bem longa',
        }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('exige confirmacao coincidente', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        changeOwnPassword(tenant.context, {
          currentPassword: tenant.password,
          newPassword: 'uma nova senha bem longa',
          confirmPassword: 'outra coisa totalmente',
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('recusa repetir a senha atual', async () => {
    await expect(
      runWithContext({ origin: 'test' }, () =>
        changeOwnPassword(tenant.context, {
          currentPassword: tenant.password,
          newPassword: tenant.password,
          confirmPassword: tenant.password,
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('a nova senha passa a valer e a antiga deixa de valer', async () => {
    const nova = 'uma senha nova e bastante longa';
    await runWithContext({ origin: 'test' }, () =>
      changeOwnPassword(tenant.context, {
        currentPassword: tenant.password,
        newPassword: nova,
        confirmPassword: nova,
      }),
    );

    await getRateLimitStore().reset(`login:${tenant.email}`);
    await expect(
      runWithContext({ origin: 'test' }, () => login({ email: tenant.email, password: nova })),
    ).resolves.toBeTruthy();

    await getRateLimitStore().reset(`login:${tenant.email}`);
    await expect(
      runWithContext({ origin: 'test' }, () =>
        login({ email: tenant.email, password: tenant.password }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('encerra as sessoes existentes quando solicitado', async () => {
    await createSession(tenant.adminUserId, tenant.tenantId);
    await createSession(tenant.adminUserId, tenant.tenantId);
    expect(await countActiveSessions(tenant.context, tenant.adminUserId)).toBeGreaterThanOrEqual(2);

    const nova = 'outra senha longa o suficiente';
    await runWithContext({ origin: 'test' }, () =>
      changeOwnPassword(tenant.context, {
        currentPassword: tenant.password,
        newPassword: nova,
        confirmPassword: nova,
        revokeOtherSessions: true,
      }),
    );

    expect(await countActiveSessions(tenant.context, tenant.adminUserId)).toBe(0);
  });
});

describe('redefinicao por token (itens 36 e 37)', () => {
  it('o banco guarda apenas o hash do token', async () => {
    const issued = await runWithContext({ origin: 'test' }, () =>
      issuePasswordReset(tenant.context, tenant.adminUserId),
    );

    const rows = await getDb().select().from(passwordResetTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(issued.token);
    expect(rows[0]!.tokenHash).toHaveLength(64);
    expect(JSON.stringify(rows)).not.toContain(issued.token);
  });

  it('o token redefine a senha e encerra todas as sessoes', async () => {
    await createSession(tenant.adminUserId, tenant.tenantId);
    const issued = await runWithContext({ origin: 'test' }, () =>
      issuePasswordReset(tenant.context, tenant.adminUserId),
    );

    const nova = 'senha redefinida pelo token';
    await runWithContext({ origin: 'test' }, () =>
      completePasswordReset({
        token: issued.token,
        newPassword: nova,
        confirmPassword: nova,
      }),
    );

    expect(await countActiveSessions(tenant.context, tenant.adminUserId)).toBe(0);

    await getRateLimitStore().reset(`login:${tenant.email}`);
    await expect(
      runWithContext({ origin: 'test' }, () => login({ email: tenant.email, password: nova })),
    ).resolves.toBeTruthy();
  });

  it('o token e de uso unico', async () => {
    const issued = await runWithContext({ origin: 'test' }, () =>
      issuePasswordReset(tenant.context, tenant.adminUserId),
    );
    const nova = 'primeira redefinicao longa';

    await runWithContext({ origin: 'test' }, () =>
      completePasswordReset({ token: issued.token, newPassword: nova, confirmPassword: nova }),
    );

    await expect(
      runWithContext({ origin: 'test' }, () =>
        completePasswordReset({
          token: issued.token,
          newPassword: 'segunda tentativa longa',
          confirmPassword: 'segunda tentativa longa',
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('token expirado nao funciona', async () => {
    const issued = await runWithContext({ origin: 'test' }, () =>
      issuePasswordReset(tenant.context, tenant.adminUserId),
    );

    await getDb()
      .update(passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordResetTokens.tenantId, tenant.tenantId));

    await expect(
      runWithContext({ origin: 'test' }, () =>
        completePasswordReset({
          token: issued.token,
          newPassword: 'senha valida e longa',
          confirmPassword: 'senha valida e longa',
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('emitir um novo token invalida o anterior', async () => {
    const primeiro = await runWithContext({ origin: 'test' }, () =>
      issuePasswordReset(tenant.context, tenant.adminUserId),
    );
    await runWithContext({ origin: 'test' }, () =>
      issuePasswordReset(tenant.context, tenant.adminUserId),
    );

    await expect(
      runWithContext({ origin: 'test' }, () =>
        completePasswordReset({
          token: primeiro.token,
          newPassword: 'senha valida e longa',
          confirmPassword: 'senha valida e longa',
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('token invalido devolve a mesma mensagem de token expirado', async () => {
    const inexistente = await runWithContext({ origin: 'test' }, () =>
      completePasswordReset({
        token: 'token-que-nao-existe-mesmo',
        newPassword: 'senha valida e longa',
        confirmPassword: 'senha valida e longa',
      }).catch((error: Error) => error.message),
    );

    expect(inexistente).toBe('Este link de redefinicao e invalido ou expirou.');
  });

  it('nao redefine senha de usuario inativo', async () => {
    const inativo = await createPlainUser(tenant.tenantId, 'inativo@conta.invalid');
    await getDb().update(users).set({ status: 'inactive' }).where(eq(users.id, inativo));

    await expect(
      runWithContext({ origin: 'test' }, () => issuePasswordReset(tenant.context, inativo)),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe('sessoes (itens 38 a 42)', () => {
  it('lista as sessoes e identifica a atual', async () => {
    await createSession(tenant.adminUserId, tenant.tenantId);
    const context = await contextFor(tenant.tenantId, tenant.adminUserId);

    const sessions = await listOwnSessions(context);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.filter((session) => session.isCurrent)).toHaveLength(1);
  });

  it('nunca devolve o hash do token na listagem', async () => {
    const context = await contextFor(tenant.tenantId, tenant.adminUserId);
    const sessions = await listOwnSessions(context);
    expect(JSON.stringify(sessions)).not.toContain('tokenHash');
  });

  it('encerrar uma sessao a invalida imediatamente no backend', async () => {
    const alvo = await createSession(tenant.adminUserId, tenant.tenantId);
    const context = await contextFor(tenant.tenantId, tenant.adminUserId);

    expect(await findActiveSession(alvo.token)).not.toBeNull();
    await runWithContext({ origin: 'test' }, () => revokeOwnSession(context, alvo.sessionId));
    expect(await findActiveSession(alvo.token)).toBeNull();
  });

  it('encerrar as outras preserva a sessao atual', async () => {
    const outra = await createSession(tenant.adminUserId, tenant.tenantId);
    const context = await contextFor(tenant.tenantId, tenant.adminUserId);

    const revoked = await runWithContext({ origin: 'test' }, () => revokeOtherOwnSessions(context));
    expect(revoked).toBeGreaterThanOrEqual(1);
    expect(await findActiveSession(outra.token)).toBeNull();

    const restantes = await listOwnSessions(context);
    expect(restantes).toHaveLength(1);
    expect(restantes[0]!.isCurrent).toBe(true);
  });

  it('administrador encerra as sessoes de outro usuario do mesmo tenant', async () => {
    const alvo = await createPlainUser(tenant.tenantId, 'alvo@conta.invalid');
    await grantMembership(tenant.tenantId, alvo, tenant.unitId);
    const sessao = await createSession(alvo, tenant.tenantId);

    const revoked = await runWithContext({ origin: 'test' }, () =>
      revokeUserSessionsAsAdmin(tenant.context, alvo),
    );

    expect(revoked).toBe(1);
    expect(await findActiveSession(sessao.token)).toBeNull();
  });

  it('resume o agente sem virar fingerprint', () => {
    const resumo = summarizeUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    );
    expect(resumo).toBe('Chrome em Windows');
    expect(resumo!.length).toBeLessThanOrEqual(120);
    expect(resumo).not.toContain('537.36');
    expect(summarizeUserAgent(null)).toBeNull();
  });
});

describe('auditoria da area de conta (item 89)', () => {
  it('registra a troca de senha sem qualquer segredo', async () => {
    const nova = 'mais uma senha bem longa';
    await runWithContext({ origin: 'test' }, () =>
      changeOwnPassword(tenant.context, {
        currentPassword: tenant.password,
        newPassword: nova,
        confirmPassword: nova,
      }),
    );

    const rows = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, AUDIT_ACTIONS.PASSWORD_CHANGED));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(tenant.adminUserId);

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(nova);
    expect(serialized).not.toContain(tenant.password);
    expect(serialized).not.toContain('scrypt$');
  });

  it('registra a tentativa com senha atual incorreta', async () => {
    await runWithContext({ origin: 'test' }, () =>
      changeOwnPassword(tenant.context, {
        currentPassword: 'errada demais',
        newPassword: 'uma senha bem longa nova',
        confirmPassword: 'uma senha bem longa nova',
      }).catch(() => null),
    );

    const rows = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, AUDIT_ACTIONS.PASSWORD_CHANGED));

    expect(rows).toHaveLength(1);
    expect((rows[0]!.metadata as Record<string, unknown>).result).toBe('rejected');
  });

  it('registra a emissao de token sem gravar o token', async () => {
    const issued = await runWithContext({ origin: 'test' }, () =>
      issuePasswordReset(tenant.context, tenant.adminUserId),
    );

    const rows = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED));

    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(issued.token);
  });

  it('registra a revogacao de sessoes por administrador', async () => {
    const alvo = await createPlainUser(tenant.tenantId, 'alvo2@conta.invalid');
    await createSession(alvo, tenant.tenantId);

    await runWithContext({ origin: 'test' }, () => revokeUserSessionsAsAdmin(tenant.context, alvo));

    const rows = await getDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, AUDIT_ACTIONS.ALL_SESSIONS_REVOKED));

    expect(rows).toHaveLength(1);
    expect((rows[0]!.metadata as Record<string, unknown>).scope).toBe('admin');
  });
});

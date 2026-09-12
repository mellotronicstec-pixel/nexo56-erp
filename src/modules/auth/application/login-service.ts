import 'server-only';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { AuthenticationError, RateLimitError, ValidationError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { getRateLimitStore, RATE_LIMITS } from '@/core/rate-limit/rate-limiter';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import {
  hashPassword,
  needsRehash,
  simulatePasswordVerification,
  verifyPassword,
} from '@/modules/auth/domain/password';
import { createSession, type CreatedSession } from '@/modules/auth/application/session-service';
import { tenants } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * Autenticacao (Prompt 01, item 15).
 *
 * Decisoes de seguranca:
 *  - mensagem de erro UNICA para e-mail inexistente, senha errada, usuario
 *    inativo e empresa suspensa: nenhuma resposta revela qual foi o caso;
 *  - quando o e-mail nao existe, ainda assim gastamos o tempo de uma
 *    verificacao de senha (anti user-enumeration por timing);
 *  - rate limit por e-mail antes de tocar no banco;
 *  - o e-mail e unico POR TENANT, entao a mesma pessoa pode existir em mais de
 *    uma empresa. Com mais de um candidato, o login exige o identificador da
 *    empresa — sem nunca confirmar em qual delas a conta existe.
 */

export const loginSchema = z.object({
  email: z.email({ message: 'Informe um e-mail valido.' }).max(190).trim().toLowerCase(),
  password: z.string().min(1, 'Informe a senha.').max(512),
  tenantSlug: z
    .string()
    .trim()
    .toLowerCase()
    .max(64)
    .regex(/^[a-z0-9-]*$/, 'Identificador de empresa invalido.')
    .optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export interface LoginResult {
  session: CreatedSession;
  userId: string;
  tenantId: string;
}

const GENERIC_FAILURE = 'E-mail ou senha invalidos.';
const NEEDS_TENANT =
  'Este e-mail esta vinculado a mais de uma empresa. Informe o identificador da empresa.';

export async function login(rawInput: unknown): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  const input = parsed.data;

  // 1. Rate limit antes de qualquer acesso ao banco.
  const limit = await getRateLimitStore().hit(
    `login:${input.email}`,
    RATE_LIMITS.login.limit,
    RATE_LIMITS.login.windowMs,
  );
  if (!limit.allowed) {
    logger.warn('Login bloqueado por rate limit', { module: 'auth', operation: 'login' });
    throw new RateLimitError(limit.retryAfterSeconds);
  }

  const db = getDb();

  // 2. Candidatos: usuario ativo em tenant ativo.
  const candidates = await db
    .select({
      userId: users.id,
      tenantId: users.tenantId,
      passwordHash: users.passwordHash,
      userStatus: users.status,
      tenantStatus: tenants.status,
      tenantSlug: tenants.slug,
    })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(
      input.tenantSlug
        ? and(eq(users.email, input.email), eq(tenants.slug, input.tenantSlug))
        : eq(users.email, input.email),
    );

  if (candidates.length === 0) {
    await simulatePasswordVerification();
    await recordAudit({
      action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
      entityType: 'user',
      metadata: { reason: 'unknown_email' },
    });
    throw new AuthenticationError(GENERIC_FAILURE);
  }

  if (candidates.length > 1) {
    // Nao revela em quais empresas o e-mail existe.
    throw new ValidationError(NEEDS_TENANT, { needsTenantSlug: true });
  }

  const candidate = candidates[0]!;

  const passwordOk = await verifyPassword(input.password, candidate.passwordHash);
  const accountUsable = candidate.userStatus === 'active' && candidate.tenantStatus === 'active';

  if (!passwordOk || !accountUsable) {
    await recordAudit({
      action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
      entityType: 'user',
      entityId: candidate.userId,
      tenantId: candidate.tenantId,
      metadata: { reason: passwordOk ? 'account_not_usable' : 'invalid_password' },
    });
    throw new AuthenticationError(GENERIC_FAILURE);
  }

  await getRateLimitStore().reset(`login:${input.email}`);

  // 3. Sessao + auditoria + evento na mesma transacao.
  const result = await runInTransaction(async (tx, emit) => {
    const session = await createSession(candidate.userId, candidate.tenantId, tx);

    await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, candidate.userId));

    // Re-hash transparente quando os parametros do hash ficaram defasados.
    if (needsRehash(candidate.passwordHash)) {
      const upgraded = await hashPassword(input.password);
      await tx.update(users).set({ passwordHash: upgraded }).where(eq(users.id, candidate.userId));
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.USER_LOGIN_SUCCEEDED,
        entityType: 'user',
        entityId: candidate.userId,
        tenantId: candidate.tenantId,
        userId: candidate.userId,
        metadata: { sessionId: session.sessionId },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.USER_LOGGED_IN,
      tenantId: candidate.tenantId,
      payload: { userId: candidate.userId, sessionId: session.sessionId },
    });

    return {
      session,
      userId: candidate.userId,
      tenantId: candidate.tenantId,
    } satisfies LoginResult;
  });

  logger.info('Login efetuado', { module: 'auth', operation: 'login', tenantId: result.tenantId });
  return result;
}

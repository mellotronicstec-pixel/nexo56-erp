import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { getEnv } from '@/core/config/env';
import { newId } from '@/core/ids/id';
import { sessions } from '@/modules/auth/infrastructure/schema';

/**
 * Sessoes server-side (Prompt 01, item 15).
 *
 * O cookie carrega um token opaco de 256 bits gerado com CSPRNG. O banco
 * guarda apenas SHA-256 desse token: leitura do banco nao permite assumir
 * sessao. Nao usamos JWT porque revogacao imediata (logout, suspensao de
 * usuario, troca de senha) e requisito de ERP.
 */

export const SESSION_COOKIE = 'nexo56_session';

export interface CreatedSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeCompareHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

type Executor = Pick<ReturnType<typeof getDb>, 'insert'>;

export async function createSession(
  userId: string,
  tenantId: string,
  tx?: Executor,
): Promise<CreatedSession> {
  const executor = tx ?? getDb();
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getEnv().SESSION_TTL_HOURS * 60 * 60 * 1000);
  const sessionId = newId();

  await executor.insert(sessions).values({
    id: sessionId,
    userId,
    tenantId,
    tokenHash: hashToken(token),
    expiresAt,
    revokedAt: null,
    lastUsedAt: now,
    createdAt: now,
  });

  return { sessionId, token, expiresAt };
}

export interface ActiveSession {
  id: string;
  userId: string;
  tenantId: string;
  expiresAt: Date;
}

/** Retorna a sessao apenas se existir, nao estiver revogada e nao expirada. */
export async function findActiveSession(token: string): Promise<ActiveSession | null> {
  if (!token) return null;
  const db = getDb();

  const rows = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      tenantId: sessions.tenantId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function touchSession(sessionId: string): Promise<void> {
  await getDb().update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeSession(sessionId: string): Promise<void> {
  await getDb().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

/** Revoga todas as sessoes de um usuario (suspensao, troca de senha). */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await getDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/**
 * Remove sessoes expiradas/revogadas antigas. Chamado pelo job
 * `session.prune-expired`. Idempotente por natureza: rodar duas vezes remove
 * o mesmo conjunto (a segunda execucao simplesmente nao encontra nada).
 */
export async function pruneExpiredSessions(reference = new Date()): Promise<number> {
  const result = await getDb()
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, reference), lt(sessions.revokedAt, reference)));

  const [header] = result as unknown as [{ affectedRows?: number }];
  return header?.affectedRows ?? 0;
}

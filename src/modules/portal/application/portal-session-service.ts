import 'server-only';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { getDb } from '@/core/db/client';
import { newId } from '@/core/ids/id';
import { hashToken } from '@/modules/auth/application/session-service';
import { PORTAL_LOGIN_TOKEN_BYTES, PORTAL_SESSION_TTL_HOURS } from '@/modules/portal/domain/portal';
import { portalSessions } from '@/modules/portal/infrastructure/schema';

/**
 * Sessao do Portal — MESMA FORMA da sessao interna, tabela e cookie
 * SEPARADOS (ADR-080, item 19).
 *
 * `hashToken`/`safeCompareHash` sao reaproveitados de
 * `modules/auth/application/session-service.ts` porque sao funcoes puras de
 * criptografia sem nenhuma nocao de tenant, usuario ou RBAC — reescreve-las
 * aqui identicas so criaria uma segunda formula para as duas divergirem.
 */

export interface CreatedPortalSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

type Executor = Pick<ReturnType<typeof getDb>, 'insert'>;

export async function createPortalSession(
  input: { tenantId: string; customerId: string; portalIdentityId: string },
  tx?: Executor,
  userAgentSummary?: string | null,
): Promise<CreatedPortalSession> {
  const executor = tx ?? getDb();
  const token = randomBytes(PORTAL_LOGIN_TOKEN_BYTES).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PORTAL_SESSION_TTL_HOURS * 60 * 60 * 1000);
  const sessionId = newId();

  await executor.insert(portalSessions).values({
    id: sessionId,
    tenantId: input.tenantId,
    customerId: input.customerId,
    portalIdentityId: input.portalIdentityId,
    tokenHash: hashToken(token),
    expiresAt,
    revokedAt: null,
    lastUsedAt: now,
    userAgentSummary: userAgentSummary ?? null,
    createdAt: now,
  });

  return { sessionId, token, expiresAt };
}

export interface ActivePortalSession {
  id: string;
  tenantId: string;
  customerId: string;
  portalIdentityId: string;
  expiresAt: Date;
}

export async function findActivePortalSession(token: string): Promise<ActivePortalSession | null> {
  if (!token) return null;
  const db = getDb();

  const rows = await db
    .select({
      id: portalSessions.id,
      tenantId: portalSessions.tenantId,
      customerId: portalSessions.customerId,
      portalIdentityId: portalSessions.portalIdentityId,
      expiresAt: portalSessions.expiresAt,
    })
    .from(portalSessions)
    .where(
      and(
        eq(portalSessions.tokenHash, hashToken(token)),
        isNull(portalSessions.revokedAt),
        gt(portalSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function touchPortalSession(sessionId: string): Promise<void> {
  await getDb()
    .update(portalSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(portalSessions.id, sessionId));
}

export async function revokePortalSession(sessionId: string): Promise<void> {
  await getDb()
    .update(portalSessions)
    .set({ revokedAt: new Date() })
    .where(eq(portalSessions.id, sessionId));
}

/** Revoga todas as sessoes de uma identidade — bloqueio, pedido do cliente. */
export async function revokeAllPortalSessions(portalIdentityId: string): Promise<void> {
  await getDb()
    .update(portalSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(portalSessions.portalIdentityId, portalIdentityId), isNull(portalSessions.revokedAt)));
}

export async function pruneExpiredPortalSessions(reference = new Date()): Promise<number> {
  const result = await getDb()
    .delete(portalSessions)
    .where(or(lt(portalSessions.expiresAt, reference), lt(portalSessions.revokedAt, reference)));

  const [header] = result as unknown as [{ affectedRows?: number }];
  return header?.affectedRows ?? 0;
}

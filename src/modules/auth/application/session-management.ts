import 'server-only';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { NotFoundError } from '@/core/errors';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { sessions } from '@/modules/auth/infrastructure/schema';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { findUserInTenant } from '@/modules/users/application/user-service';

/**
 * Gestao de sessoes ativas (Prompt 03, itens 38 a 42).
 *
 * A revogacao acontece no BANCO: `findActiveSession` exige `revoked_at IS NULL`
 * e `expires_at > agora`, entao a sessao para de funcionar na proxima
 * requisicao, sem depender de o navegador apagar cookie (item 41).
 */

export interface ActiveSessionSummary {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  userAgentSummary: string | null;
  /** True para a sessao que esta fazendo a requisicao. */
  isCurrent: boolean;
}

/** Sessoes ativas do proprio usuario. Nunca devolve hash de token. */
export async function listOwnSessions(context: TenantContext): Promise<ActiveSessionSummary[]> {
  const rows = await getDb()
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
      expiresAt: sessions.expiresAt,
      userAgentSummary: sessions.userAgentSummary,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, context.userId),
        eq(sessions.tenantId, context.tenantId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(sessions.lastUsedAt));

  return rows.map((row) => ({ ...row, isCurrent: row.id === context.sessionId }));
}

/** Encerra uma sessao especifica do proprio usuario. */
export async function revokeOwnSession(context: TenantContext, sessionId: string): Promise<void> {
  const rows = await getDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, context.userId),
        eq(sessions.tenantId, context.tenantId),
      ),
    )
    .limit(1);

  if (!rows[0]) throw new NotFoundError('Sessao nao encontrada.');

  await runInTransaction(async (tx) => {
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));

    await recordAudit(
      {
        action: AUDIT_ACTIONS.SESSION_REVOKED,
        entityType: 'session',
        entityId: sessionId,
        tenantId: context.tenantId,
        userId: context.userId,
        metadata: { scope: 'self', current: sessionId === context.sessionId },
      },
      tx,
    );
  });
}

/** Encerra todas as sessoes do usuario EXCETO a atual. */
export async function revokeOtherOwnSessions(context: TenantContext): Promise<number> {
  const affected = await getDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, context.userId),
        eq(sessions.tenantId, context.tenantId),
        isNull(sessions.revokedAt),
        ne(sessions.id, context.sessionId),
      ),
    );

  if (affected.length === 0) return 0;

  await runInTransaction(async (tx) => {
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, context.userId),
          eq(sessions.tenantId, context.tenantId),
          isNull(sessions.revokedAt),
          ne(sessions.id, context.sessionId),
        ),
      );

    await recordAudit(
      {
        action: AUDIT_ACTIONS.ALL_SESSIONS_REVOKED,
        entityType: 'session',
        entityId: context.userId,
        tenantId: context.tenantId,
        userId: context.userId,
        metadata: { scope: 'self_others', revokedCount: affected.length },
      },
      tx,
    );
  });

  return affected.length;
}

/**
 * Administrador encerra as sessoes de outro usuario DO MESMO TENANT.
 *
 * `findUserInTenant` garante o escopo: um ID de outro tenant nao e encontrado,
 * e a operacao falha como "usuario nao encontrado".
 */
export async function revokeUserSessionsAsAdmin(
  context: TenantContext,
  targetUserId: string,
): Promise<number> {
  const target = await findUserInTenant(context, targetUserId);

  const affected = await getDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, target.id),
        eq(sessions.tenantId, context.tenantId),
        isNull(sessions.revokedAt),
      ),
    );

  if (affected.length === 0) return 0;

  await runInTransaction(async (tx, emit) => {
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, target.id),
          eq(sessions.tenantId, context.tenantId),
          isNull(sessions.revokedAt),
        ),
      );

    await recordAudit(
      {
        action: AUDIT_ACTIONS.ALL_SESSIONS_REVOKED,
        entityType: 'session',
        entityId: target.id,
        tenantId: context.tenantId,
        userId: context.userId,
        metadata: { scope: 'admin', targetUserId: target.id, revokedCount: affected.length },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.SESSION_REVOKED,
      tenantId: context.tenantId,
      payload: { targetUserId: target.id, revokedCount: affected.length, by: context.userId },
    });
  });

  return affected.length;
}

/** Quantas sessoes ativas o usuario possui — usado nas telas administrativas. */
export async function countActiveSessions(context: TenantContext, userId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.tenantId, context.tenantId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  return rows.length;
}

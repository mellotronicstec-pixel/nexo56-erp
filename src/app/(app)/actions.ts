'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { getEnv } from '@/core/config/env';
import { isAppError, ValidationError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { getCurrentContext, UNIT_COOKIE } from '@/modules/auth/application/current-context';
import { revokeSession, SESSION_COOKIE } from '@/modules/auth/application/session-service';

/**
 * Verificacao de origem, como defesa em profundidade sobre a protecao nativa
 * de Server Actions do Next (Prompt 03, item 106 — CSRF).
 */
export async function assertSameOrigin(): Promise<void> {
  const headerList = await headers();
  const origin = headerList.get('origin');
  if (!origin) return;

  if (origin !== new URL(getEnv().APP_URL).origin) {
    throw new ValidationError('Requisicao rejeitada por origem invalida.');
  }
}

/** Logout: revoga a sessao no servidor e so entao limpa o cookie. */
export async function logoutAction(): Promise<void> {
  await runWithContext({ origin: 'web' }, async () => {
    const context = await getCurrentContext();

    if (context) {
      await revokeSession(context.sessionId);
      await recordAudit({
        action: AUDIT_ACTIONS.USER_LOGGED_OUT,
        entityType: 'session',
        entityId: context.sessionId,
        tenantId: context.tenantId,
        userId: context.userId,
      });
    }

    // Idempotente: sem sessao valida, apenas limpa o cookie (item 42).
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE);
    cookieStore.delete(UNIT_COOKIE);
  });

  redirect('/login');
}

/**
 * Troca a unidade ativa (Prompt 03, itens 23 e 26).
 *
 * O cliente PEDE uma unidade; quem decide e o servidor. A unidade so e gravada
 * no cookie depois de confirmada entre as autorizadas — e, mesmo assim, o
 * `loadContextForSession` revalida a cada requisicao. Trocar de unidade nao
 * altera tenant e nao amplia permissao alguma: apenas muda quais papeis UNIT
 * entram no calculo.
 */
export async function switchUnitAction(formData: FormData): Promise<void> {
  await runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();

      const context = await getCurrentContext();
      if (!context) return;

      const requestedUnitId = String(formData.get('unitId') ?? '');

      if (!context.authorizedUnitIds.includes(requestedUnitId)) {
        logger.warn('Tentativa de selecionar unidade nao autorizada', {
          module: 'tenancy',
          operation: 'switchUnit',
        });
        return; // silencioso de proposito: nao confirma a existencia da unidade
      }

      const cookieStore = await cookies();
      cookieStore.set(UNIT_COOKIE, requestedUnitId, {
        httpOnly: true,
        secure: getEnv().NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });

      await recordAudit({
        action: AUDIT_ACTIONS.UNIT_SWITCHED,
        entityType: 'unit',
        entityId: requestedUnitId,
        tenantId: context.tenantId,
        unitId: requestedUnitId,
        userId: context.userId,
        before: { unitId: context.activeUnitId },
        after: { unitId: requestedUnitId },
      });
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha ao trocar de unidade', {
          module: 'tenancy',
          operation: 'switchUnit',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  redirect('/');
}

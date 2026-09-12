'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { getCurrentContext } from '@/modules/auth/application/current-context';
import { revokeSession, SESSION_COOKIE } from '@/modules/auth/application/session-service';

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

    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE);
  });

  redirect('/login');
}

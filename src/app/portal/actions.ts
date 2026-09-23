'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { PORTAL_LOGIN_COOKIE } from '@/modules/portal/domain/portal';
import { findActivePortalSession, revokePortalSession } from '@/modules/portal/application/portal-session-service';

export async function portalLogoutAction(): Promise<void> {
  await runWithContext({ origin: 'web' }, async () => {
    const cookieStore = await cookies();
    const token = cookieStore.get(PORTAL_LOGIN_COOKIE)?.value;

    if (token) {
      const session = await findActivePortalSession(token);
      if (session) await revokePortalSession(session.id);
    }

    cookieStore.delete(PORTAL_LOGIN_COOKIE);
  });

  redirect('/portal/entrar');
}

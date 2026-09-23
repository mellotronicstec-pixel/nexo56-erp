'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { getEnv } from '@/core/config/env';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { consumePortalLoginToken } from '@/modules/portal/application/portal-login-service';
import { PORTAL_LOGIN_COOKIE } from '@/modules/portal/domain/portal';

export interface ConfirmLoginState {
  error: string | null;
}

/**
 * Consome o link SO NA CONFIRMACAO explicita, nunca no GET da pagina.
 *
 * Scanner de e-mail corporativo e antivirus costumam abrir todo link de uma
 * mensagem antes de o destinatario ler — um GET que consumisse o token
 * sozinho deixaria o link "gasto" antes do cliente clicar. A pagina so
 * mostra um botao; o consumo de verdade acontece aqui, numa Server Action
 * que so roda com um clique de pessoa.
 */
export async function confirmPortalLoginAction(
  token: string,
  _previous: ConfirmLoginState,
): Promise<ConfirmLoginState> {
  let destination: string | null = null;

  const result = await runWithContext({ origin: 'web' }, async (): Promise<ConfirmLoginState> => {
    try {
      const session = await consumePortalLoginToken(token);

      const cookieStore = await cookies();
      cookieStore.set(PORTAL_LOGIN_COOKIE, session.token, {
        httpOnly: true,
        secure: getEnv().NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        expires: session.expiresAt,
      });

      destination = '/portal';
      return { error: null };
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha inesperada ao confirmar login do Portal', {
          module: 'portal',
          operation: 'confirmPortalLoginAction',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { error: toUserMessage(error) };
    }
  });

  if (destination) redirect(destination);
  return result;
}

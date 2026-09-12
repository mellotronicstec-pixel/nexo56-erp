'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { runWithContext } from '@/core/context/request-context';
import { getEnv } from '@/core/config/env';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { changeOwnPassword } from '@/modules/auth/application/password-service';
import { requireContext } from '@/modules/auth/application/current-context';
import {
  revokeOtherOwnSessions,
  revokeOwnSession,
} from '@/modules/auth/application/session-management';
import {
  createSession,
  SESSION_COOKIE,
  summarizeUserAgent,
} from '@/modules/auth/application/session-service';
import { type AccountActionState } from './action-state';
import { assertSameOrigin } from '../actions';

async function run(
  operation: string,
  work: () => Promise<AccountActionState>,
): Promise<AccountActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      const result = await work();
      revalidatePath('/minha-conta');
      return result;
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha em acao da conta', {
          module: 'auth',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { error: toUserMessage(error), success: null };
    }
  });
}

/**
 * Troca da propria senha.
 *
 * Quando o usuario opta por encerrar as outras sessoes, TODAS sao revogadas —
 * inclusive a atual — e uma nova e criada logo em seguida. Assim nenhuma
 * sessao anterior a troca continua valendo, e a pessoa nao e deslogada do
 * proprio navegador.
 */
export async function changePasswordAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  return run('changePassword', async () => {
    const context = await requireContext();
    const revokeOthers = formData.get('revokeOtherSessions') !== 'false';

    await changeOwnPassword(context, {
      currentPassword: formData.get('currentPassword'),
      newPassword: formData.get('newPassword'),
      confirmPassword: formData.get('confirmPassword'),
      revokeOtherSessions: revokeOthers,
    });

    if (revokeOthers) {
      const headerList = await headers();
      const fresh = await createSession(
        context.userId,
        context.tenantId,
        undefined,
        summarizeUserAgent(headerList.get('user-agent')),
      );

      const cookieStore = await cookies();
      cookieStore.set(SESSION_COOKIE, fresh.token, {
        httpOnly: true,
        secure: getEnv().NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        expires: fresh.expiresAt,
      });
    }

    return {
      error: null,
      success: revokeOthers
        ? 'Senha alterada. As demais sessoes foram encerradas.'
        : 'Senha alterada.',
    };
  });
}

export async function revokeSessionAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  return run('revokeSession', async () => {
    const context = await requireContext();
    await revokeOwnSession(context, String(formData.get('sessionId') ?? ''));
    return { error: null, success: 'Sessao encerrada.' };
  });
}

export async function revokeOtherSessionsAction(
  _previous: AccountActionState,
  _formData: FormData,
): Promise<AccountActionState> {
  return run('revokeOtherSessions', async () => {
    const context = await requireContext();
    const revoked = await revokeOtherOwnSessions(context);
    return {
      error: null,
      success:
        revoked === 0 ? 'Nenhuma outra sessao ativa.' : `${revoked} sessao(oes) encerrada(s).`,
    };
  });
}

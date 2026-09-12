'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { getEnv } from '@/core/config/env';
import { isAppError, toUserMessage, ValidationError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { login } from '@/modules/auth/application/login-service';
import { SESSION_COOKIE } from '@/modules/auth/application/session-service';

/**
 * Server Action de login.
 *
 * Protecoes (Prompt 01, itens 15 e 42):
 *  - validacao server-side com zod (o formulario nao e barreira);
 *  - verificacao explicita de Origin contra APP_URL, alem da protecao nativa
 *    de Server Actions do Next, como defesa em profundidade contra CSRF;
 *  - cookie HttpOnly + SameSite=Lax + Secure em producao + Path=/;
 *  - a resposta nunca diz se o e-mail existe.
 */

export interface LoginFormState {
  error: string | null;
  needsTenantSlug: boolean;
  /**
   * Valores devolvidos ao formulario para repreenchimento.
   *
   * O React reseta campos nao controlados quando uma action de formulario
   * termina; sem isto, quem erra a senha perde o e-mail digitado e a segunda
   * tentativa chega vazia ao servidor.
   *
   * A SENHA NUNCA e devolvida — apenas identificacao nao sensivel.
   */
  values: { email: string; tenantSlug: string };
}

async function assertSameOrigin(): Promise<void> {
  const headerList = await headers();
  const origin = headerList.get('origin');
  if (!origin) return; // navegacao sem Origin (ex.: alguns clientes); Next ja valida Server Actions

  const expected = new URL(getEnv().APP_URL).origin;
  if (origin !== expected) {
    throw new ValidationError('Requisicao rejeitada por origem invalida.');
  }
}

export async function loginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  let destination: string | null = null;

  const submitted = {
    email: String(formData.get('email') ?? ''),
    tenantSlug: String(formData.get('tenantSlug') ?? ''),
  };

  const result = await runWithContext({ origin: 'web' }, async (): Promise<LoginFormState> => {
    try {
      await assertSameOrigin();

      const outcome = await login({
        email: formData.get('email'),
        password: formData.get('password'),
        tenantSlug: (formData.get('tenantSlug') as string | null)?.trim() || undefined,
      });

      const cookieStore = await cookies();
      cookieStore.set(SESSION_COOKIE, outcome.session.token, {
        httpOnly: true,
        secure: getEnv().NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        expires: outcome.session.expiresAt,
      });

      destination = '/';
      return { error: null, needsTenantSlug: false, values: submitted };
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha inesperada no login', {
          module: 'auth',
          operation: 'loginAction',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const needsTenantSlug = Boolean(
        isAppError(error) &&
        (error.details as { needsTenantSlug?: boolean } | undefined)?.needsTenantSlug,
      );

      return { error: toUserMessage(error), needsTenantSlug, values: submitted };
    }
  });

  // redirect() lanca por design — fica fora do try/catch acima.
  if (destination) redirect(destination);
  return result;
}

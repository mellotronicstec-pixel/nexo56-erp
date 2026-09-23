'use server';

import { headers } from 'next/headers';
import { runWithContext } from '@/core/context/request-context';
import { logger } from '@/core/logging/logger';
import { getEnv } from '@/core/config/env';
import { ValidationError } from '@/core/errors';
import { requestPortalLogin } from '@/modules/portal/application/portal-login-service';

/**
 * Pede o link magico (ADR-080). O RESULTADO E SEMPRE O MESMO (item 17): esta
 * action nunca devolve "contato nao encontrado" — so "se existir, enviamos".
 */

export interface RequestLoginState {
  submitted: boolean;
}

async function assertSameOrigin(): Promise<void> {
  const headerList = await headers();
  const origin = headerList.get('origin');
  if (!origin) return;
  if (origin !== new URL(getEnv().APP_URL).origin) {
    throw new ValidationError('Requisicao rejeitada por origem invalida.');
  }
}

export async function requestPortalLoginAction(
  _previous: RequestLoginState,
  formData: FormData,
): Promise<RequestLoginState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
    } catch (error) {
      logger.warn('Pedido de link do Portal recusado por origem', {
        module: 'portal',
        operation: 'requestPortalLoginAction',
        error: error instanceof Error ? error.message : String(error),
      });
      // Mesma resposta de sempre: a origem invalida nao vira pista nenhuma.
      return { submitted: true };
    }

    const contact = String(formData.get('contact') ?? '');
    await requestPortalLogin(contact);

    return { submitted: true };
  });
}

'use client';

import { useEffect } from 'react';
import { Button } from '@/design-system/components';

/**
 * Erro inesperado (Prompt 01, item 77).
 * O usuario recebe mensagem compreensivel; o detalhe tecnico fica no servidor.
 * `digest` e o identificador do erro no log — nao e stack trace.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({ level: 'error', message: 'Erro na interface', digest: error.digest }),
    );
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-heading text-h3 font-semibold text-ink-900">Algo deu errado</h1>
        <p className="mt-2 text-ui text-ink-500">
          Nao foi possivel concluir esta operacao. Tente novamente em instantes.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-small text-ink-500">Referencia: {error.digest}</p>
        ) : null}
        <div className="mt-6">
          <Button onClick={reset}>Tentar novamente</Button>
        </div>
      </div>
    </main>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Acesso negado' };

/**
 * Acesso negado (Prompt 01, item 77).
 *
 * Mensagem generica de proposito: nao revela se a funcionalidade existe, se o
 * plano contempla ou se falta permissao — esse detalhe fica no log e na
 * auditoria, nao na tela de quem nao pode ver.
 */
export default function AccessDeniedPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-heading text-h3 font-semibold text-ink-900">Acesso negado</h1>
        <p className="mt-2 text-ui text-ink-500">
          Voce nao tem acesso a esta area. Se acredita que deveria ter, fale com o administrador da
          sua empresa.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md border border-ink-300 bg-white px-4 text-ui font-semibold text-ink-700 transition-colors hover:bg-ink-50"
        >
          Voltar ao inicio
        </Link>
      </div>
    </main>
  );
}

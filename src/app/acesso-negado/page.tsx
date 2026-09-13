import type { Metadata } from 'next';
import Link from 'next/link';
import { linkButtonClass } from '@/design-system/components';

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
        <Link href="/" className={linkButtonClass('secondary', 'md', 'mt-6')}>
          Voltar ao inicio
        </Link>
      </div>
    </main>
  );
}

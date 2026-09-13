import Link from 'next/link';
import { linkButtonClass } from '@/design-system/components';

/**
 * Pagina inexistente (Prompt 04, item 52).
 *
 * Amigavel e sem detalhe interno: nao diz qual rota faltou, nem se o registro
 * existe em outra empresa. Para quem esta de fora, endereco inexistente e
 * endereco de outra empresa sao indistinguiveis — e assim deve ser.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-[28rem] text-center">
        <p className="font-heading text-h1 font-bold text-brand-500">404</p>
        <h1 className="mt-2 font-heading text-h3 font-semibold text-ink-900">
          Pagina nao encontrada
        </h1>
        <p className="mt-2 text-ui text-ink-500">O endereco acessado nao existe ou foi movido.</p>
        <Link href="/" className={linkButtonClass('primary', 'md', 'mt-6')}>
          Voltar ao inicio
        </Link>
      </div>
    </main>
  );
}

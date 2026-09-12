import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="font-heading text-h1 font-bold text-brand-500">404</p>
        <h1 className="mt-2 font-heading text-h3 font-semibold text-ink-900">
          Pagina nao encontrada
        </h1>
        <p className="mt-2 text-ui text-ink-500">O endereco acessado nao existe ou foi movido.</p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-brand-500 px-4 text-ui font-semibold text-white transition-colors hover:bg-brand-600"
        >
          Voltar ao inicio
        </Link>
      </div>
    </main>
  );
}

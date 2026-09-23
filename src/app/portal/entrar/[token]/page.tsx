import type { Metadata } from 'next';
import { BrandMark } from '@/design-system/components/brand-mark';
import { ConfirmLoginForm } from './confirm-form';

export const metadata: Metadata = { title: 'Confirmar entrada' };

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * Esta pagina NAO consome o token (ver `confirm-actions.ts`). Ela so o
 * repassa, intacto, para o botao — o clique de uma pessoa e que faz o
 * consumo de verdade.
 */
export default async function PortalConfirmarEntradaPage({ params }: PageProps) {
  const { token } = await params;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>

        <div className="rounded-lg border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="font-heading text-h3 font-semibold text-ink-900">Confirmar entrada</h1>
          <p className="mt-1 mb-6 text-ui text-ink-500">
            Toque no botao abaixo para entrar no Portal do Cliente.
          </p>
          <ConfirmLoginForm token={token} />
        </div>
      </div>
    </main>
  );
}

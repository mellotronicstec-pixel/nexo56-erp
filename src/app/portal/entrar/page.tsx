import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BrandMark } from '@/design-system/components/brand-mark';
import { getPortalContext } from '@/modules/portal/application/portal-context';
import { EntrarForm } from './entrar-form';

export const metadata: Metadata = { title: 'Entrar' };

export default async function PortalEntrarPage() {
  if (await getPortalContext()) redirect('/portal');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>

        <div className="rounded-lg border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="font-heading text-h3 font-semibold text-ink-900">Portal do Cliente</h1>
          <p className="mt-1 mb-6 text-ui text-ink-500">
            Informe o e-mail ou telefone do seu cadastro. Enviamos um link para voce entrar, sem
            senha.
          </p>
          <EntrarForm />
        </div>
      </div>
    </main>
  );
}

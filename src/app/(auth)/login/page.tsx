import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BrandMark } from '@/design-system/components/brand-mark';
import { getCurrentContext } from '@/modules/auth/application/current-context';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

/**
 * Tela de login (Prompt 01, item 55).
 * Sem gradiente, sem glassmorphism, sem animacao gratuita: moderno,
 * tecnologico, confiavel, organizado e pratico (Prompt 00, item 89).
 */
export default async function LoginPage() {
  if (await getCurrentContext()) redirect('/');

  return (
    <main className="flex min-h-dvh flex-col bg-ink-50">
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex justify-center">
            <BrandMark />
          </div>

          <div className="rounded-lg border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
            <h1 className="font-heading text-h3 font-semibold text-ink-900">Entrar</h1>
            <p className="mt-1 mb-6 text-ui text-ink-500">
              Acesse com as credenciais da sua empresa.
            </p>
            <LoginForm />
          </div>

          <p className="mt-6 text-center text-small text-ink-500">
            Problemas para acessar? Fale com o administrador da sua empresa.
          </p>
        </div>
      </div>
    </main>
  );
}

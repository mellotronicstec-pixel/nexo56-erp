import Link from 'next/link';
import { BrandMark } from '@/design-system/components/brand-mark';
import { portalLogoutAction } from '../actions';

const NAV_ITEMS = [
  { href: '/portal', label: 'Ordens de servico' },
  { href: '/portal/equipamentos', label: 'Equipamentos' },
  { href: '/portal/garantias', label: 'Garantias' },
] as const;

/**
 * Moldura do Portal AUTENTICADO — nao e o shell do painel interno (item 31).
 * So navegacao entre as tres secoes do Portal e o botao de sair.
 */
export function PortalChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BrandMark />
          <span className="text-small text-ink-500">Portal do Cliente</span>
        </div>
        <form action={portalLogoutAction}>
          <button
            type="submit"
            className="text-small font-medium text-ink-500 underline hover:text-ink-700"
          >
            Sair
          </button>
        </form>
      </header>

      <nav className="mb-6 flex flex-wrap gap-2">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="touch-target rounded-md border border-ink-200 bg-white px-3 py-1.5 text-small font-medium text-ink-700 hover:border-brand-300 hover:text-brand-700"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <main>{children}</main>
    </div>
  );
}

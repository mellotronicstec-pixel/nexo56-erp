import Link from 'next/link';
import { cn } from '@/design-system/cn';

/**
 * Abas de navegacao (Prompt 04, item 42).
 *
 * Cada aba e um LINK para uma URL propria, nao um estado de cliente. Assim a
 * aba aberta sobrevive ao recarregar, pode ser compartilhada, e a navegacao
 * por teclado e a nativa de links — sem reimplementar setas.
 *
 * Em tela estreita a faixa rola horizontalmente DENTRO de si mesma; a pagina
 * nunca ganha rolagem lateral (item 65).
 */
export interface TabItem {
  href: string;
  label: string;
  /** Contagem opcional ao lado do rotulo. */
  count?: number;
}

export function Tabs({
  items,
  activeHref,
  label = 'Secoes desta pagina',
  className,
}: {
  items: readonly TabItem[];
  activeHref: string;
  label?: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn('border-b border-ink-200', className)}>
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const active = item.href === activeHref;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-ui font-medium transition-colors',
                  active
                    ? 'border-brand-500 text-brand-700'
                    : 'border-transparent text-ink-600 hover:border-ink-300 hover:text-ink-900',
                )}
              >
                {item.label}
                {typeof item.count === 'number' ? (
                  <span className="rounded-full bg-ink-100 px-1.5 text-small text-ink-600">
                    {item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

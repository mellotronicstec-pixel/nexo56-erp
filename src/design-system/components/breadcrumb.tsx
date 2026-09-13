import Link from 'next/link';
import { IconChevronRight } from '@/design-system/icons';
import { cn } from '@/design-system/cn';

/**
 * Trilha de navegacao (Prompt 04, item 39).
 *
 * `<nav aria-label>` com lista ordenada: a ordem importa e o leitor de tela
 * anuncia "1 de 3". O ultimo item nao e link e carrega `aria-current="page"`.
 * Os separadores sao `aria-hidden`, senao viram ruido a cada nivel.
 */
export interface Crumb {
  label: string;
  /** Ausente = item atual (ultimo da trilha). */
  href?: string;
}

export function Breadcrumb({ items, className }: { items: readonly Crumb[]; className?: string }) {
  return (
    <nav aria-label="Trilha de navegacao" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-small text-ink-500">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className={cn('rounded-xs hover:text-ink-800 hover:underline')}
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className="font-medium text-ink-700">
                  {item.label}
                </span>
              )}
              {last ? null : <IconChevronRight size={14} className="text-ink-400" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

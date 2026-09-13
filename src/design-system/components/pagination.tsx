import Link from 'next/link';
import { cn } from '@/design-system/cn';
import { IconChevronLeft, IconChevronRight } from '@/design-system/icons';

/**
 * Paginacao (Prompt 04, item 20).
 *
 * Navegacao por LINKS, nao por botoes: cada pagina tem URL propria, o botao
 * voltar do navegador funciona e o link pode ser compartilhado. A pagina atual
 * e anunciada com `aria-current="page"`.
 */
export function Pagination({
  page,
  pageCount,
  hrefFor,
  className,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  if (pageCount <= 1) return null;

  const previous = page > 1 ? page - 1 : null;
  const next = page < pageCount ? page + 1 : null;

  const step = (
    href: string | null,
    label: string,
    icon: React.ReactNode,
    position: 'before' | 'after',
  ) =>
    href ? (
      <Link
        href={href}
        rel={position === 'before' ? 'prev' : 'next'}
        className="touch-target inline-flex items-center gap-1.5 rounded-md border border-ink-300 bg-white px-3 text-ui font-medium text-ink-700 transition-colors hover:bg-ink-50"
      >
        {position === 'before' ? icon : null}
        {label}
        {position === 'after' ? icon : null}
      </Link>
    ) : (
      <span
        aria-disabled="true"
        className="touch-target inline-flex items-center gap-1.5 rounded-md border border-ink-200 px-3 text-ui font-medium text-ink-400"
      >
        {position === 'before' ? icon : null}
        {label}
        {position === 'after' ? icon : null}
      </span>
    );

  return (
    <nav
      aria-label="Paginacao"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 px-4 py-3',
        className,
      )}
    >
      {step(
        previous === null ? null : hrefFor(previous),
        'Anterior',
        <IconChevronLeft size={16} />,
        'before',
      )}

      <p className="text-small text-ink-500" aria-current="page">
        Pagina {page} de {pageCount}
      </p>

      {step(
        next === null ? null : hrefFor(next),
        'Proxima',
        <IconChevronRight size={16} />,
        'after',
      )}
    </nav>
  );
}

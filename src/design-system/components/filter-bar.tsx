import type { ReactNode } from 'react';
import { cn } from '@/design-system/cn';
import { Badge } from './badge';

/**
 * Barra de filtros (Prompt 04, item 43).
 *
 * Um `<form method="get">`: os filtros viram query string, a URL descreve o
 * que esta na tela e recarregar nao perde a selecao. Sem estado de cliente,
 * sem JavaScript obrigatorio.
 *
 * Os filtros aplicados aparecem como etiquetas — quem chega numa lista curta
 * precisa saber que ela esta filtrada, e nao vazia.
 */
export function FilterBar({
  action,
  children,
  applied,
  onClearHref,
  className,
}: {
  action?: string;
  children: ReactNode;
  /** Rotulos legiveis do que esta aplicado agora. */
  applied?: readonly string[];
  /** URL que remove todos os filtros. */
  onClearHref?: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-3 border-b border-ink-200 px-4 py-3 sm:px-5', className)}>
      <form
        method="get"
        action={action}
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      >
        {children}
      </form>

      {applied && applied.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-small text-ink-500">Filtros aplicados:</span>
          {applied.map((item) => (
            <Badge key={item} tone="brand">
              {item}
            </Badge>
          ))}
          {onClearHref ? (
            <a
              href={onClearHref}
              className="text-small font-semibold text-brand-600 hover:text-brand-700 hover:underline"
            >
              Limpar filtros
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

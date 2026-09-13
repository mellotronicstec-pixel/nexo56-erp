import type { ReactNode } from 'react';
import { cn } from '@/design-system/cn';
import { Breadcrumb, type Crumb } from './breadcrumb';

/**
 * Cabecalho de pagina (Prompt 04, item 40).
 *
 * Estrutura unica para TODAS as telas do Nexo56, de modo que cada modulo novo
 * nao invente o proprio jeito de apresentar titulo e acoes:
 *
 *   breadcrumbs -> eyebrow -> titulo -> descricao -> metadados -> acoes
 *
 * O `<h1>` fica aqui, uma unica vez por pagina — hierarquia de cabecalhos e o
 * indice que quem usa leitor de tela percorre para se situar.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  breadcrumbs,
  actions,
  metadata,
  className,
}: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  breadcrumbs?: readonly Crumb[];
  actions?: ReactNode;
  metadata?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('space-y-3', className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumb items={breadcrumbs} /> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          {eyebrow ? (
            <p className="text-small font-semibold tracking-wide text-brand-600 uppercase">
              {eyebrow}
            </p>
          ) : null}

          <h1 className="font-heading text-h2 font-bold text-ink-900">{title}</h1>

          {description ? <p className="max-w-[42rem] text-ui text-ink-600">{description}</p> : null}

          {metadata ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-small text-ink-500">
              {metadata}
            </div>
          ) : null}
        </div>

        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

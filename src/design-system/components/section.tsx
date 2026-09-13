import type { ReactNode } from 'react';
import { cn } from '@/design-system/cn';

/**
 * Secao de conteudo com titulo proprio (Prompt 04, item 19).
 *
 * Usa `<section aria-labelledby>` ligado ao proprio titulo, entao a secao
 * aparece nomeada na navegacao por regioes do leitor de tela — util em telas
 * longas como a ficha de acesso de um usuario.
 */
export function Section({
  id,
  title,
  description,
  actions,
  children,
  className,
  headingLevel = 2,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <section aria-labelledby={`${id}-title`} className={cn('space-y-3', className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Heading id={`${id}-title`} className="font-heading text-h4 font-semibold text-ink-900">
            {title}
          </Heading>
          {description ? <p className="mt-1 text-ui text-ink-600">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Separador visual. Decorativo, entao oculto para leitor de tela. */
export function Divider({ className }: { className?: string }) {
  return <hr aria-hidden="true" className={cn('border-ink-200', className)} />;
}

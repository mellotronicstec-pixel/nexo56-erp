import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/design-system/cn';

/**
 * Cartao (Prompt 04, item 22).
 *
 * Sombra discreta e uma so borda: o contorno ja separa o conteudo do fundo, e
 * empilhar sombras fortes deixa a tela suja (Prompt 00, item 89).
 *
 * `interactive` apenas prepara o cartao para ser clicavel — quem o usa coloca
 * um link ou botao REAL dentro. Cartao com `onClick` no container nao e
 * alcancavel por teclado.
 */
export function Card({
  className,
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-lg border border-ink-200 bg-white shadow-xs',
        interactive &&
          'transition-shadow duration-(--duration-fast) hover:border-ink-300 hover:shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  headingLevel = 2,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Ajuste quando o cartao vive dentro de uma secao que ja tem h2. */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
      <div className="min-w-0">
        <Heading className="font-heading text-h5 font-semibold text-ink-900">{title}</Heading>
        {description ? <p className="mt-1 text-small text-ink-500">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Rodape de acoes. No celular os botoes empilham, com o principal no topo. */
export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-ink-200 px-5 py-4 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

import type { ReactNode } from 'react';

/**
 * Estado vazio (Prompt 04, item 31).
 *
 * Diferencia "nao ha nada ainda" de "o filtro nao encontrou nada" — quem usa
 * passa o texto certo. Lista vazia sem explicacao parece tela quebrada.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-ink-100 text-ink-400"
        >
          {icon}
        </span>
      ) : (
        <div aria-hidden="true" className="mb-3 size-10 rounded-lg bg-ink-100" />
      )}
      <p className="font-heading text-h5 font-semibold text-ink-800">{title}</p>
      {description ? <p className="mt-1 max-w-md text-ui text-ink-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

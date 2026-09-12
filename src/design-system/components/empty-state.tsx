import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div aria-hidden="true" className="mb-3 size-10 rounded-lg bg-ink-100" />
      <p className="font-heading text-h5 font-semibold text-ink-800">{title}</p>
      {description ? <p className="mt-1 max-w-md text-ui text-ink-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

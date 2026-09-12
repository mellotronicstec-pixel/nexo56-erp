import type { ReactNode } from 'react';
import { Label } from './label';

/**
 * Agrupa rotulo + campo + mensagem de erro com as ligacoes de acessibilidade
 * corretas (`htmlFor`, `aria-describedby`), para que nenhuma tela precise
 * refazer isso a mao.
 */
export function Field({
  id,
  label,
  error,
  hint,
  required,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string; invalid: boolean }) => ReactNode;
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children({ id, 'aria-describedby': describedBy || undefined, invalid: Boolean(error) })}
      {hint ? (
        <p id={`${id}-hint`} className="text-small text-ink-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-small font-medium text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

import { useId, type ReactNode } from 'react';
import { cn } from '@/design-system/cn';
import { Label } from './label';

/**
 * Campo de formulario completo (Prompt 04, itens 18 e 19; item 90).
 *
 * Junta rotulo, dica, controle e erro com as ligacoes corretas:
 *
 *   label[for] -> controle[id]
 *   controle[aria-describedby] -> dica e erro
 *   controle[aria-invalid] quando ha erro
 *
 * O erro aparece JUNTO do campo, em portugues claro, e nunca depende so de
 * cor: vem com texto e com `aria-invalid`, entao quem nao distingue vermelho
 * continua sabendo qual campo recusou.
 */
export function FormField({
  id,
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  /** Opcional: sem ele, um id estavel e gerado. */
  id?: string;
  label: string;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-required'?: boolean;
    invalid: boolean;
  }) => ReactNode;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  const describedBy = [error ? `${fieldId}-error` : null, hint ? `${fieldId}-hint` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={fieldId} required={required}>
        {label}
      </Label>

      {children({
        id: fieldId,
        'aria-describedby': describedBy || undefined,
        'aria-required': required || undefined,
        invalid: Boolean(error),
      })}

      {hint ? (
        <p id={`${fieldId}-hint`} className="text-small text-ink-500">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={`${fieldId}-error`} className="text-small font-medium text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Compatibilidade: `Field` era o nome do Prompt 01 e segue valendo. */
export { FormField as Field };

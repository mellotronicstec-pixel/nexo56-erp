import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/design-system/cn';

/**
 * Escolhas binarias e exclusivas (Prompt 04, item 18).
 *
 * Os tres usam input NATIVO com aparencia customizada por `accent-color` e
 * classes. Nada de `div role="checkbox"` reimplementado: o nativo ja vem com
 * teclado, leitor de tela, formulario e estado indeterminado de graca.
 *
 * O rotulo envolve o controle, entao clicar no texto tambem alterna — alvo de
 * toque adequado sem CSS extra.
 */

interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  hint?: ReactNode;
}

function ChoiceRow({
  control,
  label,
  hint,
  disabled,
}: {
  control: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 text-ui',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      {control}
      <span className="min-w-0">
        <span className="block font-medium text-ink-800">{label}</span>
        {hint ? <span className="mt-0.5 block text-small text-ink-500">{hint}</span> : null}
      </span>
    </label>
  );
}

export const Checkbox = forwardRef<HTMLInputElement, ChoiceProps>(function Checkbox(
  { label, hint, className, disabled, ...props },
  ref,
) {
  return (
    <ChoiceRow
      disabled={disabled}
      label={label}
      hint={hint}
      control={
        <input
          ref={ref}
          type="checkbox"
          disabled={disabled}
          className={cn(
            'mt-0.5 size-4 shrink-0 rounded-xs border-ink-300 accent-brand-500',
            className,
          )}
          {...props}
        />
      }
    />
  );
});

export const Radio = forwardRef<HTMLInputElement, ChoiceProps>(function Radio(
  { label, hint, className, disabled, ...props },
  ref,
) {
  return (
    <ChoiceRow
      disabled={disabled}
      label={label}
      hint={hint}
      control={
        <input
          ref={ref}
          type="radio"
          disabled={disabled}
          className={cn('mt-0.5 size-4 shrink-0 border-ink-300 accent-brand-500', className)}
          {...props}
        />
      }
    />
  );
});

/**
 * Switch — checkbox com `role="switch"`.
 *
 * Usado quando o efeito e IMEDIATO (ligar/desligar algo), enquanto o checkbox
 * pertence a formularios que so valem apos enviar.
 */
export const Switch = forwardRef<HTMLInputElement, ChoiceProps>(function Switch(
  { label, hint, className, disabled, ...props },
  ref,
) {
  return (
    <ChoiceRow
      disabled={disabled}
      label={label}
      hint={hint}
      control={
        <input
          ref={ref}
          type="checkbox"
          role="switch"
          disabled={disabled}
          className={cn('mt-0.5 size-4 shrink-0 rounded-full accent-brand-500', className)}
          {...props}
        />
      }
    />
  );
});

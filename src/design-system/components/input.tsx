import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/design-system/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/** Campo de texto. O rotulo vem sempre do componente Label (acessibilidade). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-md border bg-white px-3 text-ui text-ink-900 shadow-xs transition-colors',
        'placeholder:text-ink-400',
        'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:opacity-55',
        invalid ? 'border-danger-500' : 'border-ink-300 hover:border-ink-400',
        className,
      )}
      {...props}
    />
  );
});

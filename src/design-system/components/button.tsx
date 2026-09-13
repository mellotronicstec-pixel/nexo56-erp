import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/design-system/cn';
import { Spinner } from './spinner';

/**
 * Botao (Prompt 01, item 53; Prompt 04, itens 15 a 17).
 *
 * Inter SemiBold 600, sem caixa alta. Estados cobertos: normal, hover, active,
 * focus visivel, disabled e loading — e `loading` implica `disabled`, entao
 * duplo envio nao acontece por acidente (item 91).
 */

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-500 text-white shadow-xs hover:bg-brand-600 active:bg-brand-700 disabled:hover:bg-brand-500',
  secondary:
    'bg-white text-ink-700 border border-ink-300 shadow-xs hover:bg-ink-50 active:bg-ink-100 disabled:hover:bg-white',
  outline:
    'bg-transparent text-brand-700 border border-brand-300 hover:bg-brand-50 active:bg-brand-100 disabled:hover:bg-transparent',
  ghost: 'bg-transparent text-ink-600 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200',
  /** Vermelho SO para acao destrutiva — nunca decorativo (item 60). */
  destructive:
    'bg-danger-600 text-white shadow-xs hover:bg-danger-700 active:bg-danger-700 disabled:hover:bg-danger-600',
  link: 'bg-transparent text-brand-600 underline-offset-4 hover:underline hover:text-brand-700 px-0',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-small gap-1.5',
  md: 'h-10 px-4 text-ui gap-2',
  lg: 'h-11 px-5 text-body gap-2',
};

/**
 * Classes de botao para elementos que NAO sao `<button>` — um `<Link>`, por
 * exemplo. Navegacao e link; acao e botao. Em vez de copiar as classes em cada
 * pagina (item 129), o estilo sai daqui.
 */
export function linkButtonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(
    'inline-flex items-center justify-center rounded-md font-semibold transition-colors',
    'duration-(--duration-fast)',
    VARIANTS[variant],
    variant === 'link' ? 'h-auto gap-1.5 text-ui' : SIZES[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    className,
    children,
    disabled,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-semibold transition-colors',
        'duration-(--duration-fast)',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANTS[variant],
        variant === 'link' ? 'h-auto gap-1.5 text-ui' : SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </button>
  );
});

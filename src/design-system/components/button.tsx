import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/design-system/cn';
import { Spinner } from './spinner';

/**
 * Botao (Prompt 01, item 53).
 * Inter SemiBold 600 conforme hierarquia tipografica (Prompt 00, item 77).
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 disabled:hover:bg-brand-500 shadow-xs',
  secondary:
    'bg-white text-ink-700 border border-ink-300 hover:bg-ink-50 active:bg-ink-100 disabled:hover:bg-white shadow-xs',
  ghost: 'bg-transparent text-ink-600 hover:bg-ink-100 active:bg-ink-200',
  danger: 'bg-danger-500 text-white hover:bg-danger-700 active:bg-danger-700 shadow-xs',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-small gap-1.5',
  md: 'h-10 px-4 text-ui gap-2',
  lg: 'h-11 px-5 text-body gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
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
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANTS[variant],
        SIZES[size],
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

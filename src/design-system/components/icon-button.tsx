import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/design-system/cn';
import type { ButtonVariant } from './button';

/**
 * Botao apenas com icone (Prompt 04, item 16).
 *
 * `label` e OBRIGATORIO: sem texto visivel, o nome acessivel e a unica forma
 * de alguem usando leitor de tela saber o que o botao faz. Ele vira
 * `aria-label` e tambem `title`, para quem usa mouse ver a dica.
 *
 * Em telas pequenas o alvo tem 44px (item 68); no desktop pode ser compacto.
 */

const VARIANTS: Record<Extract<ButtonVariant, 'secondary' | 'ghost' | 'destructive'>, string> = {
  secondary: 'bg-white text-ink-700 border border-ink-300 shadow-xs hover:bg-ink-50',
  ghost: 'bg-transparent text-ink-600 hover:bg-ink-100 hover:text-ink-900',
  destructive: 'bg-transparent text-danger-600 hover:bg-danger-50',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  variant?: keyof typeof VARIANTS;
  size?: 'sm' | 'md';
  children: React.ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors',
        'duration-(--duration-fast) disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' ? 'size-8' : 'size-10',
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

import type { ReactNode } from 'react';
import { cn } from '@/design-system/cn';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, { box: string; title: string }> = {
  info: { box: 'border-info-500/30 bg-info-50', title: 'text-info-700' },
  success: { box: 'border-success-500/30 bg-success-50', title: 'text-success-700' },
  warning: { box: 'border-warning-500/30 bg-warning-50', title: 'text-warning-700' },
  danger: { box: 'border-danger-500/30 bg-danger-50', title: 'text-danger-700' },
};

/**
 * Mensagem de estado. `role="alert"` apenas para erros, para nao interromper
 * leitores de tela com informacao nao urgente.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-md border px-4 py-3 text-ui', TONES[tone].box, className)}
    >
      {title ? <p className={cn('font-semibold', TONES[tone].title)}>{title}</p> : null}
      {children ? <div className={cn('text-ink-700', title && 'mt-1')}>{children}</div> : null}
    </div>
  );
}

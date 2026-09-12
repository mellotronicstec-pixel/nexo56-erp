import type { ReactNode } from 'react';
import { cn } from '@/design-system/cn';

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700 border-ink-200',
  brand: 'bg-brand-50 text-brand-700 border-brand-200',
  success: 'bg-success-50 text-success-700 border-success-500/30',
  warning: 'bg-warning-50 text-warning-700 border-warning-500/30',
  danger: 'bg-danger-50 text-danger-700 border-danger-500/30',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-small font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

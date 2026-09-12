import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/design-system/cn';

export function Label({
  className,
  children,
  required,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn('block text-ui font-medium text-ink-700', className)} {...props}>
      {children}
      {required ? (
        <span className="text-danger-500" aria-hidden="true">
          {' '}
          *
        </span>
      ) : null}
    </label>
  );
}

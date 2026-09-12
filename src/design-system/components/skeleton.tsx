import { cn } from '@/design-system/cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-ink-200', className)} />
  );
}

import { cn } from '@/design-system/cn';

const SIZES = { sm: 'size-4 border-2', md: 'size-5 border-2', lg: 'size-8 border-[3px]' } as const;

export function Spinner({
  size = 'md',
  label = 'Carregando',
  className,
}: {
  size?: keyof typeof SIZES;
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-t-transparent opacity-70',
        SIZES[size],
        className,
      )}
    />
  );
}

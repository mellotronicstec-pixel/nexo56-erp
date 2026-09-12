import { cn } from '@/design-system/cn';

/** Iniciais do nome; nunca expoe e-mail ou documento na sigla. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full',
        'bg-brand-50 text-small font-semibold text-brand-700',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

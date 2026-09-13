import type { ReactNode } from 'react';
import { cn } from '@/design-system/cn';

/**
 * Cartao de indicador (Prompt 04, item 23).
 *
 * SOMENTE componente visual. Nao calcula, nao busca e nao inventa numero: quem
 * o usa passa um valor real vindo do dominio. Nenhuma tela desta fase exibe
 * KPI, porque nenhum modulo de negocio existe ainda para produzir um.
 *
 * O numero usa Sora, conforme a hierarquia tipografica oficial.
 */
export function MetricCard({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-ink-200 bg-white p-5 shadow-xs', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-ui font-medium text-ink-600">{label}</p>
        {icon ? <span className="text-ink-400">{icon}</span> : null}
      </div>
      <p className="mt-2 font-heading text-h2 font-bold text-ink-900">{value}</p>
      {hint ? <p className="mt-1 text-small text-ink-500">{hint}</p> : null}
    </div>
  );
}

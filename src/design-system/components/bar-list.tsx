import { cn } from '@/design-system/cn';

/**
 * Lista de barras horizontais (Prompt 18, itens 80 a 83 e 138 a 139).
 *
 * DECISAO DE BIBLIOTECA: nenhuma biblioteca de graficos foi adicionada. Uma
 * lista de barras com largura proporcional, feita de `div`s e numero em
 * texto, resolve os graficos deste modulo (distribuicao por status,
 * antiguidade do backlog) sem SVG, sem canvas e sem dependencia nova —
 * "nao desenhar grafico ad hoc quando uma biblioteca pequena e mais segura,
 * mas tambem nao adicionar dependencia gigante para um donut" (item 81).
 *
 * ACESSIBILIDADE NAO E OPCIONAL AQUI (item 82): rotulo e valor sao TEXTO real
 * em cada linha — quem usa leitor de tela ouve exatamente os mesmos numeros
 * de quem ve a barra, e nada depende so de cor.
 */
export interface BarListItem {
  key: string;
  label: string;
  value: number;
  /** Texto formatado do valor. Sem isto, usa `value` cru. */
  formattedValue?: string;
  href?: string;
  tone?: 'brand' | 'neutral';
}

export function BarList({
  items,
  emptyLabel = 'Sem dados.',
  className,
}: {
  items: readonly BarListItem[];
  emptyLabel?: string;
  className?: string;
}) {
  if (items.length === 0) {
    return <p className={cn('text-small text-ink-500', className)}>{emptyLabel}</p>;
  }

  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <ul className={cn('space-y-2', className)}>
      {items.map((item) => {
        const widthPercent = Math.max(2, Math.round((item.value / max) * 100));
        const row = (
          <div className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-small text-ink-600" title={item.label}>
              {item.label}
            </span>
            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-ink-100">
              <span
                className={cn(
                  'block h-full rounded-full',
                  item.tone === 'neutral' ? 'bg-ink-400' : 'bg-brand-600',
                )}
                style={{ width: `${widthPercent}%` }}
              />
            </span>
            <span className="w-12 shrink-0 text-right text-small font-semibold text-ink-900">
              {item.formattedValue ?? item.value}
            </span>
          </div>
        );

        return (
          <li key={item.key}>
            {item.href ? (
              <a
                href={item.href}
                className="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                {row}
              </a>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}

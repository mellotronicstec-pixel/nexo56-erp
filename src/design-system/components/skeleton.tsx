import { cn } from '@/design-system/cn';

/**
 * Esqueleto de carregamento (Prompt 04, item 31).
 *
 * Sempre `aria-hidden`: quem usa leitor de tela nao ganha nada ouvindo
 * "carregando" seis vezes seguidas. O anuncio correto vem de uma unica regiao
 * com `aria-busy` ou do `Spinner`, que tem rotulo.
 *
 * Serve para lista, linha de tabela e cartao — o formato vem das classes de
 * quem usa, entao nao ha um componente por formato.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-ink-200', className)} />
  );
}

/** Bloco pronto para linhas de texto: evita repetir a mesma composicao. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className={cn('h-4', index === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

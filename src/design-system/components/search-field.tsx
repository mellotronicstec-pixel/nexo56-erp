import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/design-system/cn';
import { IconSearch } from '@/design-system/icons';

/**
 * Campo de busca (Prompt 04, item 44).
 *
 * `type="search"` de propriedade: o navegador oferece o botao de limpar e o
 * teclado do celular mostra a tecla "buscar". O rotulo e obrigatorio — quando
 * nao couber visualmente, `labelHidden` o mantem para o leitor de tela.
 *
 * Esta e a PRIMITIVA. A busca global do produto (motor, indice, resultados)
 * NAO existe ainda e nao e simulada aqui.
 */
export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  id: string;
  label: string;
  labelHidden?: boolean;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { id, label, labelHidden = true, className, ...props },
  ref,
) {
  return (
    <div className={cn('w-full', className)}>
      <label
        htmlFor={id}
        className={labelHidden ? 'sr-only' : 'mb-1.5 block text-ui font-medium text-ink-700'}
      >
        {label}
      </label>
      <div className="relative">
        <IconSearch
          size={18}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-400"
        />
        <input
          ref={ref}
          id={id}
          type="search"
          className={cn(
            'h-10 w-full rounded-md border border-ink-300 bg-white pl-10 pr-3 text-ui text-ink-900 shadow-xs',
            'transition-colors duration-(--duration-fast) placeholder:text-ink-400 hover:border-ink-400',
          )}
          {...props}
        />
      </div>
    </div>
  );
});

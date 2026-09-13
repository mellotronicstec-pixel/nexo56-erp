import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cn } from '@/design-system/cn';

/**
 * Tabela administrativa (Prompt 04, itens 20 e 21).
 *
 * REGRA DA RESPONSIVIDADE: no celular a tabela NAO e espremida. Quem usa esta
 * primitiva renderiza `<Table>` para telas medias em diante e uma lista de
 * `<CardList>` abaixo disso — as duas com os MESMOS dados. Comprimir colunas
 * ate o texto quebrar letra a letra e o erro que torna ERP inutilizavel no
 * balcao (Prompt 00, item 66).
 *
 * A tabela ainda ganha um contorno com rolagem horizontal propria: se um dia
 * o conteudo exceder a largura em tablet, quem rola e a tabela, nunca a
 * pagina inteira (item 65).
 */
export function Table({
  caption,
  children,
  className,
}: {
  /** Descricao para leitor de tela. Visualmente oculta. */
  caption: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    /**
     * `relative` nao e enfeite: sem ele, um filho posicionado de forma
     * absoluta — o texto `sr-only` de um rotulo, por exemplo — toma o
     * viewport como bloco de contencao, ESCAPA do recorte da rolagem e
     * empurra a largura da pagina inteira. O sintoma aparece longe da causa:
     * uma barra de rolagem horizontal no documento, em tablet.
     */
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full text-ui', className)}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-ink-200 bg-ink-50 text-left">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-ink-200">{children}</tbody>;
}

export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={className}>{children}</tr>;
}

export function TH({
  children,
  className,
  align = 'left',
  srOnly = false,
  sorted,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & {
  align?: 'left' | 'right';
  /** Cabecalho de coluna de acoes: visualmente vazio, mas nomeado. */
  srOnly?: boolean;
  /** Estado de ordenacao, quando a coluna e ordenavel. */
  sorted?: 'asc' | 'desc' | null;
}) {
  return (
    <th
      scope="col"
      aria-sort={
        sorted === undefined
          ? undefined
          : sorted === 'asc'
            ? 'ascending'
            : sorted === 'desc'
              ? 'descending'
              : 'none'
      }
      className={cn(
        'px-5 py-3 font-medium text-ink-600',
        align === 'right' && 'text-right',
        className,
      )}
      {...props}
    >
      {srOnly ? <span className="sr-only">{children}</span> : children}
    </th>
  );
}

export function TD({
  children,
  className,
  align = 'left',
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' }) {
  return (
    <td
      className={cn('px-5 py-3 text-ink-700', align === 'right' && 'text-right', className)}
      {...props}
    >
      {children}
    </td>
  );
}

/**
 * Lista de cartoes — a face mobile da mesma informacao da tabela.
 *
 * Recebe `label` para descrever a lista a quem usa leitor de tela, ja que ela
 * substitui uma tabela que tinha `caption`.
 */
export function CardList({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul aria-label={label} className={cn('divide-y divide-ink-200', className)}>
      {children}
    </ul>
  );
}

export function CardListItem({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn('px-4 py-3', className)}>{children}</li>;
}

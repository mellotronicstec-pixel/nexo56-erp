import Link from 'next/link';
import { IconChevronRight } from '@/design-system/icons';
import { cn } from '@/design-system/cn';

/**
 * Trilha de navegacao (Prompt 04, item 39).
 *
 * `<nav aria-label>` com lista ordenada: a ordem importa e o leitor de tela
 * anuncia "1 de 3". O ultimo item nao e link e carrega `aria-current="page"`.
 * Os separadores sao `aria-hidden`, senao viram ruido a cada nivel.
 *
 * ALVO DE TOQUE (Prompt 07, item 78): o texto da trilha e pequeno de proposito
 * — ela e orientacao, nao acao principal. Mas o LINK precisa ser tocavel: o
 * `py-1` leva a area clicavel a 26px, acima do minimo de 24px da WCAG 2.2 AA
 * para alvo de ponteiro. Sem isso, no celular a trilha vira decoracao que
 * ninguem consegue usar para voltar.
 */
export interface Crumb {
  label: string;
  /** Ausente = item atual (ultimo da trilha). */
  href?: string;
}

export function Breadcrumb({ items, className }: { items: readonly Crumb[]; className?: string }) {
  return (
    <nav aria-label="Trilha de navegacao" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-small text-ink-500">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className={cn(
                    'inline-flex items-center rounded-xs py-1 hover:text-ink-800 hover:underline',
                    /*
                      O ALVO DE TOQUE VALE PARA A TRILHA TAMBEM. O texto e
                      pequeno de proposito — trilha nao compete com o titulo —
                      mas o dedo nao sabe disso. `min-h` sem `min-w` porque
                      44px de largura num "Agenda" curto deixaria a trilha com
                      buracos entre os itens.
                    */
                    'min-h-[44px] sm:min-h-0',
                  )}
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className="font-medium text-ink-700">
                  {item.label}
                </span>
              )}
              {last ? null : <IconChevronRight size={14} className="text-ink-400" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

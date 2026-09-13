'use client';

import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/design-system/cn';
import { useDismissable } from './use-dismissable';

/**
 * Menu suspenso (Prompt 04, item 26).
 *
 * O gatilho declara `aria-haspopup="menu"` e `aria-expanded`; o painel e um
 * `role="menu"` com itens `role="menuitem"`. Esc fecha e devolve o foco ao
 * gatilho; clicar fora fecha.
 *
 * Nao e um menu de navegacao completo com setas — para uma lista curta de
 * acoes, Tab entre os itens e o comportamento que as pessoas ja esperam.
 */
export function Menu({
  label,
  trigger,
  align = 'right',
  children,
}: {
  /** Nome acessivel do menu. */
  label: string;
  trigger: (props: { open: boolean }) => ReactNode;
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useDismissable({ open, onClose: () => setOpen(false), containerRef, trapFocus: false });

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="flex items-center rounded-md transition-colors duration-(--duration-fast)"
      >
        {trigger({ open })}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          /**
           * Fecha ao escolher um item — MENOS quando o clique foi num
           * formulario. Fechar desmonta o painel, e desmontar no meio do
           * clique aborta o envio antes de ele sair: o botao "Sair" parecia
           * nao fazer nada. Formularios cuidam do proprio fim de vida, porque
           * a acao navega ou recarrega a pagina.
           */
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest('form')) setOpen(false);
          }}
          className={cn(
            'absolute top-full z-300 mt-2 min-w-56 rounded-lg border border-ink-200 bg-white py-1 shadow-md',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Item de menu. Use `as="div"` quando o conteudo ja for um link ou um form. */
export function MenuItem({
  children,
  className,
  tone = 'default',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <div
      role="menuitem"
      className={cn(
        'px-1 py-0.5 text-ui',
        tone === 'danger' ? 'text-danger-700' : 'text-ink-700',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Cabecalho nao interativo dentro do menu (nome, e-mail, contexto). */
export function MenuHeader({ children }: { children: ReactNode }) {
  return <div className="border-b border-ink-200 px-4 py-3">{children}</div>;
}

export function MenuSeparator() {
  return <hr className="my-1 border-ink-200" role="separator" />;
}

/** Estilo comum de linha clicavel dentro do menu. */
export const MENU_ROW =
  'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-ui transition-colors hover:bg-ink-100';

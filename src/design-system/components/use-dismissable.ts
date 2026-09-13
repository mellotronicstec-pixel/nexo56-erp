'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Comportamento compartilhado por modal, gaveta e menu (Prompt 04, itens 24,
 * 25, 26 e 70).
 *
 * - Esc fecha;
 * - clique fora fecha;
 * - o foco entra na camada e nao escapa dela enquanto estiver aberta;
 * - ao fechar, o foco VOLTA para quem abriu — senao a pessoa que navega por
 *   teclado e devolvida ao topo da pagina, perdida.
 *
 * Escrito uma vez aqui em vez de repetido em cada componente: armadilha de
 * foco meio implementada e pior do que nenhuma.
 */
export function useDismissable({
  open,
  onClose,
  containerRef,
  trapFocus = true,
}: {
  open: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  trapFocus?: boolean;
}) {
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = containerRef.current;

    const focusables = () =>
      Array.from(
        container?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null || element === document.activeElement);

    // Foco inicial: o primeiro elemento util da camada, ou ela mesma.
    if (trapFocus) {
      const first = focusables()[0];
      (first ?? container)?.focus?.();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (!trapFocus || event.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) return;

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const onPointerDown = (event: MouseEvent) => {
      if (container && !container.contains(event.target as Node)) onClose();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onPointerDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onPointerDown);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose, containerRef, trapFocus]);
}

'use client';

import { useId, useRef, type ReactNode } from 'react';
import { cn } from '@/design-system/cn';
import { IconClose } from '@/design-system/icons';
import { IconButton } from './icon-button';
import { useDismissable } from './use-dismissable';

/**
 * Gaveta lateral (Prompt 04, item 25).
 *
 * Usada para navegacao no celular, filtros e detalhes contextuais. Mesmas
 * garantias do modal: Esc, clique fora, foco preso e devolvido.
 *
 * `side="left"` para navegacao (onde o menu vive); `side="right"` para filtros
 * e detalhes, ao lado do conteudo que modificam.
 */
export function Drawer({
  open,
  onClose,
  title,
  side = 'left',
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: 'left' | 'right';
  footer?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useDismissable({ open, onClose, containerRef: panelRef });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-300">
      <div className="fixed inset-0 bg-(--overlay-scrim)" aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'fixed inset-y-0 flex w-80 max-w-[85vw] flex-col bg-white shadow-lg',
          side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
          'border-ink-200',
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-ink-200 px-4">
          <h2 id={titleId} className="font-heading text-h6 font-semibold text-ink-900">
            {title}
          </h2>
          <IconButton label="Fechar" onClick={onClose} size="sm">
            <IconClose size={18} />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer ? <div className="border-t border-ink-200 px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

'use client';

import { useId, useRef, type ReactNode } from 'react';
import { cn } from '@/design-system/cn';
import { IconClose } from '@/design-system/icons';
import { IconButton } from './icon-button';
import { useDismissable } from './use-dismissable';

/**
 * Dialogo modal acessivel (Prompt 04, item 24).
 *
 * `role="dialog" aria-modal="true"`, titulo e descricao ligados por
 * `aria-labelledby`/`aria-describedby`, Esc e clique fora fecham, o foco fica
 * preso dentro e volta ao gatilho ao fechar.
 *
 * O corpo rola sozinho quando o conteudo e longo; no celular o dialogo encosta
 * na base da tela, onde o polegar alcanca (item 24).
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useDismissable({ open, onClose, containerRef: panelRef });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-400 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-(--overlay-scrim)" aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[90dvh] w-full flex-col rounded-t-xl bg-white shadow-lg',
          'sm:rounded-xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-2xl',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-heading text-h5 font-semibold text-ink-900">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-small text-ink-500">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Fechar" onClick={onClose} size="sm">
            <IconClose size={18} />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-ui text-ink-700">
          {children}
        </div>

        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-ink-200 px-5 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

'use client';

import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/design-system/cn';

/**
 * Dica curta (Prompt 04, item 111).
 *
 * Aparece no hover E no foco — quem navega por teclado tambem precisa da
 * informacao. O conteudo e ligado por `aria-describedby`, entao a dica e
 * COMPLEMENTO: nunca a unica forma de saber o que o controle faz.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <span aria-describedby={id} className="inline-flex">
        {children}
      </span>

      <span
        id={id}
        role="tooltip"
        hidden={!visible}
        className={cn(
          'pointer-events-none absolute left-1/2 z-300 w-max max-w-64 -translate-x-1/2 rounded-md',
          'bg-ink-900 px-2.5 py-1.5 text-small text-white shadow-md',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        )}
      >
        {content}
      </span>
    </span>
  );
}

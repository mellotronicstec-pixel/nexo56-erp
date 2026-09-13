'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/design-system/cn';
import { IconCheck, IconAlert, IconInfo, IconClose } from '@/design-system/icons';
import { IconButton } from './icon-button';

/**
 * Avisos temporarios (Prompt 04, itens 27 e 28).
 *
 * REGRA: toast NAO pode ser a unica comunicacao de erro critico (item 28). Ele
 * some sozinho e pode passar despercebido. Erro que exige acao continua
 * aparecendo junto do campo ou como `Alert` persistente na tela — o toast, no
 * maximo, complementa.
 *
 * A regiao e `aria-live="polite"`, entao o leitor de tela termina a frase atual
 * antes de anunciar. Erros usam `assertive`, que interrompe.
 */

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface ToastMessage {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

const ToastContext = createContext<((toast: Omit<ToastMessage, 'id'>) => void) | null>(null);

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast precisa estar dentro de <ToastProvider>.');
  return push;
}

const TONES: Record<ToastTone, { box: string; icon: ReactNode }> = {
  success: { box: 'border-success-500/30 bg-success-50', icon: <IconCheck size={18} /> },
  error: { box: 'border-danger-500/30 bg-danger-50', icon: <IconAlert size={18} /> },
  warning: { box: 'border-warning-500/30 bg-warning-50', icon: <IconAlert size={18} /> },
  info: { box: 'border-info-500/30 bg-info-50', icon: <IconInfo size={18} /> },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const push = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = Date.now() + Math.random();
    setMessages((current) => [...current, { ...toast, id }]);
    // Erro permanece ate quem le fechar; os demais somem sozinhos.
    if (toast.tone !== 'error') {
      setTimeout(() => setMessages((current) => current.filter((m) => m.id !== id)), 5000);
    }
  }, []);

  const dismiss = useCallback((id: number) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-500 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-[24rem] items-start gap-3 rounded-lg border px-4 py-3 shadow-md',
              TONES[message.tone].box,
            )}
          >
            <span className="mt-0.5 text-ink-700">{TONES[message.tone].icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-ui font-semibold text-ink-900">{message.title}</p>
              {message.description ? (
                <p className="mt-0.5 text-small text-ink-600">{message.description}</p>
              ) : null}
            </div>
            <IconButton label="Fechar aviso" size="sm" onClick={() => dismiss(message.id)}>
              <IconClose size={16} />
            </IconButton>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';
import { cn } from '@/design-system/cn';
import { IconEye, IconEyeOff } from '@/design-system/icons';

/**
 * Campo de senha com alternancia de visibilidade (Prompt 04, item 18).
 *
 * Mostrar a senha e um recurso de ACESSIBILIDADE: quem digita uma frase longa
 * num teclado de celular precisa conferir o que escreveu. O estado e anunciado
 * por `aria-pressed`, e o campo mantem o foco ao alternar.
 */
export function PasswordInput({
  className,
  invalid = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const [visible, setVisible] = useState(false);
  const hintId = useId();

  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-10 w-full rounded-md border bg-white pl-3 pr-12 text-ui text-ink-900 shadow-xs',
          'transition-colors duration-(--duration-fast) placeholder:text-ink-400',
          'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:opacity-55',
          invalid ? 'border-danger-500' : 'border-ink-300 hover:border-ink-400',
          className,
        )}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-pressed={visible}
        aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        aria-describedby={hintId}
        className={cn(
          'absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md',
          'text-ink-500 transition-colors hover:text-ink-800',
        )}
      >
        {visible ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
      <span id={hintId} className="sr-only">
        A senha fica visivel na tela enquanto este botao estiver ativo.
      </span>
    </div>
  );
}

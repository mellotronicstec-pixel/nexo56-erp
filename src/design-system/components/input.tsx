import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
} from 'react';
import { cn } from '@/design-system/cn';

/**
 * Campos de entrada (Prompt 04, itens 18 e 19).
 *
 * Nenhum deles renderiza rotulo: quem faz isso e o `FormField`, que tambem
 * cria as ligacoes de acessibilidade. Placeholder NUNCA substitui rotulo
 * (item 19) — por isso nao ha prop que sugira o contrario.
 */

/** Base compartilhada por input, textarea e select: uma aparencia so. */
const CONTROL_BASE =
  'w-full rounded-md border bg-white px-3 text-ui text-ink-900 shadow-xs transition-colors ' +
  'duration-(--duration-fast) placeholder:text-ink-400 ' +
  'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:opacity-55 ' +
  'read-only:bg-ink-50';

function borderFor(invalid: boolean) {
  return invalid ? 'border-danger-500' : 'border-ink-300 hover:border-ink-400';
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_BASE, 'h-10', borderFor(invalid), className)}
      {...props}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid = false, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_BASE, 'py-2', borderFor(invalid), className)}
      {...props}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/**
 * Select nativo, de proposito: o do sistema operacional e acessivel, funciona
 * com teclado, com leitor de tela e — no celular — abre o seletor nativo, que
 * e melhor do que qualquer lista custom reimplementada.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid = false, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_BASE, 'h-10 pr-8', borderFor(invalid), className)}
      {...props}
    >
      {children}
    </select>
  );
});

'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/design-system/cn';
import { formatAmount, normalizeAmountInput } from '@/core/money/format';

/**
 * Entrada de dinheiro em pt-BR (Prompt 09, item 90).
 *
 * POR QUE NAO `<input type="number">`
 *
 * No Brasil a pessoa digita virgula como decimal, e `type="number"` a recusa
 * em boa parte dos navegadores — o campo simplesmente nao aceita a tecla, e o
 * atendente conclui que o sistema esta quebrado. Alem disso, `type="number"`
 * traz setas de incremento que nao fazem sentido para preco e, no celular,
 * abre um teclado que varia por fabricante.
 *
 * A ESCOLHA: `type="text"` com `inputMode="decimal"`, que abre o teclado
 * numerico no celular e aceita virgula e ponto.
 *
 * QUEM DECIDE O VALOR E O SERVIDOR. Este componente formata para a pessoa ler
 * e nao impede nada: o que vale e o que o caso de uso normaliza e o `Money`
 * interpreta. Uma mascara agressiva que "conserta" digitacao no cliente cria
 * exatamente a divergencia que esse arranjo evita.
 */
export interface MoneyInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'defaultValue' | 'value'
> {
  /** Valor inicial em decimal tecnico (`"149.90"`), como vem do banco. */
  defaultValue?: string;
  invalid?: boolean;
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { className, invalid = false, defaultValue = '', onBlur, ...props },
  ref,
) {
  /**
   * NAO CONTROLADO de propósito.
   *
   * A primeira versao guardava o texto em estado interno e ainda aceitava
   * `onChange` de quem usa — duas fontes de verdade para o mesmo campo. Como o
   * `{...props}` vinha depois, o `onChange` de fora substituia o de dentro, o
   * estado interno congelava e o campo parava de responder. Sem estado, o DOM
   * e a unica fonte, e o `onChange` de quem usa passa direto.
   */
  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      defaultValue={defaultValue ? formatAmount(defaultValue) : ''}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-md border bg-white px-3 text-ui text-ink-900 shadow-xs',
        'text-right tabular-nums transition-colors duration-(--duration-fast)',
        'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:opacity-55',
        invalid ? 'border-danger-500' : 'border-ink-300 hover:border-ink-400',
        className,
      )}
      {...props}
      onBlur={(event) => {
        /**
         * Reescreve para a forma canonica SO ao sair do campo. Fazer isso a
         * cada tecla moveria o cursor no meio da digitacao — o defeito
         * classico de campo de dinheiro mascarado.
         */
        const normalized = normalizeAmountInput(event.target.value);
        if (normalized !== null) event.target.value = formatAmount(normalized);
        onBlur?.(event);
      }}
    />
  );
});

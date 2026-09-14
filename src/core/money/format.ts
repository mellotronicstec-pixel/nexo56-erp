import { Money } from './money';

/**
 * Apresentacao de dinheiro em pt-BR (Prompt 02 item 21; Prompt 09 itens 89 e 90).
 *
 * POR QUE ISTO E UM MODULO, E NAO UM `Intl.NumberFormat` EM CADA TELA
 *
 * Espalhar `new Intl.NumberFormat('pt-BR', ...)` pelo projeto produz
 * divergencia silenciosa: uma tela mostra "R$ 1.234,56", outra "1234,56", uma
 * terceira esquece os centavos. Pior, cada chamada cria um formatador novo —
 * `Intl.NumberFormat` e caro, e uma lista de 25 orcamentos o instanciaria 25
 * vezes.
 *
 * O `Money` continua sendo a autoridade sobre o VALOR; este arquivo cuida
 * apenas de como ele aparece e de como o que a pessoa digitou vira valor.
 */

const CURRENCY_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DECIMAL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * `Money` -> `"R$ 1.234,56"`.
 *
 * Converte a partir da string decimal do `Money`, nao dos centavos em
 * `Number`: um valor acima de 2^53 centavos perderia precisao no caminho.
 */
export function formatBRL(value: Money | string): string {
  const decimal = typeof value === 'string' ? value : value.toString();
  return CURRENCY_FORMATTER.format(Number(decimal));
}

/** Igual ao anterior, sem o simbolo — para colunas de tabela e campos. */
export function formatAmount(value: Money | string): string {
  const decimal = typeof value === 'string' ? value : value.toString();
  return DECIMAL_FORMATTER.format(Number(decimal));
}

/**
 * `"1.234,56"` (ou `"1234,56"`, ou `"1234.56"`) -> `"1234.56"`.
 *
 * O QUE ESTA FUNCAO RESOLVE: no Brasil a pessoa digita virgula como decimal e
 * ponto como milhar, e o teclado numerico do celular oferece os dois. Mandar
 * isso direto para o backend produziria `Money.parse('1.234,56')` -> erro, ou
 * pior, `1.234` interpretado como um real e vinte e tres.
 *
 * Devolve `null` quando nao ha numero nenhum, para o chamador decidir entre
 * zero e erro. NAO arredonda e NAO valida faixa — quem faz isso e o `Money` e
 * o dominio, no servidor.
 */
export function normalizeAmountInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Mantem digitos, separadores e sinal; descarta "R$", espaco e o resto.
  const cleaned = trimmed.replace(/[^\d.,-]/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;

  const negative = cleaned.startsWith('-');
  const body = cleaned.replace(/-/g, '');

  const lastComma = body.lastIndexOf(',');
  const lastDot = body.lastIndexOf('.');

  let normalized: string;
  if (lastComma === -1 && lastDot === -1) {
    normalized = body;
  } else if (lastComma > lastDot) {
    // Virgula e o decimal: "1.234,56" e "1234,56".
    normalized = body.replace(/\./g, '').replace(',', '.');
  } else {
    /**
     * Ponto e o decimal ("1234.56"), OU e separador de milhar sem decimal
     * ("1.234"). O desempate e o tamanho do ultimo grupo: exatamente tres
     * digitos depois do ultimo ponto significa milhar.
     */
    const afterDot = body.length - lastDot - 1;
    normalized = afterDot === 3 ? body.replace(/\./g, '') : body.replace(/,/g, '');
  }

  if (!/^\d*\.?\d*$/.test(normalized) || !/\d/.test(normalized)) return null;
  return `${negative ? '-' : ''}${normalized}`;
}

/**
 * Quantidade: `"2,5"` -> `"2.5"`. Mesma conversao, sem casas fixas — meia hora
 * de bancada e `0.5`, e tres unidades sao `3`, nao `3,00`.
 */
export function normalizeQuantityInput(raw: string): string | null {
  return normalizeAmountInput(raw);
}

const QUANTITY_FORMATTER = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

/** `"2.5000"` -> `"2,5"`; `"3.0000"` -> `"3"`. */
export function formatQuantity(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? QUANTITY_FORMATTER.format(parsed) : value;
}

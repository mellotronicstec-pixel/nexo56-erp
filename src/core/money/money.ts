/**
 * Dinheiro (Prompt 00 item 45; Prompt 02 itens 19 a 21).
 *
 * POR QUE ESTA ABSTRACAO EXISTE
 *
 * `0.1 + 0.2 === 0.30000000000000004` em ponto flutuante. Em um ERP isso vira
 * centavo errado em orcamento, pagamento e fechamento. O banco ja guarda
 * DECIMAL exato; o risco esta no caminho de volta, quando alguem faz
 * `parseFloat(row.valor)` e soma.
 *
 * REPRESENTACAO INTERNA
 *
 * Inteiro de centavos (`bigint`). Nao ha ponto flutuante em nenhum ponto do
 * ciclo: o DECIMAL do MariaDB chega como string, e convertida para bigint sem
 * passar por `number`, e volta para string ao gravar.
 *
 * ARREDONDAMENTO
 *
 * Half-up (2,345 -> 2,35), a convencao comercial brasileira, aplicado UMA vez
 * no resultado final. Calculos intermediarios usam `DECIMAL(14,4)` no banco e
 * milesimos aqui, para nao acumular erro de arredondamento.
 *
 * FORMATACAO
 *
 * `toString()` devolve valor tecnico (`"1234.56"`), nunca com "R$". Simbolo,
 * separador e idioma pertencem a apresentacao (Prompt 02, item 21).
 */

export type Currency = 'BRL';

const SCALE = 2n;
const SCALE_FACTOR = 100n;

export class Money {
  /** Valor em centavos. Privado de proposito: ninguem manipula o inteiro cru. */
  private readonly cents: bigint;
  readonly currency: Currency;

  private constructor(cents: bigint, currency: Currency) {
    this.cents = cents;
    this.currency = currency;
  }

  static zero(currency: Currency = 'BRL'): Money {
    return new Money(0n, currency);
  }

  /** A partir de centavos inteiros. */
  static fromCents(cents: bigint | number, currency: Currency = 'BRL'): Money {
    if (typeof cents === 'number' && !Number.isInteger(cents)) {
      throw new TypeError('Money.fromCents exige inteiro; use Money.parse para valores decimais.');
    }
    return new Money(BigInt(cents), currency);
  }

  /**
   * A partir de string decimal — o caminho usado para ler DECIMAL do banco.
   *
   * Aceita `"1234.56"`, `"1234"`, `"-12.30"`, `"1234.5678"` (trunca com
   * arredondamento half-up para 2 casas). NAO aceita `number`, justamente para
   * impedir que um float impreciso entre disfarçado.
   */
  static parse(value: string, currency: Currency = 'BRL'): Money {
    const raw = value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(raw)) {
      throw new TypeError(`Valor monetario invalido: ${JSON.stringify(value)}`);
    }

    const negative = raw.startsWith('-');
    const [intPart = '0', fracPart = ''] = raw.replace('-', '').split('.');

    const padded = (fracPart + '000').slice(0, 3);
    const wholeCents = BigInt(intPart) * SCALE_FACTOR + BigInt(padded.slice(0, 2) || '0');
    const thirdDigit = Number(padded[2] ?? '0');

    // half-up na terceira casa
    let cents = wholeCents + (thirdDigit >= 5 ? 1n : 0n);
    if (negative) cents = -cents;

    return new Money(cents, currency);
  }

  /**
   * Converte um valor de um `number` do JavaScript.
   *
   * Existe para entrada de formulario, onde o dado chega como numero. Rejeita
   * valores nao finitos e usa a representacao decimal do numero, nao aritmetica
   * binaria. Nao use para encadear calculos — use os metodos da classe.
   */
  static fromNumber(value: number, currency: Currency = 'BRL'): Money {
    if (!Number.isFinite(value)) throw new TypeError('Valor monetario precisa ser finito.');
    return Money.parse(value.toFixed(4), currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new TypeError(`Nao e possivel operar ${this.currency} com ${other.currency}.`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents + other.cents, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents - other.cents, this.currency);
  }

  /**
   * Multiplica por uma quantidade, que pode ser fracionaria (2,5 metros).
   * A quantidade entra como string decimal para nao reintroduzir float.
   */
  multiply(factor: string | number | bigint): Money {
    const raw = typeof factor === 'bigint' ? factor.toString() : String(factor);
    if (!/^-?\d+(\.\d+)?$/.test(raw.trim())) {
      throw new TypeError(`Fator invalido: ${JSON.stringify(factor)}`);
    }

    const negative = raw.trim().startsWith('-');
    const [intPart = '0', fracPart = ''] = raw.trim().replace('-', '').split('.');
    const scaleDigits = fracPart.length;
    const factorAsInt = BigInt(intPart + fracPart || '0');
    const divisor = 10n ** BigInt(scaleDigits);

    const product = this.cents * factorAsInt;
    const rounded = roundHalfUpDivision(product, divisor);

    return new Money(negative ? -rounded : rounded, this.currency);
  }

  /** Percentual: `applyPercent('10')` devolve 10% do valor. */
  applyPercent(percent: string | number): Money {
    return this.multiply(percent).multiply('0.01');
  }

  negate(): Money {
    return new Money(-this.cents, this.currency);
  }

  abs(): Money {
    return new Money(this.cents < 0n ? -this.cents : this.cents, this.currency);
  }

  isZero(): boolean {
    return this.cents === 0n;
  }

  isNegative(): boolean {
    return this.cents < 0n;
  }

  isPositive(): boolean {
    return this.cents > 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.cents === other.cents;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.cents < other.cents) return -1;
    if (this.cents > other.cents) return 1;
    return 0;
  }

  /** Centavos inteiros — para serializacao tecnica e testes. */
  toCents(): bigint {
    return this.cents;
  }

  /**
   * String decimal com 2 casas, pronta para gravar em `DECIMAL(14,2)`.
   * Sem simbolo de moeda e sem separador de milhar.
   */
  toString(): string {
    const negative = this.cents < 0n;
    const absolute = negative ? -this.cents : this.cents;
    const whole = absolute / SCALE_FACTOR;
    const fraction = (absolute % SCALE_FACTOR).toString().padStart(Number(SCALE), '0');
    return `${negative ? '-' : ''}${whole}.${fraction}`;
  }

  toJSON(): { amount: string; currency: Currency } {
    return { amount: this.toString(), currency: this.currency };
  }
}

/** Divisao inteira com arredondamento half-up, preservando o sinal. */
function roundHalfUpDivision(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Divisao por zero.');
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const quotient = a / b;
  const remainder = a % b;
  const rounded = remainder * 2n >= b ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Soma uma lista com moeda consistente. Lista vazia devolve zero na moeda
 * informada — nao `null`, para nao espalhar checagem de nulo pelo calculo.
 */
export function sumMoney(values: readonly Money[], currency: Currency = 'BRL'): Money {
  return values.reduce((total, value) => total.add(value), Money.zero(currency));
}

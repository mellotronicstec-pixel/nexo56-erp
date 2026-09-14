/**
 * Quantidade exata (Prompt 02 item 22; Prompt 10 itens 16, 132 e 133).
 *
 * POR QUE ESTA CLASSE EXISTE, SE JA EXISTE `Money`
 *
 * Quantidade NAO e dinheiro. Dinheiro tem 2 casas e uma moeda; quantidade tem
 * 4 casas (`DECIMAL(14,4)`) e uma unidade de medida, e 2,5 metros de cabo nao
 * se somam a 3 gramas de pasta termica. Reaproveitar `Money` para saldo
 * obrigaria a arredondar 0,0005 kg para zero e a carregar um `currency` que
 * nao significa nada num estoque.
 *
 * REPRESENTACAO INTERNA
 *
 * Inteiro de decimos de milesimo (`bigint`), escala 10^4 — exatamente a escala
 * da coluna. Nao ha ponto flutuante em ponto nenhum do ciclo: o DECIMAL do
 * MariaDB chega como string, vira bigint sem passar por `number`, e volta para
 * string ao gravar.
 *
 * O SALDO DE ESTOQUE DEPENDE DISSO. `0.1 + 0.2 !== 0.3` em float, e um saldo
 * que erra na quarta casa produz "disponivel -0,0000000001" — o bastante para
 * uma reserva legitima ser recusada sem ninguem entender por que.
 */

const SCALE = 4;
const SCALE_FACTOR = 10_000n;

/** `DECIMAL(14,4)` comporta 10 digitos inteiros. Teto defensivo da classe. */
const MAX_UNITS = 9_999_999_999_9999n;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export class Quantity {
  /** Valor em decimos de milesimo. Privado: ninguem manipula o inteiro cru. */
  private readonly units: bigint;

  private constructor(units: bigint) {
    this.units = units;
  }

  static zero(): Quantity {
    return new Quantity(0n);
  }

  /** A partir do inteiro na escala interna. Para testes e serializacao tecnica. */
  static fromUnits(units: bigint): Quantity {
    return new Quantity(units);
  }

  /**
   * A partir de string decimal — o caminho usado para ler `DECIMAL(14,4)`.
   *
   * NAO aceita `number`, pelo mesmo motivo de `Money.parse`: impedir que um
   * float impreciso entre disfarcado. A quinta casa e arredondada half-up,
   * a convencao ja adotada no projeto.
   */
  static parse(value: string): Quantity {
    const raw = value.trim();
    if (!DECIMAL_PATTERN.test(raw)) {
      throw new TypeError(`Quantidade invalida: ${JSON.stringify(value)}`);
    }

    const negative = raw.startsWith('-');
    const [intPart = '0', fracPart = ''] = raw.replace('-', '').split('.');

    const padded = (fracPart + '00000').slice(0, SCALE + 1);
    const whole = BigInt(intPart) * SCALE_FACTOR + BigInt(padded.slice(0, SCALE) || '0');
    const nextDigit = Number(padded[SCALE] ?? '0');

    let units = whole + (nextDigit >= 5 ? 1n : 0n);
    if (units > MAX_UNITS) {
      throw new RangeError('Quantidade acima do limite suportado.');
    }
    if (negative) units = -units;

    return new Quantity(units);
  }

  add(other: Quantity): Quantity {
    return new Quantity(this.units + other.units);
  }

  subtract(other: Quantity): Quantity {
    return new Quantity(this.units - other.units);
  }

  negate(): Quantity {
    return new Quantity(-this.units);
  }

  abs(): Quantity {
    return new Quantity(this.units < 0n ? -this.units : this.units);
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  isPositive(): boolean {
    return this.units > 0n;
  }

  /** Verdadeiro quando o valor tem casas decimais — 2,5 tem; 3,0000 nao tem. */
  hasFraction(): boolean {
    return this.units % SCALE_FACTOR !== 0n;
  }

  equals(other: Quantity): boolean {
    return this.units === other.units;
  }

  compare(other: Quantity): -1 | 0 | 1 {
    if (this.units < other.units) return -1;
    if (this.units > other.units) return 1;
    return 0;
  }

  toUnits(): bigint {
    return this.units;
  }

  /** String decimal com 4 casas, pronta para gravar em `DECIMAL(14,4)`. */
  toString(): string {
    const negative = this.units < 0n;
    const absolute = negative ? -this.units : this.units;
    const whole = absolute / SCALE_FACTOR;
    const fraction = (absolute % SCALE_FACTOR).toString().padStart(SCALE, '0');
    return `${negative ? '-' : ''}${whole}.${fraction}`;
  }

  toJSON(): string {
    return this.toString();
  }
}

/** Soma uma lista. Lista vazia devolve zero, nao `null`. */
export function sumQuantity(values: readonly Quantity[]): Quantity {
  return values.reduce((total, value) => total.add(value), Quantity.zero());
}

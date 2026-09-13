/**
 * Geradores de CPF e CNPJ para teste (Prompt 05, item 56).
 *
 * Os numeros sao CALCULADOS a partir de uma base arbitraria, em vez de
 * copiados de algum lugar: assim nenhum documento de pessoa ou empresa real
 * entra no repositorio, e ainda assim os digitos verificadores fecham — que e
 * o que o validador precisa exercitar.
 */

export function makeCpf(base = '123456789'): string {
  const digits = base.padStart(9, '0').slice(0, 9).split('').map(Number);

  const check = (source: number[]): number => {
    let sum = 0;
    const length = source.length + 1;
    source.forEach((digit, index) => {
      sum += digit * (length - index);
    });
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const first = check(digits);
  const second = check([...digits, first]);
  return [...digits, first, second].join('');
}

export function makeCnpj(base = '12345678000'): string {
  const digits = base.padStart(12, '0').slice(0, 12).split('').map(Number);

  const check = (source: number[]): number => {
    let weight = source.length - 7;
    let sum = 0;
    for (const digit of source) {
      sum += digit * weight;
      weight -= 1;
      if (weight < 2) weight = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const first = check(digits);
  const second = check([...digits, first]);
  return [...digits, first, second].join('');
}

/** Aplica a pontuacao, para exercitar entrada formatada. */
export function formatCpf(digits: string): string {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function formatCnpj(digits: string): string {
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

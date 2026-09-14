/**
 * CPF e CNPJ.
 *
 * Nasceu no modulo de Clientes (Prompt 05, itens 8 e 9) e subiu para o core
 * quando Fornecedores (Prompt 11) precisou da mesma validacao. Fornecedor nao
 * e cliente: fazer Compras importar do modulo de Clientes criaria uma
 * dependencia que nao existe no negocio.
 *
 * REGRA CENTRAL: o documento e OPCIONAL. Uma assistencia recebe cliente que
 * nao quer informar CPF no primeiro contato, e o sistema nao pode recusar o
 * inicio do relacionamento por isso (item 85).
 *
 * Quando informado, porem, o documento e um identificador FORTE: e validado,
 * normalizado e unico dentro do tenant.
 *
 * Mascara NAO e validacao (item 8): `111.111.111-11` tem a forma certa e e
 * invalido. A verificacao aqui e a dos digitos verificadores.
 */

export const DOCUMENT_TYPES = ['cpf', 'cnpj'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Remove tudo que nao e digito. E a forma como o documento e persistido. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Sequencias de digito repetido (`00000000000`, `11111111111`...).
 *
 * Passam no calculo dos digitos verificadores, entao precisam de recusa
 * explicita — sao o caso classico de "validador que aceita lixo".
 */
function isRepeated(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

export function isValidCpf(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || isRepeated(digits)) return false;

  const check = (length: number): number => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

export function isValidCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 14 || isRepeated(digits)) return false;

  const check = (length: number): number => {
    // Pesos do CNPJ: comecam em 5 (ou 6) e voltam a 9 apos o 2.
    let weight = length - 7;
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * weight;
      weight -= 1;
      if (weight < 2) weight = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return check(12) === Number(digits[12]) && check(13) === Number(digits[13]);
}

export function isValidDocument(type: DocumentType, value: string): boolean {
  return type === 'cpf' ? isValidCpf(value) : isValidCnpj(value);
}

/** Deduz o tipo pelo comprimento. Usado so para MENSAGEM, nunca para o modelo. */
export function inferDocumentType(value: string): DocumentType | null {
  const digits = onlyDigits(value);
  if (digits.length === 11) return 'cpf';
  if (digits.length === 14) return 'cnpj';
  return null;
}

/**
 * Formatacao para exibicao.
 *
 * O documento e mostrado por INTEIRO na tela operacional (item 50): quem
 * atende precisa conferir o CPF com a pessoa na frente, e mascarar por estetica
 * atrapalharia o atendimento sem proteger nada — quem ve a tela ja tem
 * permissao para ver o cadastro.
 */
export function formatDocument(type: DocumentType, digits: string): string {
  const clean = onlyDigits(digits);

  if (type === 'cpf' && clean.length === 11) {
    return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9)}`;
  }
  if (type === 'cnpj' && clean.length === 14) {
    return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-${clean.slice(12)}`;
  }
  return clean;
}

/**
 * Telefone e e-mail.
 *
 * Nasceu no modulo de Clientes (Prompt 05, item 12) e subiu para o core quando
 * Fornecedores (Prompt 11) precisou do mesmo tratamento — o telefone do
 * fornecedor tem exatamente os mesmos problemas do telefone do cliente.
 *
 * DOIS VALORES, PROPOSITOS DIFERENTES
 *
 *   valor de exibicao   -> o que a pessoa digitou, preservado
 *   valor normalizado   -> so digitos, para BUSCAR e COMPARAR
 *
 * Guardar so o formatado tornaria impossivel achar "(11) 98888-7777" digitando
 * "11988887777" no balcao — que e exatamente como quem atende digita.
 *
 * A validacao e DELIBERADAMENTE FROUXA. O Brasil ja teve 8 digitos, hoje tem 9
 * no celular, e existem ramais, 0800 e numeros internacionais. Um validador
 * rigido recusaria numero legitimo, e recusar contato valido no balcao e um
 * defeito pior do que aceitar um numero estranho.
 */

const MIN_DIGITS = 8;
const MAX_DIGITS = 15; // E.164

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidPhone(value: string): boolean {
  const digits = normalizePhone(value);
  return digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS;
}

/**
 * Formatacao brasileira para exibicao.
 *
 * A interface prioriza o Brasil (item 12), mas o DOMINIO nao se limita a ele:
 * numero fora do padrao nacional e devolvido como veio, em vez de ser
 * espremido num formato que nao e o dele.
 */
export function formatPhone(value: string): string {
  const digits = normalizePhone(value);

  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return value.trim();
}

/** E-mail: minusculas e sem espacos nas bordas. Nada alem disso. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Normalizacao de texto para BUSCA e para CODIGOS.
 *
 * Nasceu no modulo de equipamentos (Prompt 06) e subiu para o core quando o
 * Estoque (Prompt 10) precisou das mesmas duas operacoes. A alternativa seria
 * o catalogo de pecas importar do modulo de equipamentos — uma dependencia que
 * nao existe no negocio — ou duplicar as regex, que e como duas telas comecam
 * a discordar sobre o que "o mesmo codigo" significa.
 */

/**
 * Forma de COMPARACAO de um texto livre.
 *
 * O valor exibido e sempre preservado como foi digitado; esta funcao produz
 * apenas a chave de busca. E por isso que "Samsung", "SAMSUNG" e "samsung"
 * deixam de virar tres marcas diferentes no mesmo tenant.
 */
export function normalizeSearchable(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Forma COMPACTA de um codigo: so letras e digitos, em maiuscula.
 *
 * Mais agressiva que a de texto porque codigo impresso vem com hifen, espaco,
 * ponto ou nada, conforme o fabricante e conforme quem digita enxerga. Depois
 * disto, "SN: y1-2345" e "Y12345" se encontram.
 */
export function normalizeCompactCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

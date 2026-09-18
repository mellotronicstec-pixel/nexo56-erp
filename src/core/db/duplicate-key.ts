/**
 * Detecta a violacao de UNIQUE do MySQL/MariaDB.
 *
 * POR QUE NAO OLHAR A MENSAGEM: ela vem em ingles, muda entre versoes do
 * servidor e some quando o driver embrulha o erro. O que nao muda e o par
 * `ER_DUP_ENTRY` / 1062.
 *
 * POR QUE PERCORRER `cause`: Drizzle e mysql2 reembrulham o erro original
 * algumas vezes no caminho de volta da transacao, e o codigo fica numa camada
 * interna. Seis niveis cobrem com folga o encadeamento real e evitam laco
 * infinito num `cause` circular.
 *
 * Esta funcao existia copiada em tres lugares — fila de jobs, abertura de OS e
 * emissao de garantia. Uma copia a mais era a copia em que alguem, um dia,
 * corrigiria so um dos lados.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    const code = (current as { code?: string }).code;
    const errno = (current as { errno?: number }).errno;
    if (code === 'ER_DUP_ENTRY' || errno === 1062) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

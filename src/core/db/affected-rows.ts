/**
 * Linhas afetadas por um `UPDATE`/`DELETE` (Prompt 08, item 11).
 *
 * POR QUE ISTO E UMA FUNCAO E NAO UM ACESSO DIRETO:
 *
 * O driver mysql2 devolve `[ResultSetHeader, FieldPacket[]]`, e o Drizzle
 * repassa esse par. Ler `resultado.affectedRows` (sem o `[0]`) devolve
 * `undefined` em silencio — e `undefined` num compare-and-swap significa
 * "zero linhas", ou seja: a trava de concorrencia passa a recusar TODAS as
 * gravacoes, inclusive as legitimas.
 *
 * O erro nao aparece em typecheck nem em leitura rapida do codigo, entao o
 * acesso mora aqui, num lugar so, testado.
 */
export function affectedRows(result: unknown): number {
  // Forma do mysql2 via Drizzle: [ResultSetHeader, FieldPacket[]].
  if (Array.isArray(result)) {
    const header = result[0] as { affectedRows?: number } | undefined;
    return header?.affectedRows ?? 0;
  }

  // Forma ja desembrulhada, caso o driver mude.
  const direct = result as { affectedRows?: number; rowsAffected?: number } | null;
  return direct?.affectedRows ?? direct?.rowsAffected ?? 0;
}

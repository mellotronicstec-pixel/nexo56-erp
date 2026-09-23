import 'server-only';
import { NotFoundError } from '@/core/errors';

/**
 * A UNICA FORMA DE NEGAR ACESSO NO PORTAL (item 9 e 46).
 *
 * Nao existe "403 — esta OS nao e sua" em lugar nenhum do Portal: o mesmo
 * `NotFoundError` que uma OS inexistente devolve. Qualquer consulta do
 * Portal ja filtra por `tenantId` e `customerId` na clausula WHERE — este
 * helper e so o ultimo passo, para que "achei a linha mas ela era de outro
 * cliente" e "nao achei linha nenhuma" produzam, sempre, a MESMA resposta.
 * Distinguir os dois casos e o que transforma um sistema em oraculo de
 * enumeracao: tentar ids em sequencia e aprender, pela diferenca de erro,
 * quais existem.
 */
export function assertOwned<T>(row: T | null | undefined): T {
  if (!row) throw new NotFoundError('Registro nao encontrado.');
  return row;
}

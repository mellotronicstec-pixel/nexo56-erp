import { describe, expect, it } from 'vitest';
import { affectedRows } from '@/core/db/affected-rows';

/**
 * LEITURA DE LINHAS AFETADAS (Prompt 08, item 11).
 *
 * Este teste existe por causa de um defeito real encontrado na propria etapa:
 * lendo `resultado.affectedRows` sem o `[0]` do par devolvido pelo driver, o
 * valor era `undefined` — e `undefined` tratado como zero faz o
 * compare-and-swap recusar TODAS as gravacoes, inclusive as legitimas. O erro
 * nao aparece em typecheck e some numa leitura rapida, entao fica travado aqui.
 */

describe('afetadas', () => {
  it('le o par [ResultSetHeader, FieldPacket[]] que o mysql2 devolve', () => {
    expect(affectedRows([{ affectedRows: 1 }, []])).toBe(1);
    expect(affectedRows([{ affectedRows: 0 }, []])).toBe(0);
    expect(affectedRows([{ affectedRows: 7 }, []])).toBe(7);
  });

  it('aceita a forma ja desembrulhada, caso o driver mude', () => {
    expect(affectedRows({ affectedRows: 3 })).toBe(3);
    expect(affectedRows({ rowsAffected: 2 })).toBe(2);
  });

  it('o que nao traz contagem vale zero — nunca "provavelmente deu certo"', () => {
    expect(affectedRows(null)).toBe(0);
    expect(affectedRows(undefined)).toBe(0);
    expect(affectedRows([])).toBe(0);
    expect(affectedRows({})).toBe(0);
  });
});

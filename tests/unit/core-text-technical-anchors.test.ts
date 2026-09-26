import { describe, expect, it } from 'vitest';
import { extractTechnicalAnchors } from '@/core/text/technical-anchors';

/**
 * PRIMITIVE COMPARTILHADA DE EXTRACAO DE ANCORAS TECNICAS (correcao de
 * boundary pos-CI #34): nasceu no Nexo56 AI (Prompt 20), subiu para o core
 * quando a Busca de Pecas (Prompt 21) precisou da mesma operacao sem
 * depender de `modules/ai`.
 *
 * Estes testes cobrem SO a extracao pura (raw/normalized). A politica de
 * comparacao origem-vs-saida do AI Gateway (`checkTechnicalAnchors`)
 * continua testada em `tests/unit/ai-technical-anchors.test.ts` — e
 * especifica daquele modulo, nao desta primitive.
 */

describe('extractTechnicalAnchors', () => {
  it('"220V" e "220 V" normalizam para a mesma ancora (apresentacao nao e fato)', () => {
    const semEspaco = extractTechnicalAnchors('A tensao e 220V.');
    const comEspaco = extractTechnicalAnchors('A tensao e 220 V.');
    expect(semEspaco[0]?.normalized).toBe('220v');
    expect(comEspaco.map((a) => a.normalized)).toContain('220v');
  });

  it('preserva o bruto tal como apareceu no texto', () => {
    const [anchor] = extractTechnicalAnchors('Modelo X123 apresenta defeito.');
    expect(anchor?.raw).toBe('X123');
    expect(anchor?.normalized).toBe('x123');
  });

  it('codigo de erro (letra+digitos) e reconhecido como ancora', () => {
    const anchors = extractTechnicalAnchors('Codigo de erro E01 registrado.').map(
      (a) => a.normalized,
    );
    expect(anchors).toContain('e01');
  });

  it('corrente com separador decimal (3,5A) e uma unica ancora', () => {
    const anchors = extractTechnicalAnchors('Corrente medida de 3,5A.').map((a) => a.normalized);
    expect(anchors).toContain('3,5a');
  });

  it('texto sem nenhum digito nao produz ancora nenhuma', () => {
    expect(extractTechnicalAnchors('Equipamento nao liga, sem mais detalhes.')).toEqual([]);
  });

  it('e deterministico: mesma entrada, mesma saida', () => {
    const a = extractTechnicalAnchors('placa ABC-123, 220V');
    const b = extractTechnicalAnchors('placa ABC-123, 220V');
    expect(a).toEqual(b);
  });
});

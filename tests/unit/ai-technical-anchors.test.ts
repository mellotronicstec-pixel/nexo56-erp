import { describe, expect, it } from 'vitest';
import {
  checkTechnicalAnchors,
  extractTechnicalAnchors,
} from '@/modules/ai/domain/technical-anchors';

/**
 * PROTECAO DE SIGNIFICADO TECNICO (Prompt 20, itens 56 a 62, 105 a 107,
 * 166 a 169, 179).
 *
 * Estes sao os testes de seguranca mais importantes do prompt: provam que a
 * troca silenciosa de um dado tecnico e DETECTADA, sempre, independente de o
 * provedor ter obedecido uma instrucao maliciosa ou simplesmente alucinado.
 */

describe('normalizacao (item 58): apresentacao nao e fato', () => {
  it('"220V" e "220 V" normalizam para a mesma ancora', () => {
    const semEspaco = extractTechnicalAnchors('A tensao e 220V.');
    const comEspaco = extractTechnicalAnchors('A tensao e 220 V.');
    expect(semEspaco[0]?.normalized).toBe('220v');
    expect(comEspaco.map((a) => a.normalized)).toContain('220v');
  });
});

describe('item 105: ancoras tecnicas nao podem trocar', () => {
  it('220V nao pode virar 127V', () => {
    const result = checkTechnicalAnchors(
      'Equipamento opera em 220V.',
      'Equipamento opera em 127V.',
      'preserve_anchors',
    );
    expect(result.ok).toBe(false);
    expect(result.newAnchors).toContain('127v');
  });

  it('E01 nao pode virar E02', () => {
    const result = checkTechnicalAnchors(
      'Codigo de erro E01 registrado.',
      'Codigo de erro E02 registrado.',
      'preserve_anchors',
    );
    expect(result.ok).toBe(false);
    expect(result.newAnchors).toContain('e02');
  });

  it('3,5A nao pode virar 5A', () => {
    const result = checkTechnicalAnchors(
      'Corrente medida de 3,5A.',
      'Corrente medida de 5A.',
      'preserve_anchors',
    );
    expect(result.ok).toBe(false);
    expect(result.newAnchors).toContain('5a');
  });

  it('modelo X123 nao pode virar X132', () => {
    const result = checkTechnicalAnchors(
      'Modelo X123 apresenta defeito.',
      'Modelo X132 apresenta defeito.',
      'preserve_anchors',
    );
    expect(result.ok).toBe(false);
    expect(result.newAnchors).toContain('x132');
  });

  it('texto identico, so reescrito de estilo, passa (nenhuma ancora nova, nenhuma perdida)', () => {
    const result = checkTechnicalAnchors(
      'Equipamento com defeito na fonte, tensao 220V, corrente 3,5A.',
      'O equipamento apresenta um defeito na fonte de alimentacao. A tensao registrada e de 220V, com corrente de 3,5A.',
      'preserve_anchors',
    );
    expect(result.ok).toBe(true);
  });
});

describe('item 12/57: RESUMIR pode omitir ancora secundaria, nunca trocar ou inventar', () => {
  it('omitir uma ancora e permitido com preserve_anchors_allow_omission', () => {
    const result = checkTechnicalAnchors(
      'Defeito na fonte, tensao 220V, codigo E01 registrado durante o teste.',
      'Defeito na fonte, tensao 220V.',
      'preserve_anchors_allow_omission',
    );
    expect(result.ok).toBe(true);
    expect(result.droppedAnchors).toHaveLength(0); // dropped nao e reportado nesta policy
  });

  it('mas trocar 220V por 127V continua proibido mesmo com omissao permitida', () => {
    const result = checkTechnicalAnchors(
      'Defeito na fonte, tensao 220V, codigo E01.',
      'Defeito na fonte, tensao 127V.',
      'preserve_anchors_allow_omission',
    );
    expect(result.ok).toBe(false);
    expect(result.newAnchors).toContain('127v');
  });

  it('mesma policy tambem barra ancora completamente NOVA (invencao)', () => {
    const result = checkTechnicalAnchors(
      'Defeito na fonte, sem medicao registrada.',
      'Defeito na fonte, medicao de 12V confirmada.',
      'preserve_anchors_allow_omission',
    );
    expect(result.ok).toBe(false);
    expect(result.newAnchors).toContain('12v');
  });
});

describe('item 57: preserve_anchors exige TODAS as ancoras de volta (RESUMIR nao usa esta policy, mas as 3 de reescrita usam)', () => {
  it('sumir uma ancora sem a task ter licenca para omitir e reprovado', () => {
    const result = checkTechnicalAnchors(
      'Tensao 220V, codigo E01.',
      'Tensao 220V.',
      'preserve_anchors',
    );
    expect(result.ok).toBe(false);
    expect(result.droppedAnchors).toContain('e01');
  });
});

describe('item 61/136: GERAR_PARECER_TECNICO (no_new_technical_facts) nao pode inventar dado ausente do contexto', () => {
  it('parecer que so usa dados do contexto passa', () => {
    const contexto =
      'Equipamento: Televisor\nMarca: Marca X\nModelo: X123\nRelato do cliente: nao liga.';
    const parecer = 'O televisor modelo X123 apresenta nao ligar, conforme relatado.';
    const result = checkTechnicalAnchors(contexto, parecer, 'no_new_technical_facts');
    expect(result.ok).toBe(true);
  });

  it('parecer que inventa um codigo de erro ausente do contexto e reprovado', () => {
    const contexto = 'Equipamento: Televisor\nModelo: X123\nRelato do cliente: nao liga.';
    const parecer = 'O televisor X123 apresenta o codigo de erro E07, nao presente no relato.';
    const result = checkTechnicalAnchors(contexto, parecer, 'no_new_technical_facts');
    expect(result.ok).toBe(false);
    expect(result.newAnchors).toContain('e07');
  });

  it('parecer nao precisa citar TODAS as ancoras do contexto (nao e obrigado a repetir tudo)', () => {
    const contexto =
      'Equipamento: Televisor\nModelo: X123\nRelato do cliente: nao liga, comprado em 05/01/2024.';
    const parecer = 'O televisor modelo X123 nao liga.';
    const result = checkTechnicalAnchors(contexto, parecer, 'no_new_technical_facts');
    expect(result.ok).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_REPORT_MAX,
  INTERNAL_NOTES_MAX,
  SERVICE_ORDER_INITIAL_STATUS,
  SERVICE_ORDER_STATUSES,
  SERVICE_ORDER_STATUS_LABEL,
  TIMELINE_KINDS,
  buildLabelData,
  formatServiceOrderNumber,
  isLabelPrintable,
  labelVoltage,
  normalizeCustomerReport,
  parseServiceOrderNumber,
  statusLabel,
  timelineLabel,
} from '@/modules/service-orders/domain/service-order';

/**
 * DOMINIO DA ORDEM DE SERVICO (Prompt 07, item 122).
 *
 * O que estes testes travam nao e a formatacao bonita: e a fronteira com o
 * Prompt 08 e a honestidade da etiqueta.
 */

describe('numero humano (itens 13, 18 e 19)', () => {
  it('formata com prefixo e zeros a esquerda', () => {
    expect(formatServiceOrderNumber(1)).toBe('OS #000001');
    expect(formatServiceOrderNumber(1234)).toBe('OS #001234');
    expect(formatServiceOrderNumber(1234567)).toBe('OS #1234567');
  });

  it('respeita o prefixo e o padding configurados no tenant', () => {
    expect(formatServiceOrderNumber(42, 'ORD', 4)).toBe('ORD #0042');
    expect(formatServiceOrderNumber(42, '', 4)).toBe('#0042');
  });

  it('le o numero do jeito que a pessoa digita no balcao', () => {
    expect(parseServiceOrderNumber('1234')).toBe(1234);
    expect(parseServiceOrderNumber('OS 1234')).toBe(1234);
    expect(parseServiceOrderNumber('OS #001234')).toBe(1234);
    expect(parseServiceOrderNumber('os#1234')).toBe(1234);
    expect(parseServiceOrderNumber(' 000042 ')).toBe(42);
  });

  it('recusa o que nao e numero de OS', () => {
    expect(parseServiceOrderNumber('')).toBeNull();
    expect(parseServiceOrderNumber('Yamaha')).toBeNull();
    expect(parseServiceOrderNumber('OS #')).toBeNull();
    // Zero nao e numero de OS: a sequencia comeca em 1.
    expect(parseServiceOrderNumber('0')).toBeNull();
  });

  it('formatar e reinterpretar devolve o mesmo numero', () => {
    for (const value of [1, 7, 99, 1000, 987654]) {
      expect(parseServiceOrderNumber(formatServiceOrderNumber(value))).toBe(value);
    }
  });
});

describe('estado inicial (Prompt 07, itens 25 a 27; formalizado no Prompt 08)', () => {
  it('o estado inicial e aguardando parecer tecnico', () => {
    expect(SERVICE_ORDER_INITIAL_STATUS).toBe('awaiting_technical_opinion');
    expect(statusLabel(SERVICE_ORDER_INITIAL_STATUS)).toBe('Aguardando Parecer Tecnico');
  });

  it('estado desconhecido volta como veio, sem inventar rotulo', () => {
    expect(statusLabel('estado_que_nao_existe')).toBe('estado_que_nao_existe');
  });

  it('todo estado declarado tem rotulo em pt-BR', () => {
    for (const status of SERVICE_ORDER_STATUSES) {
      expect(SERVICE_ORDER_STATUS_LABEL[status]).toBeTruthy();
    }
  });

  it('nao ha estado que seja uma ACAO (item 27 do Prompt 07; item 13 do Prompt 08)', () => {
    // A trava continua valendo depois do Prompt 08: "buscar peca" e "informar
    // disponivel" ganharam implementacao como ACAO, nunca como situacao.
    const proibidos = [
      'buscar_peca',
      'enviar_orcamento',
      'informar_disponivel',
      'part_pickup',
      'notify_customer',
    ];
    for (const chave of proibidos) {
      expect((SERVICE_ORDER_STATUS_LABEL as Record<string, string>)[chave]).toBeUndefined();
    }
  });
});

describe('relato do cliente (itens 21 a 23)', () => {
  it('normaliza espacos e quebras de linha sem alterar o conteudo', () => {
    expect(normalizeCustomerReport('  Nao liga.  ')).toBe('Nao liga.');
    expect(normalizeCustomerReport('Linha 1\r\nLinha 2')).toBe('Linha 1\nLinha 2');
  });

  it('preserva o texto do cliente por inteiro', () => {
    const relato = 'Cliente informa que o aparelho desligou sozinho apos a queda de energia.';
    expect(normalizeCustomerReport(relato)).toBe(relato);
  });

  it('o limite do relato e maior que o das observacoes internas', () => {
    // Relato e narrativa do cliente; observacao interna e recado de operacao.
    expect(CUSTOMER_REPORT_MAX).toBeGreaterThan(INTERNAL_NOTES_MAX);
  });
});

describe('etiqueta fisica (itens 81 a 85)', () => {
  const base = { customerName: 'Maria Souza', number: 1024, voltage: 'bivolt' };

  it('monta exatamente os cinco elementos previstos', () => {
    const label = buildLabelData(base);
    expect(Object.keys(label).sort()).toEqual([
      'customerName',
      'number',
      'qrToken',
      'voltage',
      'warranty',
    ]);
  });

  it('traz nome, numero e tensao', () => {
    const label = buildLabelData(base);
    expect(label.customerName).toBe('Maria Souza');
    expect(label.number).toBe('OS #001024');
    expect(label.voltage).toBe('Bivolt');
  });

  it('NAO inventa garantia nem QR — os dois dependem de dominios futuros', () => {
    const label = buildLabelData(base);
    expect(label.warranty).toBeNull();
    expect(label.qrToken).toBeNull();
  });

  it('nao e impri­mivel enquanto faltar o QR', () => {
    // A etiqueta oficial tem cinco elementos. Tres nao sao a etiqueta.
    expect(isLabelPrintable(buildLabelData(base))).toBe(false);
  });

  it('tensao nao aplicavel vira N/A e nao identificada nunca fica em branco', () => {
    expect(labelVoltage('not_applicable')).toBe('N/A');
    expect(labelVoltage('unknown')).toBe('Nao identificada');
    // Valor desconhecido tambem nao vira chute: cai no texto seguro.
    expect(labelVoltage('qualquer-coisa')).toBe('Nao identificada');
  });

  it('cobre todas as tensoes do cadastro', () => {
    expect(labelVoltage('v110')).toBe('110 V');
    expect(labelVoltage('v127')).toBe('127 V');
    expect(labelVoltage('v220')).toBe('220 V');
    expect(labelVoltage('bivolt')).toBe('Bivolt');
  });

  it('nao carrega nenhum dos campos proibidos (item 83)', () => {
    const label = buildLabelData(base) as unknown as Record<string, unknown>;
    for (const proibido of [
      'phone',
      'document',
      'address',
      'defect',
      'accessories',
      'technician',
      'price',
      'brand',
      'model',
      'serial',
      'notes',
    ]) {
      expect(label[proibido]).toBeUndefined();
    }
  });
});

describe('linha do tempo (itens 37 e 38)', () => {
  it('so declara fatos que acontecem de verdade', () => {
    // Cresceu com o Prompt 08 (fatos de workflow), com o Prompt 10 (reserva e
    // consumo de peca) e com o Prompt 13 (vinculo de retorno em garantia e
    // reclassificacao). Cada entrada aqui corresponde a algo que o codigo
    // escreve — nao ha tipo reservado para o futuro.
    expect(Object.values(TIMELINE_KINDS).sort()).toEqual([
      'created',
      'customer_notification_requested',
      'customer_report_updated',
      'details_updated',
      'follow_up_rescheduled',
      'part_consumed',
      'part_pickup_requested',
      'part_reservation_released',
      'part_reserved',
      'status_changed',
      'task_completed',
      'technician_assigned',
      'warranty_reclassified',
      'warranty_return_linked',
    ]);
  });

  it('todo tipo declarado tem rotulo legivel', () => {
    for (const kind of Object.values(TIMELINE_KINDS)) {
      expect(timelineLabel(kind)).not.toBe(kind);
    }
  });

  it('tipo desconhecido volta como veio, sem inventar rotulo', () => {
    expect(timelineLabel('fato_do_prompt_09')).toBe('fato_do_prompt_09');
    expect(timelineLabel(TIMELINE_KINDS.CREATED)).toBe('Ordem de Servico aberta');
  });
});

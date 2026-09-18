import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import {
  CANCEL_RULE,
  FOLLOW_UP_ON_AWAITING_REPAIR_DAYS,
  FOLLOW_UP_ON_CREATION_DAYS,
  REASON_MAX,
  SERVICE_ORDER_INITIAL_STATUS,
  SERVICE_ORDER_STATUSES,
  SERVICE_ORDER_STATUS_LABEL,
  SERVICE_ORDER_STATUS_TONE,
  TASK_KINDS,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  TERMINAL_STATUSES,
  TRANSITIONS,
  explainRefusal,
  findTransition,
  isKnownStatus,
  isTerminal,
  manualTransitionsFrom,
  statusLabel,
  statusTone,
  transitionsFrom,
  followUpPolicyFor,
  type ServiceOrderStatus,
} from '@/modules/service-orders/domain/workflow';

/**
 * MAQUINA DE ESTADOS DA ORDEM DE SERVICO (Prompt 08, itens 104 a 108).
 *
 * O que estes testes travam nao e a lista de estados: e a ideia de que a lista
 * de transicoes VALIDAS e finita, declarada num lugar so, e que tudo que nao
 * esta declarado e proibido. Uma transicao nova so passa a existir editando a
 * matriz — nunca por um `if` novo em alguma pagina.
 */

describe('estados (itens 5 e 6)', () => {
  it('declara os nove estados oficiais, sem inventar nem faltar', () => {
    expect([...SERVICE_ORDER_STATUSES]).toEqual([
      'awaiting_technical_opinion',
      'awaiting_approval',
      'awaiting_repair',
      'awaiting_part',
      'repair_completed',
      'awaiting_delivery_preparation',
      'awaiting_customer_pickup',
      'completed',
      'cancelled',
    ]);
  });

  it('toda OS nasce Aguardando Parecer Tecnico', () => {
    expect(SERVICE_ORDER_INITIAL_STATUS).toBe('awaiting_technical_opinion');
  });

  it('todo estado tem rotulo em pt-BR e tom visual', () => {
    for (const status of SERVICE_ORDER_STATUSES) {
      expect(SERVICE_ORDER_STATUS_LABEL[status]).toBeTruthy();
      expect(SERVICE_ORDER_STATUS_TONE[status]).toBeTruthy();
    }
  });

  it('estado desconhecido nao ganha rotulo nem tom inventado', () => {
    expect(isKnownStatus('em_orcamento')).toBe(false);
    expect(statusLabel('em_orcamento')).toBe('em_orcamento');
    expect(statusTone('em_orcamento')).toBe('neutral');
  });

  it('Reparo Concluido NAO e o fim: e conclusao tecnica (item 57)', () => {
    // Confundir os dois entregaria o aparelho sem limpeza e sem conferencia.
    expect(isTerminal('repair_completed')).toBe(false);
    expect(SERVICE_ORDER_STATUS_LABEL.repair_completed).toBe('Reparo Concluido');
    expect(SERVICE_ORDER_STATUS_LABEL.completed).toBe('Finalizada');
  });
});

describe('terminais (itens 54 e 55)', () => {
  it('finalizada e cancelada sao os unicos terminais', () => {
    expect([...TERMINAL_STATUSES]).toEqual(['completed', 'cancelled']);
  });

  it('de um terminal nao sai transicao nenhuma, nem cancelamento', () => {
    for (const terminal of TERMINAL_STATUSES) {
      expect(transitionsFrom(terminal)).toEqual([]);
      expect(manualTransitionsFrom(terminal)).toEqual([]);
      expect(findTransition(terminal, 'awaiting_repair')).toBeNull();
      expect(findTransition(terminal, 'cancelled')).toBeNull();
    }
  });

  it('a recusa explica que a ordem esta encerrada, em portugues', () => {
    expect(explainRefusal('completed', 'awaiting_repair')).toContain('Finalizada');
    expect(explainRefusal('cancelled', 'awaiting_repair')).toContain('Cancelada');
  });
});

describe('matriz de transicoes (itens 8 e 105)', () => {
  /** A matriz esperada, escrita a mao: o teste falha se alguem inventar um atalho. */
  const esperado: Record<string, string[]> = {
    awaiting_technical_opinion: ['awaiting_repair', 'awaiting_approval'],
    awaiting_approval: ['awaiting_repair'],
    /**
     * `awaiting_technical_opinion` entrou aqui no Prompt 13: e a
     * RECLASSIFICACAO de uma OS de garantia cujo defeito nao estava coberto.
     *
     * Ela e `actionOnly`, entao NAO aparece no seletor generico de status — o
     * teste logo abaixo trava isso. Esta linha existe para que adicionar a
     * regra tenha sido uma decisao escrita, e nao um efeito colateral que
     * passou despercebido.
     */
    awaiting_repair: ['awaiting_part', 'repair_completed', 'awaiting_technical_opinion'],
    awaiting_part: ['awaiting_repair'],
    repair_completed: ['awaiting_delivery_preparation'],
    awaiting_delivery_preparation: ['awaiting_customer_pickup'],
    awaiting_customer_pickup: ['completed'],
    completed: [],
    cancelled: [],
  };

  it('cada estado oferece exatamente os destinos previstos, mais o cancelamento', () => {
    for (const status of SERVICE_ORDER_STATUSES) {
      const destinos = transitionsFrom(status).map((rule) => rule.to);
      const previstos = esperado[status] ?? [];
      const comCancelamento = previstos.length === 0 ? [] : [...previstos, 'cancelled'];
      expect(destinos).toEqual(comCancelamento);
    }
  });

  it('a reclassificacao de garantia NAO aparece no seletor generico de status', () => {
    /**
     * `transitionsFrom` conhece a regra; `manualTransitionsFrom` — que e o que
     * a tela usa para montar o seletor — nao a oferece.
     *
     * Se um dia alguem remover o `actionOnly`, qualquer pessoa com permissao
     * de transicao mandaria uma OS de conserto de volta para parecer tecnico
     * pelo dropdown, sem motivo e sem a permissao propria de reclassificar.
     */
    const manuais = manualTransitionsFrom('awaiting_repair').map((rule) => rule.to);
    expect(manuais).not.toContain('awaiting_technical_opinion');
    expect(manuais).toEqual(['awaiting_part', 'repair_completed', 'cancelled']);

    const regra = findTransition('awaiting_repair', 'awaiting_technical_opinion');
    expect(regra?.actionOnly).toBe(true);
    expect(regra?.requiresReason).toBe(true);
  });

  it('salto de etapa e recusado com explicacao, nao com erro tecnico', () => {
    const proibidas: [ServiceOrderStatus, ServiceOrderStatus][] = [
      ['awaiting_technical_opinion', 'completed'],
      ['awaiting_technical_opinion', 'awaiting_customer_pickup'],
      ['awaiting_approval', 'repair_completed'],
      ['awaiting_repair', 'awaiting_customer_pickup'],
      ['awaiting_part', 'repair_completed'],
      ['repair_completed', 'completed'],
      ['awaiting_customer_pickup', 'awaiting_repair'],
    ];

    for (const [from, to] of proibidas) {
      expect(findTransition(from, to)).toBeNull();
      expect(explainRefusal(from, to)).toContain(SERVICE_ORDER_STATUS_LABEL[from]);
      expect(explainRefusal(from, to)).toContain(SERVICE_ORDER_STATUS_LABEL[to]);
    }
  });

  it('nenhum estado transita para si mesmo', () => {
    for (const status of SERVICE_ORDER_STATUSES) {
      expect(findTransition(status, status)).toBeNull();
      expect(explainRefusal(status, status)).toBeTruthy();
    }
    expect(explainRefusal('awaiting_repair', 'awaiting_repair')).toContain('ja esta');
  });

  it('estado desconhecido nao entra na maquina por nenhum lado', () => {
    expect(findTransition('awaiting_repair', 'aguardando_orcamento')).toBeNull();
    expect(findTransition('aguardando_orcamento', 'awaiting_repair')).toBeNull();
    expect(transitionsFrom('aguardando_orcamento')).toEqual([]);
  });

  it('toda regra da matriz aponta para estados conhecidos e tem rotulo e permissao', () => {
    for (const rule of TRANSITIONS) {
      expect(isKnownStatus(rule.from)).toBe(true);
      expect(isKnownStatus(rule.to)).toBe(true);
      expect(rule.label).toBeTruthy();
      expect(rule.permission).toBeTruthy();
    }
  });
});

describe('acoes nao viram estados (itens 13 e 16)', () => {
  it('Informar Ordem Disponivel nao e oferecida como mudanca generica de situacao', () => {
    const regra = findTransition('awaiting_delivery_preparation', 'awaiting_customer_pickup');
    expect(regra?.actionOnly).toBe(true);

    // O seletor generico nao a oferece: so a acao dedicada chega la.
    const manuais = manualTransitionsFrom('awaiting_delivery_preparation').map((rule) => rule.to);
    expect(manuais).not.toContain('awaiting_customer_pickup');
    // Mas cancelar continua possivel a partir dali.
    expect(manuais).toContain('cancelled');
  });

  it('Buscar Peca nao existe como estado nem como transicao', () => {
    expect(isKnownStatus('part_pickup')).toBe(false);
    for (const rule of TRANSITIONS) {
      expect(rule.to).not.toBe('part_pickup');
    }
  });
});

describe('cancelamento (item 53)', () => {
  it('sai de qualquer estado nao terminal, exige motivo e permissao propria', () => {
    expect(CANCEL_RULE.permission).toBe(PERMISSIONS.SERVICE_ORDERS_CANCEL);
    expect(CANCEL_RULE.requiresReason).toBe(true);

    for (const status of SERVICE_ORDER_STATUSES) {
      const regra = findTransition(status, 'cancelled');
      if (isTerminal(status)) {
        expect(regra).toBeNull();
      } else {
        expect(regra?.requiresReason).toBe(true);
        expect(regra?.permission).toBe(PERMISSIONS.SERVICE_ORDERS_CANCEL);
      }
    }
  });

  it('o motivo tem limite declarado', () => {
    expect(REASON_MAX).toBe(300);
  });
});

describe('permissoes por transicao (itens 50 e 51)', () => {
  it('finalizar exige permissao propria, nao a de transicao comum', () => {
    expect(findTransition('awaiting_customer_pickup', 'completed')?.permission).toBe(
      PERMISSIONS.SERVICE_ORDERS_COMPLETE,
    );
  });

  it('as demais transicoes do fluxo usam a permissao de transicao', () => {
    const fluxo = TRANSITIONS.filter((rule) => rule.to !== 'completed');
    for (const rule of fluxo) {
      expect(rule.permission).toBe(PERMISSIONS.SERVICE_ORDERS_TRANSITION);
    }
  });

  it('transicao NAO e o mesmo que editar a OS', () => {
    // Quem corrige o relato do cliente nao necessariamente move o trabalho.
    const permissoes = new Set(TRANSITIONS.map((rule) => rule.permission));
    expect(permissoes.has(PERMISSIONS.SERVICE_ORDERS_UPDATE)).toBe(false);
  });
});

describe('politica de follow-up (itens 34, 35 e 126)', () => {
  it('abertura agenda +2 dias e liberacao para conserto agenda +3', () => {
    expect(FOLLOW_UP_ON_CREATION_DAYS).toBe(2);
    expect(FOLLOW_UP_ON_AWAITING_REPAIR_DAYS).toBe(3);
    expect(followUpPolicyFor('awaiting_repair')).toEqual({ kind: 'set', days: 3 });
  });

  it('estado terminal encerra o acompanhamento', () => {
    expect(followUpPolicyFor('completed')).toEqual({ kind: 'clear' });
    expect(followUpPolicyFor('cancelled')).toEqual({ kind: 'clear' });
  });

  it('onde nao ha prazo definido, o vigente e MANTIDO — nao se inventa numero', () => {
    for (const status of [
      'awaiting_technical_opinion',
      'awaiting_approval',
      'awaiting_part',
      'repair_completed',
      'awaiting_delivery_preparation',
      'awaiting_customer_pickup',
    ] as ServiceOrderStatus[]) {
      expect(followUpPolicyFor(status)).toEqual({ kind: 'keep' });
    }
  });
});

describe('tarefas de workflow (itens 22, 23 e 30)', () => {
  it('os tipos de tarefa sao acoes operacionais, nao situacoes da OS', () => {
    expect(Object.values(TASK_KINDS).sort()).toEqual(['delivery_preparation', 'part_pickup']);
    for (const kind of Object.values(TASK_KINDS)) {
      expect(isKnownStatus(kind)).toBe(false);
    }
  });

  it('toda situacao de tarefa tem rotulo', () => {
    expect([...TASK_STATUSES]).toEqual(['open', 'done', 'cancelled']);
    for (const status of TASK_STATUSES) {
      expect(TASK_STATUS_LABEL[status]).toBeTruthy();
    }
  });
});

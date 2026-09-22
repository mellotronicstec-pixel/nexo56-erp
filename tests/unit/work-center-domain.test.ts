import { describe, expect, it } from 'vitest';
import {
  ATTENTION_FLAGS,
  ATTENTION_FLAG_LABEL,
  attentionFlagsFor,
  compareWorkCenterItems,
  isActiveWork,
  isAttentionFlag,
  isWorkQueue,
  isWorkView,
  URGENCY_RANK,
  urgencyRankFor,
  WORK_QUEUES,
  WORK_QUEUE_EMPTY,
  WORK_VIEWS,
  workQueueLabel,
  type AttentionFlag,
  type WorkCenterItem,
} from '@/modules/work-center/domain/work-center';
import {
  SERVICE_ORDER_STATUS_LABEL,
  SERVICE_ORDER_STATUSES,
} from '@/modules/service-orders/domain/workflow';

/**
 * O DOMINIO DA CENTRAL, sem banco e sem tela.
 *
 * O foco destes testes e a ORDENACAO. O Prompt 14 teve um defeito real em que
 * um rank de POSICAO foi comparado como se fosse PESO, invertendo a lista
 * inteira — e so um teste de dominio pegou. Aqui a precedencia e provada caso
 * a caso, com empates explicitos.
 */

function item(parcial: Partial<WorkCenterItem>): WorkCenterItem {
  const base: WorkCenterItem = {
    serviceOrderId: 'os-1',
    number: 1,
    status: 'awaiting_repair',
    unitId: 'unit-1',
    unitName: 'Matriz',
    customerName: 'Cliente',
    equipmentSummary: 'Televisor',
    assigneeId: null,
    assigneeName: null,
    followUpAt: null,
    openTaskCount: 0,
    flags: [],
    urgency: URGENCY_RANK.none,
    classification: null,
    openedAt: new Date('2026-09-01T12:00:00.000Z'),
  };

  const combinado = { ...base, ...parcial };
  /** A urgencia e derivada das flags: manter as duas coerentes por construcao. */
  return { ...combinado, urgency: urgencyRankFor(combinado.flags) };
}

describe('as filas sao os estados oficiais, nao um vocabulario paralelo', () => {
  it('toda fila e um estado conhecido do Prompt 08', () => {
    for (const fila of WORK_QUEUES) {
      expect(SERVICE_ORDER_STATUSES as readonly string[]).toContain(fila);
    }
  });

  it('finalizada e cancelada NAO sao filas de trabalho ativo', () => {
    expect(WORK_QUEUES as readonly string[]).not.toContain('completed');
    expect(WORK_QUEUES as readonly string[]).not.toContain('cancelled');
    expect(isActiveWork('completed')).toBe(false);
    expect(isActiveWork('cancelled')).toBe(false);
  });

  it('as sete filas cobrem exatamente os estados nao terminais', () => {
    const naoTerminais = SERVICE_ORDER_STATUSES.filter(
      (s) => s !== 'completed' && s !== 'cancelled',
    );
    expect([...WORK_QUEUES].sort()).toEqual([...naoTerminais].sort());
  });

  it('o rotulo vem do Prompt 08, nao de uma copia', () => {
    for (const fila of WORK_QUEUES) {
      expect(workQueueLabel(fila)).toBe(SERVICE_ORDER_STATUS_LABEL[fila]);
    }
  });

  it('toda fila tem texto de estado vazio proprio e operacional', () => {
    for (const fila of WORK_QUEUES) {
      expect(WORK_QUEUE_EMPTY[fila]).toMatch(/Nenhuma OS/);
      expect(WORK_QUEUE_EMPTY[fila]).toMatch(/unidade/);
    }
  });

  it('recusa fila inventada', () => {
    expect(isWorkQueue('awaiting_part')).toBe(true);
    expect(isWorkQueue('urgente')).toBe(false);
    expect(isWorkQueue('parada')).toBe(false);
    expect(isWorkQueue('na_bancada')).toBe(false);
    expect(isWorkQueue('completed')).toBe(false);
  });
});

describe('flags de atencao sao derivadas dos fatos', () => {
  const hoje = '2026-09-22';

  it('acompanhamento no passado e atraso', () => {
    const flags = attentionFlagsFor(
      { followUpAt: '2026-09-20', hasOverdueTask: false, assigneeId: 'u1' },
      hoje,
    );
    expect(flags).toEqual(['overdue_follow_up']);
  });

  it('acompanhamento hoje NAO e atraso', () => {
    const flags = attentionFlagsFor(
      { followUpAt: hoje, hasOverdueTask: false, assigneeId: 'u1' },
      hoje,
    );
    expect(flags).toEqual(['follow_up_today']);
  });

  it('acompanhamento no futuro nao gera flag nenhuma', () => {
    expect(
      attentionFlagsFor(
        { followUpAt: '2026-10-01', hasOverdueTask: false, assigneeId: 'u1' },
        hoje,
      ),
    ).toEqual([]);
  });

  it('sem acompanhamento e sem tarefa, so a falta de responsavel aparece', () => {
    expect(
      attentionFlagsFor({ followUpAt: null, hasOverdueTask: false, assigneeId: null }, hoje),
    ).toEqual(['unassigned']);
  });

  it('as flags se acumulam quando os fatos se acumulam', () => {
    expect(
      attentionFlagsFor({ followUpAt: '2026-09-01', hasOverdueTask: true, assigneeId: null }, hoje),
    ).toEqual(['overdue_follow_up', 'overdue_task', 'unassigned']);
  });

  it('atrasado e hoje sao mutuamente exclusivos', () => {
    for (const data of ['2026-09-01', hoje, '2026-12-01']) {
      const flags = attentionFlagsFor(
        { followUpAt: data, hasOverdueTask: false, assigneeId: 'u1' },
        hoje,
      );
      const temAmbas = flags.includes('overdue_follow_up') && flags.includes('follow_up_today');
      expect(temAmbas).toBe(false);
    }
  });

  it('toda flag tem rotulo em texto: cor sozinha nao informa', () => {
    for (const flag of ATTENTION_FLAGS) {
      expect(ATTENTION_FLAG_LABEL[flag as AttentionFlag]).toBeTruthy();
    }
    expect(isAttentionFlag('overdue_task')).toBe(true);
    expect(isAttentionFlag('urgentissima')).toBe(false);
  });
});

describe('urgencia: o rank e POSICAO, e zero vem primeiro', () => {
  it('a precedencia declarada e respeitada', () => {
    expect(URGENCY_RANK.overdue_follow_up).toBeLessThan(URGENCY_RANK.overdue_task);
    expect(URGENCY_RANK.overdue_task).toBeLessThan(URGENCY_RANK.follow_up_today);
    expect(URGENCY_RANK.follow_up_today).toBeLessThan(URGENCY_RANK.none);
  });

  it('a flag mais urgente decide o rank quando ha varias', () => {
    expect(urgencyRankFor(['overdue_follow_up', 'overdue_task', 'unassigned'])).toBe(
      URGENCY_RANK.overdue_follow_up,
    );
    expect(urgencyRankFor(['overdue_task', 'unassigned'])).toBe(URGENCY_RANK.overdue_task);
    expect(urgencyRankFor(['follow_up_today', 'unassigned'])).toBe(URGENCY_RANK.follow_up_today);
  });

  it('"sem responsavel" NAO cria urgencia sozinha', () => {
    expect(urgencyRankFor(['unassigned'])).toBe(URGENCY_RANK.none);
    expect(urgencyRankFor([])).toBe(URGENCY_RANK.none);
  });
});

describe('ordenacao: a precedencia inteira, provada caso a caso', () => {
  it('1. urgencia manda: atrasado vem antes de tarefa atrasada, que vem antes de hoje', () => {
    const atrasado = item({ number: 90, flags: ['overdue_follow_up'], followUpAt: '2026-09-20' });
    const tarefa = item({ number: 10, flags: ['overdue_task'] });
    const hoje = item({ number: 20, flags: ['follow_up_today'], followUpAt: '2026-09-22' });
    const calmo = item({ number: 1, flags: [] });

    const ordenado = [calmo, hoje, tarefa, atrasado].sort(compareWorkCenterItems);
    expect(ordenado.map((i) => i.number)).toEqual([90, 10, 20, 1]);
  });

  it('2. mesma urgencia: o acompanhamento mais antigo vem primeiro', () => {
    const antigo = item({ number: 50, flags: ['overdue_follow_up'], followUpAt: '2026-09-01' });
    const recente = item({ number: 2, flags: ['overdue_follow_up'], followUpAt: '2026-09-21' });

    expect([recente, antigo].sort(compareWorkCenterItems).map((i) => i.number)).toEqual([50, 2]);
  });

  it('2b. sem data de referencia vai para o FIM dentro da mesma urgencia', () => {
    const comData = item({ number: 99, flags: ['overdue_task'], followUpAt: '2026-09-10' });
    const semData = item({ number: 1, flags: ['overdue_task'], followUpAt: null });

    expect([semData, comData].sort(compareWorkCenterItems).map((i) => i.number)).toEqual([99, 1]);
  });

  it('3. empate total de urgencia e data: o numero da OS desempata, crescente', () => {
    const a = item({ number: 300, flags: ['overdue_follow_up'], followUpAt: '2026-09-15' });
    const b = item({ number: 42, flags: ['overdue_follow_up'], followUpAt: '2026-09-15' });
    const c = item({ number: 117, flags: ['overdue_follow_up'], followUpAt: '2026-09-15' });

    expect([a, b, c].sort(compareWorkCenterItems).map((i) => i.number)).toEqual([42, 117, 300]);
  });

  it('mesmo estado e mesma data ainda produzem ordem TOTAL', () => {
    const itens = [5, 3, 9, 1].map((number) =>
      item({ number, status: 'awaiting_part', flags: [], followUpAt: null }),
    );
    expect(itens.sort(compareWorkCenterItems).map((i) => i.number)).toEqual([1, 3, 5, 9]);
  });

  it('"sem responsavel" nao altera a ordem: e badge, nao urgencia', () => {
    const comDono = item({ number: 7, flags: [], assigneeId: 'u1' });
    const semDono = item({ number: 8, flags: ['unassigned'], assigneeId: null });

    /** O numero decide, porque a urgencia de ambos e a mesma. */
    expect([semDono, comDono].sort(compareWorkCenterItems).map((i) => i.number)).toEqual([7, 8]);
  });

  it('a ordenacao e DETERMINISTICA: embaralhar a entrada nao muda a saida', () => {
    const itens = [
      item({ number: 11, flags: ['overdue_follow_up'], followUpAt: '2026-09-02' }),
      item({ number: 4, flags: ['overdue_task'], followUpAt: '2026-09-02' }),
      item({ number: 77, flags: [], followUpAt: null }),
      item({ number: 8, flags: ['follow_up_today'], followUpAt: '2026-09-22' }),
      item({ number: 3, flags: ['overdue_follow_up'], followUpAt: '2026-09-02' }),
      item({ number: 55, flags: ['unassigned'], followUpAt: null }),
    ];

    const esperado = [3, 11, 4, 8, 55, 77];

    for (let tentativa = 0; tentativa < 12; tentativa += 1) {
      const embaralhado = [...itens];
      /** Embaralhamento deterministico, sem Math.random. */
      for (let i = embaralhado.length - 1; i > 0; i -= 1) {
        const j = (i * 7 + tentativa * 3) % (i + 1);
        const a = embaralhado[i]!;
        const b = embaralhado[j]!;
        embaralhado[i] = b;
        embaralhado[j] = a;
      }
      expect(embaralhado.sort(compareWorkCenterItems).map((i) => i.number)).toEqual(esperado);
    }
  });

  it('comparar um item consigo mesmo devolve zero', () => {
    const unico = item({ number: 12, flags: ['overdue_task'], followUpAt: '2026-09-05' });
    expect(compareWorkCenterItems(unico, unico)).toBe(0);
  });

  it('a comparacao e antissimetrica', () => {
    const a = item({ number: 1, flags: ['overdue_follow_up'], followUpAt: '2026-09-01' });
    const b = item({ number: 2, flags: ['follow_up_today'], followUpAt: '2026-09-22' });

    expect(Math.sign(compareWorkCenterItems(a, b))).toBe(-Math.sign(compareWorkCenterItems(b, a)));
  });
});

describe('visoes', () => {
  it('sao exatamente duas, e o nome invalido e recusado', () => {
    expect(WORK_VIEWS).toEqual(['mine', 'unit']);
    expect(isWorkView('mine')).toBe(true);
    expect(isWorkView('unit')).toBe(true);
    expect(isWorkView('todas')).toBe(false);
    expect(isWorkView('')).toBe(false);
  });
});

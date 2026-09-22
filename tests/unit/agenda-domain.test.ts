import { describe, expect, it } from 'vitest';
import {
  AGENDA_ITEM_TYPES,
  APPOINTMENT_STATUSES,
  bucketFor,
  canCancel,
  canComplete,
  canEdit,
  compareAgendaItems,
  countOverdue,
  daysLate,
  defaultAgendaRange,
  explainNotOpen,
  groupAgendaByDay,
  isKnownAgendaItemType,
  isKnownTaskStatus,
  isRangeTooWide,
  isTaskOverdue,
  MAX_AGENDA_RANGE_DAYS,
  TASK_BUCKETS,
  TASK_PRIORITIES,
  TASK_PRIORITY_RANK,
  TASK_STATUSES,
  validateAppointmentWhen,
  type AgendaItem,
} from '@/modules/agenda/domain/agenda';

/**
 * O DOMINIO DA AGENDA, sem banco e sem tela.
 *
 * Tudo que estes testes verificam e calculo puro — e por isso pode ser
 * verificado exaustivamente, coisa que um teste de integracao nunca faz.
 */

function item(parcial: Partial<AgendaItem>): AgendaItem {
  return {
    type: 'task',
    id: 'id',
    title: 'Titulo',
    unitId: 'unit',
    assigneeId: null,
    dueDate: null,
    startAt: null,
    endAt: null,
    allDay: false,
    status: 'open',
    priority: null,
    serviceOrderId: null,
    serviceOrderNumber: null,
    customerName: null,
    overdue: false,
    ...parcial,
  };
}

describe('situacoes e transicoes da tarefa', () => {
  it('fala o mesmo vocabulario do Prompt 08: open, done, cancelled', () => {
    expect(TASK_STATUSES).toEqual(['open', 'done', 'cancelled']);
  });

  it('so a tarefa aberta pode ser concluida, cancelada ou editada', () => {
    expect(canComplete('open')).toBe(true);
    expect(canCancel('open')).toBe(true);
    expect(canEdit('open')).toBe(true);

    for (const status of ['done', 'cancelled']) {
      expect(canComplete(status)).toBe(false);
      expect(canCancel(status)).toBe(false);
      expect(canEdit(status)).toBe(false);
    }
  });

  it('explica a recusa em portugues, sem jargao de estado', () => {
    expect(explainNotOpen('done')).toContain('concluida');
    expect(explainNotOpen('cancelled')).toContain('cancelada');
  });

  it('reconhece so as situacoes que existem', () => {
    expect(isKnownTaskStatus('open')).toBe(true);
    expect(isKnownTaskStatus('completed')).toBe(false);
    expect(isKnownTaskStatus('')).toBe(false);
  });
});

describe('atraso e derivado, nunca persistido', () => {
  const fuso = 'America/Sao_Paulo';
  /** 2026-09-22 03:00 UTC = 2026-09-22 00:00 em Sao Paulo. */
  const agora = new Date('2026-09-22T12:00:00.000Z');

  it('tarefa aberta com prazo no passado esta atrasada', () => {
    expect(isTaskOverdue({ status: 'open', dueDate: '2026-09-21' }, fuso, agora)).toBe(true);
  });

  it('tarefa que vence hoje NAO esta atrasada', () => {
    expect(isTaskOverdue({ status: 'open', dueDate: '2026-09-22' }, fuso, agora)).toBe(false);
  });

  it('tarefa encerrada nunca esta atrasada, mesmo com prazo vencido', () => {
    expect(isTaskOverdue({ status: 'done', dueDate: '2026-01-01' }, fuso, agora)).toBe(false);
    expect(isTaskOverdue({ status: 'cancelled', dueDate: '2026-01-01' }, fuso, agora)).toBe(false);
  });

  it('tarefa sem prazo nao atrasa: nao ha do que atrasar', () => {
    expect(isTaskOverdue({ status: 'open', dueDate: null }, fuso, agora)).toBe(false);
  });

  it('conta os dias de atraso para a tela dizer quanto, nao so que sim', () => {
    expect(daysLate('2026-09-20', '2026-09-22')).toBe(2);
    expect(daysLate('2026-09-22', '2026-09-22')).toBe(0);
    /** Prazo no futuro nao produz atraso negativo. */
    expect(daysLate('2026-09-30', '2026-09-22')).toBe(0);
  });

  it('atravessa a virada do mes e do ano', () => {
    expect(daysLate('2026-12-30', '2027-01-02')).toBe(3);
  });
});

describe('baldes de "Minhas tarefas"', () => {
  it('separa vencido, hoje, futuro e sem prazo', () => {
    expect(bucketFor('2026-09-21', '2026-09-22')).toBe('overdue');
    expect(bucketFor('2026-09-22', '2026-09-22')).toBe('today');
    expect(bucketFor('2026-09-23', '2026-09-22')).toBe('upcoming');
    expect(bucketFor(null, '2026-09-22')).toBe('no_due');
  });

  it('todo balde tem rotulo e a lista nao cresceu sem querer', () => {
    expect(TASK_BUCKETS).toEqual(['overdue', 'today', 'upcoming', 'no_due']);
  });
});

describe('prioridade', () => {
  it('o rank e POSICAO na lista: o urgente vem primeiro, entao vale menos', () => {
    expect(TASK_PRIORITIES).toEqual(['low', 'normal', 'high', 'urgent']);
    expect(TASK_PRIORITY_RANK.urgent).toBeLessThan(TASK_PRIORITY_RANK.high);
    expect(TASK_PRIORITY_RANK.high).toBeLessThan(TASK_PRIORITY_RANK.normal);
    expect(TASK_PRIORITY_RANK.normal).toBeLessThan(TASK_PRIORITY_RANK.low);
  });
});

describe('compromisso', () => {
  it('nao tem situacao "realizado" (item 47)', () => {
    expect(APPOINTMENT_STATUSES).toEqual(['scheduled', 'cancelled']);
    expect(APPOINTMENT_STATUSES as readonly string[]).not.toContain('completed');
    expect(APPOINTMENT_STATUSES as readonly string[]).not.toContain('done');
  });

  it('recusa fim antes ou igual ao inicio', () => {
    const inicio = new Date('2026-09-22T14:00:00.000Z');
    expect(
      validateAppointmentWhen({ allDay: false, startAt: inicio, endAt: inicio }),
    ).not.toBeNull();
    expect(
      validateAppointmentWhen({
        allDay: false,
        startAt: inicio,
        endAt: new Date('2026-09-22T13:00:00.000Z'),
      }),
    ).not.toBeNull();
  });

  it('aceita periodo com fim depois do inicio', () => {
    expect(
      validateAppointmentWhen({
        allDay: false,
        startAt: new Date('2026-09-22T14:00:00.000Z'),
        endAt: new Date('2026-09-22T15:00:00.000Z'),
      }),
    ).toBeNull();
  });

  it('dia inteiro de um dia so e valido; de tras para frente nao', () => {
    expect(
      validateAppointmentWhen({ allDay: true, startDate: '2026-09-22', endDate: '2026-09-22' }),
    ).toBeNull();
    expect(
      validateAppointmentWhen({ allDay: true, startDate: '2026-09-22', endDate: '2026-09-21' }),
    ).not.toBeNull();
  });
});

describe('janela da agenda', () => {
  it('a janela padrao comeca hoje e cobre a semana operacional', () => {
    const janela = defaultAgendaRange('2026-09-22');
    expect(janela.from).toBe('2026-09-22');
    expect(janela.to).toBe('2026-09-29');
  });

  it('o teto existe para a agenda nao virar varredura de historico', () => {
    expect(isRangeTooWide('2026-01-01', '2026-02-01')).toBe(false);
    expect(isRangeTooWide('2020-01-01', '2030-01-01')).toBe(true);
  });

  it('exatamente o teto ainda passa; um dia a mais nao', () => {
    const inicio = new Date('2026-01-01T00:00:00.000Z');
    const noTeto = new Date(inicio);
    noTeto.setUTCDate(noTeto.getUTCDate() + MAX_AGENDA_RANGE_DAYS);
    const passando = new Date(noTeto);
    passando.setUTCDate(passando.getUTCDate() + 1);

    expect(isRangeTooWide('2026-01-01', noTeto.toISOString().slice(0, 10))).toBe(false);
    expect(isRangeTooWide('2026-01-01', passando.toISOString().slice(0, 10))).toBe(true);
  });
});

describe('ordem e agrupamento da agenda', () => {
  it('o dia manda; dentro do dia, quem tem hora vem antes', () => {
    const semHora = item({ id: 'a', dueDate: '2026-09-22', title: 'Tarefa' });
    const comHora = item({
      id: 'b',
      type: 'appointment',
      dueDate: '2026-09-22',
      startAt: new Date('2026-09-22T12:00:00.000Z'),
      title: 'Visita',
    });

    expect([semHora, comHora].sort(compareAgendaItems)[0]!.id).toBe('b');
  });

  it('item sem dia vai para o fim, e nao some', () => {
    const comDia = item({ id: 'a', dueDate: '2026-09-25' });
    const semDia = item({ id: 'b', dueDate: null });

    const ordenados = [semDia, comDia].sort(compareAgendaItems);
    expect(ordenados.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('empatando dia e hora, a prioridade desempata', () => {
    const normal = item({ id: 'a', dueDate: '2026-09-22', priority: 'normal' });
    const urgente = item({ id: 'b', dueDate: '2026-09-22', priority: 'urgent' });

    expect([normal, urgente].sort(compareAgendaItems)[0]!.id).toBe('b');
  });

  it('agrupa por dia preservando a ordem e sem grupo vazio', () => {
    const grupos = groupAgendaByDay([
      item({ id: 'c', dueDate: '2026-09-23' }),
      item({ id: 'a', dueDate: '2026-09-22' }),
      item({ id: 'b', dueDate: '2026-09-22' }),
    ]);

    expect(grupos.map((g) => g.date)).toEqual(['2026-09-22', '2026-09-23']);
    expect(grupos[0]!.items).toHaveLength(2);
    expect(grupos.every((g) => g.items.length > 0)).toBe(true);
  });

  it('lista vazia produz nenhum grupo, nao um grupo vazio', () => {
    expect(groupAgendaByDay([])).toEqual([]);
  });

  it('conta os atrasados sem consultar nada', () => {
    expect(
      countOverdue([item({ overdue: true }), item({ overdue: false }), item({ overdue: true })]),
    ).toBe(2);
  });
});

describe('origens do item da agenda', () => {
  it('sao exatamente quatro, e cada uma continua identificavel', () => {
    expect(AGENDA_ITEM_TYPES).toEqual(['task', 'appointment', 'service_order_task', 'follow_up']);
  });

  it('recusa origem inventada', () => {
    expect(isKnownAgendaItemType('task')).toBe(true);
    expect(isKnownAgendaItemType('reminder')).toBe(false);
    expect(isKnownAgendaItemType('automation')).toBe(false);
  });
});

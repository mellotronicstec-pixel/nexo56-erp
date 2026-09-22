import 'server-only';
import { ValidationError } from '@/core/errors';
import {
  completeTask as completeServiceOrderTask,
  rescheduleFollowUp,
} from '@/modules/service-orders/application/service-order-actions';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { isKnownAgendaItemType } from '@/modules/agenda/domain/agenda';
import { completeTask as completeAgendaTask } from './task-service';

/**
 * UMA ACAO, UM DONO (ADR-073).
 *
 * A Agenda mostra quatro origens na mesma lista, e a pessoa clica "concluir"
 * sem saber — nem precisar saber — de qual tabela aquele item veio. Este
 * modulo e o unico lugar que sabe, e o que ele faz com esse conhecimento e
 * DELEGAR.
 *
 * O QUE ELE NAO FAZ, e essa e a razao de existir: ele nao reimplementa a
 * conclusao da tarefa de fluxo. Se a Agenda escrevesse direto em
 * `service_order_tasks`, existiriam duas conclusoes possiveis para a mesma
 * tarefa — a do Prompt 08, com suas regras e seus eventos, e a da Agenda, com
 * as regras que alguem lembrasse de copiar. No dia em que o Prompt 08 mudasse
 * uma regra, a copia continuaria com a antiga, em silencio.
 *
 * Follow-up nao tem "concluir" (item 35): ele nao e trabalho, e um lembrete de
 * olhar. O que se faz com ele e REAGENDAR — e quem reagenda e o Prompt 08.
 */

export type AgendaActionResult =
  { kind: 'task' } | { kind: 'service_order_task'; serviceOrderId: string };

/**
 * Conclui o item da agenda, seja ele de que origem for.
 *
 * `follow_up` e `appointment` nao chegam aqui: a interface nao oferece
 * "concluir" para eles, e se chegarem a resposta e uma recusa explicita, nao
 * um sucesso silencioso que nao concluiu nada.
 */
export async function completeAgendaItem(
  context: TenantContext,
  type: string,
  itemId: string,
  expectedVersion?: number,
): Promise<AgendaActionResult> {
  if (!isKnownAgendaItemType(type)) {
    throw new ValidationError('Tipo de item desconhecido.');
  }

  switch (type) {
    case 'task':
      await completeAgendaTask(context, itemId, expectedVersion);
      return { kind: 'task' };

    case 'service_order_task': {
      /** O dono da regra continua sendo o Prompt 08. */
      const resultado = await completeServiceOrderTask(context, itemId);
      return { kind: 'service_order_task', serviceOrderId: resultado.serviceOrderId };
    }

    case 'follow_up':
      throw new ValidationError(
        'Um acompanhamento nao se conclui: reagende a data ou movimente a Ordem de Servico.',
      );

    default:
      throw new ValidationError(
        'Um compromisso nao se conclui: cancele-o se ele nao vai mais acontecer.',
      );
  }
}

/**
 * Reagenda o proximo ponto de atencao de uma OS a partir da Agenda.
 *
 * Tambem e delegacao pura: a validacao da data, a permissao e o registro na
 * linha do tempo sao os do Prompt 08. A Agenda so oferece o botao.
 */
export async function rescheduleFollowUpFromAgenda(
  context: TenantContext,
  serviceOrderId: string,
  followUpAt: string,
): Promise<void> {
  await rescheduleFollowUp(context, serviceOrderId, { followUpAt });
}

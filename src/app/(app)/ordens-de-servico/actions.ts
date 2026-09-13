'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { requireUnitAuthorization } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  createServiceOrder,
  updateServiceOrder,
} from '@/modules/service-orders/application/service-order-service';
import { EMPTY_SERVICE_ORDER_STATE, type ServiceOrderActionState } from './action-state';
import { assertSameOrigin } from '../actions';

/**
 * Server Actions de Ordens de Servico (Prompt 07, itens 91, 100 e 101).
 *
 * Camada fina de proposito: ela le o formulario, revalida a autorizacao no
 * servidor e chama o service. Nenhuma regra de negocio mora aqui — a mesma
 * regra tem de valer quando a chamada vier da futura API ou do Nexo56 Mobile,
 * e regra escrita dentro da action so vale para esta pagina.
 *
 * A AUTORIZACAO E DE UNIDADE, e nao de tenant (item 63).
 * `requireUnitAuthorization` exige unidade ativa e avalia a permissao DENTRO
 * dela — o que faz valer tanto o papel de nivel tenant quanto o papel
 * concedido so naquela loja. Usar o guard de tenant aqui negaria acesso
 * justamente a quem opera o balcao com um papel de unidade.
 */

async function run(
  operation: string,
  work: () => Promise<ServiceOrderActionState>,
): Promise<ServiceOrderActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      return await work();
    } catch (error) {
      if (!isAppError(error)) {
        // Sem PII no log: operacao e mensagem tecnica, nunca o relato do cliente.
        logger.error('Falha em acao de ordem de servico', {
          module: 'service-orders',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...EMPTY_SERVICE_ORDER_STATE, error: toUserMessage(error) };
    }
  });
}

export async function createServiceOrderAction(
  _previous: ServiceOrderActionState,
  formData: FormData,
): Promise<ServiceOrderActionState> {
  let createdId: string | null = null;

  const result = await run('createServiceOrder', async () => {
    const { context } = await requireUnitAuthorization(
      PERMISSIONS.SERVICE_ORDERS_CREATE,
      FEATURES.CORE_SERVICE_ORDERS,
    );

    const created = await createServiceOrder(context, {
      equipmentId: String(formData.get('equipmentId') ?? ''),
      intakeId: String(formData.get('intakeId') ?? ''),
      customerReport: String(formData.get('customerReport') ?? ''),
      internalNotes: String(formData.get('internalNotes') ?? ''),
      /**
       * A chave vem do formulario e e estavel enquanto ele estiver aberto
       * (itens 32 e 93). Reenviar o mesmo formulario reencontra a OS criada;
       * abrir outro formulario gera outra chave e cria outra OS.
       */
      idempotencyKey: String(formData.get('idempotencyKey') ?? ''),
    });

    createdId = created.serviceOrderId;
    revalidatePath('/ordens-de-servico');
    revalidatePath('/recebimentos');
    return {
      ...EMPTY_SERVICE_ORDER_STATE,
      success: created.reused
        ? 'Esta Ordem de Servico ja havia sido aberta.'
        : 'Ordem de Servico aberta.',
    };
  });

  // `redirect` lanca por design: fica fora do try.
  if (createdId) redirect(`/ordens-de-servico/${createdId}`);
  return result;
}

export async function updateServiceOrderAction(
  _previous: ServiceOrderActionState,
  formData: FormData,
): Promise<ServiceOrderActionState> {
  let updatedId: string | null = null;

  const result = await run('updateServiceOrder', async () => {
    const { context } = await requireUnitAuthorization(
      PERMISSIONS.SERVICE_ORDERS_UPDATE,
      FEATURES.CORE_SERVICE_ORDERS,
    );

    const serviceOrderId = String(formData.get('serviceOrderId') ?? '');
    await updateServiceOrder(context, serviceOrderId, {
      customerReport: String(formData.get('customerReport') ?? ''),
      internalNotes: String(formData.get('internalNotes') ?? ''),
    });

    updatedId = serviceOrderId;
    revalidatePath('/ordens-de-servico');
    revalidatePath(`/ordens-de-servico/${serviceOrderId}`);
    return { ...EMPTY_SERVICE_ORDER_STATE, success: 'Dados de abertura atualizados.' };
  });

  if (updatedId) redirect(`/ordens-de-servico/${updatedId}`);
  return result;
}

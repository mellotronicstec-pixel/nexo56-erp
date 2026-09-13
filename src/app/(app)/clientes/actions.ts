'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { requireAuthorization } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import {
  createCustomer,
  findByDocument,
  setCustomerStatus,
  updateCustomer,
} from '@/modules/customers/application/customer-service';
import { onlyDigits } from '@/modules/customers/domain/document';
import { FEATURES } from '@/modules/features/domain/catalog';
import { EMPTY_CUSTOMER_STATE, type CustomerActionState } from './action-state';
import { assertSameOrigin } from '../actions';

/**
 * Server Actions de Clientes (Prompt 05, item 51).
 *
 * Toda mutacao segue a mesma ordem: origem -> autenticacao/tenant ->
 * permissao -> validacao -> normalizacao -> regra de dominio -> persistencia
 * -> auditoria -> revalidacao. O `requireAuthorization` resolve os tres
 * primeiros passos de uma vez, e nenhum deles depende do cliente.
 */

async function run(
  operation: string,
  work: () => Promise<CustomerActionState>,
): Promise<CustomerActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      return await work();
    } catch (error) {
      if (!isAppError(error)) {
        /**
         * Log sem dado pessoal (item 49): so a operacao e a mensagem do erro.
         * O formulario inteiro NUNCA vai para o log — ele carrega CPF,
         * telefone e e-mail.
         */
        logger.error('Falha em acao de clientes', {
          module: 'customers',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...EMPTY_CUSTOMER_STATE, error: toUserMessage(error) };
    }
  });
}

/** Reconstroi a lista de contatos a partir dos campos repetidos do formulario. */
function readContacts(formData: FormData) {
  const types = formData.getAll('contactType').map(String);
  const values = formData.getAll('contactValue').map(String);
  const labels = formData.getAll('contactLabel').map(String);
  const whatsappFlags = new Set(formData.getAll('contactWhatsapp').map(String));

  return types
    .map((type, index) => ({
      type: type === 'email' ? ('email' as const) : ('phone' as const),
      value: values[index] ?? '',
      label: labels[index] ?? '',
      isWhatsapp: whatsappFlags.has(String(index)),
    }))
    .filter((contact) => contact.value.trim().length > 0);
}

function readInput(formData: FormData) {
  return {
    kind: String(formData.get('kind') ?? 'individual'),
    name: String(formData.get('name') ?? ''),
    tradeName: String(formData.get('tradeName') ?? ''),
    document: String(formData.get('document') ?? ''),
    stateRegistration: String(formData.get('stateRegistration') ?? ''),
    birthDate: String(formData.get('birthDate') ?? ''),
    notes: String(formData.get('notes') ?? ''),
    contacts: readContacts(formData),
    address: {
      zipCode: String(formData.get('zipCode') ?? ''),
      street: String(formData.get('street') ?? ''),
      number: String(formData.get('number') ?? ''),
      complement: String(formData.get('complement') ?? ''),
      district: String(formData.get('district') ?? ''),
      city: String(formData.get('city') ?? ''),
      state: String(formData.get('state') ?? ''),
    },
  };
}

export async function createCustomerAction(
  _previous: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  let createdId: string | null = null;

  const result = await run('createCustomer', async () => {
    const context = await requireAuthorization({
      permission: PERMISSIONS.CUSTOMERS_MANAGE,
      featureKey: FEATURES.CORE_CUSTOMERS,
    });

    const input = readInput(formData);

    /**
     * Documento duplicado: antes de tentar gravar, buscamos o cliente
     * existente para poder OFERECER um atalho ate ele (item 20) em vez de
     * apenas recusar. O bloqueio de verdade continua sendo a restricao UNIQUE
     * do banco, que tambem resolve duas gravacoes simultaneas (item 53).
     */
    if (input.document) {
      const existing = await findByDocument(context, onlyDigits(input.document));
      if (existing) {
        return {
          ...EMPTY_CUSTOMER_STATE,
          error: 'Ja existe um cliente com este documento nesta empresa.',
          duplicate: existing,
        };
      }
    }

    const created = await createCustomer(context, input);
    createdId = created.customerId;
    revalidatePath('/clientes');
    return { ...EMPTY_CUSTOMER_STATE, success: 'Cliente cadastrado.' };
  });

  // `redirect` lanca: fica FORA do try, senao viraria "erro inesperado".
  if (createdId) redirect(`/clientes/${createdId}`);
  return result;
}

export async function updateCustomerAction(
  _previous: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  let updatedId: string | null = null;

  const result = await run('updateCustomer', async () => {
    const context = await requireAuthorization({
      permission: PERMISSIONS.CUSTOMERS_MANAGE,
      featureKey: FEATURES.CORE_CUSTOMERS,
    });

    const customerId = String(formData.get('customerId') ?? '');
    const input = readInput(formData);

    if (input.document) {
      const existing = await findByDocument(context, onlyDigits(input.document), customerId);
      if (existing) {
        return {
          ...EMPTY_CUSTOMER_STATE,
          error: 'Ja existe outro cliente com este documento nesta empresa.',
          duplicate: existing,
        };
      }
    }

    await updateCustomer(context, customerId, input);
    updatedId = customerId;
    revalidatePath('/clientes');
    revalidatePath(`/clientes/${customerId}`);
    return { ...EMPTY_CUSTOMER_STATE, success: 'Cadastro atualizado.' };
  });

  if (updatedId) redirect(`/clientes/${updatedId}`);
  return result;
}

export async function setCustomerStatusAction(
  _previous: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  return run('setCustomerStatus', async () => {
    const context = await requireAuthorization({
      permission: PERMISSIONS.CUSTOMERS_CHANGE_STATUS,
      featureKey: FEATURES.CORE_CUSTOMERS,
    });

    const customerId = String(formData.get('customerId') ?? '');
    const status = String(formData.get('status') ?? '') === 'active' ? 'active' : 'inactive';

    await setCustomerStatus(context, customerId, status);

    revalidatePath('/clientes');
    revalidatePath(`/clientes/${customerId}`);
    return {
      ...EMPTY_CUSTOMER_STATE,
      success: status === 'active' ? 'Cliente reativado.' : 'Cliente inativado.',
    };
  });
}

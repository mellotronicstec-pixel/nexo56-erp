'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { requireAuthorization } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import {
  createEquipment,
  setEquipmentStatus,
  updateEquipment,
} from '@/modules/equipment/application/equipment-service';
import { findSimilarEquipment } from '@/modules/equipment/application/equipment-queries';
import { createIntake } from '@/modules/equipment/application/intake-service';
import { attachMedia, removeMedia } from '@/modules/equipment/application/media-service';
import { equipmentTitle } from '@/modules/equipment/domain/equipment';
import { FEATURES } from '@/modules/features/domain/catalog';
import { EMPTY_EQUIPMENT_STATE, type EquipmentActionState } from './action-state';
import { assertSameOrigin } from '../actions';

/**
 * Server Actions de Equipamentos e Recebimento (Prompt 06, item 72).
 *
 * Toda mutacao revalida autorizacao no servidor. A interface que esconde o
 * botao e conveniencia; a barreira esta aqui.
 */

async function run(
  operation: string,
  work: () => Promise<EquipmentActionState>,
): Promise<EquipmentActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      return await work();
    } catch (error) {
      if (!isAppError(error)) {
        // Sem PII no log: operacao e mensagem tecnica, nunca o formulario.
        logger.error('Falha em acao de equipamentos', {
          module: 'equipment',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...EMPTY_EQUIPMENT_STATE, error: toUserMessage(error) };
    }
  });
}

function readEquipmentInput(formData: FormData) {
  return {
    customerId: String(formData.get('customerId') ?? ''),
    kind: String(formData.get('kind') ?? ''),
    brand: String(formData.get('brand') ?? ''),
    model: String(formData.get('model') ?? ''),
    serial: String(formData.get('serial') ?? ''),
    voltage: String(formData.get('voltage') ?? 'unknown'),
    notes: String(formData.get('notes') ?? ''),
  };
}

export async function createEquipmentAction(
  _previous: EquipmentActionState,
  formData: FormData,
): Promise<EquipmentActionState> {
  let createdId: string | null = null;

  const result = await run('createEquipment', async () => {
    const context = await requireAuthorization({
      permission: PERMISSIONS.EQUIPMENT_MANAGE,
      featureKey: FEATURES.CORE_EQUIPMENT,
    });

    const input = readEquipmentInput(formData);

    /**
     * Possiveis duplicados viram AVISO, nunca bloqueio (item 55): dois
     * aparelhos iguais do mesmo cliente existem, e fabricante reutiliza
     * serial. Quem decide e quem esta atendendo — por isso o aviso so aparece
     * na primeira tentativa, e reenviar confirma.
     */
    if (String(formData.get('confirmarDuplicado') ?? '') !== 'sim') {
      const similar = await findSimilarEquipment(context, {
        customerId: input.customerId,
        serial: input.serial,
        brand: input.brand,
        model: input.model,
      });

      if (similar.length > 0) {
        return {
          ...EMPTY_EQUIPMENT_STATE,
          error: 'Encontramos equipamentos parecidos. Confira antes de cadastrar outro.',
          similar: similar.map((item) => ({
            id: item.id,
            title: equipmentTitle(item),
            customerName: item.customerName,
          })),
        };
      }
    }

    const created = await createEquipment(context, input);
    createdId = created.equipmentId;
    revalidatePath('/equipamentos');
    return { ...EMPTY_EQUIPMENT_STATE, success: 'Equipamento cadastrado.' };
  });

  // `redirect` lanca por design: fica fora do try.
  if (createdId) redirect(`/equipamentos/${createdId}`);
  return result;
}

export async function updateEquipmentAction(
  _previous: EquipmentActionState,
  formData: FormData,
): Promise<EquipmentActionState> {
  let updatedId: string | null = null;

  const result = await run('updateEquipment', async () => {
    const context = await requireAuthorization({
      permission: PERMISSIONS.EQUIPMENT_MANAGE,
      featureKey: FEATURES.CORE_EQUIPMENT,
    });

    const equipmentId = String(formData.get('equipmentId') ?? '');
    await updateEquipment(context, equipmentId, readEquipmentInput(formData));

    updatedId = equipmentId;
    revalidatePath('/equipamentos');
    revalidatePath(`/equipamentos/${equipmentId}`);
    return { ...EMPTY_EQUIPMENT_STATE, success: 'Equipamento atualizado.' };
  });

  if (updatedId) redirect(`/equipamentos/${updatedId}`);
  return result;
}

export async function setEquipmentStatusAction(
  _previous: EquipmentActionState,
  formData: FormData,
): Promise<EquipmentActionState> {
  return run('setEquipmentStatus', async () => {
    const context = await requireAuthorization({
      permission: PERMISSIONS.EQUIPMENT_MANAGE,
      featureKey: FEATURES.CORE_EQUIPMENT,
    });

    const equipmentId = String(formData.get('equipmentId') ?? '');
    const status = String(formData.get('status') ?? '') === 'active' ? 'active' : 'inactive';

    await setEquipmentStatus(context, equipmentId, status);
    revalidatePath(`/equipamentos/${equipmentId}`);
    return {
      ...EMPTY_EQUIPMENT_STATE,
      success: status === 'active' ? 'Equipamento reativado.' : 'Equipamento inativado.',
    };
  });
}

/**
 * Registro do recebimento (item 82).
 *
 * A UNIDADE sai do contexto ativo, dentro do service — nunca do formulario.
 */
export async function createIntakeAction(
  _previous: EquipmentActionState,
  formData: FormData,
): Promise<EquipmentActionState> {
  let equipmentId: string | null = null;

  const result = await run('createIntake', async () => {
    const context = await requireAuthorization({
      permission: PERMISSIONS.EQUIPMENT_INTAKE_CREATE,
      featureKey: FEATURES.CORE_EQUIPMENT_INTAKE,
    });

    const accessories = formData
      .getAll('accessoryLabel')
      .map(String)
      .map((label, index) => ({
        label: label.trim(),
        quantity: Number(formData.getAll('accessoryQuantity')[index] ?? 1),
      }))
      .filter((accessory) => accessory.label.length > 0);

    const conditions = formData
      .getAll('condition')
      .map(String)
      .map((key) => ({ key, note: '' }));

    const target = String(formData.get('equipmentId') ?? '');

    await createIntake(context, {
      equipmentId: target,
      powerCable: String(formData.get('powerCable') ?? 'not_applicable'),
      accessories,
      conditions,
      inspectionNotes: String(formData.get('inspectionNotes') ?? ''),
      notes: String(formData.get('notes') ?? ''),
    });

    equipmentId = target;
    revalidatePath('/recebimentos');
    revalidatePath(`/equipamentos/${target}`);
    return { ...EMPTY_EQUIPMENT_STATE, success: 'Recebimento registrado.' };
  });

  if (equipmentId) redirect(`/equipamentos/${equipmentId}`);
  return result;
}

/**
 * Envio de foto (itens 23, 24 e 29).
 *
 * O arquivo chega como `File` do FormData. A validacao real — assinatura dos
 * bytes, tamanho, tenant — acontece no service, no servidor.
 */
export async function uploadMediaAction(
  _previous: EquipmentActionState,
  formData: FormData,
): Promise<EquipmentActionState> {
  return run('uploadMedia', async () => {
    const context = await requireAuthorization({
      permission: PERMISSIONS.EQUIPMENT_INTAKE_MANAGE_MEDIA,
      featureKey: FEATURES.CORE_EQUIPMENT_INTAKE,
    });

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { ...EMPTY_EQUIPMENT_STATE, error: 'Selecione uma foto para enviar.' };
    }

    const equipmentId = String(formData.get('equipmentId') ?? '');
    const data = Buffer.from(await file.arrayBuffer());

    await attachMedia(context, {
      equipmentId,
      intakeId: String(formData.get('intakeId') ?? '') || null,
      kind: String(formData.get('kind') ?? 'general'),
      caption: String(formData.get('caption') ?? ''),
      data,
      originalName: file.name,
    });

    revalidatePath(`/equipamentos/${equipmentId}`);
    return { ...EMPTY_EQUIPMENT_STATE, success: 'Foto anexada.' };
  });
}

export async function removeMediaAction(
  _previous: EquipmentActionState,
  formData: FormData,
): Promise<EquipmentActionState> {
  return run('removeMedia', async () => {
    const context = await requireAuthorization({
      permission: PERMISSIONS.EQUIPMENT_INTAKE_MANAGE_MEDIA,
      featureKey: FEATURES.CORE_EQUIPMENT_INTAKE,
    });

    await removeMedia(context, String(formData.get('mediaId') ?? ''));
    revalidatePath(`/equipamentos/${String(formData.get('equipmentId') ?? '')}`);
    return { ...EMPTY_EQUIPMENT_STATE, success: 'Foto removida.' };
  });
}

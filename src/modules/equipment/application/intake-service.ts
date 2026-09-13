import 'server-only';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { POWER_CABLE_ANSWERS, isKnownCondition } from '@/modules/equipment/domain/equipment';
import {
  equipment,
  equipmentIntakeAccessories,
  equipmentIntakeConditions,
  equipmentIntakes,
} from '@/modules/equipment/infrastructure/schema';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Recebimento de equipamento (Prompt 06, itens 6, 57 a 60).
 *
 * O RECEBIMENTO E DA UNIDADE. Ele registra um acontecimento com lugar e hora:
 * o aparelho foi entregue naquela loja, naquele dia, para aquela pessoa. A
 * unidade sai do contexto ATIVO — nunca da entrada do formulario —, e fica
 * gravada para sempre: trocar de unidade depois nao reescreve onde o cliente
 * deixou o aparelho.
 *
 * O recebimento NAO tem workflow (item 60). Ele nao e uma Ordem de Servico em
 * miniatura: nao ha "em analise", "aguardando peca" nem "pronto". Esses estados
 * pertencem a OS, e duplicalos aqui criaria duas verdades sobre o mesmo
 * atendimento.
 */

const accessorySchema = z.object({
  label: z.string().trim().min(1).max(120),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
});

const conditionSchema = z.object({
  key: z.string().trim().min(1).max(40),
  note: z.string().trim().max(300).optional().or(z.literal('')),
});

export const intakeInputSchema = z.object({
  equipmentId: z.string().min(1, 'Selecione o equipamento.'),
  powerCable: z.enum(POWER_CABLE_ANSWERS).default('not_applicable'),
  accessories: z.array(accessorySchema).max(30).default([]),
  conditions: z.array(conditionSchema).max(30).default([]),
  inspectionNotes: z.string().trim().max(4000).optional().or(z.literal('')),
  notes: z.string().trim().max(4000).optional().or(z.literal('')),
});

export type IntakeInput = z.infer<typeof intakeInputSchema>;

export async function createIntake(
  context: TenantContext,
  rawInput: unknown,
): Promise<{ intakeId: string }> {
  const parsed = intakeInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  const input = parsed.data;

  /**
   * A unidade vem do CONTEXTO, nunca do formulario (item 67). Sem unidade
   * ativa nao ha onde registrar a entrada — e receber "em lugar nenhum" nao e
   * um estado valido no dominio.
   */
  const unitId = context.activeUnitId;
  if (!unitId) {
    throw new ValidationError(
      'Selecione a unidade onde o equipamento esta sendo recebido antes de continuar.',
    );
  }

  const db = getDb();
  const [target] = await db
    .select({ id: equipment.id, customerId: equipment.customerId })
    .from(equipment)
    .where(and(eq(equipment.tenantId, context.tenantId), eq(equipment.id, input.equipmentId)))
    .limit(1);

  if (!target) throw new NotFoundError('Equipamento nao encontrado.');

  /** Condicoes desconhecidas sao descartadas: o catalogo e a fonte da verdade. */
  const conditions = input.conditions.filter((condition) => isKnownCondition(condition.key));
  const intakeId = newId();
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx.insert(equipmentIntakes).values({
      id: intakeId,
      tenantId: context.tenantId,
      unitId,
      equipmentId: input.equipmentId,
      receivedAt: now,
      receivedBy: context.userId,
      powerCable: input.powerCable,
      inspectionNotes: input.inspectionNotes || null,
      notes: input.notes || null,
      createdBy: context.userId,
      updatedBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    if (input.accessories.length > 0) {
      await tx.insert(equipmentIntakeAccessories).values(
        input.accessories.map((accessory) => ({
          id: newId(),
          intakeId,
          tenantId: context.tenantId,
          label: accessory.label,
          quantity: accessory.quantity,
          createdAt: now,
        })),
      );
    }

    if (conditions.length > 0) {
      await tx.insert(equipmentIntakeConditions).values(
        conditions.map((condition) => ({
          id: newId(),
          intakeId,
          tenantId: context.tenantId,
          conditionKey: condition.key,
          note: condition.note || null,
          createdAt: now,
        })),
      );
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.EQUIPMENT_INTAKE_CREATED,
        entityType: 'equipment_intake',
        entityId: intakeId,
        tenantId: context.tenantId,
        unitId,
        userId: context.userId,
        after: {
          equipmentId: input.equipmentId,
          accessoryCount: input.accessories.length,
          conditionCount: conditions.length,
          powerCable: input.powerCable,
        },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.EQUIPMENT_INTAKE_CREATED,
      tenantId: context.tenantId,
      payload: {
        intakeId,
        equipmentId: input.equipmentId,
        customerId: target.customerId,
        unitId,
        receivedBy: context.userId,
      },
    });
  });

  return { intakeId };
}

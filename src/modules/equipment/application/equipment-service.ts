import 'server-only';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { customers } from '@/modules/customers/infrastructure/schema';
import {
  VOLTAGES,
  normalizeSearchable,
  normalizeSerial,
} from '@/modules/equipment/domain/equipment';
import { equipment } from '@/modules/equipment/infrastructure/schema';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Cadastro de equipamentos (Prompt 06, itens 4, 9, 64 e 65).
 *
 * O `tenant_id` vem sempre do contexto autenticado. O `customer_id` e validado
 * DENTRO do tenant antes de qualquer gravacao — e a FK composta no banco
 * recusa a associacao mesmo que a aplicacao erre.
 */

export const equipmentInputSchema = z.object({
  customerId: z.string().min(1, 'Selecione o cliente.'),
  kind: z.string().trim().min(2, 'Informe o tipo do equipamento.').max(80),
  brand: z.string().trim().max(120).optional().or(z.literal('')),
  model: z.string().trim().max(160).optional().or(z.literal('')),
  /** Opcional de proposito: etiqueta ilegivel e rotina (item 56). */
  serial: z.string().trim().max(120).optional().or(z.literal('')),
  voltage: z.enum(VOLTAGES).default('unknown'),
  notes: z.string().trim().max(4000).optional().or(z.literal('')),
});

export type EquipmentInput = z.infer<typeof equipmentInputSchema>;

function parse(input: unknown): EquipmentInput {
  const parsed = equipmentInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

function derive(input: EquipmentInput) {
  return {
    kindNormalized: normalizeSearchable(input.kind),
    brand: input.brand || null,
    brandNormalized: input.brand ? normalizeSearchable(input.brand) : null,
    model: input.model || null,
    modelNormalized: input.model ? normalizeSearchable(input.model) : null,
    serial: input.serial || null,
    serialNormalized: input.serial ? normalizeSerial(input.serial) : null,
    notes: input.notes || null,
  };
}

/** Confirma que o cliente existe NO TENANT antes de vincular o equipamento. */
async function assertCustomerInTenant(context: TenantContext, customerId: string): Promise<void> {
  const [row] = await getDb()
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.tenantId, context.tenantId), eq(customers.id, customerId)))
    .limit(1);

  // Cliente de outro tenant e cliente inexistente dao a mesma resposta.
  if (!row) throw new NotFoundError('Cliente nao encontrado.');
}

export async function createEquipment(
  context: TenantContext,
  rawInput: unknown,
): Promise<{ equipmentId: string }> {
  const input = parse(rawInput);
  await assertCustomerInTenant(context, input.customerId);

  const derived = derive(input);
  const equipmentId = newId();
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx.insert(equipment).values({
      id: equipmentId,
      tenantId: context.tenantId,
      customerId: input.customerId,
      kind: input.kind,
      kindNormalized: derived.kindNormalized,
      brand: derived.brand,
      brandNormalized: derived.brandNormalized,
      model: derived.model,
      modelNormalized: derived.modelNormalized,
      serial: derived.serial,
      serialNormalized: derived.serialNormalized,
      voltage: input.voltage,
      notes: derived.notes,
      status: 'active',
      // Procedencia do cadastro. Nunca usada como filtro (item 5).
      originUnitId: context.activeUnitId,
      createdBy: context.userId,
      updatedBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.EQUIPMENT_CREATED,
        entityType: 'equipment',
        entityId: equipmentId,
        tenantId: context.tenantId,
        unitId: context.activeUnitId,
        userId: context.userId,
        after: {
          kind: input.kind,
          brand: derived.brand,
          model: derived.model,
          hasSerial: Boolean(derived.serial),
          voltage: input.voltage,
        },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.EQUIPMENT_CREATED,
      tenantId: context.tenantId,
      payload: { equipmentId, customerId: input.customerId, createdBy: context.userId },
    });
  });

  return { equipmentId };
}

/**
 * Correcao do cadastro (item 64).
 *
 * O CLIENTE NAO MUDA POR AQUI (item 65). Transferir o aparelho para outro dono
 * como se fosse edicao comum corromperia o historico: os recebimentos, as
 * fotos e — em breve — as ordens de servico continuariam apontando para o
 * equipamento, mas o dono teria mudado sem rastro. Se um dia essa operacao for
 * necessaria, sera um caso de uso proprio e auditado.
 */
export async function updateEquipment(
  context: TenantContext,
  equipmentId: string,
  rawInput: unknown,
): Promise<void> {
  const input = parse(rawInput);
  const db = getDb();

  const [existing] = await db
    .select()
    .from(equipment)
    .where(and(eq(equipment.tenantId, context.tenantId), eq(equipment.id, equipmentId)))
    .limit(1);

  if (!existing) throw new NotFoundError('Equipamento nao encontrado.');

  if (existing.customerId !== input.customerId) {
    throw new ValidationError(
      'Nao e possivel transferir o equipamento para outro cliente por aqui. O historico ficaria inconsistente.',
    );
  }

  const derived = derive(input);
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx
      .update(equipment)
      .set({
        kind: input.kind,
        kindNormalized: derived.kindNormalized,
        brand: derived.brand,
        brandNormalized: derived.brandNormalized,
        model: derived.model,
        modelNormalized: derived.modelNormalized,
        serial: derived.serial,
        serialNormalized: derived.serialNormalized,
        voltage: input.voltage,
        notes: derived.notes,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(and(eq(equipment.tenantId, context.tenantId), eq(equipment.id, equipmentId)));

    await recordAudit(
      {
        action: AUDIT_ACTIONS.EQUIPMENT_UPDATED,
        entityType: 'equipment',
        entityId: equipmentId,
        tenantId: context.tenantId,
        userId: context.userId,
        before: {
          kind: existing.kind,
          brand: existing.brand,
          model: existing.model,
          hasSerial: Boolean(existing.serial),
          voltage: existing.voltage,
        },
        after: {
          kind: input.kind,
          brand: derived.brand,
          model: derived.model,
          hasSerial: Boolean(derived.serial),
          voltage: input.voltage,
        },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.EQUIPMENT_UPDATED,
      tenantId: context.tenantId,
      payload: { equipmentId, updatedBy: context.userId },
    });
  });
}

export async function setEquipmentStatus(
  context: TenantContext,
  equipmentId: string,
  status: 'active' | 'inactive',
): Promise<void> {
  const db = getDb();

  const [existing] = await db
    .select({ id: equipment.id, status: equipment.status })
    .from(equipment)
    .where(and(eq(equipment.tenantId, context.tenantId), eq(equipment.id, equipmentId)))
    .limit(1);

  if (!existing) throw new NotFoundError('Equipamento nao encontrado.');
  if (existing.status === status) return;

  await runInTransaction(async (tx) => {
    await tx
      .update(equipment)
      .set({ status, updatedBy: context.userId, updatedAt: new Date() })
      .where(and(eq(equipment.tenantId, context.tenantId), eq(equipment.id, equipmentId)));

    await recordAudit(
      {
        action: AUDIT_ACTIONS.EQUIPMENT_UPDATED,
        entityType: 'equipment',
        entityId: equipmentId,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { status: existing.status },
        after: { status },
      },
      tx,
    );
  });
}

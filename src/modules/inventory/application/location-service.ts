import 'server-only';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  LOCATION_CODE_MAX,
  LOCATION_DESCRIPTION_MAX,
  LOCATION_NAME_MAX,
  LOCATION_STATUSES,
  normalizeLocationCode,
} from '@/modules/inventory/domain/inventory';
import { stockLocations } from '@/modules/inventory/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Localizacoes fisicas do estoque (Prompt 10, itens 8, 9 e 10).
 *
 * LOCALIZACAO E DA UNIDADE, e a autorizacao passa `unitId` justamente por
 * isso: quem administra as prateleiras da loja do centro nao administra as da
 * loja do bairro so por estar no mesmo tenant.
 *
 * Nao ha tipo, nao ha hierarquia e nao ha enum de "prateleira/gaveta/bancada":
 * a loja nomeia o proprio espaco (item 8). Uma arvore de localizacoes seria
 * arquitetura para um problema que uma assistencia tecnica nao tem.
 */

const locationInputSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da localizacao.').max(LOCATION_NAME_MAX),
  code: z.string().trim().max(LOCATION_CODE_MAX).optional(),
  description: z.string().trim().max(LOCATION_DESCRIPTION_MAX).optional(),
});

function parseInput(rawInput: unknown) {
  const parsed = locationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

function assertUnitAuthorized(context: TenantContext, unitId: string): void {
  if (!context.authorizedUnitIds.includes(unitId)) {
    throw new NotFoundError('Unidade nao encontrada.');
  }
}

export async function loadLocation(context: TenantContext, locationId: string) {
  const [row] = await getDb()
    .select()
    .from(stockLocations)
    .where(and(eq(stockLocations.tenantId, context.tenantId), eq(stockLocations.id, locationId)))
    .limit(1);

  if (!row) throw new NotFoundError('Localizacao nao encontrada.');
  assertUnitAuthorized(context, row.unitId);
  return row;
}

async function assertCodeAvailable(
  unitId: string,
  codeNormalized: string | null,
  exceptId?: string,
): Promise<void> {
  if (!codeNormalized) return;

  const conditions = [
    eq(stockLocations.unitId, unitId),
    eq(stockLocations.codeNormalized, codeNormalized),
  ];
  if (exceptId) conditions.push(ne(stockLocations.id, exceptId));

  const [existing] = await getDb()
    .select({ code: stockLocations.code })
    .from(stockLocations)
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    throw new ConflictError(`Ja existe uma localizacao com o codigo ${existing.code}.`);
  }
}

export async function createLocation(
  context: TenantContext,
  unitId: string,
  rawInput: unknown,
): Promise<string> {
  assertUnitAuthorized(context, unitId);
  await authorize(context, {
    permission: PERMISSIONS.INVENTORY_LOCATIONS_MANAGE,
    featureKey: FEATURES.OPERATIONS_INVENTORY,
    unitId,
  });

  const input = parseInput(rawInput);
  const codeNormalized = input.code ? normalizeLocationCode(input.code) : null;
  await assertCodeAvailable(unitId, codeNormalized);

  const locationId = newId();
  const now = new Date();

  await runInTransaction(async (tx) => {
    await tx.insert(stockLocations).values({
      id: locationId,
      tenantId: context.tenantId,
      unitId,
      name: input.name,
      code: input.code || null,
      codeNormalized,
      description: input.description || null,
      status: 'active',
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.STOCK_LOCATION_CREATED,
        entityType: 'stock_location',
        entityId: locationId,
        tenantId: context.tenantId,
        unitId,
        userId: context.userId,
        after: { name: input.name, code: input.code ?? null },
      },
      tx,
    );
  });

  return locationId;
}

export async function updateLocation(
  context: TenantContext,
  locationId: string,
  rawInput: unknown,
  status?: (typeof LOCATION_STATUSES)[number],
): Promise<void> {
  const current = await loadLocation(context, locationId);
  await authorize(context, {
    permission: PERMISSIONS.INVENTORY_LOCATIONS_MANAGE,
    featureKey: FEATURES.OPERATIONS_INVENTORY,
    unitId: current.unitId,
  });

  const input = parseInput(rawInput);
  const codeNormalized = input.code ? normalizeLocationCode(input.code) : null;
  await assertCodeAvailable(current.unitId, codeNormalized, locationId);

  const now = new Date();

  await runInTransaction(async (tx) => {
    const result = await tx
      .update(stockLocations)
      .set({
        name: input.name,
        code: input.code || null,
        codeNormalized,
        description: input.description || null,
        status: status ?? current.status,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(and(eq(stockLocations.tenantId, context.tenantId), eq(stockLocations.id, locationId)));

    if (affectedRows(result) === 0) {
      throw new NotFoundError('Localizacao nao encontrada.');
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.STOCK_LOCATION_UPDATED,
        entityType: 'stock_location',
        entityId: locationId,
        tenantId: context.tenantId,
        unitId: current.unitId,
        userId: context.userId,
        before: { name: current.name, status: current.status },
        after: { name: input.name, status: status ?? current.status },
      },
      tx,
    );
  });
}

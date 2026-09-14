import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction, type EmitFn, type TransactionExecutor } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { Quantity } from '@/core/quantity/quantity';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import { parts } from '@/modules/inventory/infrastructure/schema';
import {
  NEED_JUSTIFICATION_MAX,
  NEED_ORIGINS,
  parsePurchaseQuantity,
} from '@/modules/purchasing/domain/purchasing';
import { purchaseNeeds } from '@/modules/purchasing/infrastructure/schema';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Necessidade de compra (Prompt 11, itens 8, 9 e 30).
 *
 * "PRECISAMOS COMPRAR ISTO" — e nao "compramos isto" (ADR-048).
 *
 * NADA AQUI COMPRA SOZINHO (item 9). Nenhum evento de estoque chama este
 * arquivo; `LOW_STOCK_DETECTED` nao cria necessidade automatica. O Nexo56 pode
 * SUGERIR que se compre — a tela de necessidades mostra o que esta abaixo do
 * minimo — mas quem registra a necessidade e quem compra e uma pessoa.
 */

const needInputSchema = z.object({
  unitId: z.string().trim().min(1),
  partId: z.string().trim().min(1, 'Escolha a peca.'),
  quantity: z.string().trim().min(1, 'Informe a quantidade.'),
  origin: z.enum(NEED_ORIGINS).default('manual'),
  serviceOrderId: z.string().trim().optional(),
  justification: z.string().trim().max(NEED_JUSTIFICATION_MAX).optional(),
});

function parse<T extends z.ZodTypeAny>(schema: T, rawInput: unknown): z.infer<T> {
  const parsed = schema.safeParse(rawInput);
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

async function authorizeInUnit(
  context: TenantContext,
  unitId: string,
  permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS],
): Promise<void> {
  assertUnitAuthorized(context, unitId);
  await authorize(context, {
    permission,
    featureKey: FEATURES.OPERATIONS_PURCHASING,
    unitId,
  });
}

async function loadPartInTenant(context: TenantContext, partId: string) {
  const [row] = await getDb()
    .select({
      id: parts.id,
      code: parts.code,
      name: parts.name,
      unitOfMeasure: parts.unitOfMeasure,
      status: parts.status,
    })
    .from(parts)
    .where(and(eq(parts.tenantId, context.tenantId), eq(parts.id, partId)))
    .limit(1);

  if (!row) throw new NotFoundError('Peca nao encontrada.');
  return row;
}

export async function createPurchaseNeed(
  context: TenantContext,
  rawInput: unknown,
): Promise<string> {
  const input = parse(needInputSchema, rawInput);
  await authorizeInUnit(context, input.unitId, PERMISSIONS.PURCHASES_CREATE);

  const part = await loadPartInTenant(context, input.partId);
  const amount = parsePurchaseQuantity(input.quantity, part.unitOfMeasure);

  /**
   * A OS PRECISA SER DA MESMA UNIDADE da necessidade (item 79).
   *
   * A FK composta `(service_order_id, unit_id)` ja recusaria no banco; esta
   * checagem existe para a pessoa receber uma frase em portugues.
   */
  let serviceOrderId: string | null = null;
  if (input.serviceOrderId) {
    const [order] = await getDb()
      .select({ id: serviceOrders.id, unitId: serviceOrders.unitId })
      .from(serviceOrders)
      .where(
        and(
          eq(serviceOrders.tenantId, context.tenantId),
          eq(serviceOrders.id, input.serviceOrderId),
        ),
      )
      .limit(1);

    if (!order || !context.authorizedUnitIds.includes(order.unitId)) {
      throw new NotFoundError('Ordem de Servico nao encontrada.');
    }
    if (order.unitId !== input.unitId) {
      throw new BusinessRuleError(
        'A Ordem de Servico pertence a outra unidade. Registre a necessidade na unidade dela.',
      );
    }
    serviceOrderId = order.id;
  }

  const needId = newId();
  const zero = Quantity.zero().toString();
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx.insert(purchaseNeeds).values({
      id: needId,
      tenantId: context.tenantId,
      unitId: input.unitId,
      partId: part.id,
      quantity: amount.toString(),
      orderedQuantity: zero,
      receivedQuantity: zero,
      origin: serviceOrderId ? 'service_order' : input.origin,
      serviceOrderId,
      justification: input.justification || null,
      status: 'open',
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await emit({
      type: EVENT_TYPES.PURCHASE_NEED_CREATED,
      tenantId: context.tenantId,
      payload: {
        needId,
        partId: part.id,
        unitId: input.unitId,
        quantity: amount.toString(),
        origin: serviceOrderId ? 'service_order' : input.origin,
      },
    });
  });

  return needId;
}

export async function cancelPurchaseNeed(context: TenantContext, needId: string): Promise<void> {
  const need = await loadPurchaseNeed(context, needId);
  await authorizeInUnit(context, need.unitId, PERMISSIONS.PURCHASES_CREATE);

  if (need.status === 'cancelled') return;
  if (Quantity.parse(need.receivedQuantity).isPositive()) {
    throw new BusinessRuleError('Esta necessidade ja recebeu mercadoria e nao pode ser cancelada.');
  }

  await runInTransaction(async (tx) => {
    const result = await tx
      .update(purchaseNeeds)
      .set({
        status: 'cancelled',
        version: need.version + 1,
        updatedBy: context.userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseNeeds.tenantId, context.tenantId),
          eq(purchaseNeeds.id, needId),
          eq(purchaseNeeds.version, need.version),
        ),
      );

    if (affectedRows(result) === 0) {
      throw new ConflictError('Esta necessidade foi alterada por outra pessoa.');
    }
  });
}

export interface PurchaseNeedRecord {
  id: string;
  tenantId: string;
  unitId: string;
  partId: string;
  quantity: string;
  orderedQuantity: string;
  receivedQuantity: string;
  status: string;
  serviceOrderId: string | null;
  version: number;
}

export async function loadPurchaseNeed(
  context: TenantContext,
  needId: string,
): Promise<PurchaseNeedRecord> {
  const [row] = await getDb()
    .select({
      id: purchaseNeeds.id,
      tenantId: purchaseNeeds.tenantId,
      unitId: purchaseNeeds.unitId,
      partId: purchaseNeeds.partId,
      quantity: purchaseNeeds.quantity,
      orderedQuantity: purchaseNeeds.orderedQuantity,
      receivedQuantity: purchaseNeeds.receivedQuantity,
      status: purchaseNeeds.status,
      serviceOrderId: purchaseNeeds.serviceOrderId,
      version: purchaseNeeds.version,
    })
    .from(purchaseNeeds)
    .where(and(eq(purchaseNeeds.tenantId, context.tenantId), eq(purchaseNeeds.id, needId)))
    .limit(1);

  if (!row) throw new NotFoundError('Necessidade nao encontrada.');
  if (!context.authorizedUnitIds.includes(row.unitId)) {
    throw new NotFoundError('Necessidade nao encontrada.');
  }
  return row;
}

/**
 * Acumula quanto da necessidade entrou em pedido — DENTRO da transacao de quem
 * chamou (item 30).
 *
 * A situacao e recalculada no `CASE` do proprio `UPDATE`, pela mesma razao de
 * sempre: ler, decidir em TypeScript e gravar deixaria uma janela. E `ordered`
 * NAO significa atendida — so `received` fecha a necessidade.
 */
export async function addOrderedQuantity(
  tx: TransactionExecutor,
  tenantId: string,
  needId: string,
  amount: Quantity,
): Promise<void> {
  const value = amount.toString();

  await tx.execute(sql`
    UPDATE purchase_needs
    SET ordered_quantity = ordered_quantity + ${value},
        status = CASE
          WHEN status = 'cancelled' THEN 'cancelled'
          WHEN received_quantity >= quantity THEN 'fulfilled'
          WHEN ordered_quantity + ${value} > 0 THEN 'ordered'
          ELSE 'open'
        END,
        version = version + 1,
        updated_at = NOW(3)
    WHERE id = ${needId} AND tenant_id = ${tenantId}
  `);
}

/**
 * Acumula quanto da necessidade CHEGOU — e so isto a fecha (item 30).
 *
 * Uma necessidade de 10 com pedido de 10 continua `ordered` enquanto nada
 * chegou. O pedido pode atrasar, vir pela metade ou ser cancelado; marcar
 * "atendida" na criacao do pedido mentiria para quem confere.
 */
export async function addReceivedQuantity(
  tx: TransactionExecutor,
  tenantId: string,
  needId: string,
  amount: Quantity,
): Promise<void> {
  const value = amount.toString();

  await tx.execute(sql`
    UPDATE purchase_needs
    SET received_quantity = received_quantity + ${value},
        status = CASE
          WHEN status = 'cancelled' THEN 'cancelled'
          WHEN received_quantity + ${value} >= quantity THEN 'fulfilled'
          ELSE 'ordered'
        END,
        version = version + 1,
        updated_at = NOW(3)
    WHERE id = ${needId} AND tenant_id = ${tenantId}
  `);
}

/** Desfaz a reserva de "quanto foi pedido" quando o pedido e cancelado. */
export async function releaseOrderedQuantity(
  tx: TransactionExecutor,
  tenantId: string,
  needId: string,
  amount: Quantity,
): Promise<void> {
  const value = amount.toString();

  await tx.execute(sql`
    UPDATE purchase_needs
    SET ordered_quantity = GREATEST(ordered_quantity - ${value}, 0),
        status = CASE
          WHEN status = 'cancelled' THEN 'cancelled'
          WHEN received_quantity >= quantity THEN 'fulfilled'
          WHEN GREATEST(ordered_quantity - ${value}, 0) > 0 THEN 'ordered'
          ELSE 'open'
        END,
        version = version + 1,
        updated_at = NOW(3)
    WHERE id = ${needId} AND tenant_id = ${tenantId}
  `);
}

export type { EmitFn };

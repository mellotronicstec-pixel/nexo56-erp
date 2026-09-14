import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { Money } from '@/core/money/money';
import { Quantity } from '@/core/quantity/quantity';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import { parts } from '@/modules/inventory/infrastructure/schema';
import {
  DOCUMENT_NUMBER_MAX,
  IDEMPOTENCY_KEY_MAX,
  ITEM_DESCRIPTION_MAX,
  ITEM_NOTES_MAX,
  ORDER_NOTES_MAX,
  PURCHASE_TIMELINE_KINDS,
  calculateItemTotals,
  calculatePurchaseOrderTotals,
  explainPurchaseOrderRefusal,
  findPurchaseOrderTransition,
  formatPurchaseOrderNumber,
  isPurchaseOrderEditable,
  normalizeCancelReason,
  type PurchaseOrderStatus,
} from '@/modules/purchasing/domain/purchasing';
import {
  purchaseNeeds,
  purchaseOrderItems,
  purchaseOrderTimeline,
  purchaseOrders,
  supplierParts,
  suppliers,
} from '@/modules/purchasing/infrastructure/schema';
import {
  addOrderedQuantity,
  releaseOrderedQuantity,
} from '@/modules/purchasing/application/purchase-need-service';
import {
  SEQUENCE_TYPES,
  allocateSequenceNumber,
} from '@/modules/tenancy/application/sequence-service';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Pedido de compra (Prompt 11, itens 11 a 18).
 *
 * A FRONTEIRA QUE ESTE ARQUIVO PROTEGE
 *
 * Nao ha, em lugar nenhum deste modulo, um `update(stockBalances)` nem um
 * `insert(stockMovements)` (item 20). Pedido NAO e estoque: enquanto a
 * mercadoria nao chegou, nada mudou no saldo. Quem transforma compra em saldo
 * e o RECEBIMENTO, e ele usa a primitiva oficial do Inventory.
 *
 * Tambem nao ha `update(serviceOrders)` com `status` (item 60): criar ou
 * aprovar um pedido nao tira a OS de Aguardando Peca.
 *
 * A SITUACAO DE RECEBIMENTO NAO E DECIDIDA AQUI (item 16). `partially_received`
 * e `received` sao consequencia aritmetica do que chegou, calculada pelo
 * recebimento. Este arquivo cuida das transicoes que sao DECISAO de alguem:
 * aprovar, registrar como realizado e cancelar.
 */

// ---------------------------------------------------------------------------
// Leitura com escopo (item 53)
// ---------------------------------------------------------------------------

export interface PurchaseOrderRecord {
  id: string;
  tenantId: string;
  unitId: string;
  supplierId: string;
  number: number;
  status: string;
  version: number;
  subtotal: string;
  discount: string;
  freight: string;
  otherCosts: string;
  total: string;
  expectedAt: string | null;
  placedAt: Date | null;
  internalNotes: string | null;
  supplierNotes: string | null;
  documentNumber: string | null;
  documentDate: string | null;
}

/**
 * Carrega o pedido dentro do tenant E da unidade autorizada.
 *
 * Pedido de outra empresa ou de unidade que a pessoa nao opera responde "nao
 * encontrado" — nunca "sem permissao", que confirmaria a existencia.
 */
export async function loadPurchaseOrder(
  context: TenantContext,
  purchaseOrderId: string,
): Promise<PurchaseOrderRecord> {
  const [row] = await getDb()
    .select({
      id: purchaseOrders.id,
      tenantId: purchaseOrders.tenantId,
      unitId: purchaseOrders.unitId,
      supplierId: purchaseOrders.supplierId,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      version: purchaseOrders.version,
      subtotal: purchaseOrders.subtotal,
      discount: purchaseOrders.discount,
      freight: purchaseOrders.freight,
      otherCosts: purchaseOrders.otherCosts,
      total: purchaseOrders.total,
      expectedAt: purchaseOrders.expectedAt,
      placedAt: purchaseOrders.placedAt,
      internalNotes: purchaseOrders.internalNotes,
      supplierNotes: purchaseOrders.supplierNotes,
      documentNumber: purchaseOrders.documentNumber,
      documentDate: purchaseOrders.documentDate,
    })
    .from(purchaseOrders)
    .where(
      and(eq(purchaseOrders.tenantId, context.tenantId), eq(purchaseOrders.id, purchaseOrderId)),
    )
    .limit(1);

  if (!row) throw new NotFoundError('Pedido de compra nao encontrado.');
  if (!context.authorizedUnitIds.includes(row.unitId)) {
    throw new NotFoundError('Pedido de compra nao encontrado.');
  }
  return row;
}

function assertUnitAuthorized(context: TenantContext, unitId: string): void {
  if (!context.authorizedUnitIds.includes(unitId)) {
    throw new NotFoundError('Unidade nao encontrada.');
  }
}

/** Autoriza NA UNIDADE DO PEDIDO — nunca na unidade ativa da sessao (item 47). */
async function authorizeInUnit(
  context: TenantContext,
  unitId: string,
  permission: PermissionKey,
): Promise<void> {
  assertUnitAuthorized(context, unitId);
  await authorize(context, {
    permission,
    featureKey: FEATURES.OPERATIONS_PURCHASING,
    unitId,
  });
}

function parse<T extends z.ZodTypeAny>(schema: T, rawInput: unknown): z.infer<T> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

async function writeTimeline(
  tx: TransactionExecutor,
  context: TenantContext,
  args: {
    purchaseOrderId: string;
    kind: string;
    summary: string;
    metadata?: Record<string, unknown>;
    reason?: string | null;
    now: Date;
  },
): Promise<void> {
  await tx.insert(purchaseOrderTimeline).values({
    id: newId(),
    tenantId: context.tenantId,
    purchaseOrderId: args.purchaseOrderId,
    kind: args.kind,
    summary: args.summary,
    metadata: args.metadata ?? null,
    reason: args.reason ?? null,
    actorId: context.userId,
    occurredAt: args.now,
  });
}

export { writeTimeline as writePurchaseTimeline };

// ---------------------------------------------------------------------------
// Criacao
// ---------------------------------------------------------------------------

const civilDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data valida.')
  .or(z.literal(''));

export const createPurchaseOrderSchema = z.object({
  unitId: z.string().trim().min(1, 'Escolha a unidade de destino.'),
  supplierId: z.string().trim().min(1, 'Escolha o fornecedor.'),
  expectedAt: civilDateSchema.optional(),
  internalNotes: z.string().trim().max(ORDER_NOTES_MAX).optional(),
  supplierNotes: z.string().trim().max(ORDER_NOTES_MAX).optional(),
  idempotencyKey: z.string().trim().max(IDEMPOTENCY_KEY_MAX).optional(),
});

export interface CreatePurchaseOrderResult {
  purchaseOrderId: string;
  number: number;
  formattedNumber: string;
  reused: boolean;
}

/**
 * Abre um pedido em RASCUNHO.
 *
 * A UNIDADE E OBRIGATORIA (item 3.2): a mercadoria chega em um endereco, e
 * pedido sem destino nao existe. O fornecedor precisa ser ATIVO e da mesma
 * empresa — a FK composta garante o segundo no banco.
 */
export async function createPurchaseOrder(
  context: TenantContext,
  rawInput: unknown,
): Promise<CreatePurchaseOrderResult> {
  const input = parse(createPurchaseOrderSchema, rawInput);
  await authorizeInUnit(context, input.unitId, PERMISSIONS.PURCHASES_CREATE);

  const [supplier] = await getDb()
    .select({ id: suppliers.id, name: suppliers.name, status: suppliers.status })
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, context.tenantId), eq(suppliers.id, input.supplierId)))
    .limit(1);

  if (!supplier) throw new NotFoundError('Fornecedor nao encontrado.');
  if (supplier.status !== 'active') {
    throw new BusinessRuleError(`O fornecedor ${supplier.name} esta inativo.`);
  }

  const key = input.idempotencyKey || null;

  /** Duplo clique e retry reencontram o pedido em vez de criar outro (item 55). */
  if (key) {
    const [existing] = await getDb()
      .select({ id: purchaseOrders.id, number: purchaseOrders.number })
      .from(purchaseOrders)
      .where(
        and(eq(purchaseOrders.tenantId, context.tenantId), eq(purchaseOrders.idempotencyKey, key)),
      )
      .limit(1);

    if (existing) {
      return {
        purchaseOrderId: existing.id,
        number: existing.number,
        formattedNumber: formatPurchaseOrderNumber(existing.number),
        reused: true,
      };
    }
  }

  const zero = Money.zero().toString();
  const purchaseOrderId = newId();
  const now = new Date();

  const number = await runInTransaction(async (tx, emit) => {
    /** Numeracao pela sequencia do tenant — NUNCA `MAX + 1` (item 12). */
    const sequence = await allocateSequenceNumber(
      tx,
      context.tenantId,
      SEQUENCE_TYPES.PURCHASE_ORDER,
      { prefix: 'PC', padding: 6 },
    );

    await tx.insert(purchaseOrders).values({
      id: purchaseOrderId,
      tenantId: context.tenantId,
      unitId: input.unitId,
      supplierId: supplier.id,
      number: sequence.value,
      status: 'draft',
      expectedAt: input.expectedAt || null,
      subtotal: zero,
      discount: zero,
      freight: zero,
      otherCosts: zero,
      total: zero,
      internalNotes: input.internalNotes || null,
      supplierNotes: input.supplierNotes || null,
      idempotencyKey: key,
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await writeTimeline(tx, context, {
      purchaseOrderId,
      kind: PURCHASE_TIMELINE_KINDS.CREATED,
      summary: 'Pedido criado',
      metadata: { number: sequence.value, supplierId: supplier.id },
      now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.PURCHASE_ORDER_CREATED,
        entityType: 'purchase_order',
        entityId: purchaseOrderId,
        tenantId: context.tenantId,
        unitId: input.unitId,
        userId: context.userId,
        after: { number: sequence.value, supplierId: supplier.id },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.PURCHASE_ORDER_CREATED,
      tenantId: context.tenantId,
      payload: {
        purchaseOrderId,
        number: sequence.value,
        unitId: input.unitId,
        supplierId: supplier.id,
      },
    });

    return sequence.value;
  });

  return {
    purchaseOrderId,
    number,
    formattedNumber: formatPurchaseOrderNumber(number),
    reused: false,
  };
}

// ---------------------------------------------------------------------------
// Edicao do rascunho
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  partId: z.string().trim().min(1, 'Escolha a peca.'),
  quantity: z.string().trim().min(1, 'Informe a quantidade.'),
  unitCost: z.string().trim().min(1, 'Informe o custo unitario.'),
  supplierCode: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(ITEM_NOTES_MAX).optional(),
  /** Necessidade que esta linha atende. Opcional e flexivel (item 29). */
  purchaseNeedId: z.string().trim().max(36).optional(),
});

export const savePurchaseDraftSchema = z.object({
  items: z.array(itemSchema).max(200, 'Pedido com itens demais.'),
  discount: z.string().trim().optional(),
  freight: z.string().trim().optional(),
  otherCosts: z.string().trim().optional(),
  expectedAt: civilDateSchema.optional(),
  internalNotes: z.string().trim().max(ORDER_NOTES_MAX).optional(),
  supplierNotes: z.string().trim().max(ORDER_NOTES_MAX).optional(),
  documentNumber: z.string().trim().max(DOCUMENT_NUMBER_MAX).optional(),
  documentDate: civilDateSchema.optional(),
});

/**
 * Grava o rascunho inteiro: itens, custos, previsao e observacoes.
 *
 * SUBSTITUI A LISTA DE ITENS por completo, como o editor de orcamento faz e
 * pela mesma razao: a lista e curta e vive dentro de um rascunho que ainda nao
 * virou compra. Reconciliar por id produziria um diff fragil sem ganho.
 *
 * OS TOTAIS SAO RECALCULADOS AQUI (item 15). O que o formulario mandou como
 * total e ignorado.
 *
 * O SNAPSHOT COMERCIAL E GRAVADO AGORA (item 14): descricao, unidade de medida
 * e codigo do fornecedor ficam congelados na linha. Renomear a peca depois nao
 * reescreve pedido nenhum.
 */
export async function savePurchaseOrderDraft(
  context: TenantContext,
  purchaseOrderId: string,
  rawInput: unknown,
  expectedVersion?: number,
): Promise<{ subtotal: string; total: string }> {
  const input = parse(savePurchaseDraftSchema, rawInput);
  const order = await loadPurchaseOrder(context, purchaseOrderId);
  await authorizeInUnit(context, order.unitId, PERMISSIONS.PURCHASES_UPDATE);

  if (!isPurchaseOrderEditable(order.status)) {
    throw new BusinessRuleError(
      'Este pedido nao e mais um rascunho: os itens e valores estao congelados.',
    );
  }

  /** Todas as pecas precisam existir NESTA empresa. A FK garante; aqui explica. */
  const partIds = [...new Set(input.items.map((item) => item.partId))];
  const partRows = partIds.length
    ? await getDb()
        .select({
          id: parts.id,
          code: parts.code,
          name: parts.name,
          unitOfMeasure: parts.unitOfMeasure,
          status: parts.status,
        })
        .from(parts)
        .where(and(eq(parts.tenantId, context.tenantId)))
    : [];
  const partById = new Map(partRows.map((row) => [row.id, row]));

  for (const partId of partIds) {
    const part = partById.get(partId);
    if (!part) throw new NotFoundError('Peca nao encontrada.');
    if (part.status !== 'active') {
      throw new BusinessRuleError(`A peca ${part.code} esta inativa e nao pode ser comprada.`);
    }
  }

  const totals = calculatePurchaseOrderTotals(input.items, {
    discount: input.discount || '0',
    freight: input.freight || '0',
    otherCosts: input.otherCosts || '0',
  });

  const version = expectedVersion ?? order.version;
  const now = new Date();

  await runInTransaction(async (tx) => {
    const result = await tx
      .update(purchaseOrders)
      .set({
        subtotal: totals.subtotal.toString(),
        discount: totals.discount.toString(),
        freight: totals.freight.toString(),
        otherCosts: totals.otherCosts.toString(),
        total: totals.total.toString(),
        expectedAt: input.expectedAt || null,
        internalNotes: input.internalNotes || null,
        supplierNotes: input.supplierNotes || null,
        documentNumber: input.documentNumber || null,
        documentDate: input.documentDate || null,
        version: version + 1,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(purchaseOrders.tenantId, context.tenantId),
          eq(purchaseOrders.id, purchaseOrderId),
          eq(purchaseOrders.version, version),
          eq(purchaseOrders.status, 'draft'),
        ),
      );

    if (affectedRows(result) === 0) {
      throw new ConflictError('Este pedido foi alterado por outra pessoa. Recarregue a pagina.');
    }

    await tx
      .delete(purchaseOrderItems)
      .where(
        and(
          eq(purchaseOrderItems.tenantId, context.tenantId),
          eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
        ),
      );

    for (const [index, item] of input.items.entries()) {
      const part = partById.get(item.partId);
      if (!part) throw new NotFoundError('Peca nao encontrada.');

      const line = calculateItemTotals(item);

      await tx.insert(purchaseOrderItems).values({
        id: newId(),
        tenantId: context.tenantId,
        purchaseOrderId,
        partId: part.id,
        description: `${part.code} — ${part.name}`.slice(0, ITEM_DESCRIPTION_MAX),
        supplierCode: item.supplierCode || null,
        unitOfMeasure: part.unitOfMeasure,
        quantity: line.quantity.toString(),
        receivedQuantity: Quantity.zero().toString(),
        unitCost: line.unitCost.toString(),
        total: line.total.toString(),
        purchaseNeedId: item.purchaseNeedId || null,
        notes: item.notes || null,
        position: index,
        createdAt: now,
        updatedAt: now,
      });
    }

    await writeTimeline(tx, context, {
      purchaseOrderId,
      kind: PURCHASE_TIMELINE_KINDS.ITEMS_UPDATED,
      summary: `Itens alterados: ${input.items.length} linha(s), total ${totals.total.toString()}`,
      metadata: { itemCount: input.items.length, total: totals.total.toString() },
      now,
    });
  });

  return { subtotal: totals.subtotal.toString(), total: totals.total.toString() };
}

// ---------------------------------------------------------------------------
// Transicoes (itens 16, 17 e 18)
// ---------------------------------------------------------------------------

export interface TransitionResult {
  status: PurchaseOrderStatus;
}

/**
 * Aprova, registra como realizado ou cancela.
 *
 * UMA PORTA SO. A matriz do dominio decide o que e valido; a permissao da
 * transicao e verificada NA UNIDADE DO PEDIDO; e a gravacao usa
 * compare-and-swap de versao, para que duas pessoas clicando junto nao
 * produzam dois efeitos.
 *
 * "REGISTRAR PEDIDO REALIZADO" NAO ENVIA NADA (item 18). A pessoa confirma que
 * fez o pedido ao fornecedor por telefone, WhatsApp ou balcao — o Nexo56 apenas
 * registra o fato, e a tela diz isso.
 */
export async function transitionPurchaseOrder(
  context: TenantContext,
  purchaseOrderId: string,
  to: PurchaseOrderStatus,
  options: { reason?: string; expectedVersion?: number } = {},
): Promise<TransitionResult> {
  const order = await loadPurchaseOrder(context, purchaseOrderId);

  const rule = findPurchaseOrderTransition(order.status, to);
  if (!rule) {
    throw new BusinessRuleError(explainPurchaseOrderRefusal(order.status, to));
  }

  await authorizeInUnit(context, order.unitId, rule.permission);

  const reason = rule.requiresReason ? normalizeCancelReason(options.reason ?? '') : null;

  /** Aprovar um pedido sem itens nao e caso de uso: e engano de quem clicou. */
  if (to === 'approved') {
    const items = await getDb()
      .select({ id: purchaseOrderItems.id })
      .from(purchaseOrderItems)
      .where(
        and(
          eq(purchaseOrderItems.tenantId, context.tenantId),
          eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
        ),
      );
    if (items.length === 0) {
      throw new BusinessRuleError('Inclua ao menos um item antes de aprovar a compra.');
    }
  }

  const version = options.expectedVersion ?? order.version;
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    const patch: Record<string, unknown> = {
      status: to,
      version: version + 1,
      updatedBy: context.userId,
      updatedAt: now,
    };

    if (to === 'approved') {
      patch.approvedAt = now;
      patch.approvedBy = context.userId;
    }
    if (to === 'placed') {
      patch.placedAt = now;
      patch.placedBy = context.userId;
    }
    if (to === 'cancelled') {
      patch.cancelledAt = now;
      patch.cancelReason = reason;
    }

    const result = await tx
      .update(purchaseOrders)
      .set(patch)
      .where(
        and(
          eq(purchaseOrders.tenantId, context.tenantId),
          eq(purchaseOrders.id, purchaseOrderId),
          eq(purchaseOrders.version, version),
          eq(purchaseOrders.status, order.status),
        ),
      );

    if (affectedRows(result) === 0) {
      throw new ConflictError('Este pedido foi alterado por outra pessoa. Recarregue a pagina.');
    }

    /**
     * AO APROVAR, a necessidade passa a contar o que foi PEDIDO (item 30).
     *
     * Nao ao criar o rascunho: rascunho nao e compromisso. E "pedido" nunca
     * significa "atendida" — so a chegada da mercadoria fecha a necessidade.
     */
    if (to === 'approved') {
      await applyNeedQuantities(tx, context, purchaseOrderId, 'add');
    }

    /**
     * AO CANCELAR, o que ainda nao chegou volta a faltar (item 25).
     *
     * O que JA foi recebido permanece: o estoque nao e desfeito, e a
     * necessidade continua contando aquilo como atendido.
     */
    if (to === 'cancelled' && ['approved', 'placed', 'partially_received'].includes(order.status)) {
      await applyNeedQuantities(tx, context, purchaseOrderId, 'release');
    }

    await writeTimeline(tx, context, {
      purchaseOrderId,
      kind:
        to === 'approved'
          ? PURCHASE_TIMELINE_KINDS.APPROVED
          : to === 'placed'
            ? PURCHASE_TIMELINE_KINDS.PLACED
            : PURCHASE_TIMELINE_KINDS.CANCELLED,
      summary: rule.label,
      metadata: { from: order.status, to },
      reason,
      now,
    });

    const auditAction =
      to === 'approved'
        ? AUDIT_ACTIONS.PURCHASE_ORDER_APPROVED
        : to === 'placed'
          ? AUDIT_ACTIONS.PURCHASE_ORDER_PLACED
          : AUDIT_ACTIONS.PURCHASE_ORDER_CANCELLED;

    await recordAudit(
      {
        action: auditAction,
        entityType: 'purchase_order',
        entityId: purchaseOrderId,
        tenantId: context.tenantId,
        unitId: order.unitId,
        userId: context.userId,
        before: { status: order.status },
        after: { status: to, reason },
      },
      tx,
    );

    const eventType =
      to === 'approved'
        ? EVENT_TYPES.PURCHASE_ORDER_APPROVED
        : to === 'placed'
          ? EVENT_TYPES.PURCHASE_ORDER_PLACED
          : EVENT_TYPES.PURCHASE_ORDER_CANCELLED;

    await emit({
      type: eventType,
      tenantId: context.tenantId,
      payload: {
        purchaseOrderId,
        number: order.number,
        unitId: order.unitId,
        supplierId: order.supplierId,
        from: order.status,
        to,
      },
    });
  });

  return { status: to };
}

/** Soma ou devolve a quantidade "pedida" de cada necessidade vinculada. */
async function applyNeedQuantities(
  tx: TransactionExecutor,
  context: TenantContext,
  purchaseOrderId: string,
  mode: 'add' | 'release',
): Promise<void> {
  const rows = await tx
    .select({
      purchaseNeedId: purchaseOrderItems.purchaseNeedId,
      quantity: purchaseOrderItems.quantity,
      receivedQuantity: purchaseOrderItems.receivedQuantity,
    })
    .from(purchaseOrderItems)
    .where(
      and(
        eq(purchaseOrderItems.tenantId, context.tenantId),
        eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
      ),
    )
    .orderBy(asc(purchaseOrderItems.position));

  for (const row of rows) {
    if (!row.purchaseNeedId) continue;

    if (mode === 'add') {
      await addOrderedQuantity(
        tx,
        context.tenantId,
        row.purchaseNeedId,
        Quantity.parse(row.quantity),
      );
    } else {
      /** So o PENDENTE volta a faltar. O que chegou continua atendido. */
      const pending = Quantity.parse(row.quantity).subtract(Quantity.parse(row.receivedQuantity));
      if (pending.isPositive()) {
        await releaseOrderedQuantity(tx, context.tenantId, row.purchaseNeedId, pending);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Catalogo fornecedor x peca (item 6)
// ---------------------------------------------------------------------------

/**
 * Guarda o que o fornecedor cobrou por ultimo — CONVENIENCIA de tela, nunca
 * autoridade de preco (item 6).
 *
 * O historico completo fica em `purchase_price_history`, e e ele que responde
 * "quanto pagamos, e quando". Esta linha so acelera o proximo pedido.
 */
export async function rememberSupplierPart(
  tx: TransactionExecutor,
  args: {
    tenantId: string;
    supplierId: string;
    partId: string;
    unitCost: Money;
    supplierCode: string | null;
    now: Date;
  },
): Promise<void> {
  const [existing] = await tx
    .select({ id: supplierParts.id })
    .from(supplierParts)
    .where(
      and(
        eq(supplierParts.tenantId, args.tenantId),
        eq(supplierParts.supplierId, args.supplierId),
        eq(supplierParts.partId, args.partId),
      ),
    )
    .limit(1);

  if (existing) {
    await tx
      .update(supplierParts)
      .set({
        lastUnitCost: args.unitCost.toString(),
        lastPurchasedAt: args.now,
        supplierCode: args.supplierCode ?? undefined,
        updatedAt: args.now,
      })
      .where(eq(supplierParts.id, existing.id));
    return;
  }

  await tx.insert(supplierParts).values({
    id: newId(),
    tenantId: args.tenantId,
    supplierId: args.supplierId,
    partId: args.partId,
    supplierCode: args.supplierCode,
    supplierCodeNormalized: args.supplierCode
      ? args.supplierCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
      : null,
    lastUnitCost: args.unitCost.toString(),
    lastPurchasedAt: args.now,
    status: 'active',
    createdAt: args.now,
    updatedAt: args.now,
  });
}

export { purchaseNeeds };

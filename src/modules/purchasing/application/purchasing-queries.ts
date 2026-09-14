import 'server-only';
import { and, asc, desc, eq, gt, inArray, like, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { buildOffsetPage, resolveOffset, type OffsetPage } from '@/core/db/pagination';
import { onlyDigits } from '@/core/document/brazilian-document';
import { normalizePhone } from '@/core/contact/phone';
import { Quantity } from '@/core/quantity/quantity';
import { normalizeSearchable } from '@/core/text/normalize';
import { parts, stockBalances, stockLocations } from '@/modules/inventory/infrastructure/schema';
import { needPendingToReceive } from '@/modules/purchasing/domain/purchasing';
import {
  purchaseNeeds,
  purchaseOrderItems,
  purchaseOrderTimeline,
  purchaseOrders,
  purchasePriceHistory,
  purchaseReceiptItems,
  purchaseReceipts,
  supplierContacts,
  supplierParts,
  suppliers,
} from '@/modules/purchasing/infrastructure/schema';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Consultas de Fornecedores e Compras (Prompt 11, itens 63 e 64).
 *
 * TODA consulta carrega o escopo: `tenant_id` sempre, e `unit_id` em tudo que
 * e da unidade. Nao existe aqui um `findById(id)` sem escopo.
 *
 * SEM N+1 (item 63): a listagem de pedidos e UM `JOIN` com o fornecedor e uma
 * agregacao de itens, e nao uma consulta por linha.
 */

// ---------------------------------------------------------------------------
// Fornecedores
// ---------------------------------------------------------------------------

export interface SupplierListFilters {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface SupplierListItem {
  id: string;
  name: string;
  tradeName: string | null;
  documentType: string | null;
  documentDigits: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  orderCount: number;
  lastPurchaseAt: Date | null;
}

/**
 * Busca por nome, fantasia, documento, telefone e e-mail (item 64).
 *
 * Cada campo na sua forma normalizada: nome sem acento, documento e telefone
 * so com digitos. Jogar tudo num `LIKE` sobre o texto cru faria "11 98888-7777"
 * nao encontrar quem foi cadastrado como "(11) 98888-7777".
 */
function buildSupplierSearch(rawQuery: string): SQL | undefined {
  const conditions: SQL[] = [];

  const text = normalizeSearchable(rawQuery);
  if (text) {
    conditions.push(
      like(suppliers.nameSearch, `%${text}%`),
      like(suppliers.tradeNameSearch, `%${text}%`),
      like(suppliers.email, `%${text}%`),
    );
  }

  const digits = onlyDigits(rawQuery);
  if (digits.length >= 3) {
    conditions.push(
      like(suppliers.documentDigits, `%${digits}%`),
      like(suppliers.phoneDigits, `%${normalizePhone(rawQuery)}%`),
    );
  }

  if (conditions.length === 0) return undefined;
  return or(...conditions);
}

export async function listSuppliers(
  context: TenantContext,
  filters: SupplierListFilters = {},
): Promise<OffsetPage<SupplierListItem>> {
  const { limit, offset, page } = resolveOffset(filters);
  const db = getDb();

  const conditions: SQL[] = [eq(suppliers.tenantId, context.tenantId)];

  const search = filters.search?.trim();
  if (search) {
    const condition = buildSupplierSearch(search);
    if (condition) conditions.push(condition);
  }
  if (filters.status === 'active' || filters.status === 'inactive') {
    conditions.push(eq(suppliers.status, filters.status));
  }

  const where = and(...conditions);

  const rows = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      tradeName: suppliers.tradeName,
      documentType: suppliers.documentType,
      documentDigits: suppliers.documentDigits,
      email: suppliers.email,
      phone: suppliers.phone,
      status: suppliers.status,
    })
    .from(suppliers)
    .where(where)
    .orderBy(asc(suppliers.nameSearch), asc(suppliers.id))
    .limit(limit)
    .offset(offset);

  const [totals] = await db
    .select({ total: sql<number>`count(*)` })
    .from(suppliers)
    .where(where);

  /** UMA consulta de agregacao para a pagina inteira — nunca uma por linha. */
  const ids = rows.map((row) => row.id);
  const stats = new Map<string, { orderCount: number; lastPurchaseAt: Date | null }>();

  if (ids.length > 0) {
    const aggregated = await db
      .select({
        supplierId: purchaseOrders.supplierId,
        orderCount: sql<number>`count(*)`,
        lastPurchaseAt: sql<Date | null>`max(${purchaseOrders.placedAt})`,
      })
      .from(purchaseOrders)
      .where(
        and(eq(purchaseOrders.tenantId, context.tenantId), inArray(purchaseOrders.supplierId, ids)),
      )
      .groupBy(purchaseOrders.supplierId);

    for (const row of aggregated) {
      stats.set(row.supplierId, {
        orderCount: Number(row.orderCount ?? 0),
        lastPurchaseAt: row.lastPurchaseAt ? new Date(row.lastPurchaseAt) : null,
      });
    }
  }

  const items = rows.map((row) => ({
    ...row,
    orderCount: stats.get(row.id)?.orderCount ?? 0,
    lastPurchaseAt: stats.get(row.id)?.lastPurchaseAt ?? null,
  }));

  return buildOffsetPage(items, Number(totals?.total ?? 0), { page, pageSize: limit });
}

/** Fornecedores ativos para o seletor de pedido. */
export async function listActiveSuppliers(context: TenantContext, limit = 100) {
  return getDb()
    .select({ id: suppliers.id, name: suppliers.name, tradeName: suppliers.tradeName })
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, context.tenantId), eq(suppliers.status, 'active')))
    .orderBy(asc(suppliers.nameSearch), asc(suppliers.id))
    .limit(Math.min(limit, 200));
}

export async function findSupplierDetail(context: TenantContext, supplierId: string) {
  const db = getDb();

  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, context.tenantId), eq(suppliers.id, supplierId)))
    .limit(1);

  if (!supplier) return null;

  const [contacts, catalog, orders] = await Promise.all([
    db
      .select()
      .from(supplierContacts)
      .where(
        and(
          eq(supplierContacts.tenantId, context.tenantId),
          eq(supplierContacts.supplierId, supplierId),
        ),
      )
      .orderBy(asc(supplierContacts.role), asc(supplierContacts.name)),

    db
      .select({
        id: supplierParts.id,
        partId: supplierParts.partId,
        partCode: parts.code,
        partName: parts.name,
        supplierCode: supplierParts.supplierCode,
        lastUnitCost: supplierParts.lastUnitCost,
        lastPurchasedAt: supplierParts.lastPurchasedAt,
      })
      .from(supplierParts)
      .innerJoin(parts, eq(parts.id, supplierParts.partId))
      .where(
        and(eq(supplierParts.tenantId, context.tenantId), eq(supplierParts.supplierId, supplierId)),
      )
      .orderBy(desc(supplierParts.lastPurchasedAt))
      .limit(50),

    db
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        status: purchaseOrders.status,
        total: purchaseOrders.total,
        unitId: purchaseOrders.unitId,
        unitName: units.name,
        createdAt: purchaseOrders.createdAt,
      })
      .from(purchaseOrders)
      .innerJoin(units, eq(units.id, purchaseOrders.unitId))
      .where(
        and(
          eq(purchaseOrders.tenantId, context.tenantId),
          eq(purchaseOrders.supplierId, supplierId),
        ),
      )
      .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id))
      .limit(25),
  ]);

  return {
    supplier,
    contacts,
    catalog,
    /** So pedidos de unidades que a pessoa opera (item 47). */
    orders: orders.filter((row) => context.authorizedUnitIds.includes(row.unitId)),
  };
}

// ---------------------------------------------------------------------------
// Necessidades
// ---------------------------------------------------------------------------

export interface NeedListFilters {
  search?: string;
  status?: string;
  origin?: string;
  /** `without_order` mostra o que ainda nao entrou em pedido nenhum. */
  filter?: string;
  page?: number;
  pageSize?: number;
}

export interface NeedListItem {
  id: string;
  partId: string;
  partCode: string;
  partName: string;
  unitOfMeasure: string;
  quantity: string;
  orderedQuantity: string;
  receivedQuantity: string;
  pending: string;
  status: string;
  origin: string;
  serviceOrderId: string | null;
  serviceOrderNumber: number | null;
  onHand: string;
  reserved: string;
  available: string;
  createdAt: Date;
}

export async function listPurchaseNeeds(
  context: TenantContext,
  filters: NeedListFilters = {},
): Promise<OffsetPage<NeedListItem>> {
  const { limit, offset, page } = resolveOffset(filters);

  if (!context.activeUnitId) {
    return buildOffsetPage<NeedListItem>([], 0, { page, pageSize: limit });
  }

  const unitId = context.activeUnitId;
  const db = getDb();

  const conditions: SQL[] = [
    eq(purchaseNeeds.tenantId, context.tenantId),
    eq(purchaseNeeds.unitId, unitId),
  ];

  const search = filters.search?.trim();
  if (search) {
    const text = normalizeSearchable(search);
    const code = search.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const parts_ = [] as SQL[];
    if (text) parts_.push(like(parts.nameSearch, `%${text}%`));
    if (code) parts_.push(like(parts.codeNormalized, `%${code}%`));
    if (parts_.length) conditions.push(or(...parts_) as SQL);
  }

  if (filters.status && ['open', 'ordered', 'fulfilled', 'cancelled'].includes(filters.status)) {
    conditions.push(eq(purchaseNeeds.status, filters.status));
  }
  if (filters.origin && ['manual', 'service_order', 'low_stock'].includes(filters.origin)) {
    conditions.push(eq(purchaseNeeds.origin, filters.origin));
  }
  if (filters.filter === 'without_order') {
    conditions.push(sql`${purchaseNeeds.orderedQuantity} <= 0`);
  }
  if (filters.filter === 'partially_fulfilled') {
    conditions.push(
      sql`${purchaseNeeds.receivedQuantity} > 0 AND ${purchaseNeeds.receivedQuantity} < ${purchaseNeeds.quantity}`,
    );
  }

  const where = and(...conditions);

  const rows = await db
    .select({
      id: purchaseNeeds.id,
      partId: purchaseNeeds.partId,
      partCode: parts.code,
      partName: parts.name,
      unitOfMeasure: parts.unitOfMeasure,
      quantity: purchaseNeeds.quantity,
      orderedQuantity: purchaseNeeds.orderedQuantity,
      receivedQuantity: purchaseNeeds.receivedQuantity,
      status: purchaseNeeds.status,
      origin: purchaseNeeds.origin,
      serviceOrderId: purchaseNeeds.serviceOrderId,
      serviceOrderNumber: serviceOrders.number,
      onHand: stockBalances.onHand,
      reserved: stockBalances.reserved,
      createdAt: purchaseNeeds.createdAt,
    })
    .from(purchaseNeeds)
    .innerJoin(parts, eq(parts.id, purchaseNeeds.partId))
    .leftJoin(serviceOrders, eq(serviceOrders.id, purchaseNeeds.serviceOrderId))
    .leftJoin(
      stockBalances,
      and(eq(stockBalances.partId, purchaseNeeds.partId), eq(stockBalances.unitId, unitId)),
    )
    .where(where)
    .orderBy(desc(purchaseNeeds.createdAt), desc(purchaseNeeds.id))
    .limit(limit)
    .offset(offset);

  const [totals] = await db
    .select({ total: sql<number>`count(*)` })
    .from(purchaseNeeds)
    .innerJoin(parts, eq(parts.id, purchaseNeeds.partId))
    .where(where);

  const zero = Quantity.zero();
  const items = rows.map((row) => {
    const onHand = row.onHand ? Quantity.parse(row.onHand) : zero;
    const reserved = row.reserved ? Quantity.parse(row.reserved) : zero;

    return {
      ...row,
      pending: needPendingToReceive({
        quantity: Quantity.parse(row.quantity),
        orderedQuantity: Quantity.parse(row.orderedQuantity),
        receivedQuantity: Quantity.parse(row.receivedQuantity),
        status: row.status,
      }).toString(),
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: onHand.subtract(reserved).toString(),
    };
  });

  return buildOffsetPage(items, Number(totals?.total ?? 0), { page, pageSize: limit });
}

/** Necessidades em aberto de uma peca, para importar no pedido (item 36). */
export async function listOpenNeedsForUnit(context: TenantContext, unitId: string) {
  if (!context.authorizedUnitIds.includes(unitId)) return [];

  return getDb()
    .select({
      id: purchaseNeeds.id,
      partId: purchaseNeeds.partId,
      partCode: parts.code,
      partName: parts.name,
      unitOfMeasure: parts.unitOfMeasure,
      quantity: purchaseNeeds.quantity,
      orderedQuantity: purchaseNeeds.orderedQuantity,
      receivedQuantity: purchaseNeeds.receivedQuantity,
      serviceOrderId: purchaseNeeds.serviceOrderId,
    })
    .from(purchaseNeeds)
    .innerJoin(parts, eq(parts.id, purchaseNeeds.partId))
    .where(
      and(
        eq(purchaseNeeds.tenantId, context.tenantId),
        eq(purchaseNeeds.unitId, unitId),
        inArray(purchaseNeeds.status, ['open', 'ordered']),
      ),
    )
    .orderBy(asc(purchaseNeeds.createdAt), asc(purchaseNeeds.id))
    .limit(100);
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

export interface PurchaseOrderListFilters {
  search?: string;
  status?: string;
  supplierId?: string;
  page?: number;
  pageSize?: number;
}

export interface PurchaseOrderListItem {
  id: string;
  number: number;
  status: string;
  supplierId: string;
  supplierName: string;
  total: string;
  expectedAt: string | null;
  createdAt: Date;
  itemCount: number;
}

export async function listPurchaseOrders(
  context: TenantContext,
  filters: PurchaseOrderListFilters = {},
): Promise<OffsetPage<PurchaseOrderListItem>> {
  const { limit, offset, page } = resolveOffset(filters);

  if (!context.activeUnitId) {
    return buildOffsetPage<PurchaseOrderListItem>([], 0, { page, pageSize: limit });
  }

  const db = getDb();
  const conditions: SQL[] = [
    eq(purchaseOrders.tenantId, context.tenantId),
    eq(purchaseOrders.unitId, context.activeUnitId),
  ];

  const search = filters.search?.trim();
  if (search) {
    const numeric = Number(search.replace(/\D/g, ''));
    const text = normalizeSearchable(search);
    const alternatives: SQL[] = [];
    if (Number.isInteger(numeric) && numeric > 0) {
      alternatives.push(eq(purchaseOrders.number, numeric));
    }
    if (text) {
      alternatives.push(
        like(suppliers.nameSearch, `%${text}%`),
        like(suppliers.tradeNameSearch, `%${text}%`),
      );
    }
    if (alternatives.length) conditions.push(or(...alternatives) as SQL);
  }

  if (filters.status) conditions.push(eq(purchaseOrders.status, filters.status));
  if (filters.supplierId) conditions.push(eq(purchaseOrders.supplierId, filters.supplierId));

  const where = and(...conditions);

  const rows = await db
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.name,
      total: purchaseOrders.total,
      expectedAt: purchaseOrders.expectedAt,
      createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(where)
    .orderBy(desc(purchaseOrders.number), desc(purchaseOrders.id))
    .limit(limit)
    .offset(offset);

  const [totals] = await db
    .select({ total: sql<number>`count(*)` })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(where);

  /** Contagem de itens em UMA consulta para a pagina inteira (item 63). */
  const ids = rows.map((row) => row.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const aggregated = await db
      .select({
        purchaseOrderId: purchaseOrderItems.purchaseOrderId,
        total: sql<number>`count(*)`,
      })
      .from(purchaseOrderItems)
      .where(
        and(
          eq(purchaseOrderItems.tenantId, context.tenantId),
          inArray(purchaseOrderItems.purchaseOrderId, ids),
        ),
      )
      .groupBy(purchaseOrderItems.purchaseOrderId);

    for (const row of aggregated) counts.set(row.purchaseOrderId, Number(row.total ?? 0));
  }

  const items = rows.map((row) => ({ ...row, itemCount: counts.get(row.id) ?? 0 }));
  return buildOffsetPage(items, Number(totals?.total ?? 0), { page, pageSize: limit });
}

export async function findPurchaseOrderDetail(context: TenantContext, purchaseOrderId: string) {
  const db = getDb();

  const [row] = await db
    .select()
    .from(purchaseOrders)
    .where(
      and(eq(purchaseOrders.tenantId, context.tenantId), eq(purchaseOrders.id, purchaseOrderId)),
    )
    .limit(1);

  if (!row) return null;
  if (!context.authorizedUnitIds.includes(row.unitId)) return null;

  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, context.tenantId), eq(suppliers.id, row.supplierId)))
    .limit(1);

  const [items, timeline, receipts, unit] = await Promise.all([
    db
      .select({
        id: purchaseOrderItems.id,
        partId: purchaseOrderItems.partId,
        description: purchaseOrderItems.description,
        supplierCode: purchaseOrderItems.supplierCode,
        unitOfMeasure: purchaseOrderItems.unitOfMeasure,
        quantity: purchaseOrderItems.quantity,
        receivedQuantity: purchaseOrderItems.receivedQuantity,
        unitCost: purchaseOrderItems.unitCost,
        total: purchaseOrderItems.total,
        purchaseNeedId: purchaseOrderItems.purchaseNeedId,
        notes: purchaseOrderItems.notes,
        position: purchaseOrderItems.position,
      })
      .from(purchaseOrderItems)
      .where(
        and(
          eq(purchaseOrderItems.tenantId, context.tenantId),
          eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
        ),
      )
      .orderBy(asc(purchaseOrderItems.position)),

    db
      .select({
        id: purchaseOrderTimeline.id,
        kind: purchaseOrderTimeline.kind,
        summary: purchaseOrderTimeline.summary,
        reason: purchaseOrderTimeline.reason,
        actorId: purchaseOrderTimeline.actorId,
        occurredAt: purchaseOrderTimeline.occurredAt,
      })
      .from(purchaseOrderTimeline)
      .where(
        and(
          eq(purchaseOrderTimeline.tenantId, context.tenantId),
          eq(purchaseOrderTimeline.purchaseOrderId, purchaseOrderId),
        ),
      )
      .orderBy(desc(purchaseOrderTimeline.occurredAt), desc(purchaseOrderTimeline.id))
      .limit(100),

    db
      .select({
        id: purchaseReceipts.id,
        receivedAt: purchaseReceipts.receivedAt,
        documentNumber: purchaseReceipts.documentNumber,
        notes: purchaseReceipts.notes,
        actorId: purchaseReceipts.createdBy,
      })
      .from(purchaseReceipts)
      .where(
        and(
          eq(purchaseReceipts.tenantId, context.tenantId),
          eq(purchaseReceipts.purchaseOrderId, purchaseOrderId),
        ),
      )
      .orderBy(desc(purchaseReceipts.receivedAt), desc(purchaseReceipts.id)),

    db
      .select({ id: units.id, name: units.name })
      .from(units)
      .where(eq(units.id, row.unitId))
      .limit(1),
  ]);

  /** Nomes dos atores em UMA consulta, nunca uma por linha. */
  const actorIds = [
    ...new Set(
      [...timeline.map((entry) => entry.actorId), ...receipts.map((entry) => entry.actorId)].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ];

  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const rows_ = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, context.tenantId), inArray(users.id, actorIds)));
    for (const entry of rows_) names.set(entry.id, entry.name);
  }

  return {
    order: row,
    supplier: supplier ?? null,
    unitName: unit[0]?.name ?? null,
    items,
    timeline: timeline.map((entry) => ({
      ...entry,
      actorName: entry.actorId ? (names.get(entry.actorId) ?? null) : null,
    })),
    receipts: receipts.map((entry) => ({
      ...entry,
      actorName: entry.actorId ? (names.get(entry.actorId) ?? null) : null,
    })),
  };
}

/** Localizacoes ativas da unidade do pedido, para o recebimento (item 39). */
export async function listLocationsForUnit(context: TenantContext, unitId: string) {
  if (!context.authorizedUnitIds.includes(unitId)) return [];

  return getDb()
    .select({ id: stockLocations.id, name: stockLocations.name })
    .from(stockLocations)
    .where(
      and(
        eq(stockLocations.tenantId, context.tenantId),
        eq(stockLocations.unitId, unitId),
        eq(stockLocations.status, 'active'),
      ),
    )
    .orderBy(asc(stockLocations.name), asc(stockLocations.id));
}

// ---------------------------------------------------------------------------
// Historico de preco (itens 7 e 28)
// ---------------------------------------------------------------------------

export interface PriceHistoryItem {
  id: string;
  supplierId: string;
  supplierName: string;
  quantity: string;
  unitCost: string;
  observedLeadTimeDays: number | null;
  purchaseOrderNumber: number;
  occurredAt: Date;
}

/**
 * Quanto se pagou nesta peca, de quem, e quando.
 *
 * APPEND-ONLY: cada recebimento acrescenta uma linha, e nenhuma sobrescreve a
 * anterior. E isto — e nao `supplier_parts.last_unit_cost` — que responde
 * "como o custo evoluiu".
 */
export async function listPriceHistoryForPart(
  context: TenantContext,
  partId: string,
  limit = 25,
): Promise<PriceHistoryItem[]> {
  return getDb()
    .select({
      id: purchasePriceHistory.id,
      supplierId: purchasePriceHistory.supplierId,
      supplierName: suppliers.name,
      quantity: purchasePriceHistory.quantity,
      unitCost: purchasePriceHistory.unitCost,
      observedLeadTimeDays: purchasePriceHistory.observedLeadTimeDays,
      purchaseOrderNumber: purchaseOrders.number,
      occurredAt: purchasePriceHistory.occurredAt,
    })
    .from(purchasePriceHistory)
    .innerJoin(suppliers, eq(suppliers.id, purchasePriceHistory.supplierId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchasePriceHistory.purchaseOrderId))
    .where(
      and(
        eq(purchasePriceHistory.tenantId, context.tenantId),
        eq(purchasePriceHistory.partId, partId),
      ),
    )
    .orderBy(desc(purchasePriceHistory.occurredAt), desc(purchasePriceHistory.id))
    .limit(Math.min(limit, 100));
}

/**
 * Pecas abaixo do minimo na unidade ativa — a SUGESTAO de compra (item 32).
 *
 * NAO CRIA NECESSIDADE NENHUMA. E uma consulta: a tela mostra o que esta
 * faltando, e quem registra a necessidade e quem compra e uma pessoa. Foi a
 * opcao mais simples e segura entre as duas que o item 32 aceita.
 */
export async function listLowStockSuggestions(context: TenantContext, limit = 50) {
  if (!context.activeUnitId) return [];

  return getDb()
    .select({
      partId: parts.id,
      partCode: parts.code,
      partName: parts.name,
      unitOfMeasure: parts.unitOfMeasure,
      onHand: stockBalances.onHand,
      reserved: stockBalances.reserved,
      minimumQuantity: stockBalances.minimumQuantity,
    })
    .from(stockBalances)
    .innerJoin(parts, eq(parts.id, stockBalances.partId))
    .where(
      and(
        eq(stockBalances.tenantId, context.tenantId),
        eq(stockBalances.unitId, context.activeUnitId),
        eq(parts.status, 'active'),
        gt(stockBalances.minimumQuantity, '0'),
        sql`${stockBalances.onHand} - ${stockBalances.reserved} < ${stockBalances.minimumQuantity}`,
      ),
    )
    .orderBy(asc(parts.nameSearch))
    .limit(Math.min(limit, 200));
}

/** Movimentacoes de estoque que esta compra produziu. */
export async function listReceiptMovements(context: TenantContext, purchaseOrderId: string) {
  return getDb()
    .select({
      id: purchaseReceiptItems.id,
      stockMovementId: purchaseReceiptItems.stockMovementId,
      partId: purchaseReceiptItems.partId,
      quantity: purchaseReceiptItems.quantity,
      unitCost: purchaseReceiptItems.unitCost,
      receiptId: purchaseReceiptItems.purchaseReceiptId,
    })
    .from(purchaseReceiptItems)
    .innerJoin(purchaseReceipts, eq(purchaseReceipts.id, purchaseReceiptItems.purchaseReceiptId))
    .where(
      and(
        eq(purchaseReceiptItems.tenantId, context.tenantId),
        eq(purchaseReceipts.purchaseOrderId, purchaseOrderId),
      ),
    )
    .orderBy(asc(purchaseReceiptItems.createdAt));
}

/**
 * A Ordem de Servico que originou a necessidade, quando a pessoa chegou a tela
 * pelo atalho da OS (item 29).
 *
 * Devolve `null` para OS de outra empresa ou de unidade que a pessoa nao
 * opera — e o mesmo silencio das demais consultas: quem nao alcanca a unidade
 * nao recebe a confirmacao de que a OS existe.
 */
export async function findServiceOrderForNeed(context: TenantContext, serviceOrderId: string) {
  const [row] = await getDb()
    .select({
      id: serviceOrders.id,
      number: serviceOrders.number,
      unitId: serviceOrders.unitId,
    })
    .from(serviceOrders)
    .where(and(eq(serviceOrders.tenantId, context.tenantId), eq(serviceOrders.id, serviceOrderId)))
    .limit(1);

  if (!row || !context.authorizedUnitIds.includes(row.unitId)) return null;
  return row;
}

import 'server-only';
import { and, asc, desc, eq, gte, inArray, like, lte, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import {
  buildOffsetPage,
  resolveOffset,
  type OffsetPage,
  type OffsetPageRequest,
} from '@/core/db/pagination';
import { Money } from '@/core/money/money';
import { normalizeSearchable } from '@/core/text/normalize';
import { todayIn } from '@/core/time/civil-date';
import { customers } from '@/modules/customers/infrastructure/schema';
import {
  isTitleOverdue,
  outstandingOf,
  type TitleDirection,
} from '@/modules/finance/domain/finance';
import {
  cashSessions,
  financialAccounts,
  financialCategories,
  financialInstallments,
  financialMovements,
  financialSettlements,
  financialTitles,
  financialTitleTimeline,
  paymentMethods,
} from '@/modules/finance/infrastructure/schema';
import { purchaseOrders, suppliers } from '@/modules/purchasing/infrastructure/schema';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { units } from '@/modules/tenancy/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * CONSULTAS DO FINANCEIRO (Prompt 12, itens 63 a 71 e 102).
 *
 * Paginacao no banco, filtros no banco, ordenacao deterministica. Nenhuma
 * consulta traz a tabela inteira para somar em JavaScript, e nenhuma faz N+1.
 *
 * "VENCIDO" E DERIVADO, nunca lido de uma coluna: e situacao aberta, com saldo,
 * e vencimento no passado NO FUSO DA EMPRESA (item 10).
 */

// ---------------------------------------------------------------------------
// Listagem de titulos (itens 65 e 66)
// ---------------------------------------------------------------------------

export interface TitleListFilters extends OffsetPageRequest {
  search?: string;
  status?: string;
  /** `overdue` filtra o que ja venceu e ainda deve. */
  filter?: string;
  customerId?: string;
  supplierId?: string;
  serviceOrderId?: string;
  dueFrom?: string;
  dueTo?: string;
}

export interface TitleListItem {
  id: string;
  number: number;
  direction: TitleDirection;
  description: string;
  counterpartyName: string | null;
  customerId: string | null;
  supplierId: string | null;
  serviceOrderId: string | null;
  serviceOrderNumber: number | null;
  purchaseOrderNumber: number | null;
  categoryName: string | null;
  amount: string;
  settledAmount: string;
  outstanding: string;
  dueDate: string;
  installmentCount: number;
  status: string;
  overdue: boolean;
  unitId: string;
  createdAt: Date;
}

function searchCondition(rawQuery: string): SQL | undefined {
  const text = normalizeSearchable(rawQuery);
  const conditions: SQL[] = [];

  if (text) {
    conditions.push(
      like(sql`LOWER(${financialTitles.description})`, `%${text}%`),
      like(customers.nameNormalized, `%${text}%`),
      like(suppliers.nameSearch, `%${text}%`),
      like(sql`LOWER(${financialTitles.payeeName})`, `%${text}%`),
    );
  }

  const digits = rawQuery.replace(/\D/g, '');
  if (digits) {
    conditions.push(eq(financialTitles.number, Number(digits)));
  }

  if (conditions.length === 0) return undefined;
  return or(...conditions);
}

/**
 * Titulos da UNIDADE ATIVA, numa direcao.
 *
 * O financeiro de uma loja nao e o da outra: somar as duas numa lista so
 * responderia uma pergunta que ninguem faz no balcao.
 */
export async function listFinancialTitles(
  context: TenantContext,
  direction: TitleDirection,
  filters: TitleListFilters = {},
): Promise<OffsetPage<TitleListItem>> {
  const { limit, offset, page } = resolveOffset(filters);

  if (!context.activeUnitId) {
    return buildOffsetPage<TitleListItem>([], 0, { page, pageSize: limit });
  }

  const hoje = todayIn(context.tenantTimezone);
  const conditions: SQL[] = [
    eq(financialTitles.tenantId, context.tenantId),
    eq(financialTitles.unitId, context.activeUnitId),
    eq(financialTitles.direction, direction),
  ];

  if (filters.status) conditions.push(eq(financialTitles.status, filters.status));
  if (filters.customerId) conditions.push(eq(financialTitles.customerId, filters.customerId));
  if (filters.supplierId) conditions.push(eq(financialTitles.supplierId, filters.supplierId));
  if (filters.serviceOrderId) {
    conditions.push(eq(financialTitles.serviceOrderId, filters.serviceOrderId));
  }
  if (filters.dueFrom) conditions.push(gte(financialTitles.dueDate, filters.dueFrom));
  if (filters.dueTo) conditions.push(lte(financialTitles.dueDate, filters.dueTo));

  /**
   * VENCIDO NO BANCO, para nao paginar errado.
   *
   * Filtrar vencidos em JavaScript depois de paginar traria "3 de 25" numa
   * pagina e "0 de 25" na seguinte. A condicao e a mesma do dominio — aberto,
   * com saldo, vencimento passado — escrita em SQL e com a data de HOJE
   * calculada no fuso da empresa antes de descer.
   */
  if (filters.filter === 'overdue') {
    conditions.push(
      sql`${financialTitles.status} IN ('open', 'partially_settled')`,
      sql`${financialTitles.amount} > ${financialTitles.settledAmount}`,
      sql`${financialTitles.dueDate} < ${hoje}`,
    );
  }
  if (filters.filter === 'open') {
    conditions.push(sql`${financialTitles.status} IN ('open', 'partially_settled')`);
  }

  if (filters.search) {
    const condition = searchCondition(filters.search);
    if (condition) conditions.push(condition);
  }

  const where = and(...conditions);
  const db = getDb();

  const base = db
    .select({
      id: financialTitles.id,
      number: financialTitles.number,
      direction: financialTitles.direction,
      description: financialTitles.description,
      customerId: financialTitles.customerId,
      supplierId: financialTitles.supplierId,
      customerName: customers.name,
      supplierName: suppliers.name,
      payeeName: financialTitles.payeeName,
      serviceOrderId: financialTitles.serviceOrderId,
      serviceOrderNumber: serviceOrders.number,
      purchaseOrderNumber: purchaseOrders.number,
      categoryName: financialCategories.name,
      amount: financialTitles.amount,
      settledAmount: financialTitles.settledAmount,
      dueDate: financialTitles.dueDate,
      installmentCount: financialTitles.installmentCount,
      status: financialTitles.status,
      unitId: financialTitles.unitId,
      createdAt: financialTitles.createdAt,
    })
    .from(financialTitles)
    .leftJoin(customers, eq(customers.id, financialTitles.customerId))
    .leftJoin(suppliers, eq(suppliers.id, financialTitles.supplierId))
    .leftJoin(serviceOrders, eq(serviceOrders.id, financialTitles.serviceOrderId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, financialTitles.purchaseOrderId))
    .leftJoin(financialCategories, eq(financialCategories.id, financialTitles.categoryId))
    .where(where);

  const [rows, totals] = await Promise.all([
    base
      .orderBy(asc(financialTitles.dueDate), desc(financialTitles.number))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(financialTitles)
      .leftJoin(customers, eq(customers.id, financialTitles.customerId))
      .leftJoin(suppliers, eq(suppliers.id, financialTitles.supplierId))
      .where(where),
  ]);

  const items: TitleListItem[] = rows.map((row) => {
    const outstanding = outstandingOf({
      amount: Money.parse(row.amount),
      settledAmount: Money.parse(row.settledAmount),
    });

    return {
      id: row.id,
      number: row.number,
      direction: row.direction as TitleDirection,
      description: row.description,
      counterpartyName: row.customerName ?? row.supplierName ?? row.payeeName,
      customerId: row.customerId,
      supplierId: row.supplierId,
      serviceOrderId: row.serviceOrderId,
      serviceOrderNumber: row.serviceOrderNumber,
      purchaseOrderNumber: row.purchaseOrderNumber,
      categoryName: row.categoryName,
      amount: row.amount,
      settledAmount: row.settledAmount,
      outstanding: outstanding.toString(),
      dueDate: row.dueDate,
      installmentCount: row.installmentCount,
      status: row.status,
      overdue: isTitleOverdue(
        { status: row.status, dueDate: row.dueDate, outstanding },
        context.tenantTimezone,
      ),
      unitId: row.unitId,
      createdAt: row.createdAt,
    };
  });

  return buildOffsetPage(items, Number(totals[0]?.total ?? 0), { page, pageSize: limit });
}

// ---------------------------------------------------------------------------
// Ficha do titulo
// ---------------------------------------------------------------------------

export async function findTitleDetail(context: TenantContext, titleId: string) {
  const db = getDb();

  const [row] = await db
    .select()
    .from(financialTitles)
    .where(and(eq(financialTitles.tenantId, context.tenantId), eq(financialTitles.id, titleId)))
    .limit(1);

  if (!row) return null;
  if (!context.authorizedUnitIds.includes(row.unitId)) return null;

  const [installments, settlements, timeline, counterparty, unit] = await Promise.all([
    db
      .select({
        id: financialInstallments.id,
        number: financialInstallments.number,
        amount: financialInstallments.amount,
        settledAmount: financialInstallments.settledAmount,
        dueDate: financialInstallments.dueDate,
        status: financialInstallments.status,
      })
      .from(financialInstallments)
      .where(
        and(
          eq(financialInstallments.tenantId, context.tenantId),
          eq(financialInstallments.titleId, titleId),
        ),
      )
      .orderBy(asc(financialInstallments.number)),

    db
      .select({
        id: financialSettlements.id,
        amount: financialSettlements.amount,
        effectiveDate: financialSettlements.effectiveDate,
        status: financialSettlements.status,
        reference: financialSettlements.reference,
        notes: financialSettlements.notes,
        reversalReason: financialSettlements.reversalReason,
        installmentNumber: financialInstallments.number,
        accountName: financialAccounts.name,
        methodName: paymentMethods.name,
        methodKind: paymentMethods.kind,
        cardInstallments: financialSettlements.cardInstallments,
        actorId: financialSettlements.createdBy,
        createdAt: financialSettlements.createdAt,
      })
      .from(financialSettlements)
      .innerJoin(
        financialInstallments,
        eq(financialInstallments.id, financialSettlements.installmentId),
      )
      .innerJoin(
        financialAccounts,
        eq(financialAccounts.id, financialSettlements.financialAccountId),
      )
      .innerJoin(paymentMethods, eq(paymentMethods.id, financialSettlements.paymentMethodId))
      .where(
        and(
          eq(financialSettlements.tenantId, context.tenantId),
          eq(financialSettlements.titleId, titleId),
        ),
      )
      .orderBy(desc(financialSettlements.createdAt)),

    db
      .select({
        id: financialTitleTimeline.id,
        kind: financialTitleTimeline.kind,
        summary: financialTitleTimeline.summary,
        reason: financialTitleTimeline.reason,
        actorId: financialTitleTimeline.actorId,
        occurredAt: financialTitleTimeline.occurredAt,
      })
      .from(financialTitleTimeline)
      .where(
        and(
          eq(financialTitleTimeline.tenantId, context.tenantId),
          eq(financialTitleTimeline.titleId, titleId),
        ),
      )
      .orderBy(desc(financialTitleTimeline.occurredAt), desc(financialTitleTimeline.id))
      .limit(100),

    resolveCounterpartyName(context, row),

    db
      .select({ id: units.id, name: units.name })
      .from(units)
      .where(eq(units.id, row.unitId))
      .limit(1),
  ]);

  /** Nomes dos atores em UMA consulta, nunca uma por linha. */
  const actorIds = [
    ...new Set(
      [...timeline.map((e) => e.actorId), ...settlements.map((e) => e.actorId)].filter(
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
    title: row,
    counterpartyName: counterparty,
    unitName: unit[0]?.name ?? null,
    installments,
    settlements: settlements.map((entry) => ({
      ...entry,
      actorName: entry.actorId ? (names.get(entry.actorId) ?? null) : null,
    })),
    timeline: timeline.map((entry) => ({
      ...entry,
      actorName: entry.actorId ? (names.get(entry.actorId) ?? null) : null,
    })),
  };
}

async function resolveCounterpartyName(
  context: TenantContext,
  row: { customerId: string | null; supplierId: string | null; payeeName: string | null },
): Promise<string | null> {
  if (row.customerId) {
    const [cliente] = await getDb()
      .select({ name: customers.name })
      .from(customers)
      .where(and(eq(customers.tenantId, context.tenantId), eq(customers.id, row.customerId)))
      .limit(1);
    return cliente?.name ?? null;
  }
  if (row.supplierId) {
    const [fornecedor] = await getDb()
      .select({ name: suppliers.name })
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, context.tenantId), eq(suppliers.id, row.supplierId)))
      .limit(1);
    return fornecedor?.name ?? null;
  }
  return row.payeeName;
}

// ---------------------------------------------------------------------------
// Visao geral (item 63)
// ---------------------------------------------------------------------------

export interface FinanceOverview {
  receivableOpen: string;
  receivableOverdue: string;
  payableOpen: string;
  payableOverdue: string;
  receivedInPeriod: string;
  paidInPeriod: string;
  accounts: Array<{ id: string; name: string; kind: string; balance: string }>;
  upcoming: Array<{
    titleId: string;
    direction: TitleDirection;
    description: string;
    counterpartyName: string | null;
    dueDate: string;
    outstanding: string;
    overdue: boolean;
  }>;
}

/**
 * SO METRICAS CUJA DEFINICAO E CONFIAVEL (item 63).
 *
 * Nao ha "lucro" aqui: receita menos algumas despesas nao e lucro, e chamar
 * assim seria inventar um KPI sem fonte da verdade. Nao ha DRE. O que existe e
 * o que o balcao consegue conferir: quanto ha para receber, quanto venceu,
 * quanto entrou no periodo, e quanto tem em cada conta.
 */
export async function loadFinanceOverview(
  context: TenantContext,
  period: { from: string; to: string },
): Promise<FinanceOverview> {
  if (!context.activeUnitId) {
    return {
      receivableOpen: '0.00',
      receivableOverdue: '0.00',
      payableOpen: '0.00',
      payableOverdue: '0.00',
      receivedInPeriod: '0.00',
      paidInPeriod: '0.00',
      accounts: [],
      upcoming: [],
    };
  }

  const db = getDb();
  const unitId = context.activeUnitId;
  const hoje = todayIn(context.tenantTimezone);

  const abertoPorDirecao = db
    .select({
      direction: financialTitles.direction,
      overdue: sql<number>`CASE WHEN ${financialTitles.dueDate} < ${hoje} THEN 1 ELSE 0 END`,
      total: sql<string>`COALESCE(SUM(${financialTitles.amount} - ${financialTitles.settledAmount}), 0)`,
    })
    .from(financialTitles)
    .where(
      and(
        eq(financialTitles.tenantId, context.tenantId),
        eq(financialTitles.unitId, unitId),
        sql`${financialTitles.status} IN ('open', 'partially_settled')`,
      ),
    )
    .groupBy(
      financialTitles.direction,
      sql`CASE WHEN ${financialTitles.dueDate} < ${hoje} THEN 1 ELSE 0 END`,
    );

  const liquidadoNoPeriodo = db
    .select({
      direction: financialSettlements.direction,
      total: sql<string>`COALESCE(SUM(${financialSettlements.amount}), 0)`,
    })
    .from(financialSettlements)
    .where(
      and(
        eq(financialSettlements.tenantId, context.tenantId),
        eq(financialSettlements.unitId, unitId),
        eq(financialSettlements.status, 'confirmed'),
        gte(financialSettlements.effectiveDate, period.from),
        lte(financialSettlements.effectiveDate, period.to),
      ),
    )
    .groupBy(financialSettlements.direction);

  const contas = db
    .select({
      id: financialAccounts.id,
      name: financialAccounts.name,
      kind: financialAccounts.kind,
      balance: financialAccounts.currentBalance,
      unitId: financialAccounts.unitId,
    })
    .from(financialAccounts)
    .where(
      and(eq(financialAccounts.tenantId, context.tenantId), eq(financialAccounts.status, 'active')),
    )
    .orderBy(asc(financialAccounts.nameSearch));

  const proximos = db
    .select({
      titleId: financialTitles.id,
      direction: financialTitles.direction,
      description: financialTitles.description,
      customerName: customers.name,
      supplierName: suppliers.name,
      payeeName: financialTitles.payeeName,
      dueDate: financialInstallments.dueDate,
      amount: financialInstallments.amount,
      settledAmount: financialInstallments.settledAmount,
      status: financialInstallments.status,
    })
    .from(financialInstallments)
    .innerJoin(financialTitles, eq(financialTitles.id, financialInstallments.titleId))
    .leftJoin(customers, eq(customers.id, financialTitles.customerId))
    .leftJoin(suppliers, eq(suppliers.id, financialTitles.supplierId))
    .where(
      and(
        eq(financialInstallments.tenantId, context.tenantId),
        eq(financialInstallments.unitId, unitId),
        sql`${financialInstallments.status} IN ('open', 'partially_settled')`,
      ),
    )
    .orderBy(asc(financialInstallments.dueDate))
    .limit(10);

  const [abertos, liquidados, listaContas, listaProximos] = await Promise.all([
    abertoPorDirecao,
    liquidadoNoPeriodo,
    contas,
    proximos,
  ]);

  const soma = (direction: string, overdue: number) =>
    abertos
      .filter((row) => row.direction === direction && Number(row.overdue) === overdue)
      .reduce((total, row) => total.add(Money.parse(String(row.total))), Money.zero())
      .toString();

  const somaAberto = (direction: string) =>
    abertos
      .filter((row) => row.direction === direction)
      .reduce((total, row) => total.add(Money.parse(String(row.total))), Money.zero())
      .toString();

  const liquidado = (direction: string) =>
    liquidados
      .filter((row) => row.direction === direction)
      .reduce((total, row) => total.add(Money.parse(String(row.total))), Money.zero())
      .toString();

  return {
    receivableOpen: somaAberto('receivable'),
    receivableOverdue: soma('receivable', 1),
    payableOpen: somaAberto('payable'),
    payableOverdue: soma('payable', 1),
    receivedInPeriod: liquidado('receivable'),
    paidInPeriod: liquidado('payable'),
    /** Contas da empresa e da unidade ativa; as de outra loja nao entram. */
    accounts: listaContas
      .filter((row) => row.unitId === null || row.unitId === unitId)
      .map((row) => ({ id: row.id, name: row.name, kind: row.kind, balance: row.balance })),
    upcoming: listaProximos.map((row) => {
      const outstanding = outstandingOf({
        amount: Money.parse(row.amount),
        settledAmount: Money.parse(row.settledAmount),
      });
      return {
        titleId: row.titleId,
        direction: row.direction as TitleDirection,
        description: row.description,
        counterpartyName: row.customerName ?? row.supplierName ?? row.payeeName,
        dueDate: row.dueDate,
        outstanding: outstanding.toString(),
        overdue: isTitleOverdue(
          { status: row.status, dueDate: row.dueDate, outstanding },
          context.tenantTimezone,
        ),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Fluxo de caixa (item 64)
// ---------------------------------------------------------------------------

export interface CashFlowRow {
  date: string;
  inflow: string;
  outflow: string;
}

export interface CashFlowResult {
  /** O que JA aconteceu: movimentos no ledger. */
  realized: CashFlowRow[];
  /** O que AINDA vai acontecer: parcelas em aberto por vencimento. */
  forecast: CashFlowRow[];
}

/**
 * REALIZADO E PREVISTO NAO SE SOMAM (item 64).
 *
 * Sao duas listas separadas, e a tela as mostra em blocos distintos. Juntar as
 * duas num numero so transformaria uma promessa em dinheiro — que e
 * exatamente o erro que este modulo inteiro existe para evitar.
 */
export async function loadCashFlow(
  context: TenantContext,
  period: { from: string; to: string },
): Promise<CashFlowResult> {
  if (!context.activeUnitId) return { realized: [], forecast: [] };

  const db = getDb();
  const unitId = context.activeUnitId;

  const [realizado, previsto] = await Promise.all([
    db
      .select({
        date: financialMovements.effectiveDate,
        direction: financialMovements.direction,
        total: sql<string>`COALESCE(SUM(${financialMovements.amount}), 0)`,
      })
      .from(financialMovements)
      .where(
        and(
          eq(financialMovements.tenantId, context.tenantId),
          eq(financialMovements.unitId, unitId),
          gte(financialMovements.effectiveDate, period.from),
          lte(financialMovements.effectiveDate, period.to),
        ),
      )
      .groupBy(financialMovements.effectiveDate, financialMovements.direction)
      .orderBy(asc(financialMovements.effectiveDate)),

    db
      .select({
        date: financialInstallments.dueDate,
        direction: financialTitles.direction,
        total: sql<string>`COALESCE(SUM(${financialInstallments.amount} - ${financialInstallments.settledAmount}), 0)`,
      })
      .from(financialInstallments)
      .innerJoin(financialTitles, eq(financialTitles.id, financialInstallments.titleId))
      .where(
        and(
          eq(financialInstallments.tenantId, context.tenantId),
          eq(financialInstallments.unitId, unitId),
          sql`${financialInstallments.status} IN ('open', 'partially_settled')`,
          gte(financialInstallments.dueDate, period.from),
          lte(financialInstallments.dueDate, period.to),
        ),
      )
      .groupBy(financialInstallments.dueDate, financialTitles.direction)
      .orderBy(asc(financialInstallments.dueDate)),
  ]);

  return {
    realized: agrupar(realizado, (row) => row.direction === 'inflow'),
    forecast: agrupar(previsto, (row) => row.direction === 'receivable'),
  };
}

function agrupar<T extends { date: string; total: string }>(
  rows: T[],
  isInflow: (row: T) => boolean,
): CashFlowRow[] {
  const mapa = new Map<string, { inflow: Money; outflow: Money }>();

  for (const row of rows) {
    const atual = mapa.get(row.date) ?? { inflow: Money.zero(), outflow: Money.zero() };
    const amount = Money.parse(String(row.total));
    if (isInflow(row)) atual.inflow = atual.inflow.add(amount);
    else atual.outflow = atual.outflow.add(amount);
    mapa.set(row.date, atual);
  }

  return [...mapa.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, valores]) => ({
      date,
      inflow: valores.inflow.toString(),
      outflow: valores.outflow.toString(),
    }));
}

// ---------------------------------------------------------------------------
// Resumos para outros modulos (itens 68 a 71)
// ---------------------------------------------------------------------------

export interface FinancialSummary {
  total: string;
  settled: string;
  outstanding: string;
  overdue: string;
  titles: Array<{
    id: string;
    number: number;
    direction: TitleDirection;
    description: string;
    amount: string;
    outstanding: string;
    dueDate: string;
    status: string;
    overdue: boolean;
  }>;
}

async function summarizeTitles(context: TenantContext, condition: SQL): Promise<FinancialSummary> {
  const rows = await getDb()
    .select({
      id: financialTitles.id,
      number: financialTitles.number,
      direction: financialTitles.direction,
      description: financialTitles.description,
      amount: financialTitles.amount,
      settledAmount: financialTitles.settledAmount,
      dueDate: financialTitles.dueDate,
      status: financialTitles.status,
      unitId: financialTitles.unitId,
    })
    .from(financialTitles)
    .where(and(eq(financialTitles.tenantId, context.tenantId), condition))
    .orderBy(asc(financialTitles.dueDate), desc(financialTitles.number))
    .limit(50);

  /** So titulos de unidades que a pessoa opera (item 54). */
  const visiveis = rows.filter((row) => context.authorizedUnitIds.includes(row.unitId));

  let total = Money.zero();
  let settled = Money.zero();
  let overdueTotal = Money.zero();

  const titles = visiveis
    .filter((row) => row.status !== 'cancelled')
    .map((row) => {
      const amount = Money.parse(row.amount);
      const settledAmount = Money.parse(row.settledAmount);
      const outstanding = outstandingOf({ amount, settledAmount });
      const overdue = isTitleOverdue(
        { status: row.status, dueDate: row.dueDate, outstanding },
        context.tenantTimezone,
      );

      total = total.add(amount);
      settled = settled.add(settledAmount);
      if (overdue) overdueTotal = overdueTotal.add(outstanding);

      return {
        id: row.id,
        number: row.number,
        direction: row.direction as TitleDirection,
        description: row.description,
        amount: row.amount,
        outstanding: outstanding.toString(),
        dueDate: row.dueDate,
        status: row.status,
        overdue,
      };
    });

  return {
    total: total.toString(),
    settled: settled.toString(),
    outstanding: total.subtract(settled).toString(),
    overdue: overdueTotal.toString(),
    titles,
  };
}

/** Resumo financeiro da Ordem de Servico (item 68). */
export async function summarizeServiceOrderFinance(
  context: TenantContext,
  serviceOrderId: string,
): Promise<FinancialSummary> {
  return summarizeTitles(context, eq(financialTitles.serviceOrderId, serviceOrderId));
}

/** Resumo financeiro do pedido de compra (item 69). */
export async function summarizePurchaseOrderFinance(
  context: TenantContext,
  purchaseOrderId: string,
): Promise<FinancialSummary> {
  return summarizeTitles(context, eq(financialTitles.purchaseOrderId, purchaseOrderId));
}

/** Resumo financeiro do cliente (item 70). Sem score, sem bloqueio automatico. */
export async function summarizeCustomerFinance(
  context: TenantContext,
  customerId: string,
): Promise<FinancialSummary> {
  return summarizeTitles(context, eq(financialTitles.customerId, customerId));
}

/** Resumo financeiro do fornecedor (item 71). Nao e historico de precos. */
export async function summarizeSupplierFinance(
  context: TenantContext,
  supplierId: string,
): Promise<FinancialSummary> {
  return summarizeTitles(context, eq(financialTitles.supplierId, supplierId));
}

// ---------------------------------------------------------------------------
// Extrato e caixa
// ---------------------------------------------------------------------------

export async function listAccountMovements(context: TenantContext, accountId: string, limit = 50) {
  return getDb()
    .select({
      id: financialMovements.id,
      direction: financialMovements.direction,
      amount: financialMovements.amount,
      resultingBalance: financialMovements.resultingBalance,
      originKind: financialMovements.originKind,
      reference: financialMovements.reference,
      effectiveDate: financialMovements.effectiveDate,
      occurredAt: financialMovements.occurredAt,
      reversalOfMovementId: financialMovements.reversalOfMovementId,
    })
    .from(financialMovements)
    .where(
      and(
        eq(financialMovements.tenantId, context.tenantId),
        eq(financialMovements.financialAccountId, accountId),
      ),
    )
    .orderBy(desc(financialMovements.occurredAt), desc(financialMovements.id))
    .limit(Math.min(limit, 200));
}

export async function listCashSessions(context: TenantContext, limit = 25) {
  if (!context.activeUnitId) return [];

  return getDb()
    .select({
      id: cashSessions.id,
      accountName: financialAccounts.name,
      openedAt: cashSessions.openedAt,
      closedAt: cashSessions.closedAt,
      openingAmount: cashSessions.openingAmount,
      countedAmount: cashSessions.countedAmount,
      expectedAmount: cashSessions.expectedAmount,
      differenceAmount: cashSessions.differenceAmount,
      status: cashSessions.status,
    })
    .from(cashSessions)
    .innerJoin(financialAccounts, eq(financialAccounts.id, cashSessions.financialAccountId))
    .where(
      and(
        eq(cashSessions.tenantId, context.tenantId),
        eq(cashSessions.unitId, context.activeUnitId),
      ),
    )
    .orderBy(desc(cashSessions.openedAt))
    .limit(limit);
}

/** Contas financeiras da empresa, para a tela de configuracao. */
export async function listFinancialAccounts(context: TenantContext) {
  return getDb()
    .select({
      id: financialAccounts.id,
      name: financialAccounts.name,
      kind: financialAccounts.kind,
      unitId: financialAccounts.unitId,
      unitName: units.name,
      currentBalance: financialAccounts.currentBalance,
      status: financialAccounts.status,
    })
    .from(financialAccounts)
    .leftJoin(units, eq(units.id, financialAccounts.unitId))
    .where(eq(financialAccounts.tenantId, context.tenantId))
    .orderBy(asc(financialAccounts.nameSearch));
}

export async function listAllPaymentMethods(context: TenantContext) {
  return getDb()
    .select({
      id: paymentMethods.id,
      kind: paymentMethods.kind,
      name: paymentMethods.name,
      status: paymentMethods.status,
      position: paymentMethods.position,
    })
    .from(paymentMethods)
    .where(eq(paymentMethods.tenantId, context.tenantId))
    .orderBy(asc(paymentMethods.position), asc(paymentMethods.nameSearch));
}

export async function listAllCategories(context: TenantContext) {
  return getDb()
    .select({
      id: financialCategories.id,
      kind: financialCategories.kind,
      name: financialCategories.name,
      status: financialCategories.status,
    })
    .from(financialCategories)
    .where(eq(financialCategories.tenantId, context.tenantId))
    .orderBy(asc(financialCategories.kind), asc(financialCategories.nameSearch));
}

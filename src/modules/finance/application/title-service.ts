import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction, type EmitFn, type TransactionExecutor } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { Money } from '@/core/money/money';
import { todayIn } from '@/core/time/civil-date';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { customers } from '@/modules/customers/infrastructure/schema';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  CANCEL_REASON_MAX,
  CANCEL_REASON_MIN,
  categoryMatchesDirection,
  counterpartyMatchesDirection,
  formatTitleNumber,
  INSTALLMENTS_MAX,
  installmentsSumExactly,
  normalizeReason,
  originKeyFor,
  outstandingOf,
  planInstallments,
  sequenceTypeFor,
  TITLE_DESCRIPTION_MAX,
  TITLE_DIRECTIONS,
  TITLE_NOTES_MAX,
  TITLE_ORIGINS,
  TITLE_PAYEE_MAX,
  TITLE_TIMELINE_KINDS,
  titleManagePermission,
  titleNumberPrefix,
  TITLE_NUMBER_PADDING,
  type TitleDirection,
} from '@/modules/finance/domain/finance';
import {
  financialCategories,
  financialInstallments,
  financialSettlements,
  financialTitles,
  financialTitleTimeline,
} from '@/modules/finance/infrastructure/schema';
import {
  purchaseOrders,
  purchaseReceipts,
  suppliers,
} from '@/modules/purchasing/infrastructure/schema';
import { quotes } from '@/modules/quotes/infrastructure/schema';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { allocateSequenceNumber } from '@/modules/tenancy/application/sequence-service';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * TITULOS FINANCEIROS (Prompt 12, itens 6 a 10).
 *
 * Um titulo e uma OBRIGACAO: um direito (a receber) ou um dever (a pagar).
 * Criar um titulo NAO move dinheiro nenhum — quem move e a liquidacao, que e
 * outro fato, com outra data e outra permissao.
 *
 * TODO TITULO TEM PELO MENOS UMA PARCELA. A vista e `1/1`. Isso elimina o ramo
 * "as vezes parcelado" de toda consulta e de toda tela.
 */

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

const civilDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data valida.');

const titleInputSchema = z.object({
  unitId: z.string().trim().min(1, 'Escolha a unidade.'),
  direction: z.enum(TITLE_DIRECTIONS),

  customerId: z.string().trim().optional(),
  supplierId: z.string().trim().optional(),
  payeeName: z.string().trim().max(TITLE_PAYEE_MAX).optional(),

  description: z.string().trim().min(1, 'Informe a descricao.').max(TITLE_DESCRIPTION_MAX),
  categoryId: z.string().trim().optional(),

  /** Valor total da obrigacao, em decimal tecnico. */
  amount: z.string().trim().min(1, 'Informe o valor.'),

  issuedAt: civilDateSchema.optional(),
  dueDate: civilDateSchema,
  installmentCount: z.coerce.number().int().min(1).max(INSTALLMENTS_MAX).default(1),

  origin: z.enum(TITLE_ORIGINS).default('manual'),
  serviceOrderId: z.string().trim().optional(),
  quoteId: z.string().trim().optional(),
  purchaseOrderId: z.string().trim().optional(),
  purchaseReceiptId: z.string().trim().optional(),

  notes: z.string().trim().max(TITLE_NOTES_MAX).optional(),
});

export type TitleInput = z.infer<typeof titleInputSchema>;

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
  permission: Parameters<typeof authorize>[1]['permission'],
): Promise<void> {
  assertUnitAuthorized(context, unitId);
  await authorize(context, { permission, featureKey: FEATURES.FINANCE_CORE, unitId });
}

function parseAmount(raw: string): Money {
  let amount: Money;
  try {
    amount = Money.parse(raw);
  } catch {
    throw new ValidationError('Valor invalido.');
  }
  if (!amount.isPositive()) {
    throw new ValidationError('O valor do titulo precisa ser maior que zero.');
  }
  return amount;
}

// ---------------------------------------------------------------------------
// Criacao
// ---------------------------------------------------------------------------

export interface CreateTitleResult {
  titleId: string;
  number: number;
  formattedNumber: string;
  /** `true` quando a chave de origem reencontrou um titulo que ja existia. */
  reused: boolean;
}

/**
 * Cria a obrigacao, com as parcelas.
 *
 * A CHAVE DE ORIGEM E A TRAVA CONTRA DUPLICACAO (item 38). Titulo de OS ou de
 * recebimento de compra reencontra o que ja existe em vez de criar um segundo —
 * e a UNIQUE no banco e a garantia final, inclusive para duas pessoas clicando
 * ao mesmo tempo.
 */
export async function createFinancialTitle(
  context: TenantContext,
  rawInput: unknown,
): Promise<CreateTitleResult> {
  const input = parse(titleInputSchema, rawInput);
  await authorizeInUnit(context, input.unitId, titleManagePermission(input.direction));

  const amount = parseAmount(input.amount);
  const counterparty = await resolveCounterparty(context, input);
  assertCounterparty(input.direction, counterparty.kind);
  const categoryId = await resolveCategory(context, input);
  const origins = await resolveOrigins(context, input);

  const originKey = originKeyFor(input.origin, originKeyOwner(input) ?? '');

  /** Reencontro antes de criar: transforma a colisao em resposta util. */
  if (originKey) {
    const existing = await findTitleByOriginKey(context.tenantId, originKey);
    if (existing) {
      return {
        titleId: existing.id,
        number: existing.number,
        formattedNumber: formatTitleNumber(input.direction, existing.number),
        reused: true,
      };
    }
  }

  const issuedAt = input.issuedAt || todayIn(context.tenantTimezone);
  const plano = planInstallments(amount, input.installmentCount, input.dueDate);

  /** A invariante do item 9, conferida antes de qualquer gravacao. */
  if (
    !installmentsSumExactly(
      plano.map((parcela) => parcela.amount),
      amount,
    )
  ) {
    throw new BusinessRuleError('A soma das parcelas nao bateu com o total do titulo.');
  }

  const titleId = newId();
  const now = new Date();

  const numero = await runInTransaction(async (tx, emit) => {
    const sequence = await allocateSequenceNumber(
      tx,
      context.tenantId,
      sequenceTypeFor(input.direction),
      { prefix: titleNumberPrefix(input.direction), padding: TITLE_NUMBER_PADDING },
    );

    await tx.insert(financialTitles).values({
      id: titleId,
      tenantId: context.tenantId,
      unitId: input.unitId,
      direction: input.direction,
      number: sequence.value,
      counterpartyKind: counterparty.kind,
      customerId: counterparty.customerId,
      supplierId: counterparty.supplierId,
      payeeName: counterparty.payeeName,
      description: input.description,
      categoryId,
      origin: input.origin,
      originKey,
      serviceOrderId: origins.serviceOrderId,
      quoteId: origins.quoteId,
      purchaseOrderId: origins.purchaseOrderId,
      purchaseReceiptId: origins.purchaseReceiptId,
      amount: amount.toString(),
      settledAmount: '0.00',
      issuedAt,
      dueDate: input.dueDate,
      installmentCount: plano.length,
      status: 'open',
      notes: input.notes || null,
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    for (const parcela of plano) {
      await tx.insert(financialInstallments).values({
        id: newId(),
        tenantId: context.tenantId,
        unitId: input.unitId,
        titleId,
        number: parcela.number,
        amount: parcela.amount.toString(),
        settledAmount: '0.00',
        dueDate: parcela.dueDate,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      });
    }

    await writeTitleTimeline(tx, context, {
      titleId,
      kind: TITLE_TIMELINE_KINDS.CREATED,
      summary:
        plano.length === 1
          ? `${input.description} — ${amount.toString()}`
          : `${input.description} — ${amount.toString()} em ${plano.length}x`,
      metadata: { amount: amount.toString(), installments: plano.length },
      now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.FINANCIAL_TITLE_CREATED,
        entityType: 'financial_title',
        entityId: titleId,
        tenantId: context.tenantId,
        unitId: input.unitId,
        userId: context.userId,
        after: {
          direction: input.direction,
          number: sequence.value,
          amount: amount.toString(),
          installments: plano.length,
          origin: input.origin,
        },
      },
      tx,
    );

    await emit({
      type:
        input.direction === 'receivable'
          ? EVENT_TYPES.RECEIVABLE_CREATED
          : EVENT_TYPES.PAYABLE_CREATED,
      tenantId: context.tenantId,
      /** Sem dado pessoal: so chaves tecnicas e o valor (item 109). */
      payload: {
        titleId,
        number: sequence.value,
        unitId: input.unitId,
        direction: input.direction,
        amount: amount.toString(),
        installments: plano.length,
        origin: input.origin,
      },
    });

    return sequence.value;
  });

  return {
    titleId,
    number: numero,
    formattedNumber: formatTitleNumber(input.direction, numero),
    reused: false,
  };
}

/** O id que compoe a chave de origem, conforme o tipo de origem. */
function originKeyOwner(input: TitleInput): string | null {
  if (input.origin === 'service_order') return input.serviceOrderId ?? null;
  if (input.origin === 'purchase_receipt') return input.purchaseReceiptId ?? null;
  return null;
}

async function findTitleByOriginKey(tenantId: string, originKey: string) {
  const [row] = await getDb()
    .select({ id: financialTitles.id, number: financialTitles.number })
    .from(financialTitles)
    .where(and(eq(financialTitles.tenantId, tenantId), eq(financialTitles.originKey, originKey)))
    .limit(1);
  return row ?? null;
}

/**
 * A contraparte, validada contra a direcao (item 8).
 *
 * Conta a receber exige cliente. Conta a pagar aceita fornecedor cadastrado OU
 * beneficiario textual — a conta de energia e o motoboy avulso sao despesas
 * reais, e obrigar um cadastro faria alguem inventar um fornecedor.
 */
async function resolveCounterparty(context: TenantContext, input: TitleInput) {
  if (input.direction === 'receivable') {
    if (!input.customerId) throw new ValidationError('Escolha o cliente da cobranca.');

    const [cliente] = await getDb()
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, context.tenantId), eq(customers.id, input.customerId)))
      .limit(1);

    if (!cliente) throw new NotFoundError('Cliente nao encontrado.');

    return {
      kind: 'customer' as const,
      customerId: cliente.id,
      supplierId: null,
      payeeName: null,
    };
  }

  if (input.supplierId) {
    const [fornecedor] = await getDb()
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, context.tenantId), eq(suppliers.id, input.supplierId)))
      .limit(1);

    if (!fornecedor) throw new NotFoundError('Fornecedor nao encontrado.');

    return {
      kind: 'supplier' as const,
      customerId: null,
      supplierId: fornecedor.id,
      payeeName: null,
    };
  }

  const payee = input.payeeName?.trim();
  if (!payee) {
    throw new ValidationError('Escolha o fornecedor ou informe para quem e o pagamento.');
  }

  return { kind: 'other' as const, customerId: null, supplierId: null, payeeName: payee };
}

/**
 * A invariante do item 8, conferida antes de gravar.
 *
 * A CHECK do banco ja recusaria a combinacao errada. Esta funcao existe para
 * que o erro chegue como frase em portugues, e para que o teste de dominio
 * possa cobra-la sem subir um banco.
 */
function assertCounterparty(direction: TitleDirection, kind: 'customer' | 'supplier' | 'other') {
  if (!counterpartyMatchesDirection(direction, kind)) {
    throw new BusinessRuleError(
      direction === 'receivable'
        ? 'Uma conta a receber precisa de um cliente.'
        : 'Uma conta a pagar precisa de um fornecedor ou de um beneficiario.',
    );
  }
}

async function resolveCategory(context: TenantContext, input: TitleInput): Promise<string | null> {
  if (!input.categoryId) return null;

  const [categoria] = await getDb()
    .select({ id: financialCategories.id, kind: financialCategories.kind })
    .from(financialCategories)
    .where(
      and(
        eq(financialCategories.tenantId, context.tenantId),
        eq(financialCategories.id, input.categoryId),
      ),
    )
    .limit(1);

  if (!categoria) throw new NotFoundError('Categoria nao encontrada.');

  /** Categoria de receita nao entra em conta a pagar, e vice-versa (item 28). */
  if (!categoryMatchesDirection(categoria.kind, input.direction)) {
    throw new BusinessRuleError(
      input.direction === 'receivable'
        ? 'Escolha uma categoria de receita para uma conta a receber.'
        : 'Escolha uma categoria de despesa para uma conta a pagar.',
    );
  }

  return categoria.id;
}

/**
 * Os vinculos com OS, orcamento, pedido e recebimento.
 *
 * Todos OPCIONAIS. Quem confere que eles pertencem a mesma empresa e a mesma
 * unidade sao as FKs compostas do banco; aqui a validacao existe para a pessoa
 * ler uma frase em portugues em vez de um erro de constraint.
 */
async function resolveOrigins(context: TenantContext, input: TitleInput) {
  let serviceOrderId: string | null = null;
  if (input.serviceOrderId) {
    const [os] = await getDb()
      .select({ id: serviceOrders.id, unitId: serviceOrders.unitId })
      .from(serviceOrders)
      .where(
        and(
          eq(serviceOrders.tenantId, context.tenantId),
          eq(serviceOrders.id, input.serviceOrderId),
        ),
      )
      .limit(1);

    if (!os || !context.authorizedUnitIds.includes(os.unitId)) {
      throw new NotFoundError('Ordem de Servico nao encontrada.');
    }
    if (os.unitId !== input.unitId) {
      throw new BusinessRuleError(
        'A Ordem de Servico pertence a outra unidade. Registre a cobranca na unidade dela.',
      );
    }
    serviceOrderId = os.id;
  }

  let quoteId: string | null = null;
  if (input.quoteId) {
    const [orcamento] = await getDb()
      .select({ id: quotes.id })
      .from(quotes)
      .where(and(eq(quotes.tenantId, context.tenantId), eq(quotes.id, input.quoteId)))
      .limit(1);
    if (!orcamento) throw new NotFoundError('Orcamento nao encontrado.');
    quoteId = orcamento.id;
  }

  let purchaseOrderId: string | null = null;
  if (input.purchaseOrderId) {
    const [pedido] = await getDb()
      .select({ id: purchaseOrders.id, unitId: purchaseOrders.unitId })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.tenantId, context.tenantId),
          eq(purchaseOrders.id, input.purchaseOrderId),
        ),
      )
      .limit(1);
    if (!pedido) throw new NotFoundError('Pedido de compra nao encontrado.');
    if (pedido.unitId !== input.unitId) {
      throw new BusinessRuleError('O pedido de compra pertence a outra unidade.');
    }
    purchaseOrderId = pedido.id;
  }

  let purchaseReceiptId: string | null = null;
  if (input.purchaseReceiptId) {
    const [recebimento] = await getDb()
      .select({ id: purchaseReceipts.id })
      .from(purchaseReceipts)
      .where(
        and(
          eq(purchaseReceipts.tenantId, context.tenantId),
          eq(purchaseReceipts.id, input.purchaseReceiptId),
        ),
      )
      .limit(1);
    if (!recebimento) throw new NotFoundError('Recebimento de compra nao encontrado.');
    purchaseReceiptId = recebimento.id;
  }

  return { serviceOrderId, quoteId, purchaseOrderId, purchaseReceiptId };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface FinancialTitleRecord {
  id: string;
  tenantId: string;
  unitId: string;
  direction: TitleDirection;
  number: number;
  status: string;
  amount: string;
  settledAmount: string;
  dueDate: string;
  installmentCount: number;
  customerId: string | null;
  supplierId: string | null;
  serviceOrderId: string | null;
  origin: string;
  version: number;
}

export async function loadFinancialTitle(
  context: TenantContext,
  titleId: string,
): Promise<FinancialTitleRecord> {
  const [row] = await getDb()
    .select({
      id: financialTitles.id,
      tenantId: financialTitles.tenantId,
      unitId: financialTitles.unitId,
      direction: financialTitles.direction,
      number: financialTitles.number,
      status: financialTitles.status,
      amount: financialTitles.amount,
      settledAmount: financialTitles.settledAmount,
      dueDate: financialTitles.dueDate,
      installmentCount: financialTitles.installmentCount,
      customerId: financialTitles.customerId,
      supplierId: financialTitles.supplierId,
      serviceOrderId: financialTitles.serviceOrderId,
      origin: financialTitles.origin,
      version: financialTitles.version,
    })
    .from(financialTitles)
    .where(and(eq(financialTitles.tenantId, context.tenantId), eq(financialTitles.id, titleId)))
    .limit(1);

  if (!row) throw new NotFoundError('Titulo financeiro nao encontrado.');
  if (!context.authorizedUnitIds.includes(row.unitId)) {
    throw new NotFoundError('Titulo financeiro nao encontrado.');
  }

  return { ...row, direction: row.direction as TitleDirection };
}

export async function listInstallmentsOfTitle(context: TenantContext, titleId: string) {
  return getDb()
    .select({
      id: financialInstallments.id,
      number: financialInstallments.number,
      amount: financialInstallments.amount,
      settledAmount: financialInstallments.settledAmount,
      dueDate: financialInstallments.dueDate,
      status: financialInstallments.status,
      version: financialInstallments.version,
    })
    .from(financialInstallments)
    .where(
      and(
        eq(financialInstallments.tenantId, context.tenantId),
        eq(financialInstallments.titleId, titleId),
      ),
    )
    .orderBy(asc(financialInstallments.number));
}

// ---------------------------------------------------------------------------
// Cancelamento (item 72)
// ---------------------------------------------------------------------------

/**
 * CANCELAR NAO APAGA FATO NENHUM (item 72).
 *
 * Titulo sem liquidacao: cancela, com motivo. Titulo que JA RECEBEU dinheiro:
 * recusado — e preciso estornar as liquidacoes primeiro. A alternativa
 * (cancelar so o saldo restante) faria um titulo de R$ 1.000 com R$ 400
 * recebidos virar um titulo de R$ 400 "cancelado", e ninguem conseguiria dizer
 * se aquilo foi combinado ou foi erro.
 */
export async function cancelFinancialTitle(
  context: TenantContext,
  titleId: string,
  rawReason: string,
): Promise<void> {
  const title = await loadFinancialTitle(context, titleId);
  await authorizeInUnit(context, title.unitId, titleManagePermission(title.direction));

  if (title.status === 'cancelled') return;

  const settled = Money.parse(title.settledAmount);
  if (settled.isPositive()) {
    throw new BusinessRuleError(
      title.direction === 'receivable'
        ? 'Este titulo ja recebeu dinheiro. Estorne os recebimentos antes de cancelar.'
        : 'Este titulo ja teve pagamento. Estorne os pagamentos antes de cancelar.',
    );
  }

  let reason: string;
  try {
    reason = normalizeReason(rawReason, CANCEL_REASON_MIN, CANCEL_REASON_MAX, 'O motivo');
  } catch {
    throw new ValidationError(
      `O motivo do cancelamento precisa ter ao menos ${CANCEL_REASON_MIN} caracteres.`,
    );
  }

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    const result = await tx
      .update(financialTitles)
      .set({
        status: 'cancelled',
        cancelReason: reason,
        cancelledAt: now,
        version: title.version + 1,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(financialTitles.tenantId, context.tenantId),
          eq(financialTitles.id, titleId),
          eq(financialTitles.version, title.version),
          /**
           * A CONDICAO DE SALDO VAI NO `WHERE` (ADR-044).
           *
           * Entre a leitura e esta gravacao alguem pode ter recebido. Se
           * recebeu, `settled_amount` deixou de ser zero e este `UPDATE` nao
           * afeta linha nenhuma — o cancelamento e recusado pelo banco, e nao
           * por uma checagem que ja envelheceu.
           */
          eq(financialTitles.settledAmount, '0.00'),
        ),
      );

    if (affectedRows(result) === 0) {
      throw new ConflictError(
        'Este titulo foi alterado por outra pessoa. Recarregue a pagina e confira o que ja foi liquidado.',
      );
    }

    await tx
      .update(financialInstallments)
      .set({ status: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(financialInstallments.tenantId, context.tenantId),
          eq(financialInstallments.titleId, titleId),
        ),
      );

    await writeTitleTimeline(tx, context, {
      titleId,
      kind: TITLE_TIMELINE_KINDS.CANCELLED,
      summary: 'Titulo cancelado',
      reason,
      now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.FINANCIAL_TITLE_CANCELLED,
        entityType: 'financial_title',
        entityId: titleId,
        tenantId: context.tenantId,
        unitId: title.unitId,
        userId: context.userId,
        before: { status: title.status },
        after: { status: 'cancelled', reason },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.FINANCIAL_TITLE_CANCELLED,
      tenantId: context.tenantId,
      payload: { titleId, direction: title.direction, unitId: title.unitId },
    });
  });
}

// ---------------------------------------------------------------------------
// Edicao (item 73)
// ---------------------------------------------------------------------------

const titleEditSchema = z.object({
  description: z.string().trim().min(1).max(TITLE_DESCRIPTION_MAX),
  categoryId: z.string().trim().optional(),
  notes: z.string().trim().max(TITLE_NOTES_MAX).optional(),
});

/**
 * O QUE PODE SER EDITADO DEPOIS (item 73).
 *
 * Descricao, categoria e observacao. E SO. Valor, parcelamento e vencimento
 * NAO mudam depois que o titulo existe: mudar o valor de um titulo que ja
 * recebeu R$ 400 tornaria o historico incoerente, e mudar o de um titulo
 * intocado e o mesmo que cancelar e criar outro — com a diferenca de que o
 * primeiro caminho apaga o rastro e o segundo nao.
 */
export async function updateFinancialTitle(
  context: TenantContext,
  titleId: string,
  rawInput: unknown,
): Promise<void> {
  const title = await loadFinancialTitle(context, titleId);
  await authorizeInUnit(context, title.unitId, titleManagePermission(title.direction));

  if (title.status === 'cancelled') {
    throw new BusinessRuleError('Titulo cancelado nao pode ser alterado.');
  }

  const input = parse(titleEditSchema, rawInput);
  const categoryId = await resolveCategory(context, {
    ...input,
    direction: title.direction,
  } as TitleInput);

  const now = new Date();

  await runInTransaction(async (tx) => {
    const result = await tx
      .update(financialTitles)
      .set({
        description: input.description,
        categoryId,
        notes: input.notes || null,
        version: title.version + 1,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(financialTitles.tenantId, context.tenantId),
          eq(financialTitles.id, titleId),
          eq(financialTitles.version, title.version),
        ),
      );

    if (affectedRows(result) === 0) {
      throw new ConflictError('Este titulo foi alterado por outra pessoa. Recarregue a pagina.');
    }

    await writeTitleTimeline(tx, context, {
      titleId,
      kind: TITLE_TIMELINE_KINDS.UPDATED,
      summary: input.description,
      now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.FINANCIAL_TITLE_UPDATED,
        entityType: 'financial_title',
        entityId: titleId,
        tenantId: context.tenantId,
        unitId: title.unitId,
        userId: context.userId,
        after: { description: input.description },
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Linha do tempo (item 49)
// ---------------------------------------------------------------------------

export async function writeTitleTimeline(
  tx: TransactionExecutor,
  context: TenantContext,
  entry: {
    titleId: string;
    kind: string;
    summary?: string;
    reason?: string | null;
    metadata?: Record<string, unknown>;
    now: Date;
  },
): Promise<void> {
  await tx.insert(financialTitleTimeline).values({
    id: newId(),
    tenantId: context.tenantId,
    titleId: entry.titleId,
    kind: entry.kind,
    summary: entry.summary?.slice(0, 300) ?? null,
    reason: entry.reason ?? null,
    metadata: entry.metadata ?? null,
    actorId: context.userId,
    occurredAt: entry.now,
    createdAt: entry.now,
  });
}

/**
 * RECONCILIACAO DO TITULO (item 105).
 *
 * Recalcula `settled_amount` somando as liquidacoes CONFIRMADAS e compara com
 * a projecao gravada. Uma divergencia e devolvida, nunca corrigida em silencio:
 * um saldo que se conserta sozinho esconde exatamente o defeito que precisaria
 * ser investigado.
 */
export async function reconcileTitle(
  context: TenantContext,
  titleId: string,
): Promise<{ stored: string; computed: string; matches: boolean; outstanding: string }> {
  const title = await loadFinancialTitle(context, titleId);

  const settlements = await getDb()
    .select({ amount: financialSettlements.amount })
    .from(financialSettlements)
    .where(
      and(
        eq(financialSettlements.tenantId, context.tenantId),
        eq(financialSettlements.titleId, titleId),
        eq(financialSettlements.status, 'confirmed'),
      ),
    );

  const computed = settlements.reduce(
    (total, row) => total.add(Money.parse(row.amount)),
    Money.zero(),
  );
  const stored = Money.parse(title.settledAmount);

  return {
    stored: stored.toString(),
    computed: computed.toString(),
    matches: stored.equals(computed),
    outstanding: outstandingOf({
      amount: Money.parse(title.amount),
      settledAmount: computed,
    }).toString(),
  };
}

export type { EmitFn };

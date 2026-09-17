import 'server-only';
import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { normalizeSearchable } from '@/core/text/normalize';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  ACCOUNT_KINDS,
  ACCOUNT_NAME_MAX,
  ACCOUNT_STATUSES,
  CATEGORY_KINDS,
  CATEGORY_NAME_MAX,
  PAYMENT_METHOD_KINDS,
  PAYMENT_METHOD_KIND_LABEL,
  type PaymentMethodKind,
} from '@/modules/finance/domain/finance';
import {
  financialAccounts,
  financialCategories,
  paymentMethods,
} from '@/modules/finance/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * CONFIGURACAO DO FINANCEIRO (Prompt 12, itens 16 a 19 e 28).
 *
 * Contas financeiras, formas de pagamento e categorias. As tres sao do TENANT:
 * a empresa decide onde o dinheiro fica, como ele se move e por que.
 *
 * A conta PODE ter unidade, e so ela: o caixa do balcao pertence a uma loja, a
 * conta bancaria pertence a empresa inteira. Forma de pagamento e categoria
 * nunca tem unidade — "PIX" e "Aluguel" significam a mesma coisa em toda loja.
 */

// ---------------------------------------------------------------------------
// Contas financeiras
// ---------------------------------------------------------------------------

const accountInputSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da conta.').max(ACCOUNT_NAME_MAX),
  kind: z.enum(ACCOUNT_KINDS).default('cash'),
  /** Vazio = conta da empresa inteira. Preenchido = conta de uma unidade. */
  unitId: z.string().trim().optional(),
  description: z.string().trim().max(300).optional(),
});

function parse<T extends z.ZodTypeAny>(schema: T, rawInput: unknown): z.infer<T> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

async function assertAccountNameFree(
  tenantId: string,
  nameSearch: string,
  exceptId?: string,
): Promise<void> {
  const rows = await getDb()
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(
      and(
        eq(financialAccounts.tenantId, tenantId),
        eq(financialAccounts.nameSearch, nameSearch),
        exceptId ? ne(financialAccounts.id, exceptId) : undefined,
      ),
    )
    .limit(1);

  if (rows.length > 0) {
    throw new ConflictError('Ja existe uma conta financeira com este nome.');
  }
}

export async function createFinancialAccount(
  context: TenantContext,
  rawInput: unknown,
): Promise<string> {
  await authorize(context, {
    permission: PERMISSIONS.FINANCE_SETTINGS_MANAGE,
    featureKey: FEATURES.FINANCE_CORE,
  });

  const input = parse(accountInputSchema, rawInput);

  /** Conta de unidade so pode apontar para unidade que a pessoa alcanca. */
  const unitId = input.unitId || null;
  if (unitId && !context.authorizedUnitIds.includes(unitId)) {
    throw new NotFoundError('Unidade nao encontrada.');
  }

  const nameSearch = normalizeSearchable(input.name);
  await assertAccountNameFree(context.tenantId, nameSearch);

  const accountId = newId();
  const now = new Date();

  await runInTransaction(async (tx) => {
    await tx.insert(financialAccounts).values({
      id: accountId,
      tenantId: context.tenantId,
      unitId,
      name: input.name,
      nameSearch,
      kind: input.kind,
      /**
       * Nasce em ZERO, sempre.
       *
       * Saldo inicial de caixa entra pela ABERTURA DE SESSAO, que gera
       * movimento e fica no ledger. Um saldo digitado no cadastro seria
       * dinheiro sem origem — exatamente o que o item 18 proibe.
       */
      currentBalance: '0.00',
      description: input.description || null,
      status: 'active',
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.FINANCIAL_ACCOUNT_CHANGED,
        entityType: 'financial_account',
        entityId: accountId,
        tenantId: context.tenantId,
        unitId,
        userId: context.userId,
        after: { name: input.name, kind: input.kind, unitId },
      },
      tx,
    );
  });

  return accountId;
}

export async function updateFinancialAccount(
  context: TenantContext,
  accountId: string,
  rawInput: unknown,
): Promise<void> {
  await authorize(context, {
    permission: PERMISSIONS.FINANCE_SETTINGS_MANAGE,
    featureKey: FEATURES.FINANCE_CORE,
  });

  const current = await loadFinancialAccount(context, accountId);
  const input = parse(accountInputSchema, rawInput);

  const unitId = input.unitId || null;
  if (unitId && !context.authorizedUnitIds.includes(unitId)) {
    throw new NotFoundError('Unidade nao encontrada.');
  }

  /**
   * O TIPO NAO MUDA depois que a conta tem movimento.
   *
   * Transformar uma conta bancaria em caixa mudaria, retroativamente, o
   * significado de tudo que ja passou por ela — inclusive se aquele dinheiro
   * estava ou nao numa gaveta que alguem conferiu.
   */
  if (input.kind !== current.kind) {
    const [movimento] = await getDb()
      .select({ id: financialAccounts.id })
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.id, accountId),
          eq(financialAccounts.tenantId, context.tenantId),
          ne(financialAccounts.currentBalance, '0.00'),
        ),
      )
      .limit(1);

    if (movimento) {
      throw new BusinessRuleError(
        'Esta conta ja tem saldo. Crie outra conta em vez de mudar o tipo desta.',
      );
    }
  }

  const nameSearch = normalizeSearchable(input.name);
  await assertAccountNameFree(context.tenantId, nameSearch, accountId);

  await runInTransaction(async (tx) => {
    const result = await tx
      .update(financialAccounts)
      .set({
        name: input.name,
        nameSearch,
        kind: input.kind,
        unitId,
        description: input.description || null,
        version: current.version + 1,
        updatedBy: context.userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(financialAccounts.tenantId, context.tenantId),
          eq(financialAccounts.id, accountId),
          eq(financialAccounts.version, current.version),
        ),
      );

    if (affectedRows(result) === 0) {
      throw new ConflictError('Esta conta foi alterada por outra pessoa. Recarregue a pagina.');
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.FINANCIAL_ACCOUNT_CHANGED,
        entityType: 'financial_account',
        entityId: accountId,
        tenantId: context.tenantId,
        unitId,
        userId: context.userId,
        before: { name: current.name, kind: current.kind },
        after: { name: input.name, kind: input.kind },
      },
      tx,
    );
  });
}

export async function changeFinancialAccountStatus(
  context: TenantContext,
  accountId: string,
  status: (typeof ACCOUNT_STATUSES)[number],
): Promise<void> {
  await authorize(context, {
    permission: PERMISSIONS.FINANCE_SETTINGS_MANAGE,
    featureKey: FEATURES.FINANCE_CORE,
  });

  const current = await loadFinancialAccount(context, accountId);
  if (current.status === status) return;

  await runInTransaction(async (tx) => {
    const result = await tx
      .update(financialAccounts)
      .set({
        status,
        version: current.version + 1,
        updatedBy: context.userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(financialAccounts.tenantId, context.tenantId),
          eq(financialAccounts.id, accountId),
          eq(financialAccounts.version, current.version),
        ),
      );

    if (affectedRows(result) === 0) {
      throw new ConflictError('Esta conta foi alterada por outra pessoa. Recarregue a pagina.');
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.FINANCIAL_ACCOUNT_CHANGED,
        entityType: 'financial_account',
        entityId: accountId,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { status: current.status },
        after: { status },
      },
      tx,
    );
  });
}

export interface FinancialAccountRecord {
  id: string;
  tenantId: string;
  unitId: string | null;
  name: string;
  kind: string;
  currentBalance: string;
  status: string;
  version: number;
}

export async function loadFinancialAccount(
  context: TenantContext,
  accountId: string,
): Promise<FinancialAccountRecord> {
  const [row] = await getDb()
    .select({
      id: financialAccounts.id,
      tenantId: financialAccounts.tenantId,
      unitId: financialAccounts.unitId,
      name: financialAccounts.name,
      kind: financialAccounts.kind,
      currentBalance: financialAccounts.currentBalance,
      status: financialAccounts.status,
      version: financialAccounts.version,
    })
    .from(financialAccounts)
    .where(
      and(eq(financialAccounts.tenantId, context.tenantId), eq(financialAccounts.id, accountId)),
    )
    .limit(1);

  if (!row) throw new NotFoundError('Conta financeira nao encontrada.');
  return row;
}

/**
 * A conta pode ser usada NESTA unidade?
 *
 * Conta da empresa (`unitId` nulo) serve a todas. Conta de unidade serve so a
 * ela — e e isso que impede o caixa da loja Centro de receber o dinheiro de um
 * atendimento da loja Norte (item 54).
 */
export function accountServesUnit(account: { unitId: string | null }, unitId: string): boolean {
  return account.unitId === null || account.unitId === unitId;
}

// ---------------------------------------------------------------------------
// Formas de pagamento
// ---------------------------------------------------------------------------

const methodInputSchema = z.object({
  kind: z.enum(PAYMENT_METHOD_KINDS),
  name: z.string().trim().min(1, 'Informe o nome.').max(80),
  position: z.coerce.number().int().min(0).max(999).optional(),
});

export async function createPaymentMethod(
  context: TenantContext,
  rawInput: unknown,
): Promise<string> {
  await authorize(context, {
    permission: PERMISSIONS.FINANCE_SETTINGS_MANAGE,
    featureKey: FEATURES.FINANCE_CORE,
  });

  const input = parse(methodInputSchema, rawInput);
  const nameSearch = normalizeSearchable(input.name);

  const [existing] = await getDb()
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(
      and(eq(paymentMethods.tenantId, context.tenantId), eq(paymentMethods.nameSearch, nameSearch)),
    )
    .limit(1);

  if (existing) throw new ConflictError('Ja existe uma forma de pagamento com este nome.');

  const methodId = newId();
  const now = new Date();

  await runInTransaction(async (tx) => {
    await tx.insert(paymentMethods).values({
      id: methodId,
      tenantId: context.tenantId,
      kind: input.kind,
      name: input.name,
      nameSearch,
      status: 'active',
      position: input.position ?? 0,
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.PAYMENT_METHOD_CHANGED,
        entityType: 'payment_method',
        entityId: methodId,
        tenantId: context.tenantId,
        userId: context.userId,
        after: { kind: input.kind, name: input.name },
      },
      tx,
    );
  });

  return methodId;
}

export async function changePaymentMethodStatus(
  context: TenantContext,
  methodId: string,
  status: 'active' | 'inactive',
): Promise<void> {
  await authorize(context, {
    permission: PERMISSIONS.FINANCE_SETTINGS_MANAGE,
    featureKey: FEATURES.FINANCE_CORE,
  });

  const current = await loadPaymentMethod(context, methodId);
  if (current.status === status) return;

  await runInTransaction(async (tx) => {
    const result = await tx
      .update(paymentMethods)
      .set({
        status,
        version: current.version + 1,
        updatedBy: context.userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paymentMethods.tenantId, context.tenantId),
          eq(paymentMethods.id, methodId),
          eq(paymentMethods.version, current.version),
        ),
      );

    if (affectedRows(result) === 0) {
      throw new ConflictError('Esta forma de pagamento foi alterada por outra pessoa.');
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.PAYMENT_METHOD_CHANGED,
        entityType: 'payment_method',
        entityId: methodId,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { status: current.status },
        after: { status },
      },
      tx,
    );
  });
}

export async function loadPaymentMethod(context: TenantContext, methodId: string) {
  const [row] = await getDb()
    .select({
      id: paymentMethods.id,
      kind: paymentMethods.kind,
      name: paymentMethods.name,
      status: paymentMethods.status,
      version: paymentMethods.version,
    })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.tenantId, context.tenantId), eq(paymentMethods.id, methodId)))
    .limit(1);

  if (!row) throw new NotFoundError('Forma de pagamento nao encontrada.');
  return row;
}

/**
 * Cria as formas de pagamento padrao quando o tenant ainda nao tem nenhuma.
 *
 * Chamado sob demanda, e nao no provisionamento: um tenant que nunca ligar o
 * Financeiro nao precisa carregar sete linhas que ninguem vai usar. Idempotente
 * por construcao — se ja existe qualquer forma, nao faz nada.
 */
export async function ensureDefaultPaymentMethods(
  tx: TransactionExecutor,
  tenantId: string,
  actorId: string | null,
  now: Date,
): Promise<void> {
  const existing = await tx
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(eq(paymentMethods.tenantId, tenantId))
    .limit(1);

  if (existing.length > 0) return;

  const padrao: PaymentMethodKind[] = ['cash', 'pix', 'debit_card', 'credit_card', 'bank_transfer'];

  for (const [index, kind] of padrao.entries()) {
    const name = PAYMENT_METHOD_KIND_LABEL[kind];
    await tx.insert(paymentMethods).values({
      id: newId(),
      tenantId,
      kind,
      name,
      nameSearch: normalizeSearchable(name),
      status: 'active',
      position: index,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    });
  }
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

const categoryInputSchema = z.object({
  kind: z.enum(CATEGORY_KINDS),
  name: z.string().trim().min(1, 'Informe o nome da categoria.').max(CATEGORY_NAME_MAX),
});

export async function createFinancialCategory(
  context: TenantContext,
  rawInput: unknown,
): Promise<string> {
  await authorize(context, {
    permission: PERMISSIONS.FINANCE_SETTINGS_MANAGE,
    featureKey: FEATURES.FINANCE_CORE,
  });

  const input = parse(categoryInputSchema, rawInput);
  const nameSearch = normalizeSearchable(input.name);

  const [existing] = await getDb()
    .select({ id: financialCategories.id })
    .from(financialCategories)
    .where(
      and(
        eq(financialCategories.tenantId, context.tenantId),
        eq(financialCategories.kind, input.kind),
        eq(financialCategories.nameSearch, nameSearch),
      ),
    )
    .limit(1);

  if (existing) throw new ConflictError('Ja existe uma categoria com este nome.');

  const categoryId = newId();
  const now = new Date();

  await runInTransaction(async (tx) => {
    await tx.insert(financialCategories).values({
      id: categoryId,
      tenantId: context.tenantId,
      kind: input.kind,
      name: input.name,
      nameSearch,
      status: 'active',
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.FINANCIAL_CATEGORY_CHANGED,
        entityType: 'financial_category',
        entityId: categoryId,
        tenantId: context.tenantId,
        userId: context.userId,
        after: { kind: input.kind, name: input.name },
      },
      tx,
    );
  });

  return categoryId;
}

export async function changeFinancialCategoryStatus(
  context: TenantContext,
  categoryId: string,
  status: 'active' | 'inactive',
): Promise<void> {
  await authorize(context, {
    permission: PERMISSIONS.FINANCE_SETTINGS_MANAGE,
    featureKey: FEATURES.FINANCE_CORE,
  });

  const [current] = await getDb()
    .select({ id: financialCategories.id, status: financialCategories.status })
    .from(financialCategories)
    .where(
      and(
        eq(financialCategories.tenantId, context.tenantId),
        eq(financialCategories.id, categoryId),
      ),
    )
    .limit(1);

  if (!current) throw new NotFoundError('Categoria nao encontrada.');
  if (current.status === status) return;

  await runInTransaction(async (tx) => {
    await tx
      .update(financialCategories)
      .set({ status, updatedBy: context.userId, updatedAt: new Date() })
      .where(
        and(
          eq(financialCategories.tenantId, context.tenantId),
          eq(financialCategories.id, categoryId),
        ),
      );

    await recordAudit(
      {
        action: AUDIT_ACTIONS.FINANCIAL_CATEGORY_CHANGED,
        entityType: 'financial_category',
        entityId: categoryId,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { status: current.status },
        after: { status },
      },
      tx,
    );
  });
}

/** Categorias padrao, criadas junto com as formas de pagamento. */
export async function ensureDefaultCategories(
  tx: TransactionExecutor,
  tenantId: string,
  actorId: string | null,
  now: Date,
): Promise<void> {
  const existing = await tx
    .select({ id: financialCategories.id })
    .from(financialCategories)
    .where(eq(financialCategories.tenantId, tenantId))
    .limit(1);

  if (existing.length > 0) return;

  const padrao: Array<{ kind: 'revenue' | 'expense'; name: string }> = [
    { kind: 'revenue', name: 'Receita de servico' },
    { kind: 'revenue', name: 'Receita de peca' },
    { kind: 'expense', name: 'Compra de peca' },
    { kind: 'expense', name: 'Aluguel' },
    { kind: 'expense', name: 'Energia' },
    { kind: 'expense', name: 'Transporte' },
    { kind: 'expense', name: 'Material' },
    { kind: 'expense', name: 'Outros' },
  ];

  for (const item of padrao) {
    await tx.insert(financialCategories).values({
      id: newId(),
      tenantId,
      kind: item.kind,
      name: item.name,
      nameSearch: normalizeSearchable(item.name),
      status: 'active',
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Prepara o Financeiro para uso na primeira vez.
 *
 * Cria formas de pagamento e categorias padrao. NAO cria conta financeira: onde
 * o dinheiro fica e decisao da empresa, e inventar um "Caixa" que ninguem pediu
 * faria a primeira conferencia comecar errada.
 */
export async function ensureFinanceDefaults(context: TenantContext): Promise<void> {
  await authorize(context, {
    permission: PERMISSIONS.FINANCE_SETTINGS_MANAGE,
    featureKey: FEATURES.FINANCE_CORE,
  });

  const now = new Date();
  await runInTransaction(async (tx) => {
    await ensureDefaultPaymentMethods(tx, context.tenantId, context.userId, now);
    await ensureDefaultCategories(tx, context.tenantId, context.userId, now);
  });
}

/** Contas ativas que a unidade pode usar, para os seletores de liquidacao. */
export async function listAccountsForUnit(context: TenantContext, unitId: string) {
  const rows = await getDb()
    .select({
      id: financialAccounts.id,
      name: financialAccounts.name,
      kind: financialAccounts.kind,
      unitId: financialAccounts.unitId,
      currentBalance: financialAccounts.currentBalance,
    })
    .from(financialAccounts)
    .where(
      and(eq(financialAccounts.tenantId, context.tenantId), eq(financialAccounts.status, 'active')),
    )
    .orderBy(asc(financialAccounts.nameSearch), asc(financialAccounts.id));

  return rows.filter((row) => accountServesUnit(row, unitId));
}

export async function listActivePaymentMethods(context: TenantContext) {
  return getDb()
    .select({
      id: paymentMethods.id,
      kind: paymentMethods.kind,
      name: paymentMethods.name,
    })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.tenantId, context.tenantId), eq(paymentMethods.status, 'active')))
    .orderBy(asc(paymentMethods.position), asc(paymentMethods.nameSearch));
}

export async function listActiveCategories(context: TenantContext, kind?: 'revenue' | 'expense') {
  return getDb()
    .select({
      id: financialCategories.id,
      kind: financialCategories.kind,
      name: financialCategories.name,
    })
    .from(financialCategories)
    .where(
      and(
        eq(financialCategories.tenantId, context.tenantId),
        eq(financialCategories.status, 'active'),
        kind ? eq(financialCategories.kind, kind) : undefined,
      ),
    )
    .orderBy(asc(financialCategories.nameSearch));
}

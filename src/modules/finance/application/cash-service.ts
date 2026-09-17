import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { Money } from '@/core/money/money';
import { todayIn } from '@/core/time/civil-date';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  CASH_REASON_MAX,
  CASH_REASON_MIN,
  cashDifference,
  expectedCashAmount,
  normalizeReason,
  supportsCashSession,
} from '@/modules/finance/domain/finance';
import {
  cashSessions,
  financialAccounts,
  financialMovements,
} from '@/modules/finance/infrastructure/schema';
import { appendMovement } from '@/modules/finance/application/settlement-service';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * SESSAO DE CAIXA (Prompt 12, itens 22 a 26).
 *
 * A gaveta do balcao, aberta no comeco do dia e fechada no fim. E controle
 * OPERACIONAL, e nao contabilidade: responde "o que tinha, o que passou por
 * aqui, e o que sobrou de verdade".
 *
 * A DIFERENCA NAO DESAPARECE. Se a contagem nao bate, o sistema grava a
 * diferenca e para por ali — nenhum movimento automatico e criado para
 * "acertar" o saldo. Quem quiser corrigir faz um suprimento ou uma sangria,
 * com motivo e com nome.
 */

const openSchema = z.object({
  financialAccountId: z.string().trim().min(1, 'Escolha o caixa.'),
  openingAmount: z.string().trim().optional(),
  notes: z.string().trim().max(300).optional(),
});

const closeSchema = z.object({
  countedAmount: z.string().trim().min(1, 'Informe o valor contado.'),
  notes: z.string().trim().max(300).optional(),
});

const adjustSchema = z.object({
  kind: z.enum(['supply', 'withdrawal']),
  amount: z.string().trim().min(1, 'Informe o valor.'),
  reason: z.string().trim().min(1, 'Informe o motivo.'),
});

function parse<T extends z.ZodTypeAny>(schema: T, rawInput: unknown): z.infer<T> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

function parseAmount(raw: string, allowZero = false): Money {
  let amount: Money;
  try {
    amount = Money.parse(raw);
  } catch {
    throw new ValidationError('Valor invalido.');
  }
  if (amount.isNegative()) throw new ValidationError('O valor nao pode ser negativo.');
  if (!allowZero && !amount.isPositive()) {
    throw new ValidationError('O valor precisa ser maior que zero.');
  }
  return amount;
}

async function loadCashAccount(context: TenantContext, accountId: string) {
  const [row] = await getDb()
    .select({
      id: financialAccounts.id,
      name: financialAccounts.name,
      kind: financialAccounts.kind,
      unitId: financialAccounts.unitId,
      status: financialAccounts.status,
      currentBalance: financialAccounts.currentBalance,
    })
    .from(financialAccounts)
    .where(
      and(eq(financialAccounts.tenantId, context.tenantId), eq(financialAccounts.id, accountId)),
    )
    .limit(1);

  if (!row) throw new NotFoundError('Conta financeira nao encontrada.');
  if (row.status !== 'active') throw new BusinessRuleError(`A conta ${row.name} esta inativa.`);

  /** So gaveta tem sessao. Conta bancaria nao se abre nem se fecha (item 22). */
  if (!supportsCashSession(row.kind)) {
    throw new BusinessRuleError(
      `${row.name} nao e uma conta de caixa. So conta do tipo caixa abre e fecha sessao.`,
    );
  }

  /**
   * A UNIDADE DO CAIXA (item 54).
   *
   * Caixa e uma gaveta fisica: ela fica numa loja. Uma conta `cash` sem unidade
   * seria uma gaveta sem endereco, e ninguem saberia quem a conta no fim do
   * dia — por isso ela e exigida aqui.
   */
  if (!row.unitId) {
    throw new BusinessRuleError(
      `A conta ${row.name} nao esta vinculada a uma unidade. Um caixa pertence a uma loja.`,
    );
  }
  if (!context.authorizedUnitIds.includes(row.unitId)) {
    throw new NotFoundError('Conta financeira nao encontrada.');
  }

  return { ...row, unitId: row.unitId };
}

// ---------------------------------------------------------------------------
// Abertura (item 24)
// ---------------------------------------------------------------------------

export async function openCashSession(
  context: TenantContext,
  rawInput: unknown,
): Promise<{ sessionId: string }> {
  const input = parse(openSchema, rawInput);
  const account = await loadCashAccount(context, input.financialAccountId);

  await authorize(context, {
    permission: PERMISSIONS.FINANCE_CASH_OPEN,
    featureKey: FEATURES.FINANCE_CORE,
    unitId: account.unitId,
  });

  const openingAmount = parseAmount(input.openingAmount || '0', true);
  const sessionId = newId();
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    /** Mesma ordem de trava das liquidacoes: a conta primeiro. */
    const [locked] = await tx
      .select({ balance: financialAccounts.currentBalance })
      .from(financialAccounts)
      .where(
        and(eq(financialAccounts.tenantId, context.tenantId), eq(financialAccounts.id, account.id)),
      )
      .for('update');

    if (!locked) throw new NotFoundError('Conta financeira nao encontrada.');

    try {
      await tx.insert(cashSessions).values({
        id: sessionId,
        tenantId: context.tenantId,
        unitId: account.unitId,
        financialAccountId: account.id,
        openedBy: context.userId,
        openedAt: now,
        openingAmount: openingAmount.toString(),
        status: 'open',
        notes: input.notes || null,
        /**
         * UMA SESSAO ABERTA POR CAIXA (itens 24 e 45).
         *
         * `1` enquanto aberta, `NULL` depois de fechada. A UNIQUE
         * `(financial_account_id, open_marker)` faz o BANCO recusar a segunda
         * abertura — inclusive quando duas pessoas clicam ao mesmo tempo, que
         * e exatamente o caso que uma checagem em TypeScript deixaria passar.
         */
        openMarker: 1,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictError(
          `O caixa ${account.name} ja esta aberto. Feche a sessao atual antes de abrir outra.`,
        );
      }
      throw error;
    }

    /**
     * O VALOR INICIAL ENTRA PELO LEDGER, e nao por um campo de saldo.
     *
     * Trocado de outra forma: o dinheiro que ja estava na gaveta e um fato
     * financeiro como qualquer outro, e precisa aparecer no extrato da conta.
     * Um saldo inicial digitado direto na conta seria dinheiro sem origem.
     */
    if (openingAmount.isPositive()) {
      await appendMovement(tx, {
        tenantId: context.tenantId,
        unitId: account.unitId,
        accountId: account.id,
        previousBalance: Money.parse(locked.balance),
        direction: 'inflow',
        amount: openingAmount,
        originKind: 'cash_opening',
        cashSessionId: sessionId,
        reference: 'Abertura de caixa',
        effectiveDate: todayIn(context.tenantTimezone),
        actorId: context.userId,
        now,
      });
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.CASH_SESSION_OPENED,
        entityType: 'cash_session',
        entityId: sessionId,
        tenantId: context.tenantId,
        unitId: account.unitId,
        userId: context.userId,
        after: { accountId: account.id, openingAmount: openingAmount.toString() },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.CASH_SESSION_OPENED,
      tenantId: context.tenantId,
      payload: {
        sessionId,
        accountId: account.id,
        unitId: account.unitId,
        openingAmount: openingAmount.toString(),
      },
    });
  });

  return { sessionId };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}

// ---------------------------------------------------------------------------
// Fechamento (item 25)
// ---------------------------------------------------------------------------

export interface CloseCashResult {
  expectedAmount: string;
  countedAmount: string;
  differenceAmount: string;
  inflow: string;
  outflow: string;
}

export async function closeCashSession(
  context: TenantContext,
  sessionId: string,
  rawInput: unknown,
): Promise<CloseCashResult> {
  const input = parse(closeSchema, rawInput);
  const session = await loadCashSession(context, sessionId);

  await authorize(context, {
    permission: PERMISSIONS.FINANCE_CASH_CLOSE,
    featureKey: FEATURES.FINANCE_CORE,
    unitId: session.unitId,
  });

  if (session.status !== 'open') {
    throw new BusinessRuleError('Esta sessao de caixa ja foi fechada.');
  }

  const counted = parseAmount(input.countedAmount, true);
  const totals = await summarizeSession(context, sessionId);

  /**
   * A abertura ja entrou no ledger como movimento, entao ela esta dentro de
   * `inflow`. O esperado e simplesmente entradas menos saidas da sessao — somar
   * a abertura de novo contaria o mesmo dinheiro duas vezes.
   */
  const expected = expectedCashAmount({
    openingAmount: Money.zero(),
    inflow: totals.inflow,
    outflow: totals.outflow,
  });

  const difference = cashDifference({
    openingAmount: Money.zero(),
    inflow: totals.inflow,
    outflow: totals.outflow,
    countedAmount: counted,
  });

  await runInTransaction(async (tx, emit) => {
    /** A condicao de estar aberta vai no `WHERE`: dois fechamentos, um vence. */
    const result = await tx.execute(sql`
      UPDATE cash_sessions
      SET status = 'closed',
          closed_by = ${context.userId},
          closed_at = NOW(3),
          counted_amount = ${counted.toString()},
          expected_amount = ${expected.toString()},
          difference_amount = ${difference.toString()},
          notes = ${input.notes || null},
          open_marker = NULL,
          version = version + 1,
          updated_at = NOW(3)
      WHERE id = ${sessionId}
        AND tenant_id = ${context.tenantId}
        AND status = 'open'
    `);

    if (affectedRows(result) !== 1) {
      throw new ConflictError('Esta sessao de caixa ja foi fechada por outra pessoa.');
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.CASH_SESSION_CLOSED,
        entityType: 'cash_session',
        entityId: sessionId,
        tenantId: context.tenantId,
        unitId: session.unitId,
        userId: context.userId,
        after: {
          expected: expected.toString(),
          counted: counted.toString(),
          difference: difference.toString(),
        },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.CASH_SESSION_CLOSED,
      tenantId: context.tenantId,
      payload: {
        sessionId,
        unitId: session.unitId,
        accountId: session.financialAccountId,
        difference: difference.toString(),
      },
    });
  });

  return {
    expectedAmount: expected.toString(),
    countedAmount: counted.toString(),
    differenceAmount: difference.toString(),
    inflow: totals.inflow.toString(),
    outflow: totals.outflow.toString(),
  };
}

// ---------------------------------------------------------------------------
// Suprimento e sangria (item 26)
// ---------------------------------------------------------------------------

/**
 * SUPRIMENTO = dinheiro entrando na gaveta fora de um titulo (troco do dia).
 * SANGRIA    = dinheiro saindo da gaveta fora de um titulo (leva ao banco).
 *
 * NAO SAO RECEITA NEM DESPESA (item 26): nada foi vendido nem comprado, o
 * dinheiro so mudou de lugar. Por isso nao ha titulo, nao ha categoria e nao
 * ha contraparte — ha um movimento no ledger, com motivo e com nome.
 */
export async function recordCashAdjustment(
  context: TenantContext,
  sessionId: string,
  rawInput: unknown,
): Promise<{ movementId: string }> {
  const input = parse(adjustSchema, rawInput);
  const session = await loadCashSession(context, sessionId);

  await authorize(context, {
    permission: PERMISSIONS.FINANCE_CASH_ADJUST,
    featureKey: FEATURES.FINANCE_CORE,
    unitId: session.unitId,
  });

  if (session.status !== 'open') {
    throw new BusinessRuleError('O caixa esta fechado. Abra o caixa para movimentar dinheiro.');
  }

  const amount = parseAmount(input.amount);

  let reason: string;
  try {
    reason = normalizeReason(input.reason, CASH_REASON_MIN, CASH_REASON_MAX, 'O motivo');
  } catch {
    throw new ValidationError(`O motivo precisa ter ao menos ${CASH_REASON_MIN} caracteres.`);
  }

  const movementId = newId();
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    const [locked] = await tx
      .select({ balance: financialAccounts.currentBalance })
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.tenantId, context.tenantId),
          eq(financialAccounts.id, session.financialAccountId),
        ),
      )
      .for('update');

    if (!locked) throw new NotFoundError('Conta financeira nao encontrada.');

    await appendMovement(tx, {
      tenantId: context.tenantId,
      unitId: session.unitId,
      accountId: session.financialAccountId,
      previousBalance: Money.parse(locked.balance),
      direction: input.kind === 'supply' ? 'inflow' : 'outflow',
      amount,
      originKind: input.kind === 'supply' ? 'cash_supply' : 'cash_withdrawal',
      cashSessionId: sessionId,
      reference: reason.slice(0, 200),
      effectiveDate: todayIn(context.tenantTimezone),
      actorId: context.userId,
      now,
      movementId,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.CASH_ADJUSTMENT_RECORDED,
        entityType: 'cash_session',
        entityId: sessionId,
        tenantId: context.tenantId,
        unitId: session.unitId,
        userId: context.userId,
        after: { kind: input.kind, amount: amount.toString(), reason },
      },
      tx,
    );

    await emit({
      type:
        input.kind === 'supply'
          ? EVENT_TYPES.CASH_SUPPLY_RECORDED
          : EVENT_TYPES.CASH_WITHDRAWAL_RECORDED,
      tenantId: context.tenantId,
      payload: { sessionId, unitId: session.unitId, amount: amount.toString() },
    });
  });

  return { movementId };
}

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

export interface CashSessionRecord {
  id: string;
  tenantId: string;
  unitId: string;
  financialAccountId: string;
  openingAmount: string;
  status: string;
  openedAt: Date;
  version: number;
}

export async function loadCashSession(
  context: TenantContext,
  sessionId: string,
): Promise<CashSessionRecord> {
  const [row] = await getDb()
    .select({
      id: cashSessions.id,
      tenantId: cashSessions.tenantId,
      unitId: cashSessions.unitId,
      financialAccountId: cashSessions.financialAccountId,
      openingAmount: cashSessions.openingAmount,
      status: cashSessions.status,
      openedAt: cashSessions.openedAt,
      version: cashSessions.version,
    })
    .from(cashSessions)
    .where(and(eq(cashSessions.tenantId, context.tenantId), eq(cashSessions.id, sessionId)))
    .limit(1);

  if (!row) throw new NotFoundError('Sessao de caixa nao encontrada.');
  if (!context.authorizedUnitIds.includes(row.unitId)) {
    throw new NotFoundError('Sessao de caixa nao encontrada.');
  }
  return row;
}

/** Entradas e saidas que passaram por esta sessao. */
export async function summarizeSession(
  context: TenantContext,
  sessionId: string,
): Promise<{ inflow: Money; outflow: Money; movements: number }> {
  const rows = await getDb()
    .select({ direction: financialMovements.direction, amount: financialMovements.amount })
    .from(financialMovements)
    .where(
      and(
        eq(financialMovements.tenantId, context.tenantId),
        eq(financialMovements.cashSessionId, sessionId),
      ),
    );

  let inflow = Money.zero();
  let outflow = Money.zero();

  for (const row of rows) {
    const amount = Money.parse(row.amount);
    if (row.direction === 'inflow') inflow = inflow.add(amount);
    else outflow = outflow.add(amount);
  }

  return { inflow, outflow, movements: rows.length };
}

/** A sessao aberta do caixa daquela unidade, se houver. */
export async function findOpenSessionForUnit(context: TenantContext, unitId: string) {
  if (!context.authorizedUnitIds.includes(unitId)) return null;

  const [row] = await getDb()
    .select({
      id: cashSessions.id,
      financialAccountId: cashSessions.financialAccountId,
      accountName: financialAccounts.name,
      openingAmount: cashSessions.openingAmount,
      openedAt: cashSessions.openedAt,
    })
    .from(cashSessions)
    .innerJoin(financialAccounts, eq(financialAccounts.id, cashSessions.financialAccountId))
    .where(
      and(
        eq(cashSessions.tenantId, context.tenantId),
        eq(cashSessions.unitId, unitId),
        eq(cashSessions.status, 'open'),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * As contas desta unidade que estao com caixa ABERTO agora.
 *
 * POR QUE UM CONJUNTO, e nao um booleano.
 *
 * A exigencia de caixa aberto e POR CONTA (`requireOpenCashSession`), nao por
 * unidade. A ficha do titulo chegou a perguntar "ha algum caixa aberto nesta
 * unidade?" e, com duas contas em especie na mesma loja, a resposta era sim
 * enquanto a conta escolhida no formulario continuava fechada: a tela nao
 * avisava nada, a pessoa preenchia tudo e so o envio recusava.
 *
 * Devolver o conjunto deixa a tela responder a mesma pergunta que o caso de
 * uso faz — sobre a conta selecionada, nao sobre a loja.
 */
export async function listAccountsWithOpenCashSession(
  context: TenantContext,
  unitId: string,
): Promise<string[]> {
  if (!context.authorizedUnitIds.includes(unitId)) return [];

  const rows = await getDb()
    .select({ financialAccountId: cashSessions.financialAccountId })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.tenantId, context.tenantId),
        eq(cashSessions.unitId, unitId),
        eq(cashSessions.status, 'open'),
      ),
    );

  return rows.map((row) => row.financialAccountId);
}

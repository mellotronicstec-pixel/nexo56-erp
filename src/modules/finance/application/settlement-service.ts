import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { logger } from '@/core/logging/logger';
import { Money } from '@/core/money/money';
import { todayIn } from '@/core/time/civil-date';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  applyToBalance,
  canSettle,
  explainOverSettlement,
  IDEMPOTENCY_KEY_MAX,
  isTitleSettleable,
  movementDirectionFor,
  oppositeDirection,
  outstandingOf,
  REVERSAL_REASON_MAX,
  REVERSAL_REASON_MIN,
  SETTLEMENT_NOTES_MAX,
  SETTLEMENT_REFERENCE_MAX,
  settlementPermission,
  supportsCardInstallments,
  supportsCashSession,
  CARD_INSTALLMENTS_MAX,
  normalizeReason,
  TITLE_TIMELINE_KINDS,
  type TitleDirection,
} from '@/modules/finance/domain/finance';
import {
  cashSessions,
  financialAccounts,
  financialInstallments,
  financialMovements,
  financialSettlements,
  financialTitles,
  paymentMethods,
} from '@/modules/finance/infrastructure/schema';
import { accountServesUnit } from '@/modules/finance/application/finance-settings-service';
import {
  loadFinancialTitle,
  writeTitleTimeline,
} from '@/modules/finance/application/title-service';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * LIQUIDACAO E ESTORNO (Prompt 12, itens 11 a 15, 41 a 44).
 *
 * O arquivo mais delicado do modulo. Aqui dinheiro efetivamente muda de lugar,
 * e tres coisas precisam ser verdade ao mesmo tempo:
 *
 * 1. NUNCA receber ou pagar mais que o saldo em aberto (item 12);
 * 2. o mesmo comando repetido produz UM efeito (item 42);
 * 3. duas pessoas ao mesmo tempo nunca ultrapassam o saldo (item 43).
 *
 * As tres saem do BANCO, e nao de checagem em TypeScript: a condicao de saldo
 * vai no `WHERE` do proprio `UPDATE` (ADR-044), a idempotencia e UNIQUE, e a
 * conta e travada no inicio da transacao para dar ordem unica de trava.
 *
 * ESTORNO NUNCA APAGA (item 41). A liquidacao permanece, marcada como
 * estornada, e um CONTRAMOVIMENTO devolve o dinheiro ao ledger.
 */

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

const settleSchema = z.object({
  installmentId: z.string().trim().min(1, 'Escolha a parcela.'),
  amount: z.string().trim().min(1, 'Informe o valor.'),
  financialAccountId: z.string().trim().min(1, 'Escolha a conta financeira.'),
  paymentMethodId: z.string().trim().min(1, 'Escolha a forma de pagamento.'),
  effectiveDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data valida.')
    .optional(),
  cardInstallments: z.coerce.number().int().min(1).max(CARD_INSTALLMENTS_MAX).optional(),
  reference: z.string().trim().max(SETTLEMENT_REFERENCE_MAX).optional(),
  notes: z.string().trim().max(SETTLEMENT_NOTES_MAX).optional(),
  idempotencyKey: z.string().trim().max(IDEMPOTENCY_KEY_MAX).optional(),
});

export interface SettlementResult {
  settlementId: string;
  titleStatus: string;
  outstanding: string;
  /** `true` quando a chave de comando reencontrou a liquidacao que ja existia. */
  reused: boolean;
  /** `true` quando ESTE recebimento zerou o titulo inteiro. */
  titleFullySettled: boolean;
}

function parse<T extends z.ZodTypeAny>(schema: T, rawInput: unknown): z.infer<T> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Liquidacao (itens 39 e 40)
// ---------------------------------------------------------------------------

/**
 * Registra que o dinheiro entrou (recebimento) ou saiu (pagamento).
 *
 * A DIRECAO SAI DO TITULO, nunca do formulario: um titulo a receber so produz
 * entrada, e um a pagar so produz saida. Deixar a tela escolher o sentido seria
 * permitir que um erro de clique criasse dinheiro.
 */
export async function settleFinancialTitle(
  context: TenantContext,
  titleId: string,
  rawInput: unknown,
): Promise<SettlementResult> {
  const input = parse(settleSchema, rawInput);
  const title = await loadFinancialTitle(context, titleId);

  /**
   * A PERMISSAO E VERIFICADA NA UNIDADE DO TITULO (item 54), que nem sempre e
   * a unidade ativa da sessao. Receber cria dinheiro naquela unidade — e so
   * naquela.
   */
  if (!context.authorizedUnitIds.includes(title.unitId)) {
    throw new NotFoundError('Titulo financeiro nao encontrado.');
  }
  await authorize(context, {
    permission: settlementPermission(title.direction),
    featureKey: FEATURES.FINANCE_CORE,
    unitId: title.unitId,
  });

  if (!isTitleSettleable(title.status)) {
    throw new BusinessRuleError(
      title.status === 'cancelled'
        ? 'Este titulo foi cancelado.'
        : title.direction === 'receivable'
          ? 'Este titulo ja foi totalmente recebido.'
          : 'Este titulo ja foi totalmente pago.',
    );
  }

  const key = input.idempotencyKey || null;

  /**
   * REENCONTRO ANTES DE LIQUIDAR (item 42).
   *
   * Duplo clique, retry apos queda de rede e botao voltar reenviam o mesmo
   * comando. A UNIQUE no banco e a garantia final; esta consulta transforma a
   * colisao numa resposta util em vez de num erro de constraint.
   */
  if (key) {
    const [existing] = await getDb()
      .select({ id: financialSettlements.id })
      .from(financialSettlements)
      .where(
        and(
          eq(financialSettlements.tenantId, context.tenantId),
          eq(financialSettlements.idempotencyKey, key),
        ),
      )
      .limit(1);

    if (existing) {
      logger.info('Liquidacao reaproveitada por chave de comando', {
        module: 'finance',
        operation: 'settleFinancialTitle',
        titleId,
      });
      const atual = await loadFinancialTitle(context, titleId);
      return {
        settlementId: existing.id,
        titleStatus: atual.status,
        outstanding: outstandingOf({
          amount: Money.parse(atual.amount),
          settledAmount: Money.parse(atual.settledAmount),
        }).toString(),
        reused: true,
        titleFullySettled: false,
      };
    }
  }

  let amount: Money;
  try {
    amount = Money.parse(input.amount);
  } catch {
    throw new ValidationError('Valor invalido.');
  }
  if (!amount.isPositive()) {
    throw new ValidationError(
      title.direction === 'receivable'
        ? 'O valor a receber precisa ser maior que zero.'
        : 'O valor a pagar precisa ser maior que zero.',
    );
  }

  const installment = await loadInstallment(context, titleId, input.installmentId);

  /** Aviso em portugues; a trava de verdade esta no `WHERE` e na CHECK. */
  const snapshot = {
    amount: Money.parse(installment.amount),
    settledAmount: Money.parse(installment.settledAmount),
  };
  if (!canSettle(snapshot, amount)) {
    throw new BusinessRuleError(explainOverSettlement(snapshot, amount, title.direction));
  }

  const account = await loadAccountForSettlement(context, input.financialAccountId, title.unitId);
  const method = await loadMethodForSettlement(context, input.paymentMethodId);

  if (input.cardInstallments && !supportsCardInstallments(method.kind)) {
    throw new BusinessRuleError('Parcelas de cartao so valem para cartao de credito.');
  }

  const effectiveDate = input.effectiveDate || todayIn(context.tenantTimezone);
  const movementDirection = movementDirectionFor(title.direction);

  /**
   * DINHEIRO PASSA PELA GAVETA? ENTAO A GAVETA PRECISA ESTAR ABERTA (item 22).
   *
   * So conta do tipo `cash`. Conta bancaria nao tem sessao, e exigir uma faria
   * um PIX depender de alguem ter aberto o caixa.
   */
  const cashSessionId = supportsCashSession(account.kind)
    ? await requireOpenCashSession(context, account.id)
    : null;

  const settlementId = newId();
  const now = new Date();

  const outcome = await runInTransaction(async (tx, emit) => {
    /**
     * A CONTA E TRAVADA PRIMEIRO, e isto e o que da ORDEM UNICA DE TRAVA.
     *
     * Toda liquidacao que toca esta conta passa por aqui antes de qualquer
     * outra gravacao. Sem isso, duas liquidacoes em contas e parcelas
     * diferentes poderiam travar os recursos em ordens opostas e o InnoDB
     * mataria uma delas por impasse — recusando uma operacao legitima com uma
     * mensagem que ninguem entende. Foi exatamente o que aconteceu no Prompt 11
     * com recebimento de linhas diferentes do mesmo pedido.
     *
     * A trava tambem garante LEITURA FRESCA do saldo: quem espera aqui so
     * segue depois que a outra transacao confirmou.
     */
    const [locked] = await tx
      .select({ balance: financialAccounts.currentBalance })
      .from(financialAccounts)
      .where(
        and(eq(financialAccounts.tenantId, context.tenantId), eq(financialAccounts.id, account.id)),
      )
      .for('update');

    if (!locked) throw new NotFoundError('Conta financeira nao encontrada.');

    /**
     * A TRAVA DE OVER-SETTLEMENT (itens 12 e 43).
     *
     * O `CASE` desta instrucao espelha `nextTitleStatus()` do dominio, e a
     * duplicacao e deliberada: a situacao PRECISA ser decidida dentro do
     * mesmo `UPDATE` que soma o valor, senao haveria uma janela entre somar e
     * classificar. O teste de dominio cobra que as duas versoes concordem.
     *
     * O `CASE` compara `settled_amount` SEM somar de novo, e isso importa.
     *
     * O MySQL e o MariaDB avaliam as atribuicoes de um `UPDATE` DA ESQUERDA
     * PARA A DIREITA, e cada uma ja enxerga o valor NOVO das anteriores.
     * Escrever `WHEN settled_amount + :q >= amount` somaria o valor duas
     * vezes: um titulo de R$ 1.000 que recebeu R$ 600 seria classificado como
     * liquidado, porque 600 + 600 passa de 1.000. O defeito so aparecia com
     * pagamento parcial — e foi o teste de concorrencia do caso B que o pegou.
     *
     * O `WHERE`, ao contrario, e sempre avaliado contra a linha ANTES do
     * `UPDATE`: por isso ali a soma precisa ser explicita.
     *
     * A condicao vai no `WHERE` do proprio `UPDATE`: quem decide e o InnoDB,
     * sob a trava de linha que ele ja segura para gravar. Com R$ 500 em aberto
     * e duas pessoas recebendo R$ 500 ao mesmo tempo, a segunda recebe
     * `affectedRows() === 0` e a transacao dela inteira volta atras.
     */
    const applied = await tx.execute(sql`
      UPDATE financial_installments
      SET settled_amount = settled_amount + ${amount.toString()},
          status = CASE
            WHEN settled_amount >= amount THEN 'settled'
            ELSE 'partially_settled'
          END,
          version = version + 1,
          updated_at = NOW(3)
      WHERE id = ${installment.id}
        AND tenant_id = ${context.tenantId}
        AND status IN ('open', 'partially_settled')
        AND settled_amount + ${amount.toString()} <= amount
    `);

    if (affectedRows(applied) !== 1) {
      logger.warn('Liquidacao recusada por exceder o saldo em aberto', {
        module: 'finance',
        operation: 'settleFinancialTitle',
        titleId,
      });
      throw new BusinessRuleError(
        title.direction === 'receivable'
          ? 'Outra pessoa ja recebeu esta parcela. Recarregue o titulo e confira o que ainda falta.'
          : 'Outra pessoa ja pagou esta parcela. Recarregue o titulo e confira o que ainda falta.',
      );
    }

    /** O titulo acompanha a soma das parcelas, com a mesma condicao no `WHERE`. */
    const titleApplied = await tx.execute(sql`
      UPDATE financial_titles
      SET settled_amount = settled_amount + ${amount.toString()},
          status = CASE
            WHEN settled_amount >= amount THEN 'settled'
            ELSE 'partially_settled'
          END,
          version = version + 1,
          updated_by = ${context.userId},
          updated_at = NOW(3)
      WHERE id = ${titleId}
        AND tenant_id = ${context.tenantId}
        AND status IN ('open', 'partially_settled')
        AND settled_amount + ${amount.toString()} <= amount
    `);

    if (affectedRows(titleApplied) !== 1) {
      throw new ConflictError(
        'Este titulo mudou enquanto a liquidacao era registrada. Recarregue a pagina.',
      );
    }

    await tx.insert(financialSettlements).values({
      id: settlementId,
      tenantId: context.tenantId,
      unitId: title.unitId,
      titleId,
      installmentId: installment.id,
      direction: title.direction,
      amount: amount.toString(),
      effectiveDate,
      financialAccountId: account.id,
      paymentMethodId: method.id,
      cardInstallments: input.cardInstallments ?? null,
      reference: input.reference || null,
      notes: input.notes || null,
      cashSessionId,
      status: 'confirmed',
      idempotencyKey: key,
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    /** O movimento no ledger, e o saldo da conta na mesma transacao. */
    await appendMovement(tx, {
      tenantId: context.tenantId,
      unitId: title.unitId,
      accountId: account.id,
      previousBalance: Money.parse(locked.balance),
      direction: movementDirection,
      amount,
      originKind: 'settlement',
      settlementId,
      cashSessionId,
      reference: null,
      effectiveDate,
      actorId: context.userId,
      now,
    });

    /** Le o titulo JA atualizado para saber se esta liquidacao o zerou. */
    const [atualizado] = await tx
      .select({
        amount: financialTitles.amount,
        settledAmount: financialTitles.settledAmount,
        status: financialTitles.status,
        serviceOrderId: financialTitles.serviceOrderId,
      })
      .from(financialTitles)
      .where(and(eq(financialTitles.tenantId, context.tenantId), eq(financialTitles.id, titleId)));

    const status = atualizado?.status ?? title.status;
    const outstanding = outstandingOf({
      amount: Money.parse(atualizado?.amount ?? title.amount),
      settledAmount: Money.parse(atualizado?.settledAmount ?? title.settledAmount),
    });
    const fully = status === 'settled';

    await writeTitleTimeline(tx, context, {
      titleId,
      kind: fully ? TITLE_TIMELINE_KINDS.FULLY_SETTLED : TITLE_TIMELINE_KINDS.SETTLED,
      summary: `${amount.toString()} — ${method.name} — parcela ${installment.number}`,
      metadata: { settlementId, amount: amount.toString(), installment: installment.number },
      now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.FINANCIAL_SETTLEMENT_CREATED,
        entityType: 'financial_settlement',
        entityId: settlementId,
        tenantId: context.tenantId,
        unitId: title.unitId,
        userId: context.userId,
        after: {
          titleId,
          direction: title.direction,
          amount: amount.toString(),
          accountId: account.id,
          methodKind: method.kind,
        },
      },
      tx,
    );

    await emit({
      type:
        title.direction === 'receivable'
          ? EVENT_TYPES.CUSTOMER_PAYMENT_RECEIVED
          : EVENT_TYPES.SUPPLIER_PAYMENT_MADE,
      tenantId: context.tenantId,
      payload: {
        settlementId,
        titleId,
        unitId: title.unitId,
        amount: amount.toString(),
        direction: title.direction,
      },
    });

    /**
     * O GANCHO DO PROMPT 13 (item 79).
     *
     * Publicado UMA vez, quando a cobranca INTEIRA da OS chega a zero — nunca
     * a cada recebimento parcial, e nunca se ainda houver outro titulo aberto
     * daquela OS. NAO HA CONSUMIDOR: nenhuma garantia e criada, e a situacao da
     * Ordem de Servico NAO muda por causa dele.
     */
    if (fully && atualizado?.serviceOrderId) {
      const pendentes = await tx
        .select({ id: financialTitles.id })
        .from(financialTitles)
        .where(
          and(
            eq(financialTitles.tenantId, context.tenantId),
            eq(financialTitles.serviceOrderId, atualizado.serviceOrderId),
            eq(financialTitles.direction, 'receivable'),
            sql`${financialTitles.status} IN ('open', 'partially_settled')`,
          ),
        )
        .limit(1);

      if (pendentes.length === 0) {
        await emit({
          type: EVENT_TYPES.SERVICE_ORDER_FINANCIAL_SETTLED,
          tenantId: context.tenantId,
          payload: {
            serviceOrderId: atualizado.serviceOrderId,
            unitId: title.unitId,
            titleId,
          },
        });
      }
    }

    return { status, outstanding: outstanding.toString(), fully };
  });

  return {
    settlementId,
    titleStatus: outcome.status,
    outstanding: outcome.outstanding,
    reused: false,
    titleFullySettled: outcome.fully,
  };
}

// ---------------------------------------------------------------------------
// Estorno (item 41)
// ---------------------------------------------------------------------------

/**
 * Desfaz uma liquidacao POR CONTRAMOVIMENTO.
 *
 * A liquidacao original NAO e apagada nem editada: ela ganha
 * `status = 'reversed'`, o motivo, o autor e a data. O dinheiro volta ao saldo
 * em aberto do titulo, e o ledger ganha um movimento no sentido contrario —
 * que e o unico jeito honesto de contar que aquilo aconteceu e depois foi
 * desfeito.
 *
 * ESTORNAR NAO MEXE EM MAIS NADA: estorno de recebimento nao altera a Ordem de
 * Servico, e estorno de pagamento nao altera estoque nem pedido de compra.
 */
export async function reverseSettlement(
  context: TenantContext,
  settlementId: string,
  rawReason: string,
): Promise<{ reversalMovementId: string; titleStatus: string; outstanding: string }> {
  const settlement = await loadSettlement(context, settlementId);

  if (!context.authorizedUnitIds.includes(settlement.unitId)) {
    throw new NotFoundError('Liquidacao nao encontrada.');
  }
  await authorize(context, {
    permission: PERMISSIONS.FINANCE_REVERSE,
    featureKey: FEATURES.FINANCE_CORE,
    unitId: settlement.unitId,
  });

  if (settlement.status === 'reversed') {
    throw new BusinessRuleError('Esta liquidacao ja foi estornada.');
  }

  let reason: string;
  try {
    reason = normalizeReason(rawReason, REVERSAL_REASON_MIN, REVERSAL_REASON_MAX, 'O motivo');
  } catch {
    throw new ValidationError(
      `O motivo do estorno precisa ter ao menos ${REVERSAL_REASON_MIN} caracteres.`,
    );
  }

  const amount = Money.parse(settlement.amount);
  const reversalId = newId();
  const now = new Date();

  const outcome = await runInTransaction(async (tx, emit) => {
    /** Mesma ordem de trava da liquidacao: a conta primeiro. */
    const [locked] = await tx
      .select({ balance: financialAccounts.currentBalance })
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.tenantId, context.tenantId),
          eq(financialAccounts.id, settlement.financialAccountId),
        ),
      )
      .for('update');

    if (!locked) throw new NotFoundError('Conta financeira nao encontrada.');

    /**
     * UM ESTORNO SO, mesmo com duas pessoas tentando (item 44).
     *
     * A condicao `status = 'confirmed'` vai no `WHERE`: a segunda transacao
     * nao afeta linha nenhuma e volta atras inteira. A UNIQUE em
     * `reversal_of_movement_id` no ledger e a segunda barreira.
     */
    const marked = await tx.execute(sql`
      UPDATE financial_settlements
      SET status = 'reversed',
          reversed_at = NOW(3),
          reversed_by = ${context.userId},
          reversal_reason = ${reason},
          updated_at = NOW(3)
      WHERE id = ${settlementId}
        AND tenant_id = ${context.tenantId}
        AND status = 'confirmed'
    `);

    if (affectedRows(marked) !== 1) {
      throw new ConflictError('Esta liquidacao ja foi estornada por outra pessoa.');
    }

    /** O saldo em aberto volta, na parcela e no titulo. */
    await tx.execute(sql`
      UPDATE financial_installments
      SET settled_amount = settled_amount - ${amount.toString()},
          status = CASE
            WHEN settled_amount <= 0 THEN 'open'
            ELSE 'partially_settled'
          END,
          version = version + 1,
          updated_at = NOW(3)
      WHERE id = ${settlement.installmentId}
        AND tenant_id = ${context.tenantId}
    `);

    await tx.execute(sql`
      UPDATE financial_titles
      SET settled_amount = settled_amount - ${amount.toString()},
          status = CASE
            WHEN settled_amount <= 0 THEN 'open'
            ELSE 'partially_settled'
          END,
          version = version + 1,
          updated_by = ${context.userId},
          updated_at = NOW(3)
      WHERE id = ${settlement.titleId}
        AND tenant_id = ${context.tenantId}
    `);

    /** O movimento ORIGINAL desta liquidacao, que sera contrabalancado. */
    const [original] = await tx
      .select({ id: financialMovements.id, direction: financialMovements.direction })
      .from(financialMovements)
      .where(
        and(
          eq(financialMovements.tenantId, context.tenantId),
          eq(financialMovements.settlementId, settlementId),
          eq(financialMovements.originKind, 'settlement'),
        ),
      )
      .limit(1);

    if (!original) {
      throw new ConflictError('Movimento original nao encontrado. O estorno foi cancelado.');
    }

    await appendMovement(tx, {
      tenantId: context.tenantId,
      unitId: settlement.unitId,
      accountId: settlement.financialAccountId,
      previousBalance: Money.parse(locked.balance),
      direction: oppositeDirection(original.direction as 'inflow' | 'outflow'),
      amount,
      originKind: 'reversal',
      settlementId,
      reversalOfMovementId: original.id,
      cashSessionId: settlement.cashSessionId,
      reference: reason.slice(0, 200),
      effectiveDate: todayIn(context.tenantTimezone),
      actorId: context.userId,
      now,
      movementId: reversalId,
    });

    const [atualizado] = await tx
      .select({
        amount: financialTitles.amount,
        settledAmount: financialTitles.settledAmount,
        status: financialTitles.status,
        unitId: financialTitles.unitId,
      })
      .from(financialTitles)
      .where(
        and(
          eq(financialTitles.tenantId, context.tenantId),
          eq(financialTitles.id, settlement.titleId),
        ),
      );

    await writeTitleTimeline(tx, context, {
      titleId: settlement.titleId,
      kind: TITLE_TIMELINE_KINDS.REVERSED,
      summary: `Estorno de ${amount.toString()}`,
      reason,
      metadata: { settlementId, reversalMovementId: reversalId },
      now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.FINANCIAL_SETTLEMENT_REVERSED,
        entityType: 'financial_settlement',
        entityId: settlementId,
        tenantId: context.tenantId,
        unitId: settlement.unitId,
        userId: context.userId,
        before: { status: 'confirmed' },
        after: { status: 'reversed', reason, amount: amount.toString() },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.FINANCIAL_SETTLEMENT_REVERSED,
      tenantId: context.tenantId,
      payload: {
        settlementId,
        titleId: settlement.titleId,
        unitId: settlement.unitId,
        amount: amount.toString(),
      },
    });

    return {
      status: atualizado?.status ?? 'open',
      outstanding: outstandingOf({
        amount: Money.parse(atualizado?.amount ?? '0'),
        settledAmount: Money.parse(atualizado?.settledAmount ?? '0'),
      }).toString(),
    };
  });

  return {
    reversalMovementId: reversalId,
    titleStatus: outcome.status,
    outstanding: outcome.outstanding,
  };
}

// ---------------------------------------------------------------------------
// Ledger (item 14)
// ---------------------------------------------------------------------------

export interface AppendMovementInput {
  tenantId: string;
  unitId: string;
  accountId: string;
  previousBalance: Money;
  direction: 'inflow' | 'outflow';
  amount: Money;
  originKind: string;
  settlementId?: string | null;
  reversalOfMovementId?: string | null;
  cashSessionId?: string | null;
  reference?: string | null;
  effectiveDate: string;
  actorId: string | null;
  now: Date;
  movementId?: string;
}

/**
 * Grava UM movimento e atualiza o saldo da conta, na mesma transacao.
 *
 * A UNICA porta de escrita do ledger. Toda entrada e saida de dinheiro do
 * sistema passa por aqui — liquidacao, estorno, abertura de caixa, suprimento
 * e sangria — e e por isso que o saldo materializado consegue ser
 * reconciliavel: nao ha um segundo caminho que o atualize por fora.
 */
export async function appendMovement(
  tx: TransactionExecutor,
  input: AppendMovementInput,
): Promise<string> {
  const movementId = input.movementId ?? newId();
  const resulting = applyToBalance(input.previousBalance, input.direction, input.amount);

  await tx.insert(financialMovements).values({
    id: movementId,
    tenantId: input.tenantId,
    unitId: input.unitId,
    financialAccountId: input.accountId,
    direction: input.direction,
    amount: input.amount.toString(),
    resultingBalance: resulting.toString(),
    originKind: input.originKind,
    settlementId: input.settlementId ?? null,
    reversalOfMovementId: input.reversalOfMovementId ?? null,
    cashSessionId: input.cashSessionId ?? null,
    reference: input.reference ?? null,
    effectiveDate: input.effectiveDate,
    occurredAt: input.now,
    actorId: input.actorId,
    createdAt: input.now,
  });

  /**
   * O saldo e gravado com o valor JA CALCULADO, e nao com `balance + x`.
   *
   * Pode: a conta esta travada desde o inicio da transacao, entao
   * `previousBalance` nao envelheceu. E manter o calculo em `Money` — e nao em
   * aritmetica do SQL — faz o saldo e o `resulting_balance` do movimento virem
   * da mesma conta, o que e o que a reconciliacao compara.
   */
  await tx
    .update(financialAccounts)
    .set({ currentBalance: resulting.toString(), updatedAt: input.now })
    .where(
      and(
        eq(financialAccounts.tenantId, input.tenantId),
        eq(financialAccounts.id, input.accountId),
      ),
    );

  return movementId;
}

// ---------------------------------------------------------------------------
// Leituras auxiliares
// ---------------------------------------------------------------------------

async function loadInstallment(context: TenantContext, titleId: string, installmentId: string) {
  const [row] = await getDb()
    .select({
      id: financialInstallments.id,
      number: financialInstallments.number,
      amount: financialInstallments.amount,
      settledAmount: financialInstallments.settledAmount,
      status: financialInstallments.status,
    })
    .from(financialInstallments)
    .where(
      and(
        eq(financialInstallments.tenantId, context.tenantId),
        eq(financialInstallments.titleId, titleId),
        eq(financialInstallments.id, installmentId),
      ),
    )
    .limit(1);

  if (!row) throw new NotFoundError('Parcela nao encontrada.');
  if (row.status === 'cancelled') throw new BusinessRuleError('Esta parcela foi cancelada.');
  return row;
}

async function loadAccountForSettlement(context: TenantContext, accountId: string, unitId: string) {
  const [row] = await getDb()
    .select({
      id: financialAccounts.id,
      name: financialAccounts.name,
      kind: financialAccounts.kind,
      unitId: financialAccounts.unitId,
      status: financialAccounts.status,
    })
    .from(financialAccounts)
    .where(
      and(eq(financialAccounts.tenantId, context.tenantId), eq(financialAccounts.id, accountId)),
    )
    .limit(1);

  if (!row) throw new NotFoundError('Conta financeira nao encontrada.');
  if (row.status !== 'active') {
    throw new BusinessRuleError(`A conta ${row.name} esta inativa.`);
  }

  /**
   * A CONTA PRECISA SERVIR A UNIDADE DO TITULO (item 54).
   *
   * Conta da empresa serve a todas; conta de unidade serve so a dela. Sem
   * isto, o dinheiro de um atendimento da loja Norte poderia cair na gaveta da
   * loja Centro, e as duas conferencias fechariam erradas.
   */
  if (!accountServesUnit(row, unitId)) {
    throw new BusinessRuleError(
      `A conta ${row.name} pertence a outra unidade e nao pode receber esta liquidacao.`,
    );
  }

  return row;
}

async function loadMethodForSettlement(context: TenantContext, methodId: string) {
  const [row] = await getDb()
    .select({
      id: paymentMethods.id,
      kind: paymentMethods.kind,
      name: paymentMethods.name,
      status: paymentMethods.status,
    })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.tenantId, context.tenantId), eq(paymentMethods.id, methodId)))
    .limit(1);

  if (!row) throw new NotFoundError('Forma de pagamento nao encontrada.');
  if (row.status !== 'active') {
    throw new BusinessRuleError(`A forma de pagamento ${row.name} esta inativa.`);
  }
  return row;
}

async function requireOpenCashSession(context: TenantContext, accountId: string): Promise<string> {
  const [session] = await getDb()
    .select({ id: cashSessions.id })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.tenantId, context.tenantId),
        eq(cashSessions.financialAccountId, accountId),
        eq(cashSessions.status, 'open'),
      ),
    )
    .limit(1);

  if (!session) {
    throw new BusinessRuleError(
      'O caixa desta conta esta fechado. Abra o caixa antes de movimentar dinheiro nele.',
    );
  }
  return session.id;
}

export interface SettlementRecord {
  id: string;
  tenantId: string;
  unitId: string;
  titleId: string;
  installmentId: string;
  direction: TitleDirection;
  amount: string;
  financialAccountId: string;
  cashSessionId: string | null;
  status: string;
}

export async function loadSettlement(
  context: TenantContext,
  settlementId: string,
): Promise<SettlementRecord> {
  const [row] = await getDb()
    .select({
      id: financialSettlements.id,
      tenantId: financialSettlements.tenantId,
      unitId: financialSettlements.unitId,
      titleId: financialSettlements.titleId,
      installmentId: financialSettlements.installmentId,
      direction: financialSettlements.direction,
      amount: financialSettlements.amount,
      financialAccountId: financialSettlements.financialAccountId,
      cashSessionId: financialSettlements.cashSessionId,
      status: financialSettlements.status,
    })
    .from(financialSettlements)
    .where(
      and(
        eq(financialSettlements.tenantId, context.tenantId),
        eq(financialSettlements.id, settlementId),
      ),
    )
    .limit(1);

  if (!row) throw new NotFoundError('Liquidacao nao encontrada.');
  return { ...row, direction: row.direction as TitleDirection };
}

/**
 * RECONCILIACAO DA CONTA (item 105).
 *
 * Recalcula o saldo a partir do LEDGER e compara com a projecao gravada. A
 * divergencia e devolvida, nunca corrigida em silencio.
 */
export async function reconcileAccountBalance(
  context: TenantContext,
  accountId: string,
): Promise<{ stored: string; computed: string; matches: boolean; movements: number }> {
  const [account] = await getDb()
    .select({ balance: financialAccounts.currentBalance })
    .from(financialAccounts)
    .where(
      and(eq(financialAccounts.tenantId, context.tenantId), eq(financialAccounts.id, accountId)),
    )
    .limit(1);

  if (!account) throw new NotFoundError('Conta financeira nao encontrada.');

  const rows = await getDb()
    .select({ direction: financialMovements.direction, amount: financialMovements.amount })
    .from(financialMovements)
    .where(
      and(
        eq(financialMovements.tenantId, context.tenantId),
        eq(financialMovements.financialAccountId, accountId),
      ),
    );

  const computed = rows.reduce(
    (balance, row) =>
      applyToBalance(balance, row.direction as 'inflow' | 'outflow', Money.parse(row.amount)),
    Money.zero(),
  );
  const stored = Money.parse(account.balance);

  return {
    stored: stored.toString(),
    computed: computed.toString(),
    matches: stored.equals(computed),
    movements: rows.length,
  };
}

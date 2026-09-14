import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
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
import {
  IDEMPOTENCY_KEY_MAX,
  MOVEMENT_REASON_MAX,
  MOVEMENT_REFERENCE_MAX,
  assertTransferUnits,
  explainInsufficientStock,
  formatQuantityValue,
  formatTransferNumber,
  movementTotalCost,
  normalizeAdjustmentReason,
  parseConfiguredQuantity,
  parseOperationQuantity,
  signedMovementQuantity,
  unitOfMeasureAbbreviation,
  type MovementType,
} from '@/modules/inventory/domain/inventory';
import {
  parts,
  stockBalances,
  stockLocations,
  stockMovements,
  stockReservations,
  stockTransfers,
} from '@/modules/inventory/infrastructure/schema';
import { TIMELINE_KINDS } from '@/modules/service-orders/domain/service-order';
import {
  serviceOrderTimeline,
  serviceOrders,
} from '@/modules/service-orders/infrastructure/schema';
import {
  allocateSequenceNumber,
  SEQUENCE_TYPES,
} from '@/modules/tenancy/application/sequence-service';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Movimentacao, saldo e reserva (Prompt 10).
 *
 * ESTE ARQUIVO E O UNICO LUGAR QUE ESCREVE `stock_balances`.
 *
 * A ESTRATEGIA DE CONCORRENCIA, EM UMA FRASE (itens 31, 32 e 122; ADR-044)
 *
 *   A CONDICAO DE NEGOCIO VAI NO `WHERE` DO PROPRIO `UPDATE`.
 *
 * Ler o saldo, decidir em TypeScript e gravar depois deixa uma janela entre a
 * leitura e a escrita. Com saldo 1 e duas saidas simultaneas, as duas leem 1,
 * as duas concluem "cabe", e as duas gravam — o estoque fica em -1, ou fica em
 * 0 tendo entregue duas pecas que nao existiam. Nao e um caso raro: e o
 * sabado de manha com dois atendentes.
 *
 * Escrevendo `UPDATE ... SET on_hand = on_hand - :q WHERE on_hand - reserved >= :q`,
 * quem decide e o InnoDB, sob a trava de linha que ele ja segura para gravar.
 * A perdedora recebe `affectedRows() === 0` e vira erro de negocio em
 * portugues. Nao ha retry, nao ha lock explicito e nao ha `SELECT FOR UPDATE`.
 *
 * O BANCO AINDA GUARDA A RETAGUARDA: as CHECK constraints de `stock_balances`
 * recusam saldo negativo mesmo que alguem, um dia, escreva outro caminho.
 *
 * O QUE ESTE ARQUIVO NAO FAZ (itens 46 e 47)
 *
 * Nao existe aqui um `update(serviceOrders).set({ status })`. Consumir peca
 * NAO move a Ordem de Servico: quem decide que o conserto comecou e quem
 * conserta, pelo painel de workflow do Prompt 08. Deduzir a transicao do
 * consumo faria a OS andar sozinha quando o tecnico so pegou a peca para
 * testar.
 */

// ---------------------------------------------------------------------------
// Leitura com escopo (item 116)
// ---------------------------------------------------------------------------

interface PartForOperation {
  id: string;
  code: string;
  name: string;
  unitOfMeasure: string;
  status: string;
}

async function loadPartForOperation(
  context: TenantContext,
  partId: string,
): Promise<PartForOperation> {
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

/** Peca inativa nao recebe lancamento novo; o historico dela continua inteiro. */
function assertPartOperable(part: PartForOperation): void {
  if (part.status !== 'active') {
    throw new BusinessRuleError(`A peca ${part.code} esta inativa e nao aceita movimentacao.`);
  }
}

async function loadServiceOrderInUnit(
  context: TenantContext,
  serviceOrderId: string,
): Promise<{ id: string; unitId: string; number: number }> {
  const [row] = await getDb()
    .select({ id: serviceOrders.id, unitId: serviceOrders.unitId, number: serviceOrders.number })
    .from(serviceOrders)
    .where(and(eq(serviceOrders.tenantId, context.tenantId), eq(serviceOrders.id, serviceOrderId)))
    .limit(1);

  if (!row) throw new NotFoundError('Ordem de Servico nao encontrada.');
  if (!context.authorizedUnitIds.includes(row.unitId)) {
    throw new NotFoundError('Ordem de Servico nao encontrada.');
  }
  return row;
}

export interface BalanceSnapshotRow {
  onHand: string;
  reserved: string;
  available: string;
  minimumQuantity: string;
  averageCost: string | null;
}

/** Saldo da peca NA UNIDADE. Sem linha ainda significa zero, nao erro. */
export async function loadBalance(
  context: TenantContext,
  unitId: string,
  partId: string,
): Promise<BalanceSnapshotRow> {
  assertUnitAuthorized(context, unitId);

  const [row] = await getDb()
    .select({
      onHand: stockBalances.onHand,
      reserved: stockBalances.reserved,
      minimumQuantity: stockBalances.minimumQuantity,
      averageCost: stockBalances.averageCost,
    })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.tenantId, context.tenantId),
        eq(stockBalances.unitId, unitId),
        eq(stockBalances.partId, partId),
      ),
    )
    .limit(1);

  const zero = Quantity.zero().toString();
  if (!row) {
    return {
      onHand: zero,
      reserved: zero,
      available: zero,
      minimumQuantity: zero,
      averageCost: null,
    };
  }

  return {
    ...row,
    available: Quantity.parse(row.onHand).subtract(Quantity.parse(row.reserved)).toString(),
  };
}

function assertUnitAuthorized(context: TenantContext, unitId: string): void {
  if (!context.authorizedUnitIds.includes(unitId)) {
    throw new NotFoundError('Unidade nao encontrada.');
  }
}

async function authorizeInUnit(
  context: TenantContext,
  unitId: string,
  permission: PermissionKey,
): Promise<void> {
  assertUnitAuthorized(context, unitId);
  await authorize(context, {
    permission,
    featureKey: FEATURES.OPERATIONS_INVENTORY,
    unitId,
  });
}

// ---------------------------------------------------------------------------
// As quatro mutacoes de saldo. Cada uma e UMA instrucao.
// ---------------------------------------------------------------------------

interface BalanceTarget {
  tenantId: string;
  unitId: string;
  partId: string;
}

/**
 * Aumenta o saldo fisico. Nunca falha por regra: nada impede receber peca.
 *
 * O CUSTO MEDIO E CALCULADO NO PROPRIO `UPDATE`, e nao em TypeScript, pelo
 * mesmo motivo do saldo: duas entradas simultaneas leriam a mesma media antiga
 * e a segunda sobrescreveria a primeira. `ROUND` do MariaDB sobre DECIMAL e
 * half-up — a mesma convencao do `Money`.
 *
 * Entrada SEM custo informado nao mexe na media: nao saber quanto custou e
 * diferente de ter custado zero.
 */
async function increaseOnHand(
  tx: TransactionExecutor,
  target: BalanceTarget,
  amount: Quantity,
  unitCost: Money | null,
): Promise<void> {
  const value = amount.toString();
  const cost = unitCost ? unitCost.toString() : null;

  await tx.execute(sql`
    INSERT INTO stock_balances
      (id, tenant_id, unit_id, part_id, on_hand, reserved, minimum_quantity,
       average_cost, version, created_at, updated_at)
    VALUES
      (${newId()}, ${target.tenantId}, ${target.unitId}, ${target.partId}, ${value}, 0, 0,
       ${cost}, 1, NOW(3), NOW(3))
    ON DUPLICATE KEY UPDATE
      average_cost = CASE
        WHEN ${cost} IS NULL THEN average_cost
        WHEN average_cost IS NULL OR on_hand <= 0 THEN ${cost}
        ELSE ROUND((on_hand * average_cost + ${value} * ${cost}) / (on_hand + ${value}), 2)
      END,
      low_stock_alerted_at = CASE
        WHEN (on_hand + ${value} - reserved) >= minimum_quantity THEN NULL
        ELSE low_stock_alerted_at
      END,
      on_hand = on_hand + ${value},
      version = version + 1,
      updated_at = NOW(3)
  `);
}

/**
 * Diminui o saldo fisico, e SO SE HOUVER DISPONIVEL.
 *
 * A condicao e sobre o DISPONIVEL, nao sobre o saldo fisico: retirar peca que
 * esta reservada para a OS de outra pessoa deixaria a reserva dela apontando
 * para algo que nao existe mais. Consumir a PROPRIA reserva e outra operacao.
 */
async function decreaseOnHand(
  tx: TransactionExecutor,
  target: BalanceTarget,
  amount: Quantity,
): Promise<boolean> {
  const value = amount.toString();

  const result = await tx.execute(sql`
    UPDATE stock_balances
    SET on_hand = on_hand - ${value},
        version = version + 1,
        updated_at = NOW(3)
    WHERE tenant_id = ${target.tenantId}
      AND unit_id = ${target.unitId}
      AND part_id = ${target.partId}
      AND on_hand - reserved >= ${value}
  `);

  return affectedRows(result) === 1;
}

/** Compromete quantidade. Reserva consome DISPONIVEL e nao toca no fisico. */
async function increaseReserved(
  tx: TransactionExecutor,
  target: BalanceTarget,
  amount: Quantity,
): Promise<boolean> {
  const value = amount.toString();

  const result = await tx.execute(sql`
    UPDATE stock_balances
    SET reserved = reserved + ${value},
        version = version + 1,
        updated_at = NOW(3)
    WHERE tenant_id = ${target.tenantId}
      AND unit_id = ${target.unitId}
      AND part_id = ${target.partId}
      AND on_hand - reserved >= ${value}
  `);

  return affectedRows(result) === 1;
}

/** Devolve quantidade ao disponivel. O fisico nao muda: a peca nunca saiu. */
async function decreaseReserved(
  tx: TransactionExecutor,
  target: BalanceTarget,
  amount: Quantity,
): Promise<boolean> {
  const value = amount.toString();

  const result = await tx.execute(sql`
    UPDATE stock_balances
    SET low_stock_alerted_at = CASE
          WHEN (on_hand - (reserved - ${value})) >= minimum_quantity THEN NULL
          ELSE low_stock_alerted_at
        END,
        reserved = reserved - ${value},
        version = version + 1,
        updated_at = NOW(3)
    WHERE tenant_id = ${target.tenantId}
      AND unit_id = ${target.unitId}
      AND part_id = ${target.partId}
      AND reserved >= ${value}
  `);

  return affectedRows(result) === 1;
}

/**
 * CONSUMO DE RESERVA — UMA INSTRUCAO SO (item 105).
 *
 * Liberar e depois retirar seriam duas operacoes, e entre elas a peca volta ao
 * disponivel: outra pessoa pode leva-la, e o consumo legitimo falha com o
 * estoque "certo" na tela. Aqui `on_hand` e `reserved` caem juntos, sob a mesma
 * trava de linha, ou nao cai nenhum.
 */
async function consumeReserved(
  tx: TransactionExecutor,
  target: BalanceTarget,
  amount: Quantity,
): Promise<boolean> {
  const value = amount.toString();

  const result = await tx.execute(sql`
    UPDATE stock_balances
    SET on_hand = on_hand - ${value},
        reserved = reserved - ${value},
        version = version + 1,
        updated_at = NOW(3)
    WHERE tenant_id = ${target.tenantId}
      AND unit_id = ${target.unitId}
      AND part_id = ${target.partId}
      AND reserved >= ${value}
      AND on_hand >= ${value}
  `);

  return affectedRows(result) === 1;
}

async function readOnHand(tx: TransactionExecutor, target: BalanceTarget): Promise<Quantity> {
  const [row] = await tx
    .select({ onHand: stockBalances.onHand })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.tenantId, target.tenantId),
        eq(stockBalances.unitId, target.unitId),
        eq(stockBalances.partId, target.partId),
      ),
    )
    .limit(1);

  return row ? Quantity.parse(row.onHand) : Quantity.zero();
}

async function readAvailable(target: BalanceTarget): Promise<Quantity> {
  const [row] = await getDb()
    .select({ onHand: stockBalances.onHand, reserved: stockBalances.reserved })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.tenantId, target.tenantId),
        eq(stockBalances.unitId, target.unitId),
        eq(stockBalances.partId, target.partId),
      ),
    )
    .limit(1);

  if (!row) return Quantity.zero();
  return Quantity.parse(row.onHand).subtract(Quantity.parse(row.reserved));
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

interface MovementInput {
  tenantId: string;
  unitId: string;
  partId: string;
  locationId: string | null;
  type: MovementType;
  quantity: Quantity;
  resultingOnHand: Quantity;
  unitCost: Money | null;
  originKind: string;
  reference: string | null;
  reason: string | null;
  serviceOrderId: string | null;
  transferId: string | null;
  reservationId: string | null;
  idempotencyKey: string | null;
  actorId: string | null;
  now: Date;
}

/** INSERT e so. Nao ha update nem delete de movimentacao (itens 23 e 24). */
async function writeMovement(tx: TransactionExecutor, input: MovementInput): Promise<string> {
  const movementId = newId();

  await tx.insert(stockMovements).values({
    id: movementId,
    tenantId: input.tenantId,
    unitId: input.unitId,
    partId: input.partId,
    locationId: input.locationId,
    type: input.type,
    quantity: signedMovementQuantity(input.type, input.quantity).toString(),
    resultingOnHand: input.resultingOnHand.toString(),
    unitCost: input.unitCost ? input.unitCost.toString() : null,
    totalCost: movementTotalCost(input.unitCost, input.quantity)?.toString() ?? null,
    originKind: input.originKind,
    reference: input.reference,
    reason: input.reason,
    serviceOrderId: input.serviceOrderId,
    transferId: input.transferId,
    reservationId: input.reservationId,
    idempotencyKey: input.idempotencyKey,
    actorId: input.actorId,
    occurredAt: input.now,
    createdAt: input.now,
  });

  return movementId;
}

/**
 * Reencontro antes de lancar (itens 118 a 121).
 *
 * Duplo clique, retentativa apos queda de rede e botao voltar reenviam o mesmo
 * comando. A UNIQUE `(tenant_id, idempotency_key)` e a garantia final; esta
 * consulta e o que transforma a colisao numa resposta util.
 */
async function findMovementByKey(tenantId: string, key: string | null) {
  if (!key) return null;

  const [row] = await getDb()
    .select({
      id: stockMovements.id,
      unitId: stockMovements.unitId,
      partId: stockMovements.partId,
      resultingOnHand: stockMovements.resultingOnHand,
    })
    .from(stockMovements)
    .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.idempotencyKey, key)))
    .limit(1);

  return row ?? null;
}

/** Fato RESUMIDO na linha do tempo da OS (item 69). O detalhe fica no ledger. */
async function writeServiceOrderFact(
  tx: TransactionExecutor,
  context: TenantContext,
  args: {
    serviceOrderId: string;
    kind: string;
    summary: string;
    metadata: Record<string, unknown>;
    now: Date;
  },
): Promise<void> {
  await tx.insert(serviceOrderTimeline).values({
    id: newId(),
    tenantId: context.tenantId,
    serviceOrderId: args.serviceOrderId,
    kind: args.kind,
    summary: args.summary,
    metadata: args.metadata,
    actorId: context.userId,
    occurredAt: args.now,
  });
}

// ---------------------------------------------------------------------------
// Entrada (itens 76, 77 e 101)
// ---------------------------------------------------------------------------

const referenceSchema = z.string().trim().max(MOVEMENT_REFERENCE_MAX).optional();
const idempotencySchema = z.string().trim().max(IDEMPOTENCY_KEY_MAX).optional();

export const receiveStockSchema = z.object({
  unitId: z.string().trim().min(1),
  partId: z.string().trim().min(1, 'Escolha a peca.'),
  quantity: z.string().trim().min(1, 'Informe a quantidade.'),
  locationId: z.string().trim().optional(),
  unitCost: z.string().trim().optional(),
  reference: referenceSchema,
  idempotencyKey: idempotencySchema,
});

export interface StockOperationResult {
  movementId: string;
  onHand: string;
  reused: boolean;
}

/**
 * Entrada manual de estoque (item 76).
 *
 * ORIGEM `manual`, e nao `purchase_order` (item 77): nao existe modulo de
 * Compras, e inventar a referencia agora criaria linhas apontando para pedidos
 * que nunca existiram. Quem quiser registrar a nota fiscal usa `reference`,
 * que e texto.
 */
export async function receiveStock(
  context: TenantContext,
  rawInput: unknown,
): Promise<StockOperationResult> {
  const input = parse(receiveStockSchema, rawInput);
  await authorizeInUnit(context, input.unitId, PERMISSIONS.INVENTORY_RECEIVE);

  const part = await loadPartForOperation(context, input.partId);
  assertPartOperable(part);

  const amount = parseOperationQuantity(input.quantity, part.unitOfMeasure);
  const unitCost = parseOptionalCost(input.unitCost);
  const key = input.idempotencyKey || null;

  const existing = await findMovementByKey(context.tenantId, key);
  if (existing) {
    return { movementId: existing.id, onHand: existing.resultingOnHand, reused: true };
  }

  const target = { tenantId: context.tenantId, unitId: input.unitId, partId: part.id };
  const locationId = await resolveLocation(context, input.unitId, input.locationId);
  const now = new Date();

  return runInTransaction(async (tx, emit) => {
    await increaseOnHand(tx, target, amount, unitCost);
    const onHand = await readOnHand(tx, target);

    const movementId = await writeMovement(tx, {
      ...target,
      locationId,
      type: 'receipt',
      quantity: amount,
      resultingOnHand: onHand,
      unitCost,
      originKind: 'manual',
      reference: input.reference || null,
      reason: null,
      serviceOrderId: null,
      transferId: null,
      reservationId: null,
      idempotencyKey: key,
      actorId: context.userId,
      now,
    });

    await rememberPrimaryLocation(tx, target, locationId);

    await emit({
      type: EVENT_TYPES.STOCK_RECEIVED,
      tenantId: context.tenantId,
      payload: {
        partId: part.id,
        unitId: input.unitId,
        quantity: amount.toString(),
        onHand: onHand.toString(),
      },
    });

    return { movementId, onHand: onHand.toString(), reused: false };
  });
}

// ---------------------------------------------------------------------------
// Saida (itens 43, 44 e 102)
// ---------------------------------------------------------------------------

export const issueStockSchema = z.object({
  unitId: z.string().trim().min(1),
  partId: z.string().trim().min(1, 'Escolha a peca.'),
  quantity: z.string().trim().min(1, 'Informe a quantidade.'),
  locationId: z.string().trim().optional(),
  serviceOrderId: z.string().trim().optional(),
  reference: referenceSchema,
  idempotencyKey: idempotencySchema,
});

/**
 * Saida de estoque, com ou sem Ordem de Servico (itens 43 e 102).
 *
 * PECA ORCADA NAO E PECA CONSUMIDA (item 44). Esta funcao so roda porque
 * alguem clicou: nenhum evento de orcamento a chama, e nenhum job a chama.
 *
 * NAO MOVE A ORDEM DE SERVICO (itens 46 e 47). Registra o consumo na linha do
 * tempo dela, que e informacao; quem muda a situacao e o workflow.
 */
export async function issueStock(
  context: TenantContext,
  rawInput: unknown,
): Promise<StockOperationResult> {
  const input = parse(issueStockSchema, rawInput);
  await authorizeInUnit(context, input.unitId, PERMISSIONS.INVENTORY_ISSUE);

  const part = await loadPartForOperation(context, input.partId);
  assertPartOperable(part);

  const amount = parseOperationQuantity(input.quantity, part.unitOfMeasure);
  const key = input.idempotencyKey || null;

  const existing = await findMovementByKey(context.tenantId, key);
  if (existing) {
    return { movementId: existing.id, onHand: existing.resultingOnHand, reused: true };
  }

  const order = input.serviceOrderId
    ? await loadServiceOrderInUnit(context, input.serviceOrderId)
    : null;

  /**
   * A OS PRECISA SER DA MESMA UNIDADE do estoque (itens 35 e 127).
   *
   * A FK composta `(service_order_id, unit_id)` ja recusaria no banco; esta
   * checagem existe para a pessoa receber uma frase em portugues em vez de um
   * erro de constraint.
   */
  if (order && order.unitId !== input.unitId) {
    throw new BusinessRuleError(
      'A Ordem de Servico pertence a outra unidade. Transfira a peca antes de usa-la.',
    );
  }

  const target = { tenantId: context.tenantId, unitId: input.unitId, partId: part.id };
  const locationId = await resolveLocation(context, input.unitId, input.locationId);
  const now = new Date();

  return runInTransaction(async (tx, emit) => {
    const applied = await decreaseOnHand(tx, target, amount);
    if (!applied) {
      const available = await readAvailable(target);
      throw new BusinessRuleError(explainInsufficientStock(available, amount, part.unitOfMeasure));
    }

    const onHand = await readOnHand(tx, target);

    const movementId = await writeMovement(tx, {
      ...target,
      locationId,
      type: 'issue',
      quantity: amount,
      resultingOnHand: onHand,
      unitCost: null,
      originKind: order ? 'service_order' : 'manual',
      reference: input.reference || null,
      reason: null,
      serviceOrderId: order?.id ?? null,
      transferId: null,
      reservationId: null,
      idempotencyKey: key,
      actorId: context.userId,
      now,
    });

    if (order) {
      await writeServiceOrderFact(tx, context, {
        serviceOrderId: order.id,
        kind: TIMELINE_KINDS.PART_CONSUMED,
        summary: `${formatQuantityValue(amount)} ${unitOfMeasureAbbreviation(part.unitOfMeasure)} de ${part.name}`,
        metadata: { partId: part.id, movementId, quantity: amount.toString() },
        now,
      });
    }

    await emit({
      type: EVENT_TYPES.STOCK_ISSUED,
      tenantId: context.tenantId,
      payload: {
        partId: part.id,
        unitId: input.unitId,
        quantity: amount.toString(),
        onHand: onHand.toString(),
        serviceOrderId: order?.id ?? null,
      },
    });

    return { movementId, onHand: onHand.toString(), reused: false };
  });
}

// ---------------------------------------------------------------------------
// Ajuste (itens 55, 56 e 107)
// ---------------------------------------------------------------------------

export const adjustStockSchema = z.object({
  unitId: z.string().trim().min(1),
  partId: z.string().trim().min(1, 'Escolha a peca.'),
  direction: z.enum(['in', 'out']),
  quantity: z.string().trim().min(1, 'Informe a quantidade.'),
  locationId: z.string().trim().optional(),
  reason: z.string().trim().max(MOVEMENT_REASON_MAX),
});

/**
 * Ajuste de saldo.
 *
 * ACAO SENSIVEL, e a unica que reescreve o saldo sem que nada tenha entrado ou
 * saido pela porta. Por isso: permissao propria, motivo obrigatorio, AuditLog
 * e movimentacao no ledger (item 55).
 *
 * AJUSTE NAO EDITA SALDO DIRETO (item 56): passa pelo mesmo caminho de
 * movimentacao de qualquer entrada ou saida. Um `UPDATE stock_balances` a
 * parte deixaria o saldo divergente do ledger — exatamente o que a
 * reconciliacao existe para detectar.
 */
export async function adjustStock(
  context: TenantContext,
  rawInput: unknown,
): Promise<StockOperationResult> {
  const input = parse(adjustStockSchema, rawInput);
  await authorizeInUnit(context, input.unitId, PERMISSIONS.INVENTORY_ADJUST);

  const part = await loadPartForOperation(context, input.partId);
  const amount = parseOperationQuantity(input.quantity, part.unitOfMeasure);
  const reason = normalizeAdjustmentReason(input.reason);

  const target = { tenantId: context.tenantId, unitId: input.unitId, partId: part.id };
  const locationId = await resolveLocation(context, input.unitId, input.locationId);
  const type: MovementType = input.direction === 'in' ? 'adjustment_in' : 'adjustment_out';
  const now = new Date();

  return runInTransaction(async (tx, emit) => {
    if (type === 'adjustment_in') {
      await increaseOnHand(tx, target, amount, null);
    } else {
      const applied = await decreaseOnHand(tx, target, amount);
      if (!applied) {
        const available = await readAvailable(target);
        throw new BusinessRuleError(
          explainInsufficientStock(available, amount, part.unitOfMeasure),
        );
      }
    }

    const onHand = await readOnHand(tx, target);

    const movementId = await writeMovement(tx, {
      ...target,
      locationId,
      type,
      quantity: amount,
      resultingOnHand: onHand,
      unitCost: null,
      originKind: 'manual',
      reference: null,
      reason,
      serviceOrderId: null,
      transferId: null,
      reservationId: null,
      idempotencyKey: null,
      actorId: context.userId,
      now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.STOCK_ADJUSTED,
        entityType: 'stock_balance',
        entityId: part.id,
        tenantId: context.tenantId,
        unitId: input.unitId,
        userId: context.userId,
        after: { direction: input.direction, quantity: amount.toString(), reason },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.STOCK_ADJUSTED,
      tenantId: context.tenantId,
      payload: {
        partId: part.id,
        unitId: input.unitId,
        direction: input.direction,
        quantity: amount.toString(),
        onHand: onHand.toString(),
      },
    });

    return { movementId, onHand: onHand.toString(), reused: false };
  });
}

// ---------------------------------------------------------------------------
// Transferencia (itens 50 a 54, 106 e 121)
// ---------------------------------------------------------------------------

export const transferStockSchema = z.object({
  fromUnitId: z.string().trim().min(1, 'Escolha a unidade de origem.'),
  toUnitId: z.string().trim().min(1, 'Escolha a unidade de destino.'),
  partId: z.string().trim().min(1, 'Escolha a peca.'),
  quantity: z.string().trim().min(1, 'Informe a quantidade.'),
  fromLocationId: z.string().trim().optional(),
  toLocationId: z.string().trim().optional(),
  notes: z.string().trim().max(MOVEMENT_REASON_MAX).optional(),
  idempotencyKey: idempotencySchema,
});

export interface TransferResult {
  transferId: string;
  number: number;
  formattedNumber: string;
  reused: boolean;
}

/**
 * Transfere peca entre unidades da MESMA empresa.
 *
 * UMA TRANSACAO, DUAS MOVIMENTACOES, UMA IDENTIDADE (itens 51 e 52). As duas
 * movimentacoes apontam para o mesmo `transfer_id`; sem essa linha, seriam uma
 * saida e uma entrada que ninguem correlaciona depois — e que um retry
 * duplicaria pela metade.
 *
 * CROSS-TENANT E IMPOSSIVEL (item 54), e nao por checagem daqui: as FKs
 * compostas `(from_unit_id, tenant_id)` e `(to_unit_id, tenant_id)` amarram as
 * duas pontas ao mesmo tenant no banco.
 *
 * E IMEDIATA (item 53): nao ha `in_transit`, e a limitacao esta documentada em
 * docs/modules/inventory/transfers.md. O sistema nao acompanha o transporte, e
 * fingir que acompanha deixaria saldo preso em transito para sempre.
 */
export async function transferStock(
  context: TenantContext,
  rawInput: unknown,
): Promise<TransferResult> {
  const input = parse(transferStockSchema, rawInput);

  assertTransferUnits(input.fromUnitId, input.toUnitId);
  await authorizeInUnit(context, input.fromUnitId, PERMISSIONS.INVENTORY_TRANSFER);
  await authorizeInUnit(context, input.toUnitId, PERMISSIONS.INVENTORY_TRANSFER);

  const part = await loadPartForOperation(context, input.partId);
  assertPartOperable(part);

  const amount = parseOperationQuantity(input.quantity, part.unitOfMeasure);
  const key = input.idempotencyKey || null;

  if (key) {
    const [existing] = await getDb()
      .select({ id: stockTransfers.id, number: stockTransfers.number })
      .from(stockTransfers)
      .where(
        and(eq(stockTransfers.tenantId, context.tenantId), eq(stockTransfers.idempotencyKey, key)),
      )
      .limit(1);

    if (existing) {
      return {
        transferId: existing.id,
        number: existing.number,
        formattedNumber: formatTransferNumber(existing.number),
        reused: true,
      };
    }
  }

  const fromLocationId = await resolveLocation(context, input.fromUnitId, input.fromLocationId);
  const toLocationId = await resolveLocation(context, input.toUnitId, input.toLocationId);

  const origin = { tenantId: context.tenantId, unitId: input.fromUnitId, partId: part.id };
  const destination = { tenantId: context.tenantId, unitId: input.toUnitId, partId: part.id };
  const transferId = newId();
  const now = new Date();

  const number = await runInTransaction(async (tx, emit) => {
    const sequence = await allocateSequenceNumber(
      tx,
      context.tenantId,
      SEQUENCE_TYPES.STOCK_TRANSFER,
      { prefix: 'TRF', padding: 6 },
    );

    /**
     * A SAIDA VEM PRIMEIRO, sempre.
     *
     * Ordem fixa entre as duas linhas de saldo evita o abraco mortal classico:
     * A->B e B->A simultaneos travariam um no outro se cada transacao pegasse
     * as linhas na ordem da propria direcao.
     */
    const applied = await decreaseOnHand(tx, origin, amount);
    if (!applied) {
      const available = await readAvailable(origin);
      throw new BusinessRuleError(explainInsufficientStock(available, amount, part.unitOfMeasure));
    }

    /** O custo medio acompanha a peca: o destino recebe pelo custo da origem. */
    const originAverage = await readAverageCost(tx, origin);
    const originOnHand = await readOnHand(tx, origin);

    await increaseOnHand(tx, destination, amount, originAverage);
    const destinationOnHand = await readOnHand(tx, destination);

    await tx.insert(stockTransfers).values({
      id: transferId,
      tenantId: context.tenantId,
      number: sequence.value,
      fromUnitId: input.fromUnitId,
      toUnitId: input.toUnitId,
      partId: part.id,
      quantity: amount.toString(),
      status: 'completed',
      notes: input.notes || null,
      idempotencyKey: key,
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await writeMovement(tx, {
      ...origin,
      locationId: fromLocationId,
      type: 'transfer_out',
      quantity: amount,
      resultingOnHand: originOnHand,
      unitCost: originAverage,
      originKind: 'transfer',
      reference: formatTransferNumber(sequence.value),
      reason: input.notes || null,
      serviceOrderId: null,
      transferId,
      reservationId: null,
      idempotencyKey: null,
      actorId: context.userId,
      now,
    });

    await writeMovement(tx, {
      ...destination,
      locationId: toLocationId,
      type: 'transfer_in',
      quantity: amount,
      resultingOnHand: destinationOnHand,
      unitCost: originAverage,
      originKind: 'transfer',
      reference: formatTransferNumber(sequence.value),
      reason: input.notes || null,
      serviceOrderId: null,
      transferId,
      reservationId: null,
      idempotencyKey: null,
      actorId: context.userId,
      now,
    });

    await rememberPrimaryLocation(tx, destination, toLocationId);

    await recordAudit(
      {
        action: AUDIT_ACTIONS.STOCK_TRANSFERRED,
        entityType: 'stock_transfer',
        entityId: transferId,
        tenantId: context.tenantId,
        unitId: input.fromUnitId,
        userId: context.userId,
        after: {
          partId: part.id,
          toUnitId: input.toUnitId,
          quantity: amount.toString(),
          number: sequence.value,
        },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.STOCK_TRANSFERRED,
      tenantId: context.tenantId,
      payload: {
        transferId,
        partId: part.id,
        fromUnitId: input.fromUnitId,
        toUnitId: input.toUnitId,
        quantity: amount.toString(),
      },
    });

    return sequence.value;
  });

  return {
    transferId,
    number,
    formattedNumber: formatTransferNumber(number),
    reused: false,
  };
}

// ---------------------------------------------------------------------------
// Reserva (itens 33 a 38, 103 a 105)
// ---------------------------------------------------------------------------

export const reservePartSchema = z.object({
  serviceOrderId: z.string().trim().min(1, 'Informe a Ordem de Servico.'),
  partId: z.string().trim().min(1, 'Escolha a peca.'),
  quantity: z.string().trim().min(1, 'Informe a quantidade.'),
  notes: z.string().trim().max(MOVEMENT_REASON_MAX).optional(),
});

export interface ReservationResult {
  reservationId: string;
  reserved: string;
  available: string;
}

/**
 * Reserva peca para uma Ordem de Servico.
 *
 * ACAO EXPLICITA (itens 36 a 38 e 103). Nenhum evento de orcamento chama esta
 * funcao: aprovar tres orcamentos do mesmo modelo de tela nao pode esvaziar o
 * disponivel sem ninguem ter pego nada.
 *
 * A UNIDADE E A DA OS (item 34), lida da propria OS e nunca do formulario.
 * Reservar estoque de outra unidade nao e possivel (item 35): para isso existe
 * transferencia.
 */
export async function reservePart(
  context: TenantContext,
  rawInput: unknown,
): Promise<ReservationResult> {
  const input = parse(reservePartSchema, rawInput);

  const order = await loadServiceOrderInUnit(context, input.serviceOrderId);
  await authorizeInUnit(context, order.unitId, PERMISSIONS.INVENTORY_RESERVE);

  const part = await loadPartForOperation(context, input.partId);
  assertPartOperable(part);

  const amount = parseOperationQuantity(input.quantity, part.unitOfMeasure);
  const target = { tenantId: context.tenantId, unitId: order.unitId, partId: part.id };
  const reservationId = newId();
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    const applied = await increaseReserved(tx, target, amount);
    if (!applied) {
      const available = await readAvailable(target);
      throw new BusinessRuleError(explainInsufficientStock(available, amount, part.unitOfMeasure));
    }

    await tx.insert(stockReservations).values({
      id: reservationId,
      tenantId: context.tenantId,
      unitId: order.unitId,
      partId: part.id,
      serviceOrderId: order.id,
      quantity: amount.toString(),
      consumedQuantity: Quantity.zero().toString(),
      releasedQuantity: Quantity.zero().toString(),
      status: 'open',
      notes: input.notes || null,
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await writeServiceOrderFact(tx, context, {
      serviceOrderId: order.id,
      kind: TIMELINE_KINDS.PART_RESERVED,
      summary: `${formatQuantityValue(amount)} ${unitOfMeasureAbbreviation(part.unitOfMeasure)} de ${part.name}`,
      metadata: { partId: part.id, reservationId, quantity: amount.toString() },
      now,
    });

    await emit({
      type: EVENT_TYPES.STOCK_RESERVED,
      tenantId: context.tenantId,
      payload: {
        reservationId,
        partId: part.id,
        unitId: order.unitId,
        serviceOrderId: order.id,
        quantity: amount.toString(),
      },
    });
  });

  const balance = await loadBalance(context, order.unitId, part.id);
  return { reservationId, reserved: balance.reserved, available: balance.available };
}

interface ReservationRow {
  id: string;
  tenantId: string;
  unitId: string;
  partId: string;
  serviceOrderId: string;
  quantity: string;
  consumedQuantity: string;
  releasedQuantity: string;
  status: string;
}

async function loadReservation(
  context: TenantContext,
  reservationId: string,
): Promise<ReservationRow> {
  const [row] = await getDb()
    .select({
      id: stockReservations.id,
      tenantId: stockReservations.tenantId,
      unitId: stockReservations.unitId,
      partId: stockReservations.partId,
      serviceOrderId: stockReservations.serviceOrderId,
      quantity: stockReservations.quantity,
      consumedQuantity: stockReservations.consumedQuantity,
      releasedQuantity: stockReservations.releasedQuantity,
      status: stockReservations.status,
    })
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.tenantId, context.tenantId),
        eq(stockReservations.id, reservationId),
      ),
    )
    .limit(1);

  if (!row) throw new NotFoundError('Reserva nao encontrada.');
  if (!context.authorizedUnitIds.includes(row.unitId)) {
    throw new NotFoundError('Reserva nao encontrada.');
  }
  return row;
}

/**
 * Libera parte (ou tudo) do que ainda nao foi consumido (item 104).
 *
 * O saldo fisico NAO muda: a peca nunca saiu da prateleira. O que muda e
 * quanto dela esta comprometido.
 */
export async function releaseReservation(
  context: TenantContext,
  reservationId: string,
  rawQuantity: string,
): Promise<ReservationResult> {
  const reservation = await loadReservation(context, reservationId);
  await authorizeInUnit(context, reservation.unitId, PERMISSIONS.INVENTORY_RESERVE);

  const part = await loadPartForOperation(context, reservation.partId);
  const amount = parseOperationQuantity(rawQuantity, part.unitOfMeasure);
  const target = {
    tenantId: context.tenantId,
    unitId: reservation.unitId,
    partId: reservation.partId,
  };
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    /**
     * A RESERVA E O SALDO CAEM NA MESMA TRANSACAO, cada um com a propria
     * condicao no `WHERE`. Se a reserva nao tiver o saldo pedido, nada e
     * gravado — inclusive a liberacao do saldo, que faz rollback junto.
     */
    const closed = await settleReservation(tx, reservation.id, context.tenantId, amount, 'release');
    if (!closed) {
      throw new BusinessRuleError('A reserva nao tem essa quantidade em aberto.');
    }

    const applied = await decreaseReserved(tx, target, amount);
    if (!applied) {
      throw new ConflictError('O saldo reservado mudou. Recarregue a pagina.');
    }

    await writeServiceOrderFact(tx, context, {
      serviceOrderId: reservation.serviceOrderId,
      kind: TIMELINE_KINDS.PART_RESERVATION_RELEASED,
      summary: `${formatQuantityValue(amount)} ${unitOfMeasureAbbreviation(part.unitOfMeasure)} de ${part.name}`,
      metadata: { partId: part.id, reservationId, quantity: amount.toString() },
      now,
    });

    await emit({
      type: EVENT_TYPES.STOCK_RESERVATION_RELEASED,
      tenantId: context.tenantId,
      payload: {
        reservationId,
        partId: part.id,
        unitId: reservation.unitId,
        quantity: amount.toString(),
      },
    });
  });

  const balance = await loadBalance(context, reservation.unitId, reservation.partId);
  return { reservationId, reserved: balance.reserved, available: balance.available };
}

export const consumeReservationSchema = z.object({
  quantity: z.string().trim().min(1, 'Informe a quantidade.'),
  locationId: z.string().trim().optional(),
  idempotencyKey: idempotencySchema,
});

/**
 * Converte reserva em consumo fisico, ATOMICAMENTE (item 105).
 *
 * `on_hand` e `reserved` caem na mesma instrucao — ver `consumeReserved`. Nao
 * ha um instante em que a peca volta ao disponivel e outra pessoa possa
 * leva-la.
 *
 * NAO MOVE A ORDEM DE SERVICO (itens 46 e 47).
 */
export async function consumeReservation(
  context: TenantContext,
  reservationId: string,
  rawInput: unknown,
): Promise<StockOperationResult> {
  const input = parse(consumeReservationSchema, rawInput);
  const reservation = await loadReservation(context, reservationId);
  await authorizeInUnit(context, reservation.unitId, PERMISSIONS.INVENTORY_ISSUE);

  const part = await loadPartForOperation(context, reservation.partId);
  const amount = parseOperationQuantity(input.quantity, part.unitOfMeasure);
  const key = input.idempotencyKey || null;

  const existing = await findMovementByKey(context.tenantId, key);
  if (existing) {
    return { movementId: existing.id, onHand: existing.resultingOnHand, reused: true };
  }

  const target = {
    tenantId: context.tenantId,
    unitId: reservation.unitId,
    partId: reservation.partId,
  };
  const locationId = await resolveLocation(context, reservation.unitId, input.locationId);
  const now = new Date();

  return runInTransaction(async (tx, emit) => {
    const settled = await settleReservation(
      tx,
      reservation.id,
      context.tenantId,
      amount,
      'consume',
    );
    if (!settled) {
      throw new BusinessRuleError('A reserva nao tem essa quantidade em aberto.');
    }

    const applied = await consumeReserved(tx, target, amount);
    if (!applied) {
      throw new ConflictError('O saldo reservado mudou. Recarregue a pagina.');
    }

    const onHand = await readOnHand(tx, target);
    const averageCost = await readAverageCost(tx, target);

    const movementId = await writeMovement(tx, {
      ...target,
      locationId,
      type: 'issue',
      quantity: amount,
      resultingOnHand: onHand,
      unitCost: averageCost,
      originKind: 'service_order',
      reference: null,
      reason: null,
      serviceOrderId: reservation.serviceOrderId,
      transferId: null,
      reservationId: reservation.id,
      idempotencyKey: key,
      actorId: context.userId,
      now,
    });

    await writeServiceOrderFact(tx, context, {
      serviceOrderId: reservation.serviceOrderId,
      kind: TIMELINE_KINDS.PART_CONSUMED,
      summary: `${formatQuantityValue(amount)} ${unitOfMeasureAbbreviation(part.unitOfMeasure)} de ${part.name}`,
      metadata: { partId: part.id, reservationId, movementId, quantity: amount.toString() },
      now,
    });

    await emit({
      type: EVENT_TYPES.STOCK_RESERVATION_CONSUMED,
      tenantId: context.tenantId,
      payload: {
        reservationId,
        partId: part.id,
        unitId: reservation.unitId,
        serviceOrderId: reservation.serviceOrderId,
        quantity: amount.toString(),
        onHand: onHand.toString(),
      },
    });

    return { movementId, onHand: onHand.toString(), reused: false };
  });
}

/**
 * Baixa na reserva — consumo ou liberacao — em UMA instrucao condicional.
 *
 * A situacao final deriva do que sobrou, e nao de qual botao foi clicado: uma
 * reserva de 3 com 1 consumida e 2 liberadas esta encerrada pelos dois
 * caminhos. Calcular isso no `CASE` do proprio `UPDATE` evita ler, decidir e
 * gravar — o mesmo motivo de sempre.
 */
async function settleReservation(
  tx: TransactionExecutor,
  reservationId: string,
  tenantId: string,
  amount: Quantity,
  mode: 'consume' | 'release',
): Promise<boolean> {
  const value = amount.toString();
  const column = mode === 'consume' ? sql`consumed_quantity` : sql`released_quantity`;

  const result = await tx.execute(sql`
    UPDATE stock_reservations
    SET status = CASE
          WHEN quantity - consumed_quantity - released_quantity - ${value} <= 0 THEN 'closed'
          ELSE 'open'
        END,
        ${column} = ${column} + ${value},
        version = version + 1,
        updated_at = NOW(3)
    WHERE id = ${reservationId}
      AND tenant_id = ${tenantId}
      AND status = 'open'
      AND quantity - consumed_quantity - released_quantity >= ${value}
  `);

  return affectedRows(result) === 1;
}

// ---------------------------------------------------------------------------
// Estoque minimo (item 59)
// ---------------------------------------------------------------------------

export async function setMinimumQuantity(
  context: TenantContext,
  unitId: string,
  partId: string,
  rawQuantity: string,
): Promise<void> {
  await authorizeInUnit(context, unitId, PERMISSIONS.INVENTORY_CATALOG_MANAGE);

  const part = await loadPartForOperation(context, partId);
  const minimum = parseConfiguredQuantity(rawQuantity, part.unitOfMeasure);
  const target = { tenantId: context.tenantId, unitId, partId };
  const value = minimum.toString();

  await runInTransaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO stock_balances
        (id, tenant_id, unit_id, part_id, on_hand, reserved, minimum_quantity,
         version, created_at, updated_at)
      VALUES
        (${newId()}, ${target.tenantId}, ${unitId}, ${partId}, 0, 0, ${value},
         1, NOW(3), NOW(3))
      ON DUPLICATE KEY UPDATE
        low_stock_alerted_at = CASE
          WHEN (on_hand - reserved) >= ${value} THEN NULL
          ELSE low_stock_alerted_at
        END,
        minimum_quantity = ${value},
        version = version + 1,
        updated_at = NOW(3)
    `);

    await recordAudit(
      {
        action: AUDIT_ACTIONS.STOCK_MINIMUM_CHANGED,
        entityType: 'stock_balance',
        entityId: partId,
        tenantId: context.tenantId,
        unitId,
        userId: context.userId,
        after: { minimumQuantity: value },
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

function parse<T extends z.ZodTypeAny>(schema: T, rawInput: unknown): z.infer<T> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

function parseOptionalCost(raw: string | undefined): Money | null {
  if (!raw) return null;
  const cost = Money.parse(raw.replace(',', '.'));
  if (cost.isNegative()) throw new ValidationError('O custo nao pode ser negativo.');
  return cost;
}

/**
 * A localizacao informada precisa existir NA UNIDADE da operacao.
 *
 * A FK composta ja recusaria no banco; aqui a pessoa recebe uma frase em vez
 * de um erro de constraint — e um id de outra unidade responde "nao
 * encontrada", nunca "sem permissao" (que confirmaria a existencia).
 */
async function resolveLocation(
  context: TenantContext,
  unitId: string,
  locationId: string | undefined,
): Promise<string | null> {
  if (!locationId) return null;

  const [row] = await getDb()
    .select({ id: stockLocations.id })
    .from(stockLocations)
    .where(
      and(
        eq(stockLocations.tenantId, context.tenantId),
        eq(stockLocations.id, locationId),
        eq(stockLocations.unitId, unitId),
      ),
    )
    .limit(1);

  if (!row) throw new NotFoundError('Localizacao nao encontrada nesta unidade.');
  return row.id;
}

/** Guarda onde a peca costuma ficar, para a coluna resumida da listagem. */
async function rememberPrimaryLocation(
  tx: TransactionExecutor,
  target: BalanceTarget,
  locationId: string | null,
): Promise<void> {
  if (!locationId) return;

  await tx
    .update(stockBalances)
    .set({ primaryLocationId: locationId })
    .where(
      and(
        eq(stockBalances.tenantId, target.tenantId),
        eq(stockBalances.unitId, target.unitId),
        eq(stockBalances.partId, target.partId),
      ),
    );
}

async function readAverageCost(
  tx: TransactionExecutor,
  target: BalanceTarget,
): Promise<Money | null> {
  const [row] = await tx
    .select({ averageCost: stockBalances.averageCost })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.tenantId, target.tenantId),
        eq(stockBalances.unitId, target.unitId),
        eq(stockBalances.partId, target.partId),
      ),
    )
    .limit(1);

  return row?.averageCost ? Money.parse(row.averageCost) : null;
}

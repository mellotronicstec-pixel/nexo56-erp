import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { logger } from '@/core/logging/logger';
import { Money } from '@/core/money/money';
import { Quantity } from '@/core/quantity/quantity';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  applyStockEntry,
  planStockEntry,
  type StockEntryPlan,
} from '@/modules/inventory/application/stock-service';
import {
  DOCUMENT_NUMBER_MAX,
  IDEMPOTENCY_KEY_MAX,
  PURCHASE_TIMELINE_KINDS,
  explainOverReceipt,
  formatPurchaseOrderNumber,
  formatQuantityValue,
  isPurchaseOrderReceivable,
  nextPurchaseOrderStatus,
  parsePurchaseQuantity,
} from '@/modules/purchasing/domain/purchasing';
import {
  purchaseOrderItems,
  purchaseOrders,
  purchasePriceHistory,
  purchaseReceiptItems,
  purchaseReceipts,
} from '@/modules/purchasing/infrastructure/schema';
import {
  rememberSupplierPart,
  writePurchaseTimeline,
} from '@/modules/purchasing/application/purchase-order-service';
import { addReceivedQuantity } from '@/modules/purchasing/application/purchase-need-service';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Recebimento de compra (Prompt 11, itens 19 a 28).
 *
 * ESTE E O PONTO EM QUE COMPRA VIRA ESTOQUE — e o unico.
 *
 * COMO A ENTRADA ACONTECE (item 20)
 *
 * Nao ha, em lugar nenhum deste arquivo, `UPDATE stock_balances` nem
 * `INSERT INTO stock_movements`. A entrada e feita por `applyStockEntry`, a
 * primitiva oficial do Inventory, DENTRO da transacao deste recebimento. Toda
 * a aritmetica de saldo e de custo medio continua morando num lugar so.
 *
 * O QUE ACONTECE NA MESMA TRANSACAO (item 54)
 *
 *   recebimento + linhas + quantidade recebida do item + entrada de estoque
 *   + ledger + saldo + custo + necessidade + historico de preco + situacao do
 *   pedido + linha do tempo + auditoria + evento
 *
 * Se qualquer parte falhar, NADA e gravado — inclusive o saldo.
 *
 * AS DUAS TRAVAS QUE IMPORTAM
 *
 *   over-receipt   a condicao `received + :q <= quantity` vai no `WHERE` do
 *                  proprio `UPDATE`. Duas pessoas recebendo os ultimos 4 ao
 *                  mesmo tempo: so uma passa (itens 22 e 24).
 *
 *   idempotencia   `uq_receipt_idempotency` no banco. Duplo clique e retry
 *                  produzem UM recebimento, UMA entrada, UM efeito no saldo
 *                  (item 23).
 *
 * O QUE ESTE ARQUIVO NAO FAZ
 *
 *   Nao muda `service_orders.status` (item 60). Peca que chega nao tira a OS
 *   de Aguardando Peca.
 *   Nao reserva peca para OS nenhuma (item 61). A tela pode oferecer; o
 *   efeito e sempre de uma pessoa.
 *   Nao cria titulo financeiro (item 42). Publica
 *   `PURCHASE_RECEIPT_CREATED` e para por ai.
 */

const receiptLineSchema = z.object({
  purchaseOrderItemId: z.string().trim().min(1),
  quantity: z.string().trim().min(1, 'Informe a quantidade recebida.'),
  locationId: z.string().trim().optional(),
});

export const receivePurchaseSchema = z.object({
  lines: z.array(receiptLineSchema).min(1, 'Informe ao menos um item recebido.').max(200),
  documentNumber: z.string().trim().max(DOCUMENT_NUMBER_MAX).optional(),
  documentDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data valida.')
    .or(z.literal(''))
    .optional(),
  notes: z.string().trim().max(300).optional(),
  idempotencyKey: z.string().trim().max(IDEMPOTENCY_KEY_MAX).optional(),
});

export interface ReceivePurchaseResult {
  receiptId: string;
  status: string;
  reused: boolean;
  /** Quantidade total efetivamente recebida nesta operacao. */
  receivedLines: number;
}

interface OrderItemRow {
  id: string;
  partId: string;
  description: string;
  supplierCode: string | null;
  unitOfMeasure: string;
  quantity: string;
  receivedQuantity: string;
  unitCost: string;
  purchaseNeedId: string | null;
}

export async function receivePurchase(
  context: TenantContext,
  purchaseOrderId: string,
  rawInput: unknown,
): Promise<ReceivePurchaseResult> {
  const parsed = receivePurchaseSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  const input = parsed.data;

  const [order] = await getDb()
    .select({
      id: purchaseOrders.id,
      unitId: purchaseOrders.unitId,
      supplierId: purchaseOrders.supplierId,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      version: purchaseOrders.version,
      placedAt: purchaseOrders.placedAt,
    })
    .from(purchaseOrders)
    .where(
      and(eq(purchaseOrders.tenantId, context.tenantId), eq(purchaseOrders.id, purchaseOrderId)),
    )
    .limit(1);

  if (!order) throw new NotFoundError('Pedido de compra nao encontrado.');
  if (!context.authorizedUnitIds.includes(order.unitId)) {
    throw new NotFoundError('Pedido de compra nao encontrado.');
  }

  /**
   * A PERMISSAO E VERIFICADA NA UNIDADE DO PEDIDO (item 47), que nem sempre e
   * a unidade ativa da sessao. Quem recebe cria saldo naquela unidade — e so
   * naquela.
   */
  await authorize(context, {
    permission: PERMISSIONS.PURCHASES_RECEIVE,
    featureKey: FEATURES.OPERATIONS_PURCHASING,
    unitId: order.unitId,
  });

  if (!isPurchaseOrderReceivable(order.status)) {
    throw new BusinessRuleError(
      'Este pedido nao esta aguardando entrega. So pedidos realizados recebem mercadoria.',
    );
  }

  const key = input.idempotencyKey || null;

  /**
   * REENCONTRO ANTES DE RECEBER (item 23).
   *
   * Duplo clique, retry apos queda de rede e botao voltar reenviam o mesmo
   * comando. A UNIQUE no banco e a garantia final; esta consulta transforma a
   * colisao numa resposta util em vez de num erro de constraint.
   */
  if (key) {
    const [existing] = await getDb()
      .select({ id: purchaseReceipts.id })
      .from(purchaseReceipts)
      .where(
        and(
          eq(purchaseReceipts.tenantId, context.tenantId),
          eq(purchaseReceipts.idempotencyKey, key),
        ),
      )
      .limit(1);

    if (existing) {
      logger.info('Recebimento reaproveitado por chave de comando', {
        module: 'purchasing',
        operation: 'receivePurchase',
        purchaseOrderId,
      });
      return {
        receiptId: existing.id,
        status: order.status,
        reused: true,
        receivedLines: 0,
      };
    }
  }

  const itemRows = await getDb()
    .select({
      id: purchaseOrderItems.id,
      partId: purchaseOrderItems.partId,
      description: purchaseOrderItems.description,
      supplierCode: purchaseOrderItems.supplierCode,
      unitOfMeasure: purchaseOrderItems.unitOfMeasure,
      quantity: purchaseOrderItems.quantity,
      receivedQuantity: purchaseOrderItems.receivedQuantity,
      unitCost: purchaseOrderItems.unitCost,
      purchaseNeedId: purchaseOrderItems.purchaseNeedId,
    })
    .from(purchaseOrderItems)
    .where(
      and(
        eq(purchaseOrderItems.tenantId, context.tenantId),
        eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
      ),
    )
    .orderBy(asc(purchaseOrderItems.position));

  const itemById = new Map<string, OrderItemRow>(itemRows.map((row) => [row.id, row]));

  /**
   * Tudo que pode ser resolvido FORA da transacao e resolvido aqui: peca,
   * localizacao, quantidade e a checagem previa de excesso. Dentro da
   * transacao ficam apenas as gravacoes e as condicoes que precisam da trava
   * de linha.
   */
  const prepared: Array<{
    item: OrderItemRow;
    amount: Quantity;
    unitCost: Money;
    plan: StockEntryPlan;
    locationId: string | null;
  }> = [];

  for (const line of input.lines) {
    const item = itemById.get(line.purchaseOrderItemId);
    if (!item) throw new NotFoundError('Item do pedido nao encontrado.');

    const amount = parsePurchaseQuantity(line.quantity, item.unitOfMeasure);
    const snapshot = {
      quantity: Quantity.parse(item.quantity),
      receivedQuantity: Quantity.parse(item.receivedQuantity),
    };

    /** Aviso em portugues; a trava de verdade esta no `WHERE` e na CHECK. */
    if (snapshot.quantity.subtract(snapshot.receivedQuantity).compare(amount) < 0) {
      throw new BusinessRuleError(explainOverReceipt(snapshot, amount));
    }

    const plan = await planStockEntry(context, {
      unitId: order.unitId,
      partId: item.partId,
      quantity: amount.toString(),
      locationId: line.locationId ?? null,
      unitCost: item.unitCost,
      originKind: 'purchase_order',
      /**
       * A referencia humana viaja no proprio movimento (item 50).
       *
       * E o que permite ao Estoque mostrar "Origem: Compra PC 000037" mesmo
       * com o modulo de Compras desligado — sem FK do Inventory para ca.
       */
      reference: formatPurchaseOrderNumber(order.number),
      idempotencyKey: key ? `${key}:${item.id}`.slice(0, 80) : null,
    });

    prepared.push({
      item,
      amount,
      unitCost: Money.parse(item.unitCost),
      plan,
      locationId: plan.locationId,
    });
  }

  const receiptId = newId();
  const now = new Date();

  const outcome = await runInTransaction(async (tx, emit) => {
    /**
     * A PRIMEIRA COISA E TRAVAR O PEDIDO.
     *
     * Tudo que recebe mercadoria deste pedido passa por esta linha, e por ela
     * primeiro. Sao dois motivos, e os dois sao praticos:
     *
     * 1. ORDEM DE TRAVA UNICA. Sem isto, duas pessoas recebendo LINHAS
     *    DIFERENTES do mesmo pedido travam os itens em ordens opostas e o
     *    InnoDB mata uma das duas por impasse — a segunda entrega legitima
     *    seria recusada com uma mensagem que ninguem entende.
     * 2. LEITURA FRESCA. Quem espera aqui so segue depois que a outra
     *    transacao confirmou, e passa a enxergar o que ela gravou. E o que
     *    faz a aritmetica da situacao do pedido bater.
     *
     * A situacao e conferida DE NOVO sob a trava: entre a leitura de fora e
     * este ponto, alguem pode ter cancelado o pedido.
     */
    const travado = await tx
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(
        and(eq(purchaseOrders.tenantId, context.tenantId), eq(purchaseOrders.id, purchaseOrderId)),
      )
      .for('update');

    if (!isPurchaseOrderReceivable(travado[0]?.status ?? '')) {
      throw new ConflictError(
        'Este pedido mudou de situacao enquanto o recebimento era registrado. Recarregue a pagina.',
      );
    }

    /**
     * O RECEBIMENTO E GRAVADO PRIMEIRO, de propósito.
     *
     * A UNIQUE da chave de comando quebra aqui, o mais cedo possivel, e leva a
     * transacao inteira embora — entrada de estoque incluida. E o que faz duas
     * requisicoes simultaneas com a mesma chave produzirem UM efeito so.
     */
    await tx.insert(purchaseReceipts).values({
      id: receiptId,
      tenantId: context.tenantId,
      unitId: order.unitId,
      purchaseOrderId,
      receivedAt: now,
      documentNumber: input.documentNumber || null,
      documentDate: input.documentDate || null,
      notes: input.notes || null,
      idempotencyKey: key,
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    for (const line of prepared) {
      /**
       * A TRAVA DE OVER-RECEIPT (itens 22 e 24).
       *
       * A condicao vai no `WHERE` do proprio `UPDATE`: quem decide e o InnoDB,
       * sob a trava de linha que ele ja segura para gravar. Com 4 pendentes e
       * duas pessoas recebendo 4 ao mesmo tempo, a segunda recebe
       * `affectedRows() === 0` e a transacao dela inteira volta atras.
       */
      const applied = await tx.execute(sql`
        UPDATE purchase_order_items
        SET received_quantity = received_quantity + ${line.amount.toString()},
            updated_at = NOW(3)
        WHERE id = ${line.item.id}
          AND tenant_id = ${context.tenantId}
          AND received_quantity + ${line.amount.toString()} <= quantity
      `);

      if (affectedRows(applied) !== 1) {
        logger.warn('Recebimento recusado por exceder o pedido', {
          module: 'purchasing',
          operation: 'receivePurchase',
          purchaseOrderId,
        });
        throw new BusinessRuleError(
          `Outra pessoa ja recebeu esta mercadoria. Recarregue o pedido e confira o que ainda falta de ${line.item.description}.`,
        );
      }

      /** A ENTRADA DE ESTOQUE, pela primitiva oficial do Inventory (item 20). */
      const entry = await applyStockEntry(tx, emit, context, line.plan, { now });

      await tx.insert(purchaseReceiptItems).values({
        id: newId(),
        tenantId: context.tenantId,
        purchaseReceiptId: receiptId,
        purchaseOrderItemId: line.item.id,
        partId: line.item.partId,
        unitId: order.unitId,
        quantity: line.amount.toString(),
        unitCost: line.unitCost.toString(),
        totalCost: line.unitCost.multiply(line.amount.toString()).toString(),
        locationId: line.locationId,
        stockMovementId: entry.movementId,
        createdAt: now,
      });

      /** A NECESSIDADE SO FECHA AGORA — quando a mercadoria chegou (item 30). */
      if (line.item.purchaseNeedId) {
        await addReceivedQuantity(tx, context.tenantId, line.item.purchaseNeedId, line.amount);
      }

      /**
       * HISTORICO DE PRECO PAGO (itens 7 e 28): uma linha por recebimento,
       * append-only. O preco anterior NUNCA e sobrescrito.
       */
      await tx.insert(purchasePriceHistory).values({
        id: newId(),
        tenantId: context.tenantId,
        supplierId: order.supplierId,
        partId: line.item.partId,
        unitId: order.unitId,
        purchaseOrderId,
        purchaseReceiptId: receiptId,
        quantity: line.amount.toString(),
        unitCost: line.unitCost.toString(),
        totalCost: line.unitCost.multiply(line.amount.toString()).toString(),
        observedLeadTimeDays: observedLeadTime(order.placedAt, now),
        occurredAt: now,
        createdAt: now,
      });

      await rememberSupplierPart(tx, {
        tenantId: context.tenantId,
        supplierId: order.supplierId,
        partId: line.item.partId,
        unitCost: line.unitCost,
        supplierCode: line.item.supplierCode,
        now,
      });
    }

    /**
     * A SITUACAO DO PEDIDO E RECALCULADA A PARTIR DO QUE CHEGOU (item 16).
     *
     * Lendo as linhas JA atualizadas, dentro da transacao. Nao ha botao
     * "marcar como recebido" que possa contrariar a aritmetica.
     *
     * A LEITURA E COM TRAVA (`FOR UPDATE`), e isso nao e zelo decorativo.
     *
     * O InnoDB roda em REPEATABLE READ: uma leitura comum enxergaria a
     * fotografia do banco de quando esta transacao comecou a ler, e nao o que
     * outra pessoa acabou de gravar. Com duas pessoas recebendo LINHAS
     * DIFERENTES do mesmo pedido ao mesmo tempo, a segunda concluiria
     * "ainda falta chegar coisa" olhando para uma linha desatualizada, e o
     * pedido terminaria como PARCIALMENTE RECEBIDO com tudo na prateleira.
     * A leitura travada le o ultimo dado confirmado e espera quem estiver
     * gravando — que e o unico jeito de a aritmetica bater.
     */
    const updatedItems = await tx
      .select({
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
      .for('update');

    const nextStatus = nextPurchaseOrderStatus(
      updatedItems.map((row) => ({
        quantity: Quantity.parse(row.quantity),
        receivedQuantity: Quantity.parse(row.receivedQuantity),
      })),
      order.status,
    );

    /**
     * CANCELAMENTO x RECEBIMENTO (item 56, caso C).
     *
     * A condicao de situacao vai no `WHERE`: se alguem cancelou o pedido entre
     * a leitura e aqui, este `UPDATE` nao afeta linha nenhuma e a transacao
     * inteira volta atras — inclusive a entrada de estoque. O resultado e
     * deterministico: ou o cancelamento vence e nada entrou, ou o recebimento
     * vence e o cancelamento e recusado por versao.
     */
    const statusApplied = await tx.execute(sql`
      UPDATE purchase_orders
      SET status = ${nextStatus},
          version = version + 1,
          updated_by = ${context.userId},
          updated_at = NOW(3)
      WHERE id = ${purchaseOrderId}
        AND tenant_id = ${context.tenantId}
        AND status IN ('placed', 'partially_received')
    `);

    if (affectedRows(statusApplied) !== 1) {
      throw new ConflictError(
        'Este pedido mudou de situacao enquanto o recebimento era registrado. Recarregue a pagina.',
      );
    }

    const resumo = prepared
      .map((line) => `${formatQuantityValue(line.amount)} x ${line.item.description}`)
      .join('; ');

    await writePurchaseTimeline(tx, context, {
      purchaseOrderId,
      kind:
        nextStatus === 'received'
          ? PURCHASE_TIMELINE_KINDS.RECEIVED
          : PURCHASE_TIMELINE_KINDS.PARTIALLY_RECEIVED,
      summary: resumo.slice(0, 300),
      metadata: { receiptId, lines: prepared.length, status: nextStatus },
      now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.PURCHASE_RECEIPT_CREATED,
        entityType: 'purchase_receipt',
        entityId: receiptId,
        tenantId: context.tenantId,
        unitId: order.unitId,
        userId: context.userId,
        after: {
          purchaseOrderId,
          number: order.number,
          lines: prepared.length,
          status: nextStatus,
        },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.PURCHASE_RECEIPT_CREATED,
      tenantId: context.tenantId,
      /**
       * O GANCHO DO PROMPT 12 (itens 42 e 88).
       *
       * NAO HA CONSUMIDOR. Nenhum titulo financeiro e criado, nenhuma conta a
       * pagar e aberta, nenhum pagamento e registrado.
       */
      payload: {
        receiptId,
        purchaseOrderId,
        number: order.number,
        unitId: order.unitId,
        supplierId: order.supplierId,
        lines: prepared.length,
        status: nextStatus,
      },
    });

    await emit({
      type:
        nextStatus === 'received'
          ? EVENT_TYPES.PURCHASE_ORDER_RECEIVED
          : EVENT_TYPES.PURCHASE_ORDER_PARTIALLY_RECEIVED,
      tenantId: context.tenantId,
      payload: { purchaseOrderId, number: order.number, unitId: order.unitId },
    });

    return nextStatus;
  });

  return {
    receiptId,
    status: outcome,
    reused: false,
    receivedLines: prepared.length,
  };
}

/**
 * Prazo REAL entre o pedido realizado e a chegada, em dias (item 7).
 *
 * E o dado que permitira, um dia, comparar o que o fornecedor promete com o
 * que ele cumpre. Nulo quando o pedido nao tem data de realizacao — porque
 * inventar zero seria afirmar entrega imediata.
 */
function observedLeadTime(placedAt: Date | null, receivedAt: Date): number | null {
  if (!placedAt) return null;
  const millis = receivedAt.getTime() - placedAt.getTime();
  if (millis < 0) return null;
  return Math.floor(millis / (24 * 60 * 60 * 1000));
}

/** Recebimentos de um pedido, do mais recente para o mais antigo. */
export async function listReceipts(context: TenantContext, purchaseOrderId: string) {
  return getDb()
    .select({
      id: purchaseReceipts.id,
      receivedAt: purchaseReceipts.receivedAt,
      documentNumber: purchaseReceipts.documentNumber,
      notes: purchaseReceipts.notes,
    })
    .from(purchaseReceipts)
    .where(
      and(
        eq(purchaseReceipts.tenantId, context.tenantId),
        eq(purchaseReceipts.purchaseOrderId, purchaseOrderId),
      ),
    )
    .orderBy(asc(purchaseReceipts.receivedAt));
}

export type { TransactionExecutor };

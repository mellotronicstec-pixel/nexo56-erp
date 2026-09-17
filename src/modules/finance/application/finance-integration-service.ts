import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { BusinessRuleError, NotFoundError, ValidationError } from '@/core/errors';
import { Money } from '@/core/money/money';
import { civilDaysFromNow, todayIn } from '@/core/time/civil-date';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { INSTALLMENTS_MAX, TITLE_DESCRIPTION_MAX } from '@/modules/finance/domain/finance';
import {
  createFinancialTitle,
  type CreateTitleResult,
} from '@/modules/finance/application/title-service';
import { financialTitles } from '@/modules/finance/infrastructure/schema';
import {
  purchaseOrders,
  purchaseReceiptItems,
  purchaseReceipts,
} from '@/modules/purchasing/infrastructure/schema';
import { quotes } from '@/modules/quotes/infrastructure/schema';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * INTEGRACAO COM OS, ORCAMENTO E COMPRAS (Prompt 12, itens 29 a 34).
 *
 * Este arquivo e a fronteira, e ela e de MAO UNICA: o Financeiro LE o que os
 * outros modulos produziram e cria a obrigacao a partir disso. Nenhum modulo
 * operacional importa o Financeiro — `service-orders`, `quotes`, `purchasing` e
 * `inventory` continuam sem saber que ele existe, e o teste de fronteira
 * arquitetural falha se isso mudar.
 *
 * E O FINANCEIRO NAO ESCREVE NELES: nao ha `update(serviceOrders)`, nao ha
 * escrita em estoque, e nao ha alteracao da situacao do pedido de compra.
 */

// ---------------------------------------------------------------------------
// Ordem de Servico (itens 29 a 32)
// ---------------------------------------------------------------------------

const serviceOrderChargeSchema = z.object({
  /** Vazio = usa o total do orcamento aprovado. */
  amount: z.string().trim().optional(),
  description: z.string().trim().max(TITLE_DESCRIPTION_MAX).optional(),
  installmentCount: z.coerce.number().int().min(1).max(INSTALLMENTS_MAX).default(1),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data valida.')
    .optional(),
  categoryId: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * A COBRANCA DE UMA ORDEM DE SERVICO NASCE POR ACAO DE PESSOA (ADR-056).
 *
 * APROVAR ORCAMENTO NAO E RECEBER DINHEIRO, e nao e nem sequer cobrar: e o
 * aceite comercial do cliente. Entre o aceite e a cobranca existe o conserto,
 * que pode descobrir que a peca nao serve, que o aparelho nao tem jeito, ou
 * que o cliente desistiu. Criar o titulo na aprovacao encheria o contas a
 * receber de cobrancas que nunca deveriam ter existido — e cancelar cada uma
 * delas custaria mais do que cria-las.
 *
 * Entao quem cria e uma PESSOA, no momento em que ha o que cobrar. O valor vem
 * pronto do orcamento aprovado, e a acao e IDEMPOTENTE: repetir reencontra o
 * titulo em vez de criar um segundo (item 38).
 */
export async function ensureServiceOrderCharge(
  context: TenantContext,
  serviceOrderId: string,
  rawInput: unknown = {},
): Promise<CreateTitleResult & { amount: string }> {
  const parsed = serviceOrderChargeSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  const input = parsed.data;

  const [order] = await getDb()
    .select({
      id: serviceOrders.id,
      unitId: serviceOrders.unitId,
      number: serviceOrders.number,
      customerId: serviceOrders.customerId,
      status: serviceOrders.status,
    })
    .from(serviceOrders)
    .where(and(eq(serviceOrders.tenantId, context.tenantId), eq(serviceOrders.id, serviceOrderId)))
    .limit(1);

  if (!order || !context.authorizedUnitIds.includes(order.unitId)) {
    throw new NotFoundError('Ordem de Servico nao encontrada.');
  }

  await authorize(context, {
    permission: PERMISSIONS.FINANCE_RECEIVABLES_MANAGE,
    featureKey: FEATURES.FINANCE_CORE,
    unitId: order.unitId,
  });

  /** O orcamento aprovado, quando existe: e dele que sai o valor sugerido. */
  const [approved] = await getDb()
    .select({ id: quotes.id, total: quotes.total, number: quotes.number })
    .from(quotes)
    .where(
      and(
        eq(quotes.tenantId, context.tenantId),
        eq(quotes.serviceOrderId, serviceOrderId),
        eq(quotes.status, 'approved'),
      ),
    )
    .limit(1);

  const amountRaw = input.amount || approved?.total;
  if (!amountRaw) {
    throw new BusinessRuleError(
      'Esta Ordem de Servico nao tem orcamento aprovado. Informe o valor da cobranca.',
    );
  }

  let amount: Money;
  try {
    amount = Money.parse(amountRaw);
  } catch {
    throw new ValidationError('Valor invalido.');
  }
  if (!amount.isPositive()) {
    throw new ValidationError('O valor da cobranca precisa ser maior que zero.');
  }

  const dueDate = input.dueDate || todayIn(context.tenantTimezone);

  const result = await createFinancialTitle(context, {
    unitId: order.unitId,
    direction: 'receivable',
    customerId: order.customerId,
    description: input.description || `Atendimento da OS ${String(order.number).padStart(6, '0')}`,
    categoryId: input.categoryId,
    amount: amount.toString(),
    dueDate,
    installmentCount: input.installmentCount,
    origin: 'service_order',
    serviceOrderId: order.id,
    quoteId: approved?.id,
    notes: input.notes,
  });

  return { ...result, amount: amount.toString() };
}

/** O titulo de cobranca daquela OS, se ja existir. */
export async function findServiceOrderCharge(context: TenantContext, serviceOrderId: string) {
  const [row] = await getDb()
    .select({
      id: financialTitles.id,
      number: financialTitles.number,
      amount: financialTitles.amount,
      settledAmount: financialTitles.settledAmount,
      status: financialTitles.status,
      dueDate: financialTitles.dueDate,
      installmentCount: financialTitles.installmentCount,
    })
    .from(financialTitles)
    .where(
      and(
        eq(financialTitles.tenantId, context.tenantId),
        eq(financialTitles.originKey, `service_order:${serviceOrderId}`),
      ),
    )
    .limit(1);

  return row ?? null;
}

// ---------------------------------------------------------------------------
// Compras (itens 33, 34 e 37)
// ---------------------------------------------------------------------------

const purchasePayableSchema = z.object({
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data valida.')
    .optional(),
  installmentCount: z.coerce.number().int().min(1).max(INSTALLMENTS_MAX).default(1),
  categoryId: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * A CONTA A PAGAR NASCE DO RECEBIMENTO DA MERCADORIA (ADR-057).
 *
 * Nao do pedido. "Pedido realizado" significa que alguem ligou para o
 * distribuidor — nao que a mercadoria chegou, nem que a nota veio. Criar a
 * obrigacao ali encheria o contas a pagar de dividas que talvez nunca se
 * materializem, e o cancelamento de um pedido teria de sair apagando titulo.
 *
 * UM TITULO POR RECEBIMENTO, e e isso que faz a COMPRA PARCIAL funcionar
 * (item 34): pedido de R$ 1.000 com entregas de R$ 600 e R$ 400 gera dois
 * titulos que somam exatamente R$ 1.000. Nunca R$ 1.600, nunca duplicado no
 * retry — a chave de origem `purchase_receipt:<id>` e UNIQUE no banco.
 *
 * CANCELAR O PEDIDO DEPOIS NAO APAGA NADA (item 37): a mercadoria que chegou
 * continua no estoque e a divida dela continua a pagar. Sao fatos, e fatos nao
 * se desfazem por decisao posterior.
 *
 * O QUE ESTE TITULO COBRE: o valor das mercadorias daquele recebimento. Frete
 * e outros custos do pedido NAO entram — eles vivem no pedido (ADR-051) e, se
 * forem cobrados, viram uma conta a pagar propria. Isso esta escrito na tela.
 */
export async function ensurePurchaseReceiptPayable(
  context: TenantContext,
  purchaseReceiptId: string,
  rawInput: unknown = {},
): Promise<CreateTitleResult & { amount: string }> {
  const parsed = purchasePayableSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  const input = parsed.data;

  const [receipt] = await getDb()
    .select({
      id: purchaseReceipts.id,
      unitId: purchaseReceipts.unitId,
      purchaseOrderId: purchaseReceipts.purchaseOrderId,
      documentNumber: purchaseReceipts.documentNumber,
      documentDate: purchaseReceipts.documentDate,
      receivedAt: purchaseReceipts.receivedAt,
    })
    .from(purchaseReceipts)
    .where(
      and(
        eq(purchaseReceipts.tenantId, context.tenantId),
        eq(purchaseReceipts.id, purchaseReceiptId),
      ),
    )
    .limit(1);

  if (!receipt || !context.authorizedUnitIds.includes(receipt.unitId)) {
    throw new NotFoundError('Recebimento de compra nao encontrado.');
  }

  await authorize(context, {
    permission: PERMISSIONS.FINANCE_PAYABLES_MANAGE,
    featureKey: FEATURES.FINANCE_CORE,
    unitId: receipt.unitId,
  });

  const [order] = await getDb()
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      supplierId: purchaseOrders.supplierId,
      unitId: purchaseOrders.unitId,
    })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.tenantId, context.tenantId),
        eq(purchaseOrders.id, receipt.purchaseOrderId),
      ),
    )
    .limit(1);

  if (!order) throw new NotFoundError('Pedido de compra nao encontrado.');

  /** O valor da mercadoria QUE CHEGOU NESTE recebimento, somado no banco. */
  const [soma] = await getDb()
    .select({ total: sql<string>`COALESCE(SUM(${purchaseReceiptItems.totalCost}), 0)` })
    .from(purchaseReceiptItems)
    .where(
      and(
        eq(purchaseReceiptItems.tenantId, context.tenantId),
        eq(purchaseReceiptItems.purchaseReceiptId, purchaseReceiptId),
      ),
    );

  const amount = Money.parse(String(soma?.total ?? '0'));
  if (!amount.isPositive()) {
    throw new BusinessRuleError('Este recebimento nao tem valor para gerar conta a pagar.');
  }

  /** Sem data informada, vence em 30 dias — o prazo comercial mais comum. */
  const dueDate = input.dueDate || civilDaysFromNow(context.tenantTimezone, 30);

  const numeroPedido = `PC ${String(order.number).padStart(6, '0')}`;
  const descricao = receipt.documentNumber
    ? `Compra ${numeroPedido} — nota ${receipt.documentNumber}`
    : `Compra ${numeroPedido}`;

  const result = await createFinancialTitle(context, {
    unitId: receipt.unitId,
    direction: 'payable',
    supplierId: order.supplierId,
    description: descricao.slice(0, TITLE_DESCRIPTION_MAX),
    categoryId: input.categoryId,
    amount: amount.toString(),
    dueDate,
    installmentCount: input.installmentCount,
    origin: 'purchase_receipt',
    purchaseOrderId: order.id,
    purchaseReceiptId: receipt.id,
    notes: input.notes,
  });

  return { ...result, amount: amount.toString() };
}

/** Recebimentos daquele pedido e se cada um ja virou conta a pagar. */
export async function listReceiptsWithPayableStatus(
  context: TenantContext,
  purchaseOrderId: string,
) {
  const receipts = await getDb()
    .select({
      id: purchaseReceipts.id,
      receivedAt: purchaseReceipts.receivedAt,
      documentNumber: purchaseReceipts.documentNumber,
      unitId: purchaseReceipts.unitId,
    })
    .from(purchaseReceipts)
    .where(
      and(
        eq(purchaseReceipts.tenantId, context.tenantId),
        eq(purchaseReceipts.purchaseOrderId, purchaseOrderId),
      ),
    );

  if (receipts.length === 0) return [];

  const titles = await getDb()
    .select({
      id: financialTitles.id,
      number: financialTitles.number,
      amount: financialTitles.amount,
      settledAmount: financialTitles.settledAmount,
      status: financialTitles.status,
      purchaseReceiptId: financialTitles.purchaseReceiptId,
    })
    .from(financialTitles)
    .where(
      and(
        eq(financialTitles.tenantId, context.tenantId),
        eq(financialTitles.purchaseOrderId, purchaseOrderId),
      ),
    );

  const porRecebimento = new Map(titles.map((row) => [row.purchaseReceiptId, row]));

  return receipts
    .filter((receipt) => context.authorizedUnitIds.includes(receipt.unitId))
    .map((receipt) => ({
      ...receipt,
      payable: porRecebimento.get(receipt.id) ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Despesa avulsa (item 27)
// ---------------------------------------------------------------------------

const expenseSchema = z.object({
  unitId: z.string().trim().min(1, 'Escolha a unidade.'),
  supplierId: z.string().trim().optional(),
  payeeName: z.string().trim().max(200).optional(),
  description: z.string().trim().min(1, 'Informe a descricao.').max(TITLE_DESCRIPTION_MAX),
  categoryId: z.string().trim().optional(),
  amount: z.string().trim().min(1, 'Informe o valor.'),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data valida.'),
  installmentCount: z.coerce.number().int().min(1).max(INSTALLMENTS_MAX).default(1),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * DESPESA AVULSA: aluguel, energia, motoboy, material de limpeza (item 27).
 *
 * Nasce como conta a pagar MANUAL — sem pedido de compra, e sem exigir
 * fornecedor cadastrado. Pagar imediatamente e so registrar a liquidacao logo
 * depois: o titulo continua existindo, porque uma despesa paga na hora ainda e
 * uma despesa que aconteceu, e o relatorio precisa dela.
 *
 * Nao ha atalho que crie movimento sem titulo (item 27): todo movimento
 * financeiro tem origem rastreavel.
 */
export async function createExpense(
  context: TenantContext,
  rawInput: unknown,
): Promise<CreateTitleResult> {
  const parsed = expenseSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  const input = parsed.data;

  return createFinancialTitle(context, {
    ...input,
    direction: 'payable',
    origin: 'manual',
  });
}

import 'server-only';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { civilDateRangeToUtc } from '@/core/time/civil-date';
import { ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { Money } from '@/core/money/money';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { FEATURES } from '@/modules/features/domain/catalog';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  COST_DESCRIPTION_MAX,
  COST_KINDS,
  WARRANTY_TIMELINE_KINDS,
} from '@/modules/warranties/domain/warranty';
import { warrantyCosts } from '@/modules/warranties/infrastructure/schema';
import { loadWarranty, writeWarrantyTimeline } from './warranty-service';

/**
 * CUSTOS DE GARANTIA (Prompt 13, itens 44 a 46, 47, 48 e 70).
 *
 * CUSTO NAO E PAGAMENTO, e este modulo inteiro existe para manter os dois
 * separados. Registrar que uma garantia consumiu R$ 80 de peca NAO cria
 * titulo, NAO movimenta caixa e NAO toca o razao: o Financeiro sequer fica
 * sabendo, porque nada financeiro aconteceu.
 *
 * O QUE ISSO MEDE: quanto a loja gastou honrando o que prometeu. E a resposta
 * para "garantir 90 dias esta saindo caro?" — que e pergunta de gestao, nao
 * lancamento contabil.
 *
 * O QUE ESTE MODULO NUNCA FAZ (itens 47, 48 e 109): criar titulo a receber ou
 * a pagar, gerar movimento financeiro, escrever no razao, devolver peca ao
 * estoque ou lancar reembolso. Uma garantia valida nao gera cobranca ao
 * cliente — e tambem NAO gera um titulo de valor zero para "registrar".
 */

const costSchema = z.object({
  warrantyId: z.string().trim().min(1),
  warrantyReturnId: z.string().trim().optional().or(z.literal('')),
  serviceOrderId: z.string().trim().optional().or(z.literal('')),
  kind: z.enum(COST_KINDS),
  description: z.string().trim().min(1, 'Descreva o custo.').max(COST_DESCRIPTION_MAX),
  amount: z.string().trim().min(1, 'Informe o valor.'),
  stockMovementId: z.string().trim().optional().or(z.literal('')),
  partId: z.string().trim().optional().or(z.literal('')),
});

export async function recordWarrantyCost(
  context: TenantContext,
  rawInput: unknown,
): Promise<{ costId: string }> {
  const parsed = costSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  const input = parsed.data;

  const warranty = await loadWarranty(context, input.warrantyId);

  await authorize(context, {
    permission: PERMISSIONS.WARRANTIES_COSTS_MANAGE,
    featureKey: FEATURES.OPERATIONS_WARRANTIES,
    unitId: warranty.unitId,
  });

  let amount: Money;
  try {
    amount = Money.parse(input.amount);
  } catch {
    throw new ValidationError('Valor invalido.');
  }
  if (amount.isNegative()) throw new ValidationError('O custo nao pode ser negativo.');

  const costId = newId();
  const now = new Date();

  await runInTransaction(async (tx) => {
    await tx.insert(warrantyCosts).values({
      id: costId,
      tenantId: context.tenantId,
      warrantyId: input.warrantyId,
      warrantyReturnId: input.warrantyReturnId || null,
      serviceOrderId: input.serviceOrderId || null,
      kind: input.kind,
      description: input.description,
      amount: amount.toString(),
      stockMovementId: input.stockMovementId || null,
      partId: input.partId || null,
      createdBy: context.userId,
      updatedBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await writeWarrantyTimeline(tx as TransactionExecutor, {
      tenantId: context.tenantId,
      warrantyId: input.warrantyId,
      kind: WARRANTY_TIMELINE_KINDS.COST_RECORDED,
      summary: `Custo registrado: ${input.description}`,
      actorId: context.userId,
      occurredAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.WARRANTY_COST_RECORDED,
        entityType: 'warranty_cost',
        entityId: costId,
        tenantId: context.tenantId,
        unitId: warranty.unitId,
        userId: context.userId,
        after: { warrantyId: input.warrantyId, kind: input.kind, amount: amount.toString() },
      },
      tx,
    );
  });

  return { costId };
}

/**
 * Os custos de uma garantia — para quem PODE ve-los (item 70).
 *
 * A autorizacao e separada da de ver a garantia de proposito: o atendente
 * precisa saber se a cobertura vale, e nao precisa saber a margem da loja.
 */
export async function listWarrantyCosts(context: TenantContext, warrantyId: string) {
  const warranty = await loadWarranty(context, warrantyId);

  await authorize(context, {
    permission: PERMISSIONS.WARRANTIES_COSTS_VIEW,
    featureKey: FEATURES.OPERATIONS_WARRANTIES,
    unitId: warranty.unitId,
  });

  const rows = await getDb()
    .select({
      id: warrantyCosts.id,
      kind: warrantyCosts.kind,
      description: warrantyCosts.description,
      amount: warrantyCosts.amount,
      serviceOrderId: warrantyCosts.serviceOrderId,
      createdAt: warrantyCosts.createdAt,
    })
    .from(warrantyCosts)
    .where(
      and(eq(warrantyCosts.tenantId, context.tenantId), eq(warrantyCosts.warrantyId, warrantyId)),
    )
    .orderBy(warrantyCosts.createdAt);

  const total = rows.reduce((soma, row) => soma.add(Money.parse(row.amount)), Money.zero());
  return { items: rows, total: total.toString() };
}

/**
 * Custo de garantia no periodo, para o painel. Somado no BANCO, nunca em JS.
 *
 * `period.from`/`to` sao datas civis no fuso do tenant — nao instantes UTC.
 * Antes comparava com `DATE(created_at) BETWEEN from AND to`: `DATE()` do
 * MariaDB usa o fuso da SESSAO (UTC, `client.ts`), nao o do tenant, o mesmo
 * bug de ADR-084 (Prompt 19.1) — e ainda quebra o uso do indice em
 * `created_at`, pois a coluna fica dentro de uma funcao. `civilDateRangeToUtc`
 * resolve a fronteira certa e mantem a comparacao sargable.
 */
export async function sumWarrantyCosts(
  context: TenantContext,
  period: { from: string; to: string },
): Promise<string> {
  const { startUtc, endExclusiveUtc } = civilDateRangeToUtc(
    period.from,
    period.to,
    context.tenantTimezone,
  );

  const [row] = await getDb()
    .select({ total: sql<string>`COALESCE(SUM(${warrantyCosts.amount}), 0)` })
    .from(warrantyCosts)
    .where(
      and(
        eq(warrantyCosts.tenantId, context.tenantId),
        gte(warrantyCosts.createdAt, startUtc),
        lt(warrantyCosts.createdAt, endExclusiveUtc),
      ),
    );

  return row?.total ?? '0.00';
}

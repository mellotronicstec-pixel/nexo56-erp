import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { Money } from '@/core/money/money';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';
import {
  AUDIT_ACTIONS,
  recordAudit,
  type AuditAction,
} from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  APPROVAL_SOURCES,
  DESCRIPTION_MAX,
  NOTES_MAX,
  QUOTE_TIMELINE_KINDS,
  REASON_MAX,
  assertSendable,
  calculateItemTotals,
  calculateQuoteTotals,
  explainQuoteRefusal,
  findQuoteTransition,
  isQuoteEditable,
  normalizeQuantity,
  type QuoteItemInput,
  type QuoteStatus,
} from '@/modules/quotes/domain/quote';
import { quoteItems, quoteTimeline, quotes } from '@/modules/quotes/infrastructure/schema';
import {
  applyTransition,
  planTransition,
  type TransitionPlan,
} from '@/modules/service-orders/application/workflow-service';
import { formatServiceOrderNumber } from '@/modules/service-orders/domain/service-order';
import {
  serviceOrderTimeline,
  serviceOrders,
} from '@/modules/service-orders/infrastructure/schema';
import {
  allocateSequenceNumber,
  SEQUENCE_TYPES,
} from '@/modules/tenancy/application/sequence-service';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { formatQuoteNumber } from '@/modules/quotes/domain/quote';

/**
 * Casos de uso do Orcamento (Prompt 09).
 *
 * A FRONTEIRA QUE ESTE ARQUIVO EXISTE PARA PROTEGER (item 19)
 *
 * Nao ha, em lugar nenhum deste modulo, um `update(serviceOrders).set({
 * status })`. Quando o orcamento precisa mover a Ordem de Servico, ele pede ao
 * workflow do Prompt 08 — e faz isso DENTRO DA MESMA TRANSACAO, via
 * `planTransition` + `applyTransition`.
 *
 * POR QUE NA MESMA TRANSACAO, E NAO EM DUAS
 *
 * Marcar o orcamento como enviado numa transacao e mover a OS noutra cria um
 * intervalo em que existe uma proposta "enviada" com a OS parada. Se a segunda
 * falhar — permissao, estado incompativel, queda de rede — ninguem sabe qual
 * das duas verdades vale, e o conserto para esperando um estado que nunca vai
 * chegar. Uma transacao so: ou as duas coisas acontecem, ou nenhuma.
 */

// ---------------------------------------------------------------------------
// Leitura com escopo
// ---------------------------------------------------------------------------

interface QuoteRow {
  id: string;
  tenantId: string;
  unitId: string;
  serviceOrderId: string;
  number: number;
  revision: number;
  status: string;
  version: number;
  subtotal: string;
  discount: string;
  total: string;
  validUntil: string | null;
  customerNotes: string | null;
  internalNotes: string | null;
}

/**
 * Carrega o orcamento dentro do tenant E da unidade autorizada.
 *
 * Orcamento de outra empresa ou de unidade que a pessoa nao opera responde
 * "nao encontrado" — nunca "sem permissao", que confirmaria a existencia
 * (itens 73 e 74).
 */
export async function loadQuote(context: TenantContext, quoteId: string): Promise<QuoteRow> {
  const [row] = await getDb()
    .select({
      id: quotes.id,
      tenantId: quotes.tenantId,
      unitId: quotes.unitId,
      serviceOrderId: quotes.serviceOrderId,
      number: quotes.number,
      revision: quotes.revision,
      status: quotes.status,
      version: quotes.version,
      subtotal: quotes.subtotal,
      discount: quotes.discount,
      total: quotes.total,
      validUntil: quotes.validUntil,
      customerNotes: quotes.customerNotes,
      internalNotes: quotes.internalNotes,
    })
    .from(quotes)
    .where(and(eq(quotes.tenantId, context.tenantId), eq(quotes.id, quoteId)))
    .limit(1);

  if (!row) throw new NotFoundError('Orcamento nao encontrado.');
  if (!context.authorizedUnitIds.includes(row.unitId)) {
    throw new NotFoundError('Orcamento nao encontrado.');
  }
  return row;
}

/** Autoriza uma capacidade de orcamento NA UNIDADE DA ORDEM (item 72). */
async function authorizeOnQuoteUnit(
  context: TenantContext,
  unitId: string,
  permission: PermissionKey,
): Promise<void> {
  await authorize(context, { permission, featureKey: FEATURES.CORE_QUOTES, unitId });
}

async function loadServiceOrderForQuote(
  context: TenantContext,
  serviceOrderId: string,
): Promise<{ id: string; unitId: string; number: number; status: string }> {
  const [row] = await getDb()
    .select({
      id: serviceOrders.id,
      unitId: serviceOrders.unitId,
      number: serviceOrders.number,
      status: serviceOrders.status,
    })
    .from(serviceOrders)
    .where(and(eq(serviceOrders.tenantId, context.tenantId), eq(serviceOrders.id, serviceOrderId)))
    .limit(1);

  if (!row) throw new NotFoundError('Ordem de Servico nao encontrada.');
  if (!context.authorizedUnitIds.includes(row.unitId)) {
    throw new NotFoundError('Ordem de Servico nao encontrada.');
  }
  return row;
}

/** Linha lida do banco: o snapshot comercial mais o vinculo opcional. */
type StoredQuoteItem = QuoteItemInput & { partId: string | null };

async function readItems(
  tx: TransactionExecutor | ReturnType<typeof getDb>,
  tenantId: string,
  quoteId: string,
): Promise<StoredQuoteItem[]> {
  const rows = await tx
    .select({
      kind: quoteItems.kind,
      description: quoteItems.description,
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
      discount: quoteItems.discount,
      partId: quoteItems.partId,
    })
    .from(quoteItems)
    .where(and(eq(quoteItems.tenantId, tenantId), eq(quoteItems.quoteId, quoteId)))
    .orderBy(asc(quoteItems.position));

  return rows.map((row) => ({
    kind: row.kind as QuoteItemInput['kind'],
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    discount: row.discount,
    partId: row.partId,
  }));
}

async function writeQuoteTimeline(
  tx: TransactionExecutor,
  context: TenantContext,
  args: {
    quoteId: string;
    kind: string;
    summary: string;
    metadata?: Record<string, unknown>;
    reason?: string | null;
    now: Date;
  },
): Promise<void> {
  await tx.insert(quoteTimeline).values({
    id: newId(),
    tenantId: context.tenantId,
    quoteId: args.quoteId,
    kind: args.kind,
    summary: args.summary,
    metadata: args.metadata ?? null,
    reason: args.reason ?? null,
    actorId: context.userId,
    occurredAt: args.now,
  });
}

/**
 * Fato RESUMIDO na linha do tempo da OS (item 59).
 *
 * A ficha da OS conta a historia do atendimento: "Orcamento ORC #45 enviado".
 * O detalhe — quais itens, quanto cada um — vive na linha do tempo do
 * orcamento. Copiar cada alteracao de item para ca transformaria o historico
 * do aparelho num extrato de digitacao.
 */
async function writeServiceOrderFact(
  tx: TransactionExecutor,
  context: TenantContext,
  args: { serviceOrderId: string; kind: string; summary: string; quoteId: string; now: Date },
): Promise<void> {
  await tx.insert(serviceOrderTimeline).values({
    id: newId(),
    tenantId: context.tenantId,
    serviceOrderId: args.serviceOrderId,
    kind: args.kind,
    summary: args.summary,
    metadata: { quoteId: args.quoteId },
    actorId: context.userId,
    occurredAt: args.now,
  });
}

// ---------------------------------------------------------------------------
// Criacao
// ---------------------------------------------------------------------------

const civilDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data valida.')
  .or(z.literal(''));

export const createQuoteSchema = z.object({
  serviceOrderId: z.string().trim().min(1, 'Informe a Ordem de Servico.'),
  validUntil: civilDateSchema.optional(),
  customerNotes: z.string().trim().max(NOTES_MAX).optional(),
  internalNotes: z.string().trim().max(NOTES_MAX).optional(),
  idempotencyKey: z.string().trim().max(80).optional(),
});

export interface CreateQuoteResult {
  quoteId: string;
  number: number;
  revision: number;
  reused: boolean;
}

/**
 * Abre um orcamento em RASCUNHO para uma Ordem de Servico (item 17).
 *
 * Criar um orcamento NAO muda a situacao da OS. Rascunho e trabalho interno;
 * o que o cliente ve — e o que move o atendimento — e o envio.
 */
export async function createQuote(
  context: TenantContext,
  rawInput: unknown,
): Promise<CreateQuoteResult> {
  const parsed = createQuoteSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  const input = parsed.data;

  const order = await loadServiceOrderForQuote(context, input.serviceOrderId);
  await authorizeOnQuoteUnit(context, order.unitId, PERMISSIONS.QUOTES_CREATE);

  const idempotencyKey = input.idempotencyKey || null;

  /**
   * REENCONTRO ANTES DE CRIAR (itens 94 e 95).
   *
   * Duplo clique, retentativa apos queda de rede e botao voltar reenviam o
   * mesmo comando. A UNIQUE no banco e a garantia final; esta consulta e o que
   * transforma a colisao numa resposta util em vez de num erro.
   */
  if (idempotencyKey) {
    const [existing] = await getDb()
      .select({ id: quotes.id, number: quotes.number, revision: quotes.revision })
      .from(quotes)
      .where(and(eq(quotes.tenantId, context.tenantId), eq(quotes.idempotencyKey, idempotencyKey)))
      .limit(1);

    if (existing) {
      return {
        quoteId: existing.id,
        number: existing.number,
        revision: existing.revision,
        reused: true,
      };
    }
  }

  const zero = Money.zero().toString();
  const now = new Date();
  const quoteId = newId();

  const allocated = await runInTransaction(async (tx, emit) => {
    const sequence = await allocateSequenceNumber(tx, context.tenantId, SEQUENCE_TYPES.QUOTE, {
      prefix: 'ORC',
      padding: 6,
    });

    await tx.insert(quotes).values({
      id: quoteId,
      tenantId: context.tenantId,
      unitId: order.unitId,
      serviceOrderId: order.id,
      number: sequence.value,
      revision: 1,
      status: 'draft',
      // Rascunho e proposta viva: ocupa o lugar unico da OS.
      activeMarker: 1,
      subtotal: zero,
      discount: zero,
      total: zero,
      validUntil: input.validUntil || null,
      customerNotes: input.customerNotes || null,
      internalNotes: input.internalNotes || null,
      idempotencyKey,
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await writeQuoteTimeline(tx, context, {
      quoteId,
      kind: QUOTE_TIMELINE_KINDS.CREATED,
      summary: 'Orcamento criado',
      metadata: { number: sequence.value, revision: 1 },
      now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.QUOTE_CREATED,
        entityType: 'quote',
        entityId: quoteId,
        tenantId: context.tenantId,
        unitId: order.unitId,
        userId: context.userId,
        after: { serviceOrderId: order.id, number: sequence.value, revision: 1 },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.QUOTE_CREATED,
      tenantId: context.tenantId,
      payload: {
        quoteId,
        serviceOrderId: order.id,
        unitId: order.unitId,
        number: sequence.value,
        revision: 1,
      },
    });

    return sequence.value;
  });

  return { quoteId, number: allocated, revision: 1, reused: false };
}

// ---------------------------------------------------------------------------
// Edicao do rascunho
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  kind: z.enum(['service', 'part', 'other']),
  description: z.string().trim().min(1, 'Descreva o item.').max(DESCRIPTION_MAX),
  quantity: z.string().trim().min(1, 'Informe a quantidade.'),
  unitPrice: z.string().trim().min(1, 'Informe o valor unitario.'),
  discount: z.string().trim().optional(),
  /**
   * VINCULO OPCIONAL COM UMA PECA DO CATALOGO (Prompt 10, itens 39 a 42).
   *
   * Chega como texto opaco, e de propósito: este modulo NAO conhece estoque.
   * Quem resolve a peca — e quem copia descricao e preco como conveniencia —
   * e a camada de acao, que pode compor os dois modulos. Aqui o id so e
   * gravado, e a FK composta `(part_id, tenant_id)` garante que ele e da mesma
   * empresa.
   *
   * Vazio continua sendo o normal: linha PART escrita a mao vale para sempre
   * (item 40), inclusive quando o modulo de Estoque estiver desligado.
   */
  partId: z.string().trim().max(36).optional(),
});

export const saveDraftSchema = z.object({
  items: z.array(itemSchema).max(200, 'Orcamento com itens demais.'),
  discount: z.string().trim().optional(),
  validUntil: civilDateSchema.optional(),
  customerNotes: z.string().trim().max(NOTES_MAX).optional(),
  internalNotes: z.string().trim().max(NOTES_MAX).optional(),
});

/**
 * Grava o rascunho inteiro: itens, desconto, validade e observacoes.
 *
 * SUBSTITUI A LISTA DE ITENS por completo, de propósito. O editor e uma tabela
 * que a pessoa mexe livremente — linha nova, linha removida, ordem trocada — e
 * reconciliar isso por id produziria um diff fragil para nenhum ganho: a lista
 * e curta e vive dentro de um rascunho que ainda nao existe para o cliente.
 *
 * Os TOTAIS SAO RECALCULADOS AQUI (itens 36 e 40). O que o formulario mandou
 * como total e ignorado; o backend recalcula a partir das linhas e grava o
 * resultado dele.
 */
export async function saveQuoteDraft(
  context: TenantContext,
  quoteId: string,
  rawInput: unknown,
  expectedVersion?: number,
): Promise<{ subtotal: string; discount: string; total: string }> {
  const parsed = saveDraftSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  const input = parsed.data;

  const quote = await loadQuote(context, quoteId);
  await authorizeOnQuoteUnit(context, quote.unitId, PERMISSIONS.QUOTES_UPDATE_DRAFT);

  /**
   * IMUTABILIDADE APOS O ENVIO (itens 27 e 28).
   *
   * Depois de enviado, o cliente ja viu aqueles numeros. Alterar no lugar
   * apagaria a proposta que existiu — e a revisao existe exatamente para isso.
   */
  if (!isQuoteEditable(quote.status)) {
    throw new BusinessRuleError(
      'Este orcamento nao e mais um rascunho. Crie uma revisao para propor outros valores.',
    );
  }

  // Calculo ANTES da transacao: erro de valor nao deve abrir transacao.
  const totals = safeTotals(input.items, input.discount);
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    const updated = await tx
      .update(quotes)
      .set({
        subtotal: totals.subtotal.toString(),
        discount: totals.discount.toString(),
        total: totals.total.toString(),
        validUntil: input.validUntil || null,
        customerNotes: input.customerNotes || null,
        internalNotes: input.internalNotes || null,
        version: quote.version + 1,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(quotes.tenantId, context.tenantId),
          eq(quotes.id, quoteId),
          eq(quotes.status, 'draft'),
          eq(quotes.version, expectedVersion ?? quote.version),
        ),
      );

    assertWon(updated);

    await tx
      .delete(quoteItems)
      .where(and(eq(quoteItems.tenantId, context.tenantId), eq(quoteItems.quoteId, quoteId)));

    for (const [index, item] of input.items.entries()) {
      const line = calculateItemTotals(item);
      await tx.insert(quoteItems).values({
        id: newId(),
        tenantId: context.tenantId,
        quoteId,
        kind: item.kind,
        description: item.description,
        quantity: normalizeQuantity(item.quantity),
        unitPrice: Money.parse(item.unitPrice.trim()).toString(),
        discount: line.discount.toString(),
        total: line.total.toString(),
        position: index,
        partId: item.partId || null,
        createdAt: now,
        updatedAt: now,
      });
    }

    await writeQuoteTimeline(tx, context, {
      quoteId,
      kind: QUOTE_TIMELINE_KINDS.ITEMS_UPDATED,
      summary: `Itens alterados: ${input.items.length} linha(s), total ${totals.total.toString()}`,
      metadata: { itemCount: input.items.length, total: totals.total.toString() },
      now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.QUOTE_ITEMS_UPDATED,
        entityType: 'quote',
        entityId: quoteId,
        tenantId: context.tenantId,
        unitId: quote.unitId,
        userId: context.userId,
        before: { total: quote.total },
        after: { total: totals.total.toString(), itemCount: input.items.length },
      },
      tx,
    );

    // Rascunho nao gera evento de negocio: ninguem fora da loja se importa
    // com um numero que ainda esta sendo montado.
    void emit;
  });

  return {
    subtotal: totals.subtotal.toString(),
    discount: totals.discount.toString(),
    total: totals.total.toString(),
  };
}

/** Traduz erro de faixa do dominio em erro de validacao com mensagem em pt-BR. */
function safeTotals(items: readonly QuoteItemInput[], discount: string | undefined) {
  try {
    return calculateQuoteTotals(items, discount || '0');
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) {
      throw new ValidationError(error.message);
    }
    throw error;
  }
}

function assertWon(result: unknown): void {
  if (affectedRows(result) === 0) {
    throw new ConflictError(
      'Este orcamento foi alterado por outra pessoa enquanto voce trabalhava nele. Recarregue a pagina e tente de novo.',
    );
  }
}

// ---------------------------------------------------------------------------
// Mudanca de situacao do orcamento
// ---------------------------------------------------------------------------

/**
 * Marcadores de unicidade (itens 65 e 66).
 *
 * `active_marker` vale 1 enquanto a proposta esta viva (rascunho ou enviada) e
 * NULL depois; `approved_marker` vale 1 so na versao aprovada. Como o MySQL
 * trata cada NULL como distinto num UNIQUE, o banco garante "no maximo uma
 * proposta viva" e "no maximo uma versao aprovada" por Ordem de Servico — sem
 * depender de a aplicacao lembrar de checar.
 */
function markersFor(status: QuoteStatus): { activeMarker: 1 | null; approvedMarker: 1 | null } {
  return {
    activeMarker: status === 'draft' || status === 'sent' ? 1 : null,
    approvedMarker: status === 'approved' ? 1 : null,
  };
}

interface StatusChangeArgs {
  quoteId: string;
  to: QuoteStatus;
  reason?: string;
  expectedVersion?: number;
  /** Quando a mudanca tambem move a Ordem de Servico. */
  serviceOrderTo?: 'awaiting_approval' | 'awaiting_repair';
  via: string;
  auditAction: AuditAction;
  timelineKind: string;
  timelineSummary: (formatted: string) => string;
  orderFactSummary?: (formatted: string, orderNumber: string) => string;
  eventType: string;
  decisionSource?: string;
}

/**
 * O caminho unico por onde a situacao de um orcamento muda.
 *
 * Faz, numa transacao so: compare-and-swap no orcamento, linha do tempo do
 * orcamento, fato resumido na OS quando ha, auditoria, a TRANSICAO DA OS
 * quando ha, e o evento.
 */
async function changeQuoteStatus(
  context: TenantContext,
  args: StatusChangeArgs,
): Promise<{ quoteId: string; status: QuoteStatus }> {
  const quote = await loadQuote(context, args.quoteId);

  const rule = findQuoteTransition(quote.status, args.to);
  if (!rule) throw new BusinessRuleError(explainQuoteRefusal(quote.status, args.to));

  await authorizeOnQuoteUnit(context, quote.unitId, rule.permission);

  const reason = (args.reason ?? '').trim().slice(0, REASON_MAX) || null;
  if (rule.requiresReason && !reason) {
    throw new ValidationError('Informe o motivo para continuar.');
  }

  /**
   * A TRANSICAO DA OS E PLANEJADA ANTES DE QUALQUER GRAVACAO (itens 19 e 63).
   *
   * `planTransition` valida a regra do workflow e autoriza na unidade da
   * ordem, sem escrever nada. Se a OS estiver num estado incompativel, a
   * recusa chega aqui — antes de o orcamento mudar de situacao — e nada e
   * forcado.
   */
  let plan: TransitionPlan | null = null;
  if (args.serviceOrderTo) {
    const order = await loadServiceOrderForQuote(context, quote.serviceOrderId);
    /**
     * Ja estar no destino nao e erro: depois de uma recusa, a OS continua em
     * Aguardando Aprovacao, e enviar a revisao nao precisa mover nada. Repetir
     * a transicao e que seria errado — geraria um segundo fato identico na
     * linha do tempo.
     */
    if (order.status !== args.serviceOrderTo) {
      plan = await planTransition(context, {
        serviceOrderId: quote.serviceOrderId,
        to: args.serviceOrderTo,
        via: args.via,
      });
    }
  }

  const now = new Date();
  const markers = markersFor(args.to);
  const formatted = formatQuoteNumber(quote.number, quote.revision);

  await runInTransaction(async (tx, emit) => {
    const decision =
      args.to === 'approved' || args.to === 'rejected' || args.to === 'cancelled'
        ? {
            decidedAt: now,
            decidedBy: context.userId,
            decisionSource: args.decisionSource ?? null,
            decisionReason: reason,
          }
        : {};

    const updated = await tx
      .update(quotes)
      .set({
        status: args.to,
        ...markers,
        ...decision,
        ...(args.to === 'sent' ? { sentAt: now, sentBy: context.userId } : {}),
        version: quote.version + 1,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(quotes.tenantId, context.tenantId),
          eq(quotes.id, args.quoteId),
          // Estado E versao no WHERE: dois cliques nao produzem dois envios.
          eq(quotes.status, quote.status),
          eq(quotes.version, args.expectedVersion ?? quote.version),
        ),
      );

    assertWon(updated);

    await writeQuoteTimeline(tx, context, {
      quoteId: args.quoteId,
      kind: args.timelineKind,
      summary: args.timelineSummary(formatted),
      metadata: { from: quote.status, to: args.to, total: quote.total },
      reason,
      now,
    });

    await recordAudit(
      {
        action: args.auditAction,
        entityType: 'quote',
        entityId: args.quoteId,
        tenantId: context.tenantId,
        unitId: quote.unitId,
        userId: context.userId,
        before: { status: quote.status },
        after: { status: args.to, total: quote.total },
      },
      tx,
    );

    if (plan) {
      /**
       * AQUI A OS MUDA — e SO aqui, pela mao do workflow do Prompt 08, dentro
       * desta mesma transacao. O modulo de orcamento nunca escreve `status`.
       */
      await applyTransition(tx, emit, context, plan, now);
    }

    if (args.orderFactSummary) {
      const order = await tx
        .select({ number: serviceOrders.number })
        .from(serviceOrders)
        .where(eq(serviceOrders.id, quote.serviceOrderId))
        .limit(1);

      await writeServiceOrderFact(tx, context, {
        serviceOrderId: quote.serviceOrderId,
        kind: `quote_${args.to}`,
        summary: args.orderFactSummary(formatted, formatServiceOrderNumber(order[0]?.number ?? 0)),
        quoteId: args.quoteId,
        now,
      });
    }

    await emit({
      type: args.eventType as never,
      tenantId: context.tenantId,
      payload: {
        quoteId: args.quoteId,
        serviceOrderId: quote.serviceOrderId,
        unitId: quote.unitId,
        number: quote.number,
        revision: quote.revision,
        total: quote.total,
        from: quote.status,
        to: args.to,
        actorId: context.userId,
        hasReason: reason !== null,
        // NAO significa que uma mensagem saiu: nao ha canal (item 53).
        delivered: false,
      },
    });
  });

  return { quoteId: args.quoteId, status: args.to };
}

/**
 * Formaliza a proposta (itens 18, 53 e 62).
 *
 * O QUE ACONTECE: o orcamento passa a Enviado, a Ordem de Servico vai para
 * Aguardando Aprovacao pelo workflow central, e o evento `QUOTE_SENT` fica no
 * outbox.
 *
 * O QUE NAO ACONTECE: nenhuma mensagem e enviada. Nao ha WhatsApp nem e-mail
 * integrado (Prompt 16). "Enviar" aqui quer dizer FORMALIZAR — e a interface
 * diz exatamente isso, porque escrever "mensagem enviada" faria o atendente
 * parar de ligar para o cliente.
 */
export async function sendQuote(
  context: TenantContext,
  quoteId: string,
  expectedVersion?: number,
): Promise<{ quoteId: string; status: QuoteStatus }> {
  const quote = await loadQuote(context, quoteId);

  const items = await readItems(getDb(), context.tenantId, quoteId);
  assertSendableOrFail(items);

  return changeQuoteStatus(context, {
    quoteId,
    to: 'sent',
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    serviceOrderTo: 'awaiting_approval',
    via: 'quote_sent',
    auditAction: AUDIT_ACTIONS.QUOTE_SENT,
    timelineKind: QUOTE_TIMELINE_KINDS.SENT,
    timelineSummary: () =>
      'Orcamento formalizado como enviado. O envio automatico da mensagem ainda nao esta disponivel.',
    orderFactSummary: (formatted) => `Orcamento ${formatted} enviado (${quote.total})`,
    eventType: EVENT_TYPES.QUOTE_SENT,
  });
}

function assertSendableOrFail(items: readonly unknown[]): void {
  try {
    assertSendable(items);
  } catch (error) {
    throw new BusinessRuleError(error instanceof Error ? error.message : 'Orcamento sem itens.');
  }
}

/**
 * Registra a aprovacao do cliente (itens 20 e 61).
 *
 * A APROVACAO E REGISTRADA PELA EQUIPE, nao pelo cliente (item 52). Nao existe
 * Portal (Prompt 17): quem clica aqui e quem falou com a pessoa. Por isso a
 * origem gravada e `internal` — a trilha diz como a decisao chegou, e nao
 * finge que o cliente clicou num link.
 */
export async function approveQuote(
  context: TenantContext,
  quoteId: string,
  expectedVersion?: number,
): Promise<{ quoteId: string; status: QuoteStatus }> {
  return changeQuoteStatus(context, {
    quoteId,
    to: 'approved',
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    serviceOrderTo: 'awaiting_repair',
    via: 'quote_approved',
    auditAction: AUDIT_ACTIONS.QUOTE_APPROVED,
    timelineKind: QUOTE_TIMELINE_KINDS.APPROVED,
    timelineSummary: () => 'Aprovacao registrada pela equipe',
    orderFactSummary: (formatted) => `Orcamento ${formatted} aprovado`,
    eventType: EVENT_TYPES.QUOTE_APPROVED,
    decisionSource: APPROVAL_SOURCES.INTERNAL,
  });
}

/**
 * Registra a recusa do cliente (item 21).
 *
 * A ORDEM DE SERVICO NAO E CANCELADA. Recusar o orcamento e uma decisao
 * comercial; o que fazer com o aparelho — devolver, propor outro valor,
 * encerrar — e outra, e nao existe regra oficial que ligue as duas. Inventar
 * um cancelamento automatico faria o sistema encerrar atendimentos que a loja
 * ainda estava negociando.
 *
 * A OS segue em Aguardando Aprovacao, aguardando uma revisao ou uma decisao
 * humana.
 */
export async function rejectQuote(
  context: TenantContext,
  quoteId: string,
  rawInput: unknown,
  expectedVersion?: number,
): Promise<{ quoteId: string; status: QuoteStatus }> {
  const parsed = z
    .object({ reason: z.string().trim().min(3, 'Descreva o motivo da recusa.').max(REASON_MAX) })
    .safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Informe o motivo.');
  }

  return changeQuoteStatus(context, {
    quoteId,
    to: 'rejected',
    reason: parsed.data.reason,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    via: 'quote_rejected',
    auditAction: AUDIT_ACTIONS.QUOTE_REJECTED,
    timelineKind: QUOTE_TIMELINE_KINDS.REJECTED,
    timelineSummary: () => 'Recusa registrada pela equipe',
    orderFactSummary: (formatted) => `Orcamento ${formatted} recusado`,
    eventType: EVENT_TYPES.QUOTE_REJECTED,
    decisionSource: APPROVAL_SOURCES.INTERNAL,
  });
}

/**
 * Retira a proposta (item 69).
 *
 * Cancelar um ORCAMENTO nao e cancelar a ORDEM DE SERVICO — sao entidades
 * diferentes, e o aparelho continua na bancada. Descartar um rascunho nao
 * exige motivo; retirar uma proposta ja enviada exige, porque o cliente ja a
 * viu.
 */
export async function cancelQuote(
  context: TenantContext,
  quoteId: string,
  rawInput: unknown = {},
  expectedVersion?: number,
): Promise<{ quoteId: string; status: QuoteStatus }> {
  const parsed = z
    .object({ reason: z.string().trim().max(REASON_MAX).optional() })
    .safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError('Dados invalidos.');
  }

  return changeQuoteStatus(context, {
    quoteId,
    to: 'cancelled',
    ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    via: 'quote_cancelled',
    auditAction: AUDIT_ACTIONS.QUOTE_CANCELLED,
    timelineKind: QUOTE_TIMELINE_KINDS.CANCELLED,
    timelineSummary: () => 'Orcamento cancelado',
    eventType: EVENT_TYPES.QUOTE_CANCELLED,
  });
}

// ---------------------------------------------------------------------------
// Revisao (itens 25 a 28, 67 e 68)
// ---------------------------------------------------------------------------

/**
 * Cria a proxima revisao de um orcamento.
 *
 * A ESTRATEGIA ESCOLHIDA: linha NOVA, MESMO numero, revisao seguinte
 * (ADR-041). A anterior nao e tocada — continua no banco com os valores que
 * teve, a situacao que teve e a decisao que o cliente tomou sobre ela.
 *
 * Foi preferida a "versionar o mesmo registro" porque esta preserva o
 * historico sem tabela extra de versoes, e preferida a "novo orcamento com
 * numero novo" porque o cliente continua falando do "orcamento 45" — o numero
 * que ele tem na mao nao muda quando a loja refaz a conta.
 *
 * A ANTERIOR SAI DE CENA, mas so quando ainda estava viva: uma proposta
 * `sent` vira `superseded`, porque deixou de ser o que esta valendo. Uma
 * `rejected` continua `rejected` — a recusa do cliente e fato historico e nao
 * se reescreve (item 68). O mesmo vale para uma `approved`.
 */
export async function reviseQuote(
  context: TenantContext,
  quoteId: string,
): Promise<CreateQuoteResult> {
  const source = await loadQuote(context, quoteId);
  await authorizeOnQuoteUnit(context, source.unitId, PERMISSIONS.QUOTES_CREATE);

  if (source.status === 'draft') {
    throw new BusinessRuleError(
      'Este orcamento ainda e um rascunho: altere os valores nele mesmo, sem criar revisao.',
    );
  }

  const items = await readItems(getDb(), context.tenantId, quoteId);
  const now = new Date();
  const newQuoteId = newId();
  const revision = source.revision + 1;

  await runInTransaction(async (tx, emit) => {
    /**
     * A anterior perde o lugar de proposta viva ANTES de a nova nascer: a
     * UNIQUE `uq_quote_active` so admite uma por OS, e liberar o lugar aqui e
     * o que torna a revisao possivel sem afrouxar a regra.
     */
    if (source.status === 'sent') {
      const superseded = await tx
        .update(quotes)
        .set({
          status: 'superseded',
          activeMarker: null,
          version: source.version + 1,
          updatedBy: context.userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(quotes.tenantId, context.tenantId),
            eq(quotes.id, quoteId),
            eq(quotes.status, 'sent'),
            eq(quotes.version, source.version),
          ),
        );

      assertWon(superseded);

      await writeQuoteTimeline(tx, context, {
        quoteId,
        kind: QUOTE_TIMELINE_KINDS.SUPERSEDED,
        summary: `Substituido pela revisao ${revision}`,
        metadata: { revision },
        now,
      });

      await recordAudit(
        {
          action: AUDIT_ACTIONS.QUOTE_SUPERSEDED,
          entityType: 'quote',
          entityId: quoteId,
          tenantId: context.tenantId,
          unitId: source.unitId,
          userId: context.userId,
          before: { status: 'sent' },
          after: { status: 'superseded', revision },
        },
        tx,
      );
    }

    await tx.insert(quotes).values({
      id: newQuoteId,
      tenantId: context.tenantId,
      unitId: source.unitId,
      serviceOrderId: source.serviceOrderId,
      // MESMO numero: e a mesma proposta comercial, em outra versao.
      number: source.number,
      revision,
      supersedesQuoteId: quoteId,
      status: 'draft',
      activeMarker: 1,
      subtotal: source.subtotal,
      discount: source.discount,
      total: source.total,
      validUntil: source.validUntil,
      customerNotes: source.customerNotes,
      internalNotes: source.internalNotes,
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    /** Os itens sao COPIADOS: revisar quase sempre e ajustar, nao recomecar. */
    for (const [index, item] of items.entries()) {
      const line = calculateItemTotals(item);
      await tx.insert(quoteItems).values({
        id: newId(),
        tenantId: context.tenantId,
        quoteId: newQuoteId,
        kind: item.kind,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: line.discount.toString(),
        total: line.total.toString(),
        position: index,
        /** A revisao herda o vinculo, como herda tudo o mais da versao anterior. */
        partId: item.partId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await writeQuoteTimeline(tx, context, {
      quoteId: newQuoteId,
      kind: QUOTE_TIMELINE_KINDS.REVISED,
      summary: `Revisao ${revision} criada a partir da revisao ${source.revision}`,
      metadata: { revision, supersedesQuoteId: quoteId },
      now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.QUOTE_CREATED,
        entityType: 'quote',
        entityId: newQuoteId,
        tenantId: context.tenantId,
        unitId: source.unitId,
        userId: context.userId,
        after: { number: source.number, revision, supersedesQuoteId: quoteId },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.QUOTE_REVISED,
      tenantId: context.tenantId,
      payload: {
        quoteId: newQuoteId,
        supersedesQuoteId: quoteId,
        serviceOrderId: source.serviceOrderId,
        unitId: source.unitId,
        number: source.number,
        revision,
      },
    });
  });

  return { quoteId: newQuoteId, number: source.number, revision, reused: false };
}

import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { quoteItems, quoteTimeline, quotes } from '@/modules/quotes/infrastructure/schema';
import {
  QUOTE_NUMBER_PADDING,
  QUOTE_NUMBER_PREFIX,
  isQuoteActive,
} from '@/modules/quotes/domain/quote';
import { SEQUENCE_TYPES, peekSequence } from '@/modules/tenancy/application/sequence-service';
import { users } from '@/modules/users/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Consultas de Orcamentos (Prompt 09, itens 112 a 114).
 *
 * TODA consulta carrega o escopo: `tenant_id` sempre, e a unidade pela OS. Nao
 * existe aqui um `findById(id)` sem escopo — e o atalho que, um refactor
 * depois, vira IDOR entre empresas.
 */

export interface QuoteNumberFormat {
  prefix: string;
  padding: number;
}

/** Prefixo e zeros a esquerda vigentes. UMA consulta por pagina, nao por linha. */
export async function getQuoteNumberFormat(tenantId: string): Promise<QuoteNumberFormat> {
  const sequence = await peekSequence(tenantId, SEQUENCE_TYPES.QUOTE);
  return {
    prefix: sequence?.prefix ?? QUOTE_NUMBER_PREFIX,
    padding: sequence?.padding ?? QUOTE_NUMBER_PADDING,
  };
}

export interface QuoteListItem {
  id: string;
  number: number;
  revision: number;
  status: string;
  subtotal: string;
  discount: string;
  total: string;
  validUntil: string | null;
  createdAt: Date;
  sentAt: Date | null;
  decidedAt: Date | null;
  itemCount: number;
  /** `true` no orcamento que esta valendo agora (rascunho ou enviado). */
  isActive: boolean;
}

/**
 * Orcamentos de uma Ordem de Servico, do mais recente para o mais antigo.
 *
 * SEM N+1 (item 114): duas consultas para N orcamentos — a lista e uma
 * agregacao com a contagem de itens de todos eles. Uma consulta por linha
 * transformaria a ficha da OS em uma ida ao banco por proposta.
 */
export async function listQuotesForServiceOrder(
  context: TenantContext,
  serviceOrderId: string,
): Promise<QuoteListItem[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: quotes.id,
      unitId: quotes.unitId,
      number: quotes.number,
      revision: quotes.revision,
      status: quotes.status,
      subtotal: quotes.subtotal,
      discount: quotes.discount,
      total: quotes.total,
      validUntil: quotes.validUntil,
      createdAt: quotes.createdAt,
      sentAt: quotes.sentAt,
      decidedAt: quotes.decidedAt,
    })
    .from(quotes)
    .where(and(eq(quotes.tenantId, context.tenantId), eq(quotes.serviceOrderId, serviceOrderId)))
    .orderBy(desc(quotes.number), desc(quotes.revision))
    .limit(50);

  const visible = rows.filter((row) => context.authorizedUnitIds.includes(row.unitId));
  if (visible.length === 0) return [];

  const counts = new Map<string, number>();
  const countRows = await db
    .select({ quoteId: quoteItems.quoteId, id: quoteItems.id })
    .from(quoteItems)
    .where(
      and(
        eq(quoteItems.tenantId, context.tenantId),
        inArray(
          quoteItems.quoteId,
          visible.map((row) => row.id),
        ),
      ),
    );
  for (const row of countRows) {
    counts.set(row.quoteId, (counts.get(row.quoteId) ?? 0) + 1);
  }

  return visible.map((row) => ({
    id: row.id,
    number: row.number,
    revision: row.revision,
    status: row.status,
    subtotal: row.subtotal,
    discount: row.discount,
    total: row.total,
    validUntil: row.validUntil,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    decidedAt: row.decidedAt,
    itemCount: counts.get(row.id) ?? 0,
    isActive: isQuoteActive(row.status),
  }));
}

export interface QuoteDetail {
  quote: {
    id: string;
    serviceOrderId: string;
    unitId: string;
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
    sentAt: Date | null;
    decidedAt: Date | null;
    decisionSource: string | null;
    decisionReason: string | null;
    supersedesQuoteId: string | null;
  };
  items: {
    id: string;
    kind: string;
    description: string;
    quantity: string;
    unitPrice: string;
    discount: string;
    total: string;
    position: number;
  }[];
  timeline: {
    id: string;
    kind: string;
    summary: string | null;
    reason: string | null;
    actorName: string | null;
    occurredAt: Date;
  }[];
  sentByName: string | null;
  decidedByName: string | null;
}

/**
 * Ficha completa do orcamento.
 *
 * ID de outra empresa e de outra unidade devolvem `null`, igual a ID
 * inexistente (itens 73 e 74): responder "sem permissao" confirmaria que
 * aquele orcamento existe.
 */
export async function findQuoteDetail(
  context: TenantContext,
  quoteId: string,
): Promise<QuoteDetail | null> {
  const db = getDb();

  const [row] = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.tenantId, context.tenantId), eq(quotes.id, quoteId)))
    .limit(1);

  if (!row) return null;
  if (!context.authorizedUnitIds.includes(row.unitId)) return null;

  const [items, timelineRows] = await Promise.all([
    db
      .select()
      .from(quoteItems)
      .where(and(eq(quoteItems.tenantId, context.tenantId), eq(quoteItems.quoteId, quoteId)))
      .orderBy(asc(quoteItems.position)),
    db
      .select()
      .from(quoteTimeline)
      .where(and(eq(quoteTimeline.tenantId, context.tenantId), eq(quoteTimeline.quoteId, quoteId)))
      .orderBy(desc(quoteTimeline.occurredAt), desc(quoteTimeline.id))
      .limit(50),
  ]);

  /** Nomes de todos os envolvidos em UMA consulta, nao uma por fato. */
  const peopleIds = [
    ...new Set(
      [row.sentBy, row.decidedBy, ...timelineRows.map((entry) => entry.actorId)].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ];
  const names = new Map<string, string>();
  if (peopleIds.length > 0) {
    const found = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, context.tenantId), inArray(users.id, peopleIds)));
    for (const person of found) names.set(person.id, person.name);
  }

  return {
    quote: {
      id: row.id,
      serviceOrderId: row.serviceOrderId,
      unitId: row.unitId,
      number: row.number,
      revision: row.revision,
      status: row.status,
      version: row.version,
      subtotal: row.subtotal,
      discount: row.discount,
      total: row.total,
      validUntil: row.validUntil,
      customerNotes: row.customerNotes,
      internalNotes: row.internalNotes,
      sentAt: row.sentAt,
      decidedAt: row.decidedAt,
      decisionSource: row.decisionSource,
      decisionReason: row.decisionReason,
      supersedesQuoteId: row.supersedesQuoteId,
    },
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      total: item.total,
      position: item.position,
    })),
    timeline: timelineRows.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      summary: entry.summary,
      reason: entry.reason,
      actorName: entry.actorId ? (names.get(entry.actorId) ?? null) : null,
      occurredAt: entry.occurredAt,
    })),
    sentByName: row.sentBy ? (names.get(row.sentBy) ?? null) : null,
    decidedByName: row.decidedBy ? (names.get(row.decidedBy) ?? null) : null,
  };
}

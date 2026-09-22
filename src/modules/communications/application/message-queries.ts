import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { NotFoundError } from '@/core/errors';
import { normalizePageSize } from '@/core/db/pagination';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { formatServiceOrderNumber } from '@/modules/service-orders/domain/service-order';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  type CommunicationChannel,
  isCommunicationChannel,
  isMessageStatus,
  type MessageStatus,
} from '../domain/communication';
import { maskRecipient } from '../domain/recipient';
import {
  communicationAttachments,
  communicationAttempts,
  communicationMessages,
} from '../infrastructure/schema';

/**
 * LEITURA DA COMUNICAÇÃO.
 *
 * DUAS REGRAS ATRAVESSAM TUDO AQUI:
 *
 * 1. O RECORTE É TENANT + UNIDADE, sempre, na cláusula `WHERE` — nunca
 *    filtrando em memória depois de trazer tudo. Uma consulta que traz as
 *    linhas e descarta no JavaScript já vazou os dados para dentro do processo,
 *    e basta um `console.log` de diagnóstico para elas aparecerem.
 *
 * 2. A LISTA MOSTRA O DESTINO MASCARADO (item 81). A tela de comunicação fica
 *    aberta no balcão, de frente para quem está esperando ser atendido. O
 *    telefone inteiro aparece na ficha da mensagem, que é uma tela que alguém
 *    escolheu abrir.
 */

export interface MessageListFilters {
  status?: string;
  channel?: string;
  serviceOrderId?: string;
  customerId?: string;
  page?: number;
  pageSize?: number;
}

export interface MessageListItem {
  id: string;
  channel: CommunicationChannel;
  status: MessageStatus;
  purpose: string;
  /** Mascarado: fim do telefone, início do e-mail. */
  recipientMasked: string;
  customerId: string | null;
  customerName: string | null;
  serviceOrderId: string | null;
  serviceOrderNumber: string | null;
  /** Primeira linha do corpo, para reconhecer a mensagem sem abri-la. */
  preview: string;
  attemptCount: number;
  lastErrorCode: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface MessageListResult {
  items: MessageListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listMessages(
  context: TenantContext,
  filters: MessageListFilters = {},
): Promise<MessageListResult> {
  const unitId = context.activeUnitId;
  if (!unitId) throw new NotFoundError('Escolha uma unidade para ver as mensagens.');

  await authorize(context, {
    permission: PERMISSIONS.COMMUNICATIONS_VIEW,
    featureKey: FEATURES.COMMUNICATIONS_CORE,
    unitId,
  });

  const pageSize = normalizePageSize(filters.pageSize);
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const offset = (page - 1) * pageSize;

  /**
   * O recorte base. `unit_id` entra aqui e não numa condição opcional: a
   * unidade não é filtro de conveniência, é a fronteira do que esta pessoa
   * pode ver.
   */
  const base = sql`
      m.tenant_id = ${context.tenantId}
  AND m.unit_id = ${unitId}
  ${filters.status && isMessageStatus(filters.status) ? sql`AND m.status = ${filters.status}` : sql``}
  ${filters.channel && isCommunicationChannel(filters.channel) ? sql`AND m.channel = ${filters.channel}` : sql``}
  ${filters.serviceOrderId ? sql`AND m.service_order_id = ${filters.serviceOrderId}` : sql``}
  ${filters.customerId ? sql`AND m.customer_id = ${filters.customerId}` : sql``}
  `;

  const totalLinhas = await getDb().execute(sql`
    SELECT COUNT(*) AS total FROM communication_messages m WHERE ${base}
  `);
  const total = Number(
    (totalLinhas as unknown as Array<Array<{ total: number | string }>>)[0]?.[0]?.total ?? 0,
  );

  const linhas = await getDb().execute(sql`
    SELECT m.id, m.channel, m.status, m.purpose, m.recipient_display,
           m.customer_id, cu.name AS customer_name,
           m.service_order_id, so.number AS order_number,
           LEFT(m.body, 120) AS preview,
           m.attempt_count, m.last_error_code, m.sent_at, m.created_at
      FROM communication_messages m
      LEFT JOIN customers cu
             ON cu.id = m.customer_id AND cu.tenant_id = m.tenant_id
      LEFT JOIN service_orders so
             ON so.id = m.service_order_id AND so.tenant_id = m.tenant_id
     WHERE ${base}
     ORDER BY m.created_at DESC
     LIMIT ${pageSize} OFFSET ${offset}
  `);

  const dados =
    (
      linhas as unknown as Array<
        Array<{
          id: string;
          channel: string;
          status: string;
          purpose: string;
          recipient_display: string;
          customer_id: string | null;
          customer_name: string | null;
          service_order_id: string | null;
          order_number: number | null;
          preview: string;
          attempt_count: number;
          last_error_code: string | null;
          sent_at: Date | null;
          created_at: Date;
        }>
      >
    )[0] ?? [];

  const items = dados.map((linha) => ({
    id: linha.id,
    channel: (isCommunicationChannel(linha.channel)
      ? linha.channel
      : 'sms') as CommunicationChannel,
    status: (isMessageStatus(linha.status) ? linha.status : 'failed') as MessageStatus,
    purpose: linha.purpose,
    recipientMasked: isCommunicationChannel(linha.channel)
      ? maskRecipient(linha.channel, linha.recipient_display)
      : '•••',
    customerId: linha.customer_id,
    customerName: linha.customer_name,
    serviceOrderId: linha.service_order_id,
    serviceOrderNumber:
      linha.order_number === null ? null : formatServiceOrderNumber(linha.order_number),
    preview: linha.preview.replace(/\s+/g, ' ').trim(),
    attemptCount: linha.attempt_count,
    lastErrorCode: linha.last_error_code,
    sentAt: linha.sent_at,
    createdAt: linha.created_at,
  }));

  return { items, total, page, pageSize };
}

export interface MessageAttemptView {
  attemptNumber: number;
  provider: string;
  outcome: string;
  errorCode: string | null;
  errorDetail: string | null;
  durationMs: number | null;
  startedAt: Date;
}

export interface MessageAttachmentView {
  kind: string;
  warrantyId: string | null;
  filename: string;
  byteSize: number;
}

export interface MessageDetail extends MessageListItem {
  /** A ficha mostra o destino inteiro: quem abriu esta tela quis conferir. */
  recipientDisplay: string;
  subject: string | null;
  body: string;
  origin: string;
  templateId: string | null;
  sentProvider: string | null;
  lastErrorDetail: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  unitId: string;
  version: number;
  attempts: MessageAttemptView[];
  attachments: MessageAttachmentView[];
}

export async function findMessage(
  context: TenantContext,
  messageId: string,
): Promise<MessageDetail> {
  const [linha] = await getDb()
    .select({
      id: communicationMessages.id,
      unitId: communicationMessages.unitId,
      channel: communicationMessages.channel,
      status: communicationMessages.status,
      purpose: communicationMessages.purpose,
      origin: communicationMessages.origin,
      recipientDisplay: communicationMessages.recipientDisplay,
      customerId: communicationMessages.customerId,
      serviceOrderId: communicationMessages.serviceOrderId,
      subject: communicationMessages.subject,
      body: communicationMessages.body,
      templateId: communicationMessages.templateId,
      attemptCount: communicationMessages.attemptCount,
      lastErrorCode: communicationMessages.lastErrorCode,
      lastErrorDetail: communicationMessages.lastErrorDetail,
      sentAt: communicationMessages.sentAt,
      sentProvider: communicationMessages.sentProvider,
      cancelledAt: communicationMessages.cancelledAt,
      cancelReason: communicationMessages.cancelReason,
      createdAt: communicationMessages.createdAt,
      version: communicationMessages.version,
    })
    .from(communicationMessages)
    .where(
      and(
        eq(communicationMessages.id, messageId),
        eq(communicationMessages.tenantId, context.tenantId),
      ),
    )
    .limit(1);

  if (!linha) throw new NotFoundError('Mensagem nao encontrada.');

  /**
   * A autorização acontece DEPOIS de saber a unidade da mensagem, e por isso a
   * consulta acima é recortada só pelo tenant. Não há vazamento: o que a
   * consulta devolve ainda não saiu desta função, e sem a permissão da unidade
   * certa nada disso chega à tela.
   */
  await authorize(context, {
    permission: PERMISSIONS.COMMUNICATIONS_VIEW,
    featureKey: FEATURES.COMMUNICATIONS_CORE,
    unitId: linha.unitId,
  });

  const tentativas = await getDb()
    .select({
      attemptNumber: communicationAttempts.attemptNumber,
      provider: communicationAttempts.provider,
      outcome: communicationAttempts.outcome,
      errorCode: communicationAttempts.errorCode,
      errorDetail: communicationAttempts.errorDetail,
      durationMs: communicationAttempts.durationMs,
      startedAt: communicationAttempts.startedAt,
    })
    .from(communicationAttempts)
    .where(eq(communicationAttempts.messageId, messageId))
    .orderBy(desc(communicationAttempts.attemptNumber));

  const anexos = await getDb()
    .select({
      kind: communicationAttachments.kind,
      warrantyId: communicationAttachments.warrantyId,
      filename: communicationAttachments.filename,
      byteSize: communicationAttachments.byteSize,
    })
    .from(communicationAttachments)
    .where(eq(communicationAttachments.messageId, messageId));

  const contexto = await loadLabels(context.tenantId, linha.customerId, linha.serviceOrderId);
  const canal = isCommunicationChannel(linha.channel) ? linha.channel : null;

  return {
    id: linha.id,
    unitId: linha.unitId,
    channel: (canal ?? 'sms') as CommunicationChannel,
    status: (isMessageStatus(linha.status) ? linha.status : 'failed') as MessageStatus,
    purpose: linha.purpose,
    origin: linha.origin,
    recipientDisplay: linha.recipientDisplay,
    recipientMasked: canal ? maskRecipient(canal, linha.recipientDisplay) : '•••',
    customerId: linha.customerId,
    customerName: contexto.customerName,
    serviceOrderId: linha.serviceOrderId,
    serviceOrderNumber: contexto.serviceOrderNumber,
    subject: linha.subject,
    body: linha.body,
    preview: linha.body.slice(0, 120).replace(/\s+/g, ' ').trim(),
    templateId: linha.templateId,
    attemptCount: linha.attemptCount,
    lastErrorCode: linha.lastErrorCode,
    lastErrorDetail: linha.lastErrorDetail,
    sentAt: linha.sentAt,
    sentProvider: linha.sentProvider,
    cancelledAt: linha.cancelledAt,
    cancelReason: linha.cancelReason,
    createdAt: linha.createdAt,
    version: linha.version,
    attempts: tentativas,
    attachments: anexos,
  };
}

async function loadLabels(
  tenantId: string,
  customerId: string | null,
  serviceOrderId: string | null,
): Promise<{ customerName: string | null; serviceOrderNumber: string | null }> {
  let customerName: string | null = null;
  let serviceOrderNumber: string | null = null;

  if (customerId) {
    const linhas = await getDb().execute(sql`
      SELECT name FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId} LIMIT 1
    `);
    customerName = (linhas as unknown as Array<Array<{ name: string }>>)[0]?.[0]?.name ?? null;
  }

  if (serviceOrderId) {
    const linhas = await getDb().execute(sql`
      SELECT number FROM service_orders
       WHERE id = ${serviceOrderId} AND tenant_id = ${tenantId} LIMIT 1
    `);
    const numero = (linhas as unknown as Array<Array<{ number: number }>>)[0]?.[0]?.number;
    serviceOrderNumber = numero === undefined ? null : formatServiceOrderNumber(numero);
  }

  return { customerName, serviceOrderNumber };
}

/**
 * As mensagens de uma Ordem de Serviço, para a seção dentro da ficha da OS.
 *
 * Quem já está autorizado a ver aquela OS ainda precisa da permissão de
 * comunicação: ver a ordem não dá o direito de ler o que foi escrito ao
 * cliente. A seção some para quem não tem, em vez de aparecer vazia.
 */
export async function listMessagesForServiceOrder(
  context: TenantContext,
  serviceOrderId: string,
  unitId: string,
  limit = 5,
): Promise<MessageListItem[]> {
  await authorize(context, {
    permission: PERMISSIONS.COMMUNICATIONS_VIEW,
    featureKey: FEATURES.COMMUNICATIONS_CORE,
    unitId,
  });

  const linhas = await getDb()
    .select({
      id: communicationMessages.id,
      channel: communicationMessages.channel,
      status: communicationMessages.status,
      purpose: communicationMessages.purpose,
      recipientDisplay: communicationMessages.recipientDisplay,
      customerId: communicationMessages.customerId,
      body: communicationMessages.body,
      attemptCount: communicationMessages.attemptCount,
      lastErrorCode: communicationMessages.lastErrorCode,
      sentAt: communicationMessages.sentAt,
      createdAt: communicationMessages.createdAt,
    })
    .from(communicationMessages)
    .where(
      and(
        eq(communicationMessages.tenantId, context.tenantId),
        eq(communicationMessages.unitId, unitId),
        eq(communicationMessages.serviceOrderId, serviceOrderId),
      ),
    )
    .orderBy(desc(communicationMessages.createdAt))
    .limit(limit);

  return linhas.map((linha) => {
    const canal = isCommunicationChannel(linha.channel) ? linha.channel : null;
    return {
      id: linha.id,
      channel: (canal ?? 'sms') as CommunicationChannel,
      status: (isMessageStatus(linha.status) ? linha.status : 'failed') as MessageStatus,
      purpose: linha.purpose,
      recipientMasked: canal ? maskRecipient(canal, linha.recipientDisplay) : '•••',
      customerId: linha.customerId,
      customerName: null,
      serviceOrderId,
      serviceOrderNumber: null,
      preview: linha.body.slice(0, 120).replace(/\s+/g, ' ').trim(),
      attemptCount: linha.attemptCount,
      lastErrorCode: linha.lastErrorCode,
      sentAt: linha.sentAt,
      createdAt: linha.createdAt,
    };
  });
}

export interface MessagingContact {
  value: string;
  display: string;
  type: string;
  isWhatsapp: boolean;
  label: string | null;
}

export interface ComposerContext {
  customerId: string;
  customerName: string;
  unitId: string;
  serviceOrderId: string | null;
  serviceOrderNumber: string | null;
  contacts: MessagingContact[];
}

/**
 * O que a tela de composição precisa saber — e só isso.
 *
 * OS CONTATOS VÊM DAQUI, e é por isso que o `<select>` da tela não tem campo
 * livre: o que a pessoa escolhe é uma das linhas que este método devolveu, e
 * o serviço confere de novo no envio. A tela facilita; ela não autoriza.
 *
 * `unitId` é resolvido no servidor. Quando há Ordem de Serviço, a unidade é a
 * DELA — mandar mensagem sobre uma ordem da loja Centro é ato da loja Centro,
 * mesmo que quem digite esteja com outra unidade selecionada.
 */
export async function loadComposerContext(
  context: TenantContext,
  input: { customerId?: string; serviceOrderId?: string },
): Promise<ComposerContext> {
  let customerId = input.customerId ?? null;
  let unitId = context.activeUnitId;
  let serviceOrderId: string | null = null;
  let serviceOrderNumber: string | null = null;

  if (input.serviceOrderId) {
    const linhas = await getDb().execute(sql`
      SELECT id, unit_id, customer_id, number
        FROM service_orders
       WHERE id = ${input.serviceOrderId} AND tenant_id = ${context.tenantId}
       LIMIT 1
    `);

    const ordem = (
      linhas as unknown as Array<
        Array<{ id: string; unit_id: string; customer_id: string; number: number }>
      >
    )[0]?.[0];

    if (!ordem) throw new NotFoundError('Ordem de servico nao encontrada.');

    serviceOrderId = ordem.id;
    serviceOrderNumber = formatServiceOrderNumber(ordem.number);
    customerId = ordem.customer_id;
    unitId = ordem.unit_id;
  }

  if (!customerId) throw new NotFoundError('Escolha o cliente da mensagem.');
  if (!unitId) throw new NotFoundError('Escolha uma unidade para enviar mensagens.');

  await authorize(context, {
    permission: PERMISSIONS.COMMUNICATIONS_SEND,
    featureKey: FEATURES.COMMUNICATIONS_CORE,
    unitId,
  });

  const clienteLinhas = await getDb().execute(sql`
    SELECT name FROM customers WHERE id = ${customerId} AND tenant_id = ${context.tenantId} LIMIT 1
  `);
  const customerName =
    (clienteLinhas as unknown as Array<Array<{ name: string }>>)[0]?.[0]?.name ?? null;

  if (!customerName) throw new NotFoundError('Cliente nao encontrado.');

  const contatoLinhas = await getDb().execute(sql`
    SELECT value, type, is_whatsapp, label
      FROM customer_contacts
     WHERE customer_id = ${customerId} AND tenant_id = ${context.tenantId}
     ORDER BY is_primary DESC, type, value
  `);

  const contacts = (
    (
      contatoLinhas as unknown as Array<
        Array<{ value: string; type: string; is_whatsapp: number; label: string | null }>
      >
    )[0] ?? []
  ).map((linha) => ({
    value: linha.value,
    display: linha.value,
    type: linha.type,
    isWhatsapp: linha.is_whatsapp === 1,
    label: linha.label,
  }));

  return {
    customerId,
    customerName,
    unitId,
    serviceOrderId,
    serviceOrderNumber,
    contacts,
  };
}

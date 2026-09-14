import 'server-only';
import { and, eq, ne } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import {
  DOCUMENT_TYPE_FOR_KIND,
  normalizeSearchText,
  type CustomerStatus,
} from '@/modules/customers/domain/customer';
import { onlyDigits } from '@/core/document/brazilian-document';
import {
  customerAddresses,
  customerContacts,
  customers,
} from '@/modules/customers/infrastructure/schema';
import {
  customerInputSchema,
  hasAddressData,
  normalizeContacts,
  type CustomerInput,
} from './customer-input';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Gestao de clientes (Prompt 05).
 *
 * O `tenant_id` NUNCA vem da entrada: sai sempre do contexto autenticado — a
 * mesma regra dos modulos anteriores. Todo acesso por ID e resolvido com
 * `tenant_id + id`, entao um ID valido de outra empresa nao encontra nada.
 */

/** Detecta violacao de UNIQUE, atravessando o wrapper de erro do Drizzle. */
function isDuplicateKey(error: unknown, indexName: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as { code?: string; message?: string; cause?: unknown };
    if (candidate.code === 'ER_DUP_ENTRY' && candidate.message?.includes(indexName)) return true;
    if (candidate.message?.includes(indexName) && candidate.message?.includes('Duplicate')) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function parseInput(input: unknown): CustomerInput {
  const parsed = customerInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

/** Campos derivados que a entrada nao traz prontos. */
function derive(input: CustomerInput) {
  const documentDigits = input.document ? onlyDigits(input.document) : null;

  return {
    documentDigits,
    documentType: documentDigits ? DOCUMENT_TYPE_FOR_KIND[input.kind] : null,
    nameNormalized: normalizeSearchText(input.name),
    tradeName: input.kind === 'company' && input.tradeName ? input.tradeName : null,
    tradeNameNormalized:
      input.kind === 'company' && input.tradeName ? normalizeSearchText(input.tradeName) : null,
    stateRegistration:
      input.kind === 'company' && input.stateRegistration ? input.stateRegistration : null,
    birthDate: input.kind === 'individual' && input.birthDate ? input.birthDate : null,
    notes: input.notes ? input.notes : null,
  };
}

/**
 * Grava contatos e endereco.
 *
 * Na edicao, a lista inteira e substituida: o formulario e a verdade sobre os
 * contatos daquele cliente, e casar linha a linha traria uma complexidade que
 * nao paga o proprio custo neste dominio.
 */
async function writeChildren(
  tx: TransactionExecutor,
  context: TenantContext,
  customerId: string,
  input: CustomerInput,
  now: Date,
): Promise<void> {
  await tx.delete(customerContacts).where(eq(customerContacts.customerId, customerId));
  await tx.delete(customerAddresses).where(eq(customerAddresses.customerId, customerId));

  const contacts = normalizeContacts(input.contacts);

  await tx.insert(customerContacts).values(
    contacts.map((contact, index) => ({
      id: newId(),
      customerId,
      tenantId: context.tenantId,
      type: contact.type,
      value: contact.value,
      valueNormalized: contact.valueNormalized,
      isWhatsapp: contact.isWhatsapp,
      label: contact.label,
      isPrimary: index === 0,
      // 1 no principal e NULL nos demais: o indice unico faz o resto.
      primaryMarker: index === 0 ? 1 : null,
      createdAt: now,
      updatedAt: now,
    })),
  );

  if (hasAddressData(input.address)) {
    const address = input.address!;
    await tx.insert(customerAddresses).values({
      id: newId(),
      customerId,
      tenantId: context.tenantId,
      zipCode: address.zipCode ? onlyDigits(address.zipCode) : null,
      street: address.street || null,
      number: address.number || null,
      complement: address.complement || null,
      district: address.district || null,
      city: address.city || null,
      state: address.state ? address.state.toUpperCase() : null,
      country: 'BR',
      isPrimary: true,
      primaryMarker: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function createCustomer(
  context: TenantContext,
  rawInput: unknown,
): Promise<{ customerId: string }> {
  const input = parseInput(rawInput);
  const derived = derive(input);
  const customerId = newId();
  const now = new Date();

  try {
    await runInTransaction(async (tx, emit) => {
      await tx.insert(customers).values({
        id: customerId,
        tenantId: context.tenantId,
        kind: input.kind,
        name: input.name,
        nameNormalized: derived.nameNormalized,
        tradeName: derived.tradeName,
        tradeNameNormalized: derived.tradeNameNormalized,
        documentType: derived.documentType,
        documentDigits: derived.documentDigits,
        stateRegistration: derived.stateRegistration,
        birthDate: derived.birthDate,
        notes: derived.notes,
        status: 'active',
        // Procedencia, nunca filtro (item 2).
        originUnitId: context.activeUnitId,
        createdBy: context.userId,
        updatedBy: context.userId,
        createdAt: now,
        updatedAt: now,
      });

      await writeChildren(tx, context, customerId, input, now);

      /**
       * AUDITORIA SEM COPIAR O CADASTRO (item 48).
       *
       * A trilha registra o que mudou e o suficiente para rastrear — nao o
       * objeto inteiro. CPF, telefone e e-mail sao dados pessoais; duplica-los
       * numa tabela que ninguem limpa multiplicaria a exposicao sem ganho de
       * rastreabilidade. Guardamos o tipo do documento e se ele existe, nunca
       * o numero.
       */
      await recordAudit(
        {
          action: AUDIT_ACTIONS.CUSTOMER_CREATED,
          entityType: 'customer',
          entityId: customerId,
          tenantId: context.tenantId,
          unitId: context.activeUnitId,
          userId: context.userId,
          after: {
            kind: input.kind,
            name: input.name,
            hasDocument: Boolean(derived.documentDigits),
            documentType: derived.documentType,
            contactCount: input.contacts.length,
            status: 'active',
          },
        },
        tx,
      );

      await emit({
        type: EVENT_TYPES.CUSTOMER_CREATED,
        tenantId: context.tenantId,
        payload: { customerId, kind: input.kind, createdBy: context.userId },
      });
    });
  } catch (error) {
    if (isDuplicateKey(error, 'uq_customers_tenant_document')) {
      throw new ConflictError(
        derived.documentType === 'cnpj'
          ? 'Ja existe um cliente com este CNPJ nesta empresa.'
          : 'Ja existe um cliente com este CPF nesta empresa.',
        { documentDigits: derived.documentDigits },
      );
    }
    throw error;
  }

  return { customerId };
}

export async function updateCustomer(
  context: TenantContext,
  customerId: string,
  rawInput: unknown,
): Promise<void> {
  const input = parseInput(rawInput);
  const derived = derive(input);
  const db = getDb();

  const [existing] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, context.tenantId), eq(customers.id, customerId)))
    .limit(1);

  // ID de outra empresa e ID inexistente sao indistinguiveis daqui de fora.
  if (!existing) throw new NotFoundError('Cliente nao encontrado.');

  /**
   * O TIPO PF/PJ NAO MUDA APOS A CRIACAO (item 33).
   *
   * Trocar o tipo trocaria a natureza do documento (CPF vira CNPJ), o
   * significado do nome (pessoa vira razao social) e, mais adiante, a regra
   * fiscal das notas ja emitidas. Um erro de digitacao no cadastro se resolve
   * criando o cliente certo e inativando o errado — sem reescrever a historia
   * de quem ele era.
   */
  if (existing.kind !== input.kind) {
    throw new ValidationError(
      'Nao e possivel trocar entre pessoa fisica e juridica. Cadastre o cliente correto e inative este.',
    );
  }

  const documentChanged = (existing.documentDigits ?? null) !== derived.documentDigits;
  const now = new Date();

  try {
    await runInTransaction(async (tx, emit) => {
      await tx
        .update(customers)
        .set({
          name: input.name,
          nameNormalized: derived.nameNormalized,
          tradeName: derived.tradeName,
          tradeNameNormalized: derived.tradeNameNormalized,
          documentType: derived.documentType,
          documentDigits: derived.documentDigits,
          stateRegistration: derived.stateRegistration,
          birthDate: derived.birthDate,
          notes: derived.notes,
          updatedBy: context.userId,
          updatedAt: now,
        })
        .where(and(eq(customers.tenantId, context.tenantId), eq(customers.id, customerId)));

      await writeChildren(tx, context, customerId, input, now);

      await recordAudit(
        {
          action: AUDIT_ACTIONS.CUSTOMER_UPDATED,
          entityType: 'customer',
          entityId: customerId,
          tenantId: context.tenantId,
          unitId: context.activeUnitId,
          userId: context.userId,
          before: { name: existing.name, hasDocument: Boolean(existing.documentDigits) },
          after: {
            name: input.name,
            hasDocument: Boolean(derived.documentDigits),
            contactCount: input.contacts.length,
          },
        },
        tx,
      );

      /** Mudanca de documento tem trilha propria: e o identificador forte. */
      if (documentChanged) {
        await recordAudit(
          {
            action: AUDIT_ACTIONS.CUSTOMER_DOCUMENT_CHANGED,
            entityType: 'customer',
            entityId: customerId,
            tenantId: context.tenantId,
            userId: context.userId,
            before: { hasDocument: Boolean(existing.documentDigits) },
            after: {
              hasDocument: Boolean(derived.documentDigits),
              documentType: derived.documentType,
            },
          },
          tx,
        );
      }

      await emit({
        type: EVENT_TYPES.CUSTOMER_UPDATED,
        tenantId: context.tenantId,
        payload: { customerId, updatedBy: context.userId, documentChanged },
      });
    });
  } catch (error) {
    if (isDuplicateKey(error, 'uq_customers_tenant_document')) {
      throw new ConflictError(
        derived.documentType === 'cnpj'
          ? 'Ja existe outro cliente com este CNPJ nesta empresa.'
          : 'Ja existe outro cliente com este CPF nesta empresa.',
      );
    }
    throw error;
  }
}

/**
 * Ativa ou inativa (item 18).
 *
 * NAO EXISTE EXCLUSAO (item 19). Um cliente carrega historico de atendimento,
 * garantia e financeiro; apaga-lo criaria orfaos em toda parte. Inativar
 * preserva o passado e some da operacao do dia a dia.
 */
export async function setCustomerStatus(
  context: TenantContext,
  customerId: string,
  status: CustomerStatus,
): Promise<void> {
  const db = getDb();

  const [existing] = await db
    .select({ id: customers.id, status: customers.status, name: customers.name })
    .from(customers)
    .where(and(eq(customers.tenantId, context.tenantId), eq(customers.id, customerId)))
    .limit(1);

  if (!existing) throw new NotFoundError('Cliente nao encontrado.');
  if (existing.status === status) return; // idempotente

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx
      .update(customers)
      .set({ status, updatedBy: context.userId, updatedAt: now })
      .where(and(eq(customers.tenantId, context.tenantId), eq(customers.id, customerId)));

    await recordAudit(
      {
        action:
          status === 'active'
            ? AUDIT_ACTIONS.CUSTOMER_ACTIVATED
            : AUDIT_ACTIONS.CUSTOMER_DEACTIVATED,
        entityType: 'customer',
        entityId: customerId,
        tenantId: context.tenantId,
        unitId: context.activeUnitId,
        userId: context.userId,
        before: { status: existing.status },
        after: { status },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.CUSTOMER_STATUS_CHANGED,
      tenantId: context.tenantId,
      payload: { customerId, status, changedBy: context.userId },
    });
  });
}

/**
 * Clientes com documento igual ao informado (item 20).
 *
 * Usado pela interface ANTES de enviar, para oferecer o cliente existente em
 * vez de um erro seco. O bloqueio de verdade continua sendo a restricao do
 * banco — esta consulta e conveniencia, nao barreira.
 */
export async function findByDocument(
  context: TenantContext,
  documentDigits: string,
  exceptCustomerId?: string,
): Promise<{ id: string; name: string } | null> {
  const db = getDb();
  const digits = onlyDigits(documentDigits);
  if (!digits) return null;

  const [row] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, context.tenantId),
        eq(customers.documentDigits, digits),
        exceptCustomerId ? ne(customers.id, exceptCustomerId) : undefined,
      ),
    )
    .limit(1);

  return row ?? null;
}

import 'server-only';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { normalizePhone } from '@/core/contact/phone';
import {
  inferDocumentType,
  isValidDocument,
  onlyDigits,
  type DocumentType,
} from '@/core/document/brazilian-document';
import { newId } from '@/core/ids/id';
import { normalizeSearchable } from '@/core/text/normalize';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  SUPPLIER_CONTACT_NAME_MAX,
  SUPPLIER_EMAIL_MAX,
  SUPPLIER_KINDS,
  SUPPLIER_LEAD_TIME_MAX_DAYS,
  SUPPLIER_NAME_MAX,
  SUPPLIER_NOTES_MAX,
  SUPPLIER_PHONE_MAX,
  SUPPLIER_STATUSES,
  SUPPLIER_TERMS_MAX,
  SUPPLIER_TRADE_NAME_MAX,
  SUPPLIER_WEBSITE_MAX,
} from '@/modules/purchasing/domain/purchasing';
import { supplierContacts, suppliers } from '@/modules/purchasing/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Cadastro de fornecedores (Prompt 11, itens 4 e 5).
 *
 * O FORNECEDOR E DO TENANT. Nao ha `unitId` em lugar nenhum deste arquivo, e a
 * autorizacao passa `unitId: null`: a empresa negocia com o distribuidor, nao
 * a loja. Duplicar o cadastro por unidade criaria tres fornecedores que nenhum
 * relatorio soma e que a busca mostra em triplicata.
 *
 * FORNECEDOR NAO E FABRICANTE (item 5). `parts.brand` continua sendo o
 * fabricante da peca, e nada aqui o transforma em empresa cadastrada.
 */

const contactSchema = z.object({
  role: z.enum(['commercial', 'financial', 'other']).default('commercial'),
  name: z.string().trim().min(1, 'Informe o nome do contato.').max(SUPPLIER_CONTACT_NAME_MAX),
  email: z.string().trim().max(SUPPLIER_EMAIL_MAX).optional(),
  phone: z.string().trim().max(SUPPLIER_PHONE_MAX).optional(),
  notes: z.string().trim().max(300).optional(),
});

const supplierInputSchema = z.object({
  kind: z.enum(SUPPLIER_KINDS).default('company'),
  name: z.string().trim().min(1, 'Informe a razao social ou o nome.').max(SUPPLIER_NAME_MAX),
  tradeName: z.string().trim().max(SUPPLIER_TRADE_NAME_MAX).optional(),
  /** Vazio e legitimo: fornecedor informal nao tem CNPJ (item 4). */
  document: z.string().trim().max(20).optional(),
  stateRegistration: z.string().trim().max(32).optional(),
  email: z.string().trim().max(SUPPLIER_EMAIL_MAX).optional(),
  phone: z.string().trim().max(SUPPLIER_PHONE_MAX).optional(),
  phoneIsWhatsapp: z.boolean().optional(),
  website: z.string().trim().max(SUPPLIER_WEBSITE_MAX).optional(),
  zipCode: z.string().trim().max(9).optional(),
  street: z.string().trim().max(200).optional(),
  addressNumber: z.string().trim().max(20).optional(),
  complement: z.string().trim().max(120).optional(),
  district: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(2).optional(),
  leadTimeDays: z.coerce.number().int().min(0).max(SUPPLIER_LEAD_TIME_MAX_DAYS).optional(),
  commercialTerms: z.string().trim().max(SUPPLIER_TERMS_MAX).optional(),
  notes: z.string().trim().max(SUPPLIER_NOTES_MAX).optional(),
  contacts: z.array(contactSchema).max(20).optional(),
});

export type SupplierInput = z.infer<typeof supplierInputSchema>;

function parseInput(rawInput: unknown): SupplierInput {
  const parsed = supplierInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

/**
 * Documento OPCIONAL, mas validado quando informado (item 4).
 *
 * Mascara nao e validacao: `111.111.111-11` tem a forma certa e e invalido. A
 * verificacao e a dos digitos, reaproveitada do core — a mesma que o cadastro
 * de clientes usa desde o Prompt 05.
 */
function parseDocument(raw: string | undefined): {
  documentType: DocumentType | null;
  documentDigits: string | null;
} {
  if (!raw) return { documentType: null, documentDigits: null };

  const digits = onlyDigits(raw);
  if (!digits) return { documentType: null, documentDigits: null };

  const type = inferDocumentType(digits);
  if (!type) {
    throw new ValidationError('O documento precisa ter 11 digitos (CPF) ou 14 (CNPJ).');
  }
  if (!isValidDocument(type, digits)) {
    throw new ValidationError(type === 'cpf' ? 'CPF invalido.' : 'CNPJ invalido.');
  }

  return { documentType: type, documentDigits: digits };
}

interface SupplierColumns {
  kind: string;
  name: string;
  nameSearch: string;
  tradeName: string | null;
  tradeNameSearch: string | null;
  documentType: string | null;
  documentDigits: string | null;
  stateRegistration: string | null;
  email: string | null;
  phone: string | null;
  phoneDigits: string | null;
  phoneIsWhatsapp: number;
  website: string | null;
  zipCode: string | null;
  street: string | null;
  addressNumber: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  leadTimeDays: number | null;
  commercialTerms: string | null;
  notes: string | null;
}

function toColumns(input: SupplierInput): SupplierColumns {
  const document = parseDocument(input.document);

  return {
    kind: input.kind,
    name: input.name,
    nameSearch: normalizeSearchable(input.name),
    tradeName: input.tradeName || null,
    tradeNameSearch: input.tradeName ? normalizeSearchable(input.tradeName) : null,
    documentType: document.documentType,
    documentDigits: document.documentDigits,
    stateRegistration: input.stateRegistration || null,
    email: input.email ? input.email.toLowerCase() : null,
    phone: input.phone || null,
    phoneDigits: input.phone ? normalizePhone(input.phone) : null,
    phoneIsWhatsapp: input.phoneIsWhatsapp ? 1 : 0,
    website: input.website || null,
    zipCode: input.zipCode ? onlyDigits(input.zipCode) : null,
    street: input.street || null,
    addressNumber: input.addressNumber || null,
    complement: input.complement || null,
    district: input.district || null,
    city: input.city || null,
    state: input.state ? input.state.toUpperCase() : null,
    leadTimeDays: input.leadTimeDays ?? null,
    commercialTerms: input.commercialTerms || null,
    notes: input.notes || null,
  };
}

/** Carrega o fornecedor DENTRO do tenant. Nunca `findById(id)` sem escopo. */
export async function loadSupplier(context: TenantContext, supplierId: string) {
  const [row] = await getDb()
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, context.tenantId), eq(suppliers.id, supplierId)))
    .limit(1);

  if (!row) throw new NotFoundError('Fornecedor nao encontrado.');
  return row;
}

/**
 * Documento unico DENTRO DO TENANT (item 4).
 *
 * Nunca global: duas empresas compram do mesmo distribuidor, e cada uma tem o
 * proprio cadastro dele. Tratar CNPJ como identificador entre tenants vazaria
 * a existencia de um fornecedor de outra empresa.
 */
async function assertDocumentAvailable(
  tenantId: string,
  digits: string | null,
  exceptId?: string,
): Promise<void> {
  if (!digits) return;

  const conditions = [eq(suppliers.tenantId, tenantId), eq(suppliers.documentDigits, digits)];
  if (exceptId) conditions.push(ne(suppliers.id, exceptId));

  const [existing] = await getDb()
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    throw new ConflictError(`Este documento ja pertence ao fornecedor ${existing.name}.`);
  }
}

async function replaceContacts(
  tx: Parameters<Parameters<typeof runInTransaction>[0]>[0],
  tenantId: string,
  supplierId: string,
  contacts: SupplierInput['contacts'],
  now: Date,
): Promise<void> {
  await tx
    .delete(supplierContacts)
    .where(
      and(eq(supplierContacts.tenantId, tenantId), eq(supplierContacts.supplierId, supplierId)),
    );

  for (const contact of contacts ?? []) {
    await tx.insert(supplierContacts).values({
      id: newId(),
      tenantId,
      supplierId,
      role: contact.role,
      name: contact.name,
      email: contact.email ? contact.email.toLowerCase() : null,
      phone: contact.phone || null,
      phoneDigits: contact.phone ? normalizePhone(contact.phone) : null,
      notes: contact.notes || null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function createSupplier(context: TenantContext, rawInput: unknown): Promise<string> {
  await authorize(context, {
    permission: PERMISSIONS.SUPPLIERS_MANAGE,
    featureKey: FEATURES.OPERATIONS_PURCHASING,
  });

  const input = parseInput(rawInput);
  const columns = toColumns(input);
  await assertDocumentAvailable(context.tenantId, columns.documentDigits);

  const supplierId = newId();
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx.insert(suppliers).values({
      id: supplierId,
      tenantId: context.tenantId,
      ...columns,
      status: 'active',
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await replaceContacts(tx, context.tenantId, supplierId, input.contacts, now);

    await recordAudit(
      {
        action: AUDIT_ACTIONS.SUPPLIER_CREATED,
        entityType: 'supplier',
        entityId: supplierId,
        tenantId: context.tenantId,
        userId: context.userId,
        after: { name: columns.name, documentType: columns.documentType },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.SUPPLIER_CREATED,
      tenantId: context.tenantId,
      /** Sem dado pessoal no payload (item 70): so chaves tecnicas. */
      payload: { supplierId, kind: columns.kind },
    });
  });

  return supplierId;
}

export async function updateSupplier(
  context: TenantContext,
  supplierId: string,
  rawInput: unknown,
  expectedVersion?: number,
): Promise<void> {
  await authorize(context, {
    permission: PERMISSIONS.SUPPLIERS_MANAGE,
    featureKey: FEATURES.OPERATIONS_PURCHASING,
  });

  const current = await loadSupplier(context, supplierId);
  const input = parseInput(rawInput);
  const columns = toColumns(input);
  await assertDocumentAvailable(context.tenantId, columns.documentDigits, supplierId);

  const version = expectedVersion ?? current.version;
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    const result = await tx
      .update(suppliers)
      .set({ ...columns, version: version + 1, updatedBy: context.userId, updatedAt: now })
      .where(
        and(
          eq(suppliers.tenantId, context.tenantId),
          eq(suppliers.id, supplierId),
          eq(suppliers.version, version),
        ),
      );

    if (affectedRows(result) === 0) {
      throw new ConflictError(
        'Este fornecedor foi alterado por outra pessoa. Recarregue a pagina.',
      );
    }

    await replaceContacts(tx, context.tenantId, supplierId, input.contacts, now);

    await recordAudit(
      {
        action: AUDIT_ACTIONS.SUPPLIER_UPDATED,
        entityType: 'supplier',
        entityId: supplierId,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { name: current.name },
        after: { name: columns.name },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.SUPPLIER_UPDATED,
      tenantId: context.tenantId,
      payload: { supplierId },
    });
  });
}

/**
 * Ativa ou inativa o fornecedor.
 *
 * INATIVAR NAO APAGA NADA: pedidos, recebimentos e historico de preco
 * permanecem, e continuam legiveis. O fornecedor inativo apenas deixa de ser
 * oferecido em pedido novo.
 */
export async function changeSupplierStatus(
  context: TenantContext,
  supplierId: string,
  status: (typeof SUPPLIER_STATUSES)[number],
): Promise<void> {
  await authorize(context, {
    permission: PERMISSIONS.SUPPLIERS_MANAGE,
    featureKey: FEATURES.OPERATIONS_PURCHASING,
  });

  const current = await loadSupplier(context, supplierId);
  if (current.status === status) return;

  const now = new Date();

  await runInTransaction(async (tx) => {
    const result = await tx
      .update(suppliers)
      .set({
        status,
        version: current.version + 1,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(suppliers.tenantId, context.tenantId),
          eq(suppliers.id, supplierId),
          eq(suppliers.version, current.version),
        ),
      );

    if (affectedRows(result) === 0) {
      throw new ConflictError(
        'Este fornecedor foi alterado por outra pessoa. Recarregue a pagina.',
      );
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.SUPPLIER_STATUS_CHANGED,
        entityType: 'supplier',
        entityId: supplierId,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { status: current.status },
        after: { status },
      },
      tx,
    );
  });
}

import 'server-only';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { affectedRows } from '@/core/db/affected-rows';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { Money } from '@/core/money/money';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  PART_BARCODE_MAX,
  PART_BRAND_MAX,
  PART_CODE_MAX,
  PART_DESCRIPTION_MAX,
  PART_NAME_MAX,
  PART_NOTES_MAX,
  PART_NUMBER_MAX,
  PART_STATUSES,
  UNITS_OF_MEASURE,
  normalizeBarcode,
  normalizePartCode,
  normalizePartNumber,
  partSearchKey,
} from '@/modules/inventory/domain/inventory';
import { parts } from '@/modules/inventory/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Catalogo de pecas (Prompt 10, itens 5, 6, 11 a 14 e 81).
 *
 * O CATALOGO E DO TENANT. Nao ha `unitId` em lugar nenhum deste arquivo, e
 * isso e a regra, nao um esquecimento: a peca e o vocabulario da empresa, e
 * quem tem quantidade e o SALDO — que e da unidade e vive em `stock-service`.
 *
 * A autorizacao pede `unitId: null` porque administrar catalogo e capacidade
 * de TENANT (item 81). Quem so tem o perfil numa unidade nao passa a mandar no
 * catalogo da empresa por estar logado nela.
 */

const unitOfMeasureSchema = z.enum(UNITS_OF_MEASURE);

const partInputSchema = z.object({
  code: z.string().trim().min(1, 'Informe o codigo interno.').max(PART_CODE_MAX),
  name: z.string().trim().min(1, 'Informe o nome da peca.').max(PART_NAME_MAX),
  description: z.string().trim().max(PART_DESCRIPTION_MAX).optional(),
  brand: z.string().trim().max(PART_BRAND_MAX).optional(),
  partNumber: z.string().trim().max(PART_NUMBER_MAX).optional(),
  barcode: z.string().trim().max(PART_BARCODE_MAX).optional(),
  unitOfMeasure: unitOfMeasureSchema,
  suggestedPrice: z.string().trim().optional(),
  notes: z.string().trim().max(PART_NOTES_MAX).optional(),
});

export type PartInput = z.infer<typeof partInputSchema>;

function parseInput(rawInput: unknown): PartInput {
  const parsed = partInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

/**
 * Preco sugerido: informacao comercial e nada mais (item 19).
 *
 * Vazio e legitimo e diferente de zero — peca sem preco de tabela nao e peca
 * de graca. O preco que vale continua sendo o aprovado no orcamento.
 */
function parseSuggestedPrice(raw: string | undefined): string | null {
  if (!raw) return null;
  const price = Money.parse(raw.replace(',', '.'));
  if (price.isNegative()) throw new ValidationError('O preco sugerido nao pode ser negativo.');
  return price.toString();
}

interface PartColumns {
  code: string;
  codeNormalized: string;
  name: string;
  nameSearch: string;
  description: string | null;
  brand: string | null;
  brandSearch: string | null;
  partNumber: string | null;
  partNumberNormalized: string | null;
  barcode: string | null;
  barcodeNormalized: string | null;
  unitOfMeasure: string;
  suggestedPrice: string | null;
  notes: string | null;
}

function toColumns(input: PartInput): PartColumns {
  const codeNormalized = normalizePartCode(input.code);
  if (!codeNormalized) {
    throw new ValidationError('O codigo interno precisa ter letras ou numeros.');
  }

  return {
    code: input.code,
    codeNormalized,
    name: input.name,
    nameSearch: partSearchKey(input.name),
    description: input.description || null,
    brand: input.brand || null,
    brandSearch: input.brand ? partSearchKey(input.brand) : null,
    partNumber: input.partNumber || null,
    partNumberNormalized: input.partNumber ? normalizePartNumber(input.partNumber) : null,
    barcode: input.barcode || null,
    barcodeNormalized: input.barcode ? normalizeBarcode(input.barcode) : null,
    unitOfMeasure: input.unitOfMeasure,
    suggestedPrice: parseSuggestedPrice(input.suggestedPrice),
    notes: input.notes || null,
  };
}

/** Carrega a peca DENTRO do tenant. Nunca `findById(id)` sem escopo (item 116). */
export async function loadPart(context: TenantContext, partId: string) {
  const [row] = await getDb()
    .select()
    .from(parts)
    .where(and(eq(parts.tenantId, context.tenantId), eq(parts.id, partId)))
    .limit(1);

  if (!row) throw new NotFoundError('Peca nao encontrada.');
  return row;
}

async function assertCodeAvailable(
  tenantId: string,
  codeNormalized: string,
  exceptPartId?: string,
): Promise<void> {
  const conditions = [eq(parts.tenantId, tenantId), eq(parts.codeNormalized, codeNormalized)];
  if (exceptPartId) conditions.push(ne(parts.id, exceptPartId));

  const [existing] = await getDb()
    .select({ id: parts.id, code: parts.code })
    .from(parts)
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    throw new ConflictError(`Ja existe uma peca com o codigo ${existing.code}.`);
  }
}

export async function createPart(context: TenantContext, rawInput: unknown): Promise<string> {
  await authorize(context, {
    permission: PERMISSIONS.INVENTORY_CATALOG_MANAGE,
    featureKey: FEATURES.OPERATIONS_INVENTORY,
  });

  const columns = toColumns(parseInput(rawInput));
  await assertCodeAvailable(context.tenantId, columns.codeNormalized);

  const partId = newId();
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx.insert(parts).values({
      id: partId,
      tenantId: context.tenantId,
      ...columns,
      status: 'active',
      createdBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.PART_CREATED,
        entityType: 'part',
        entityId: partId,
        tenantId: context.tenantId,
        userId: context.userId,
        after: { code: columns.code, name: columns.name, unitOfMeasure: columns.unitOfMeasure },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.PART_CREATED,
      tenantId: context.tenantId,
      payload: { partId, code: columns.code, unitOfMeasure: columns.unitOfMeasure },
    });
  });

  return partId;
}

/**
 * Edita o cadastro.
 *
 * MUDAR A PECA NAO MUDA ORCAMENTO NENHUM (item 42). Nao ha, aqui, nenhuma
 * escrita em `quote_items`: a proposta guarda os proprios numeros desde o
 * Prompt 09, e e por isso que renomear uma peca depois de aprovada nao
 * reescreve o que o cliente autorizou.
 */
export async function updatePart(
  context: TenantContext,
  partId: string,
  rawInput: unknown,
  expectedVersion?: number,
): Promise<void> {
  await authorize(context, {
    permission: PERMISSIONS.INVENTORY_CATALOG_MANAGE,
    featureKey: FEATURES.OPERATIONS_INVENTORY,
  });

  const current = await loadPart(context, partId);
  const columns = toColumns(parseInput(rawInput));
  await assertCodeAvailable(context.tenantId, columns.codeNormalized, partId);

  const version = expectedVersion ?? current.version;
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    const result = await tx
      .update(parts)
      .set({ ...columns, version: version + 1, updatedBy: context.userId, updatedAt: now })
      .where(
        and(eq(parts.tenantId, context.tenantId), eq(parts.id, partId), eq(parts.version, version)),
      );

    if (affectedRows(result) === 0) {
      throw new ConflictError('Esta peca foi alterada por outra pessoa. Recarregue a pagina.');
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.PART_UPDATED,
        entityType: 'part',
        entityId: partId,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { code: current.code, name: current.name },
        after: { code: columns.code, name: columns.name },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.PART_UPDATED,
      tenantId: context.tenantId,
      payload: { partId, code: columns.code },
    });
  });
}

/**
 * Ativa ou inativa a peca.
 *
 * INATIVAR NAO APAGA NADA (item 87): saldo, movimentacoes e reservas
 * permanecem, e o historico continua legivel. A peca inativa apenas deixa de
 * ser oferecida em entrada, saida e no seletor do orcamento.
 */
export async function changePartStatus(
  context: TenantContext,
  partId: string,
  status: (typeof PART_STATUSES)[number],
): Promise<void> {
  await authorize(context, {
    permission: PERMISSIONS.INVENTORY_CATALOG_MANAGE,
    featureKey: FEATURES.OPERATIONS_INVENTORY,
  });

  const current = await loadPart(context, partId);
  if (current.status === status) return;

  const now = new Date();

  await runInTransaction(async (tx) => {
    const result = await tx
      .update(parts)
      .set({
        status,
        version: current.version + 1,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(parts.tenantId, context.tenantId),
          eq(parts.id, partId),
          eq(parts.version, current.version),
        ),
      );

    if (affectedRows(result) === 0) {
      throw new ConflictError('Esta peca foi alterada por outra pessoa. Recarregue a pagina.');
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.PART_STATUS_CHANGED,
        entityType: 'part',
        entityId: partId,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { status: current.status },
        after: { status },
      },
      tx,
    );
  });
}

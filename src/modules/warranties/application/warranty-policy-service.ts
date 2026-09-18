import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { affectedRows } from '@/core/db/affected-rows';
import { runInTransaction } from '@/core/db/unit-of-work';
import { ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { normalizeSearchable } from '@/core/text/normalize';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  DURATION_MAX,
  DURATION_MIN,
  DURATION_UNITS,
  EXCLUSIONS_MAX,
  COVERAGE_SUMMARY_MAX,
  TERMS_MAX,
  WARRANTY_TYPES,
} from '@/modules/warranties/domain/warranty';
import { warrantyPolicies } from '@/modules/warranties/infrastructure/schema';

/**
 * POLITICAS DE GARANTIA (Prompt 13, item 8).
 *
 * A politica e o MOLDE, nunca a garantia. Ela diz "reparo de placa = 90 dias,
 * cobre mao de obra"; a garantia emitida COPIA esses termos e nunca mais os
 * le daqui (ADR-062).
 *
 * E por isso que este servico nao tem nenhum metodo que altere garantias
 * existentes: editar a politica em marco nao pode, por construcao, mexer no
 * certificado entregue em janeiro.
 */

const policySchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da politica.').max(120),
  type: z.enum(WARRANTY_TYPES),
  durationAmount: z.coerce
    .number()
    .int('A duracao deve ser um numero inteiro.')
    .min(DURATION_MIN, 'A duracao deve ser de ao menos 1.')
    .max(DURATION_MAX, `A duracao nao pode passar de ${DURATION_MAX}.`),
  durationUnit: z.enum(DURATION_UNITS),
  coverageSummary: z.string().trim().max(COVERAGE_SUMMARY_MAX).optional().or(z.literal('')),
  exclusions: z.string().trim().max(EXCLUSIONS_MAX).optional().or(z.literal('')),
  terms: z.string().trim().max(TERMS_MAX).optional().or(z.literal('')),
});

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

async function authorizeSettings(context: TenantContext): Promise<void> {
  await authorize(context, {
    permission: PERMISSIONS.WARRANTIES_SETTINGS_MANAGE,
    featureKey: FEATURES.OPERATIONS_WARRANTIES,
  });
}

export async function createWarrantyPolicy(
  context: TenantContext,
  rawInput: unknown,
): Promise<{ policyId: string }> {
  await authorizeSettings(context);
  const input = parse(policySchema, rawInput);

  const policyId = newId();
  const now = new Date();

  await runInTransaction(async (tx) => {
    await tx.insert(warrantyPolicies).values({
      id: policyId,
      tenantId: context.tenantId,
      name: input.name,
      nameSearch: normalizeSearchable(input.name),
      type: input.type,
      durationAmount: input.durationAmount,
      durationUnit: input.durationUnit,
      coverageSummary: input.coverageSummary || null,
      exclusions: input.exclusions || null,
      terms: input.terms || null,
      status: 'active',
      createdBy: context.userId,
      updatedBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.WARRANTY_POLICY_CHANGED,
        entityType: 'warranty_policy',
        entityId: policyId,
        tenantId: context.tenantId,
        userId: context.userId,
        after: {
          name: input.name,
          type: input.type,
          duration: `${input.durationAmount} ${input.durationUnit}`,
        },
      },
      tx,
    );
  });

  return { policyId };
}

/**
 * Altera a politica — e NAO altera nenhuma garantia ja emitida.
 *
 * O `version` com compare-and-swap existe porque duas pessoas editando a
 * mesma politica ao mesmo tempo produziriam um molde que nenhuma das duas
 * escolheu. Quem perde a corrida recarrega.
 */
export async function updateWarrantyPolicy(
  context: TenantContext,
  policyId: string,
  rawInput: unknown,
  expectedVersion?: number,
): Promise<void> {
  await authorizeSettings(context);
  const input = parse(policySchema, rawInput);

  const current = await loadWarrantyPolicy(context, policyId);
  const now = new Date();

  await runInTransaction(async (tx) => {
    const updated = await tx
      .update(warrantyPolicies)
      .set({
        name: input.name,
        nameSearch: normalizeSearchable(input.name),
        type: input.type,
        durationAmount: input.durationAmount,
        durationUnit: input.durationUnit,
        coverageSummary: input.coverageSummary || null,
        exclusions: input.exclusions || null,
        terms: input.terms || null,
        version: current.version + 1,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(warrantyPolicies.id, policyId),
          eq(warrantyPolicies.tenantId, context.tenantId),
          eq(warrantyPolicies.version, expectedVersion ?? current.version),
        ),
      );

    if (affectedRows(updated) === 0) {
      throw new ConflictError(
        'Esta politica foi alterada por outra pessoa. Recarregue a pagina e tente de novo.',
      );
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.WARRANTY_POLICY_CHANGED,
        entityType: 'warranty_policy',
        entityId: policyId,
        tenantId: context.tenantId,
        userId: context.userId,
        before: {
          name: current.name,
          duration: `${current.durationAmount} ${current.durationUnit}`,
        },
        after: {
          name: input.name,
          duration: `${input.durationAmount} ${input.durationUnit}`,
          /**
           * O registro diz em voz alta o que a edicao NAO faz: garantias ja
           * emitidas guardam snapshot e seguem com os termos da epoca.
           */
          affectsIssuedWarranties: false,
        },
      },
      tx,
    );
  });
}

export async function changeWarrantyPolicyStatus(
  context: TenantContext,
  policyId: string,
  status: 'active' | 'inactive',
): Promise<void> {
  await authorizeSettings(context);
  const current = await loadWarrantyPolicy(context, policyId);
  const now = new Date();

  await runInTransaction(async (tx) => {
    await tx
      .update(warrantyPolicies)
      .set({ status, version: current.version + 1, updatedBy: context.userId, updatedAt: now })
      .where(
        and(eq(warrantyPolicies.id, policyId), eq(warrantyPolicies.tenantId, context.tenantId)),
      );

    await recordAudit(
      {
        action: AUDIT_ACTIONS.WARRANTY_POLICY_CHANGED,
        entityType: 'warranty_policy',
        entityId: policyId,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { status: current.status },
        after: { status },
      },
      tx,
    );
  });
}

export async function loadWarrantyPolicy(context: TenantContext, policyId: string) {
  const [row] = await getDb()
    .select()
    .from(warrantyPolicies)
    .where(and(eq(warrantyPolicies.tenantId, context.tenantId), eq(warrantyPolicies.id, policyId)))
    .limit(1);

  /** Politica de outra empresa e politica inexistente terminam no mesmo lugar. */
  if (!row) throw new NotFoundError('Politica de garantia nao encontrada.');
  return row;
}

export async function listWarrantyPolicies(context: TenantContext, onlyActive = false) {
  return getDb()
    .select({
      id: warrantyPolicies.id,
      name: warrantyPolicies.name,
      type: warrantyPolicies.type,
      durationAmount: warrantyPolicies.durationAmount,
      durationUnit: warrantyPolicies.durationUnit,
      coverageSummary: warrantyPolicies.coverageSummary,
      exclusions: warrantyPolicies.exclusions,
      terms: warrantyPolicies.terms,
      status: warrantyPolicies.status,
      version: warrantyPolicies.version,
    })
    .from(warrantyPolicies)
    .where(
      and(
        eq(warrantyPolicies.tenantId, context.tenantId),
        onlyActive ? eq(warrantyPolicies.status, 'active') : undefined,
      ),
    )
    .orderBy(asc(warrantyPolicies.type), asc(warrantyPolicies.nameSearch));
}

import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { BusinessRuleError, NotFoundError } from '@/core/errors';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { findFeature, isCore } from '@/modules/features/domain/catalog';
import {
  features,
  planEntitlements,
  tenantFeatures,
} from '@/modules/features/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Configuracao de modularidade do tenant (Prompt 01, item 25).
 *
 * Regras aplicadas aqui, nao na interface:
 *  - CORE nao pode ser desativada (Prompt 00, item 12);
 *  - nao se ativa o que o plano nao contempla;
 *  - nao se ativa feature com dependencia insatisfeita (Prompt 00, item 16);
 *  - DESATIVAR NAO APAGA DADOS: a linha permanece com enabled = false e
 *    `disabled_at` preenchido; reativar devolve o acesso ao historico
 *    (Prompt 00, itens 17 e 18).
 */

export interface ToggleFeatureInput {
  featureKey: string;
  enabled: boolean;
}

export async function setTenantFeature(
  context: TenantContext,
  input: ToggleFeatureInput,
): Promise<void> {
  const db = getDb();

  const featureRows = await db
    .select({ key: features.key, type: features.type })
    .from(features)
    .where(eq(features.key, input.featureKey))
    .limit(1);

  const feature = featureRows[0];
  if (!feature) throw new NotFoundError('Funcionalidade nao encontrada no catalogo do Nexo56.');

  if (feature.type === 'CORE' || isCore(feature.key)) {
    throw new BusinessRuleError(
      'Esta funcionalidade e estrutural do Nexo56 e nao pode ser desativada.',
    );
  }

  if (input.enabled) {
    const entitled = await db
      .select({ featureKey: planEntitlements.featureKey })
      .from(planEntitlements)
      .where(
        and(
          eq(planEntitlements.planId, context.planId),
          eq(planEntitlements.featureKey, input.featureKey),
        ),
      )
      .limit(1);

    if (entitled.length === 0) {
      throw new BusinessRuleError('O plano contratado nao inclui esta funcionalidade.');
    }

    const definition = findFeature(input.featureKey);
    const dependencies = definition?.dependsOn ?? [];

    for (const dependency of dependencies) {
      if (isCore(dependency)) continue;
      const active = await db
        .select({ enabled: tenantFeatures.enabled })
        .from(tenantFeatures)
        .where(
          and(
            eq(tenantFeatures.tenantId, context.tenantId),
            eq(tenantFeatures.featureKey, dependency),
          ),
        )
        .limit(1);

      if (!active[0]?.enabled) {
        throw new BusinessRuleError(
          `Esta funcionalidade depende de "${dependency}", que nao esta ativa para a sua empresa.`,
        );
      }
    }
  }

  const existingRows = await db
    .select({ enabled: tenantFeatures.enabled })
    .from(tenantFeatures)
    .where(
      and(
        eq(tenantFeatures.tenantId, context.tenantId),
        eq(tenantFeatures.featureKey, input.featureKey),
      ),
    )
    .limit(1);

  const previous = existingRows[0]?.enabled ?? false;
  if (previous === input.enabled) return; // nada mudou, nada a auditar

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx
      .insert(tenantFeatures)
      .values({
        tenantId: context.tenantId,
        featureKey: input.featureKey,
        enabled: input.enabled,
        enabledAt: input.enabled ? now : existingRows[0] ? undefined : null,
        disabledAt: input.enabled ? null : now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          enabled: input.enabled,
          ...(input.enabled ? { enabledAt: now, disabledAt: null } : { disabledAt: now }),
          updatedAt: now,
        },
      });

    await recordAudit(
      {
        action: input.enabled ? AUDIT_ACTIONS.FEATURE_ENABLED : AUDIT_ACTIONS.FEATURE_DISABLED,
        entityType: 'tenant_feature',
        entityId: input.featureKey,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { featureKey: input.featureKey, enabled: previous },
        after: { featureKey: input.featureKey, enabled: input.enabled },
        metadata: { featureType: feature.type },
      },
      tx,
    );

    await emit({
      type: input.enabled ? EVENT_TYPES.FEATURE_ENABLED : EVENT_TYPES.FEATURE_DISABLED,
      tenantId: context.tenantId,
      payload: { featureKey: input.featureKey, featureType: feature.type, by: context.userId },
    });
  });
}

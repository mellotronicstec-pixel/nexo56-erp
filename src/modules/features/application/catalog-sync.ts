import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { newId } from '@/core/ids/id';
import { PERMISSION_CATALOG } from '@/modules/access-control/domain/permissions';
import { permissions } from '@/modules/access-control/infrastructure/schema';
import { FEATURE_CATALOG, findDependencyCycle } from '@/modules/features/domain/catalog';
import {
  featureDependencies,
  features,
  planEntitlements,
  plans,
} from '@/modules/features/infrastructure/schema';

/**
 * Sincroniza o catalogo declarado em codigo com o banco.
 *
 * Idempotente: rodar N vezes produz o mesmo estado. Nunca APAGA feature do
 * catalogo — retirar uma funcionalidade e um ato deliberado com migration
 * propria, porque tenants podem ter dados associados (Prompt 00, item 17).
 */

export const INTERNAL_PLAN_KEY = 'internal';

export interface SyncResult {
  featuresUpserted: number;
  permissionsUpserted: number;
  internalPlanId: string;
}

export async function syncCatalog(): Promise<SyncResult> {
  const cycle = findDependencyCycle();
  if (cycle) {
    throw new Error(`Ciclo de dependencia entre features detectado: ${cycle.join(' -> ')}`);
  }

  const db = getDb();
  const now = new Date();

  for (const feature of FEATURE_CATALOG) {
    await db
      .insert(features)
      .values({
        key: feature.key,
        name: feature.name,
        description: feature.description,
        type: feature.type,
        status: 'available',
        createdAt: now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          name: feature.name,
          description: feature.description,
          type: feature.type,
          updatedAt: now,
        },
      });
  }

  for (const feature of FEATURE_CATALOG) {
    for (const dependency of feature.dependsOn) {
      await db
        .insert(featureDependencies)
        .values({ featureKey: feature.key, dependsOnKey: dependency })
        .onDuplicateKeyUpdate({ set: { featureKey: feature.key } });
    }
  }

  for (const permission of PERMISSION_CATALOG) {
    await db
      .insert(permissions)
      .values({
        key: permission.key,
        name: permission.name,
        description: permission.description,
        featureKey: permission.featureKey,
        createdAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          name: permission.name,
          description: permission.description,
          featureKey: permission.featureKey,
        },
      });
  }

  const internalPlanId = await ensureInternalPlan();

  return {
    featuresUpserted: FEATURE_CATALOG.length,
    permissionsUpserted: PERMISSION_CATALOG.length,
    internalPlanId,
  };
}

/**
 * Plano interno de desenvolvimento/homologacao (Prompt 01, item 24).
 * NAO e plano comercial: nao ha billing, checkout nem assinatura nesta etapa.
 * Contempla todas as features do catalogo para permitir testar a fundacao.
 */
async function ensureInternalPlan(): Promise<string> {
  const db = getDb();
  const now = new Date();

  const existing = await db
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.key, INTERNAL_PLAN_KEY))
    .limit(1);
  const planId = existing[0]?.id ?? newId();

  if (!existing[0]) {
    await db.insert(plans).values({
      id: planId,
      key: INTERNAL_PLAN_KEY,
      name: 'Plano interno',
      description: 'Plano tecnico de desenvolvimento e homologacao. Nao comercializavel.',
      isInternal: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const feature of FEATURE_CATALOG) {
    await db
      .insert(planEntitlements)
      .values({ planId, featureKey: feature.key, createdAt: now })
      .onDuplicateKeyUpdate({ set: { planId } });
  }

  return planId;
}

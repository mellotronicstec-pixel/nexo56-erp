import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { newId } from '@/core/ids/id';
import { PERMISSION_CATALOG, SYSTEM_ROLES } from '@/modules/access-control/domain/permissions';
import {
  permissions,
  rolePermissions,
  roles,
} from '@/modules/access-control/infrastructure/schema';
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
  /** Quantos papeis de sistema foram realinhados ao catalogo. */
  systemRolesUpdated: number;
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
  const systemRolesUpdated = await syncSystemRolePermissions();

  return {
    featuresUpserted: FEATURE_CATALOG.length,
    permissionsUpserted: PERMISSION_CATALOG.length,
    internalPlanId,
    systemRolesUpdated,
  };
}

/**
 * Mantem os papeis de SISTEMA alinhados ao catalogo (Prompt 03, item 79).
 *
 * O perfil Administrador significa "acesso administrativo completo". Quando um
 * prompt acrescenta permissoes ao catalogo, os Administradores ja existentes
 * precisam passar a te-las — caso contrario, um tenant criado antes da
 * atualizacao ficaria sem conseguir usar as capacidades novas, e o produto
 * teria dois tipos de administrador dependendo da data de cadastro.
 *
 * Descoberto por teste de ponta a ponta: apos o upgrade, o administrador
 * existente nao conseguia gerenciar acesso, porque `users.manage_access` havia
 * nascido depois do seu perfil.
 *
 * Idempotente: so insere o que falta, nunca remove permissao concedida a mao.
 */
async function syncSystemRolePermissions(): Promise<number> {
  const db = getDb();
  const now = new Date();

  const systemRoles = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.isSystem, true), eq(roles.key, SYSTEM_ROLES.ADMIN)));

  const allPermissions = PERMISSION_CATALOG.map((permission) => permission.key);

  for (const role of systemRoles) {
    for (const permissionKey of allPermissions) {
      await db
        .insert(rolePermissions)
        .values({ roleId: role.id, permissionKey, createdAt: now })
        .onDuplicateKeyUpdate({ set: { roleId: role.id } });
    }
  }

  return systemRoles.length;
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

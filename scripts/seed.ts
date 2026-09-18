/**
 * Seed de DESENVOLVIMENTO (Prompt 01, item 48).
 *
 * Protecoes:
 *  - recusa rodar com NODE_ENV=production;
 *  - exige ALLOW_SEED=true;
 *  - nao apaga nem reseta banco;
 *  - nao cria senha conhecida: a senha e aleatoria e exibida uma vez;
 *  - dados claramente ficticios (Prompt 01, item 83).
 */
import './_bootstrap-env';
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { runWithContext } from '../src/core/context/request-context';
import { closeDb, getDb } from '../src/core/db/client';
import { syncCatalog } from '../src/modules/features/application/catalog-sync';
import { FEATURES } from '../src/modules/features/domain/catalog';
import { tenantFeatures } from '../src/modules/features/infrastructure/schema';
import { provisionTenant } from '../src/modules/tenancy/application/provisioning';
import { tenants } from '../src/modules/tenancy/infrastructure/schema';

/**
 * Liga uma feature OPCIONAL no tenant de desenvolvimento.
 *
 * Idempotente e fora do `if (created)`: quando o Prompt 10 acrescentou
 * Estoque, o tenant de desenvolvimento ja existia — e uma ativacao que so
 * roda na criacao deixaria o modulo invisivel para quem ja tinha o banco.
 */
async function enableOptionalFeature(tenantId: string, featureKey: string): Promise<void> {
  const db = getDb();
  const now = new Date();

  const [existing] = await db
    .select({ featureKey: tenantFeatures.featureKey })
    .from(tenantFeatures)
    .where(and(eq(tenantFeatures.tenantId, tenantId), eq(tenantFeatures.featureKey, featureKey)))
    .limit(1);

  if (existing) {
    await db
      .update(tenantFeatures)
      .set({ enabled: true, enabledAt: now, disabledAt: null, updatedAt: now })
      .where(and(eq(tenantFeatures.tenantId, tenantId), eq(tenantFeatures.featureKey, featureKey)));
    return;
  }

  await db.insert(tenantFeatures).values({
    tenantId,
    featureKey,
    enabled: true,
    enabledAt: now,
    updatedAt: now,
  });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed nao roda em producao.');
  }
  if (process.env.ALLOW_SEED !== 'true') {
    throw new Error('Seed bloqueado. Defina ALLOW_SEED=true para executar em desenvolvimento.');
  }

  await runWithContext({ origin: 'cli' }, async () => {
    const catalog = await syncCatalog();
    const password = randomBytes(18).toString('base64url');

    const result = await provisionTenant({
      tenantName: 'Assistencia Exemplo (dados ficticios)',
      tenantSlug: 'exemplo-dev',
      timezone: 'America/Sao_Paulo',
      planId: catalog.internalPlanId,
      unitName: 'Unidade Centro (ficticia)',
      adminName: 'Administrador de Desenvolvimento',
      adminEmail: 'admin.dev@exemplo.invalid',
      adminPassword: password,
    });

    const [devTenant] = await getDb()
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, 'exemplo-dev'))
      .limit(1);

    if (devTenant) {
      /**
       * Os OPCIONAIS ligados no tenant de desenvolvimento, em ordem de
       * dependencia. Compras depende de Estoque; o Financeiro depende de
       * Clientes, que e CORE e ja esta ligado.
       *
       * A lista e reaplicada a cada seed, fora do `if (created)`: quando um
       * prompt novo acrescenta um modulo, o tenant de desenvolvimento ja
       * existe — e uma ativacao que so rodasse na criacao deixaria o modulo
       * invisivel para quem ja tinha o banco.
       */
      await enableOptionalFeature(devTenant.id, FEATURES.OPERATIONS_INVENTORY);
      await enableOptionalFeature(devTenant.id, FEATURES.OPERATIONS_PURCHASING);
      await enableOptionalFeature(devTenant.id, FEATURES.FINANCE_CORE);
      await enableOptionalFeature(devTenant.id, FEATURES.OPERATIONS_WARRANTIES);
      console.log(
        '[seed] modulos Estoque, Compras, Financeiro e Garantias habilitados no tenant de desenvolvimento.',
      );
    }

    if (!result.created) {
      console.log('[seed] tenant de desenvolvimento ja existe. Catalogo sincronizado.');
      return;
    }

    console.log('[seed] tenant ficticio criado: exemplo-dev');
    console.log('[seed] login: admin.dev@exemplo.invalid');
    console.log(`[seed] senha (exibida uma unica vez): ${password}`);
  });
}

main()
  .catch((error: unknown) => {
    console.error('[seed] FALHOU:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());

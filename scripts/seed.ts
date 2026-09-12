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
import { runWithContext } from '../src/core/context/request-context';
import { closeDb } from '../src/core/db/client';
import { syncCatalog } from '../src/modules/features/application/catalog-sync';
import { provisionTenant } from '../src/modules/tenancy/application/provisioning';

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

    if (!result.created) {
      console.log('[seed] tenant de desenvolvimento ja existe. Nada alterado.');
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

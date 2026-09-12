/**
 * Bootstrap do primeiro tenant e do primeiro administrador (Prompt 01, item 16).
 *
 * Uso:
 *   BOOTSTRAP_TENANT_NAME="Minha Assistencia" \
 *   BOOTSTRAP_TENANT_SLUG="minha-assistencia" \
 *   BOOTSTRAP_ADMIN_NAME="Nome do Administrador" \
 *   BOOTSTRAP_ADMIN_EMAIL="admin@empresa.com.br" \
 *   npm run bootstrap
 *
 * Garantias:
 *  - NAO existe credencial fixa: sem BOOTSTRAP_ADMIN_PASSWORD, uma senha
 *    aleatoria de 24 bytes e gerada e exibida UMA UNICA VEZ no terminal;
 *  - a senha nunca vai para log estruturado, auditoria, evento nem repositorio;
 *  - idempotente: se o tenant ja existe, nada e recriado nem sobrescrito;
 *  - funciona em ambiente novo (roda a sincronizacao de catalogo antes).
 */
import './_bootstrap-env';
import { randomBytes } from 'node:crypto';
import { runWithContext } from '../src/core/context/request-context';
import { closeDb } from '../src/core/db/client';
import { syncCatalog } from '../src/modules/features/application/catalog-sync';
import { provisionTenant } from '../src/modules/tenancy/application/provisioning';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Variavel ${name} e obrigatoria para o bootstrap. Veja o README (secao Bootstrap).`,
    );
  }
  return value;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

async function main(): Promise<void> {
  const tenantName = required('BOOTSTRAP_TENANT_NAME');
  const tenantSlug = slugify(process.env.BOOTSTRAP_TENANT_SLUG ?? tenantName);
  const adminName = required('BOOTSTRAP_ADMIN_NAME');
  const adminEmail = required('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const timezone = process.env.BOOTSTRAP_TENANT_TIMEZONE ?? 'America/Sao_Paulo';
  const unitName = process.env.BOOTSTRAP_UNIT_NAME ?? 'Unidade principal';

  const providedPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const generatedPassword = providedPassword ? null : randomBytes(18).toString('base64url');
  const adminPassword = providedPassword ?? (generatedPassword as string);

  if (adminPassword.length < 12) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD precisa de ao menos 12 caracteres.');
  }

  await runWithContext({ origin: 'cli' }, async () => {
    console.log('[bootstrap] sincronizando catalogo de funcionalidades e permissoes...');
    const catalog = await syncCatalog();
    console.log(
      `[bootstrap] catalogo: ${catalog.featuresUpserted} features, ${catalog.permissionsUpserted} permissoes.`,
    );

    const result = await provisionTenant({
      tenantName,
      tenantSlug,
      timezone,
      planId: catalog.internalPlanId,
      unitName,
      adminName,
      adminEmail,
      adminPassword,
    });

    if (!result.created) {
      console.log(`[bootstrap] a empresa "${tenantSlug}" ja existe. Nada foi alterado.`);
      return;
    }

    console.log('');
    console.log('[bootstrap] empresa e administrador criados com sucesso.');
    console.log(`  empresa .......: ${tenantName} (${tenantSlug})`);
    console.log(`  unidade .......: ${unitName}`);
    console.log(`  timezone ......: ${timezone}`);
    console.log(`  administrador .: ${adminEmail}`);

    if (generatedPassword) {
      console.log('');
      console.log('  ┌──────────────────────────────────────────────────────────────┐');
      console.log('  │ SENHA INICIAL (exibida apenas agora, nao fica gravada)       │');
      console.log('  └──────────────────────────────────────────────────────────────┘');
      console.log(`  ${generatedPassword}`);
      console.log('');
      console.log('  Guarde em gerenciador de senhas e troque apos o primeiro acesso.');
    }
  });
}

main()
  .catch((error: unknown) => {
    console.error('[bootstrap] FALHOU:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());

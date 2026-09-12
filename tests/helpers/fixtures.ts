import { runWithContext } from '@/core/context/request-context';
import { syncCatalog } from '@/modules/features/application/catalog-sync';
import { provisionTenant } from '@/modules/tenancy/application/provisioning';
import { loadContextForSession } from '@/modules/auth/application/current-context';
import { createSession } from '@/modules/auth/application/session-service';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Fixtures de teste. Senhas sao geradas por teste e nunca reutilizadas entre
 * ambientes — nada aqui vale fora do banco de teste.
 */

export interface TenantFixture {
  tenantId: string;
  unitId: string;
  adminUserId: string;
  slug: string;
  email: string;
  password: string;
  context: TenantContext;
  sessionToken: string;
}

export async function seedCatalog(): Promise<string> {
  return runWithContext({ origin: 'test' }, async () => (await syncCatalog()).internalPlanId);
}

export async function createTenantFixture(
  slug: string,
  planId: string,
  options: { email?: string; password?: string } = {},
): Promise<TenantFixture> {
  const email = options.email ?? `admin@${slug}.invalid`;
  const password = options.password ?? `Senha-Teste-${slug}-123456`;

  return runWithContext({ origin: 'test' }, async () => {
    const provisioned = await provisionTenant({
      tenantName: `Empresa ${slug}`,
      tenantSlug: slug,
      timezone: 'America/Sao_Paulo',
      planId,
      unitName: `Unidade ${slug}`,
      adminName: `Admin ${slug}`,
      adminEmail: email,
      adminPassword: password,
    });

    const session = await createSession(provisioned.adminUserId, provisioned.tenantId);
    const context = await loadContextForSession({
      id: session.sessionId,
      userId: provisioned.adminUserId,
      tenantId: provisioned.tenantId,
    });

    if (!context) throw new Error('Fixture nao conseguiu montar o contexto do tenant.');

    return {
      tenantId: provisioned.tenantId,
      unitId: provisioned.unitId,
      adminUserId: provisioned.adminUserId,
      slug,
      email,
      password,
      context,
      sessionToken: session.token,
    };
  });
}

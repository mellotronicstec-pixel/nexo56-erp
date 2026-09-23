import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { enrichContext } from '@/core/context/request-context';
import { AuthenticationError } from '@/core/errors';
import { checkFeatureEnabledForTenant } from '@/modules/features/application/effective-access';
import { FEATURES } from '@/modules/features/domain/catalog';
import { customers } from '@/modules/customers/infrastructure/schema';
import { tenants } from '@/modules/tenancy/infrastructure/schema';
import { PORTAL_LOGIN_COOKIE, type PortalContext } from '@/modules/portal/domain/portal';
import { portalIdentities } from '@/modules/portal/infrastructure/schema';
import {
  findActivePortalSession,
  touchPortalSession,
  type ActivePortalSession,
} from './portal-session-service';

/**
 * Resolucao do contexto do Portal (espelha `current-context.ts`, item 27).
 *
 * ESTE E O UNICO CAMINHO pelo qual um `customerId`/`tenantId` entra numa
 * pagina ou action do Portal. Nao ha parametro de URL, campo de formulario
 * nem cabecalho que decida quem e o cliente — so o cookie
 * `nexo56_portal_session`, resolvido no banco.
 *
 * REAVALIA A CADA REQUISICAO (item 122): status do customer, status da
 * identidade e a feature `customer.portal` sao lidos de novo em toda
 * chamada, nunca guardados na sessao. Desligar o Portal no meio de uma
 * sessao ativa derruba o proximo acesso — nao espera o token expirar.
 */

/**
 * Monta o contexto a partir de uma sessao JA validada — separado de
 * `getPortalContext` para que a regra de montagem (status do customer, do
 * tenant, da identidade e a feature) seja testavel sem depender de cookies
 * (mesma separacao de `current-context.ts`, item 27).
 */
export async function loadPortalContextForSession(
  session: ActivePortalSession,
): Promise<PortalContext | null> {
  const db = getDb();
  const [row] = await db
    .select({
      customerId: customers.id,
      customerStatus: customers.status,
      tenantId: tenants.id,
      tenantStatus: tenants.status,
      planId: tenants.planId,
      identityStatus: portalIdentities.status,
    })
    .from(customers)
    .innerJoin(tenants, eq(tenants.id, customers.tenantId))
    .innerJoin(portalIdentities, eq(portalIdentities.id, session.portalIdentityId))
    .where(eq(customers.id, session.customerId))
    .limit(1);

  if (!row) return null;
  if (row.customerStatus !== 'active' || row.tenantStatus !== 'active') return null;
  if (row.identityStatus === 'blocked') return null;

  const access = await checkFeatureEnabledForTenant(
    { tenantId: row.tenantId, planId: row.planId },
    FEATURES.CUSTOMER_PORTAL,
  );
  if (!access.allowed) return null;

  await touchPortalSession(session.id);

  const context: PortalContext = {
    tenantId: session.tenantId,
    customerId: session.customerId,
    portalIdentityId: session.portalIdentityId,
    sessionId: session.id,
    sessionExpiresAt: session.expiresAt,
  };

  /** Mesmo correlacionador do painel interno, para log/tracing conviverem. */
  enrichContext({ tenantId: context.tenantId, unitId: undefined });

  return context;
}

export async function getPortalContext(): Promise<PortalContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PORTAL_LOGIN_COOKIE)?.value;
  if (!token) return null;

  const session = await findActivePortalSession(token);
  if (!session) return null;

  return loadPortalContextForSession(session);
}

export async function requirePortalContext(): Promise<PortalContext> {
  const context = await getPortalContext();
  if (!context) throw new AuthenticationError('Sessao do Portal expirada ou inexistente.');
  return context;
}

/** Variante para PAGINAS: sem sessao valida, encaminha para a tela de entrada. */
export async function requirePortalContextForPage(): Promise<PortalContext> {
  const context = await getPortalContext();
  if (!context) redirect('/portal/entrar');
  return context;
}

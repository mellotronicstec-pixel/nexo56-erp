import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { checkFeatureEnabledForTenant } from '@/modules/features/application/effective-access';
import { FEATURES } from '@/modules/features/domain/catalog';
import { tenants } from '@/modules/tenancy/infrastructure/schema';
import type { PortalContext } from '@/modules/portal/domain/portal';
import {
  readCertificatePdfForWarranty,
  type CertificatePdfDownload,
} from '@/modules/warranties/application/warranty-certificate-pdf-service';
import { warranties } from '@/modules/warranties/infrastructure/schema';
import { assertOwned } from './portal-ownership';

/**
 * DOWNLOAD DO CERTIFICADO PELO PORTAL (Prompt 17, item 49 e 50).
 *
 * REUTILIZA O SERVICO OFICIAL — nunca um segundo renderizador. O nucleo
 * compartilhado (`readCertificatePdfForWarranty`) e o MESMO que o painel
 * interno usa; o que muda aqui e so COMO se prova o direito de pedir o PDF.
 *
 * `warranties.view` (permissao interna) NAO autoriza cliente externo (item
 * 50): esta funcao nunca chama `authorize()` nem monta `TenantContext`. A
 * prova e OWNERSHIP — o registro pertence a ESTE `customerId`, neste
 * `tenantId` — verificada aqui, antes de delegar ao nucleo.
 */
export async function readPortalWarrantyCertificate(
  context: PortalContext,
  warrantyId: string,
): Promise<CertificatePdfDownload> {
  const [tenant] = await getDb()
    .select({ planId: tenants.planId })
    .from(tenants)
    .where(eq(tenants.id, context.tenantId))
    .limit(1);

  const featureOn = tenant
    ? (
        await checkFeatureEnabledForTenant(
          { tenantId: context.tenantId, planId: tenant.planId },
          FEATURES.OPERATIONS_WARRANTIES,
        )
      ).allowed
    : false;

  const [owned] = await getDb()
    .select({ id: warranties.id })
    .from(warranties)
    .where(
      and(
        eq(warranties.id, warrantyId),
        eq(warranties.tenantId, context.tenantId),
        eq(warranties.customerId, context.customerId),
      ),
    )
    .limit(1);

  /** Uma so checagem final: sem o modulo ligado, o registro "nao existe". */
  assertOwned(featureOn ? owned : null);

  return readCertificatePdfForWarranty(context.tenantId, warrantyId, null);
}

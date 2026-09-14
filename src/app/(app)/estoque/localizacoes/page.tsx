import type { Metadata } from 'next';
import { Alert, PageHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listLocations } from '@/modules/inventory/application/inventory-queries';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { createLocationAction, updateLocationAction } from '../actions';
import { LocationManager } from './location-manager';

export const metadata: Metadata = { title: 'Localizacoes de estoque' };

/**
 * Localizacoes da unidade ativa (Prompt 10, itens 8 a 10).
 *
 * A pagina e da UNIDADE, e nao da empresa: cada loja organiza o proprio
 * espaco, e a prateleira "A1" de uma nao e a da outra.
 */
export default async function StockLocationsPage() {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_INVENTORY,
    PERMISSIONS.INVENTORY_VIEW,
  );

  const activeUnitId = context.activeUnitId;
  const locations = activeUnitId ? await listLocations(context, activeUnitId, true) : [];
  const canManage = hasPermission(context, PERMISSIONS.INVENTORY_LOCATIONS_MANAGE);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Localizacoes de estoque"
        description="Onde a peca fica dentro desta unidade. Localizacao nao e unidade."
        breadcrumbs={[{ label: 'Estoque', href: '/estoque' }, { label: 'Localizacoes' }]}
      />

      {!activeUnitId ? (
        <Alert tone="warning">
          Escolha uma unidade para ver e cadastrar localizacoes. Elas pertencem a unidade, nao a
          empresa.
        </Alert>
      ) : (
        <LocationManager
          unitId={activeUnitId}
          unitName={context.tenantName}
          locations={locations}
          canManage={canManage}
          createAction={createLocationAction}
          updateAction={updateLocationAction}
        />
      )}
    </div>
  );
}

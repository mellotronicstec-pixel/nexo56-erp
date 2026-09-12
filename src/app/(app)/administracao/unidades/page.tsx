import type { Metadata } from 'next';
import { Badge, Card, CardBody, CardHeader, EmptyState } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listUnits } from '@/modules/tenancy/application/tenancy-queries';

export const metadata: Metadata = { title: 'Unidades' };

/**
 * Esta pagina depende da feature OPCIONAL `platform.multi_unit`.
 * Se o plano nao contemplar ou a empresa desativar, `requireAccess` nega aqui
 * no servidor — mesmo que alguem chegue pela URL direta.
 */
export default async function UnitsPage() {
  const { context } = await requireAccessForPage(
    FEATURES.PLATFORM_MULTI_UNIT,
    PERMISSIONS.UNITS_VIEW,
  );
  const units = await listUnits(context);

  return (
    <div className="mx-auto max-w-5xl">
      <Card>
        <CardHeader title="Unidades" description={`${units.length} unidade(s) nesta empresa`} />
        {units.length === 0 ? (
          <EmptyState title="Nenhuma unidade" />
        ) : (
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[480px] text-ui">
              <thead className="border-b border-ink-200 bg-ink-50 text-left">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium text-ink-600">
                    Nome
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium text-ink-600">
                    Fuso horario
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium text-ink-600">
                    Situacao
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {units.map((unit) => (
                  <tr key={unit.id}>
                    <td className="px-5 py-3 font-medium text-ink-900">{unit.name}</td>
                    <td className="px-5 py-3 text-ink-600">
                      {unit.timezone ?? `${context.tenantTimezone} (herdado)`}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={unit.status === 'active' ? 'success' : 'neutral'}>
                        {unit.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        )}
      </Card>
    </div>
  );
}

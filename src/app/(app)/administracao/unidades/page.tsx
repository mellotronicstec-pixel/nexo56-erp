import type { Metadata } from 'next';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { IconBuilding } from '@/design-system/icons';
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
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Unidades"
        description="Filiais e pontos de atendimento desta empresa."
        breadcrumbs={[{ label: 'Administracao' }, { label: 'Unidades' }]}
        metadata={<span>{units.length} unidade(s)</span>}
      />

      <Card>
        <CardHeader title="Unidades" description={`${units.length} unidade(s) nesta empresa`} />
        {units.length === 0 ? (
          <EmptyState
            title="Nenhuma unidade"
            description="Esta empresa ainda nao possui unidades cadastradas."
            icon={<IconBuilding />}
          />
        ) : (
          <CardBody className="p-0">
            <div className="hidden md:block">
              <Table caption="Unidades desta empresa">
                <THead>
                  <TR>
                    <TH>Nome</TH>
                    <TH>Fuso horario</TH>
                    <TH>Situacao</TH>
                  </TR>
                </THead>
                <TBody>
                  {units.map((unit) => (
                    <TR key={unit.id}>
                      <TD className="font-medium text-ink-900">{unit.name}</TD>
                      <TD className="text-ink-600">
                        {unit.timezone ?? `${context.tenantTimezone} (herdado)`}
                      </TD>
                      <TD>
                        <Badge tone={unit.status === 'active' ? 'success' : 'neutral'}>
                          {unit.status === 'active' ? 'ativa' : 'inativa'}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <CardList label="Unidades desta empresa" className="md:hidden">
              {units.map((unit) => (
                <CardListItem key={unit.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">{unit.name}</p>
                      <p className="truncate text-small text-ink-500">
                        {unit.timezone ?? `${context.tenantTimezone} (herdado)`}
                      </p>
                    </div>
                    <Badge tone={unit.status === 'active' ? 'success' : 'neutral'}>
                      {unit.status === 'active' ? 'ativa' : 'inativa'}
                    </Badge>
                  </div>
                </CardListItem>
              ))}
            </CardList>
          </CardBody>
        )}
      </Card>
    </div>
  );
}

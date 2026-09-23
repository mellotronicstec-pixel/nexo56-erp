import type { Metadata } from 'next';
import { Badge, CardList, CardListItem, EmptyState, PageHeader, linkButtonClass } from '@/design-system/components';
import { requirePortalContextForPage } from '@/modules/portal/application/portal-context';
import { listMyWarranties } from '@/modules/portal/application/portal-query-service';
import { TEMPORAL_CLASS_LABEL, type TemporalClass } from '@/modules/warranties/domain/warranty';
import { PortalChrome } from '../_components/portal-chrome';
import { dataCivil } from '../format';

export const metadata: Metadata = { title: 'Garantias' };

const TEMPORAL_TONE: Record<TemporalClass, 'success' | 'neutral' | 'warning'> = {
  valid: 'success',
  future: 'warning',
  expired: 'neutral',
};

export default async function PortalWarrantiesPage() {
  const context = await requirePortalContextForPage();
  const garantias = await listMyWarranties(context);

  return (
    <PortalChrome>
      <PageHeader title="Suas garantias" description="Cobertura, vigencia e certificado de cada garantia." />

      {garantias.length === 0 ? (
        <EmptyState
          title="Nenhuma garantia ativa"
          description="Garantias emitidas para os seus atendimentos aparecem aqui."
        />
      ) : (
        <CardList label="Suas garantias">
          {garantias.map((warranty) => (
            <CardListItem key={warranty.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">Garantia {warranty.number}</p>
                  <p className="text-small text-ink-500">
                    {warranty.typeLabel} · {warranty.durationLabel}
                  </p>
                  <p className="text-small text-ink-500">
                    {dataCivil(warranty.startsOn)} a {dataCivil(warranty.endsOn)}
                  </p>
                </div>
                <Badge tone={TEMPORAL_TONE[warranty.temporal]}>
                  {TEMPORAL_CLASS_LABEL[warranty.temporal]}
                </Badge>
              </div>
              <a
                href={`/api/portal/garantias/${warranty.id}/certificado/pdf`}
                className={`${linkButtonClass('secondary', 'sm', 'touch-target')} mt-3`}
              >
                Baixar certificado em PDF
              </a>
            </CardListItem>
          ))}
        </CardList>
      )}
    </PortalChrome>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/design-system/components';
import { isAppError } from '@/core/errors';
import { requirePortalContextForPage } from '@/modules/portal/application/portal-context';
import { getMyServiceOrder } from '@/modules/portal/application/portal-query-service';
import { PortalChrome } from '../../_components/portal-chrome';
import { dataHora } from '../../format';

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = { title: 'Ordem de servico' };

export default async function PortalServiceOrderPage({ params }: PageProps) {
  const context = await requirePortalContextForPage();
  const { id } = await params;

  const os = await getMyServiceOrder(context, id).catch((error: unknown) => {
    /** OS de outro cliente e OS inexistente terminam no mesmo lugar (item 46). */
    if (isAppError(error)) return null;
    throw error;
  });
  if (!os) notFound();

  return (
    <PortalChrome>
      <PageHeader
        title={`OS ${os.number}`}
        description={os.equipmentTitle}
        breadcrumbs={[{ label: 'Ordens de servico', href: '/portal' }, { label: `OS ${os.number}` }]}
        metadata={<Badge tone={os.statusTone}>{os.statusLabel}</Badge>}
      />

      <div className="space-y-4">
        <Card>
          <CardHeader title="O que voce relatou" headingLevel={2} />
          <CardBody>
            <p className="whitespace-pre-line text-ui text-ink-700">{os.customerReport}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Historico" headingLevel={2} />
          <CardBody>
            {os.timeline.length === 0 ? (
              <p className="text-ui text-ink-500">Nenhuma atualizacao registrada ainda.</p>
            ) : (
              <ol className="space-y-3">
                {os.timeline.map((entry, index) => (
                  <li key={index} className="border-l-2 border-ink-200 pl-3">
                    <p className="text-ui text-ink-900">{entry.summary}</p>
                    <p className="text-small text-ink-500">{dataHora(entry.occurredAt)}</p>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>
    </PortalChrome>
  );
}

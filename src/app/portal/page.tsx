import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, CardList, CardListItem, EmptyState, PageHeader } from '@/design-system/components';
import { requirePortalContextForPage } from '@/modules/portal/application/portal-context';
import { listMyServiceOrders } from '@/modules/portal/application/portal-query-service';
import { PortalChrome } from './_components/portal-chrome';
import { dataHora } from './format';

export const metadata: Metadata = { title: 'Ordens de servico' };

export default async function PortalHomePage() {
  const context = await requirePortalContextForPage();
  const ordens = await listMyServiceOrders(context);

  return (
    <PortalChrome>
      <PageHeader title="Suas ordens de servico" description="Acompanhe o andamento dos seus aparelhos." />

      {ordens.length === 0 ? (
        <EmptyState
          title="Nenhuma ordem de servico ainda"
          description="Quando voce deixar um aparelho para reparo, ele aparece aqui."
        />
      ) : (
        <CardList label="Suas ordens de servico">
          {ordens.map((os) => (
            <CardListItem key={os.id}>
              <Link href={`/portal/ordens/${os.id}`} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">OS {os.number}</p>
                  <p className="truncate text-small text-ink-500">{os.equipmentTitle}</p>
                  <p className="text-small text-ink-500">Aberta em {dataHora(os.openedAt)}</p>
                </div>
                <Badge tone={os.statusTone}>{os.statusLabel}</Badge>
              </Link>
            </CardListItem>
          ))}
        </CardList>
      )}
    </PortalChrome>
  );
}

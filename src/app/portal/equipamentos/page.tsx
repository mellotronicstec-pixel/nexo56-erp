import type { Metadata } from 'next';
import { CardList, CardListItem, EmptyState, PageHeader } from '@/design-system/components';
import { requirePortalContextForPage } from '@/modules/portal/application/portal-context';
import { listMyEquipment } from '@/modules/portal/application/portal-query-service';
import { PortalChrome } from '../_components/portal-chrome';

export const metadata: Metadata = { title: 'Equipamentos' };

export default async function PortalEquipmentPage() {
  const context = await requirePortalContextForPage();
  const equipamentos = await listMyEquipment(context);

  return (
    <PortalChrome>
      <PageHeader title="Seus equipamentos" description="Os aparelhos cadastrados no seu nome." />

      {equipamentos.length === 0 ? (
        <EmptyState
          title="Nenhum equipamento cadastrado"
          description="Aparelhos que voce trouxer para atendimento aparecem aqui."
        />
      ) : (
        <CardList label="Seus equipamentos">
          {equipamentos.map((item) => (
            <CardListItem key={item.id}>
              <p className="font-medium text-ink-900">{item.title}</p>
              <p className="text-small text-ink-500">
                {item.kind}
                {item.maskedSerial ? ` · Serie ${item.maskedSerial}` : ''}
              </p>
            </CardListItem>
          ))}
        </CardList>
      )}
    </PortalChrome>
  );
}

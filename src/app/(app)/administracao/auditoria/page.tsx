import type { Metadata } from 'next';
import { Badge, Card, CardBody, CardHeader, EmptyState } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { listRecentAudit } from '@/modules/audit/application/audit-queries';
import { FEATURES } from '@/modules/features/domain/catalog';

export const metadata: Metadata = { title: 'Auditoria' };

export default async function AuditPage() {
  const { context } = await requireAccessForPage(FEATURES.CORE_AUDIT, PERMISSIONS.AUDIT_VIEW);
  const entries = await listRecentAudit(context);

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: context.tenantTimezone,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <Card>
        <CardHeader
          title="Trilha de auditoria"
          description={`Ultimas ${entries.length} acoes registradas — horarios em ${context.tenantTimezone}`}
        />
        {entries.length === 0 ? (
          <EmptyState
            title="Nenhum registro"
            description="Nenhuma acao auditada nesta empresa ainda."
          />
        ) : (
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-ui">
              <thead className="border-b border-ink-200 bg-ink-50 text-left">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium text-ink-600">
                    Quando
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium text-ink-600">
                    Acao
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium text-ink-600">
                    Entidade
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium text-ink-600">
                    Origem
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-5 py-3 whitespace-nowrap text-ink-600">
                      {formatter.format(entry.createdAt)}
                    </td>
                    <td className="px-5 py-3 font-mono text-small text-ink-900">{entry.action}</td>
                    <td className="px-5 py-3 text-ink-600">{entry.entityType}</td>
                    <td className="px-5 py-3">
                      <Badge>{entry.origin}</Badge>
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

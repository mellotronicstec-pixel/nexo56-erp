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
import { IconHistory } from '@/design-system/icons';
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
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Auditoria"
        description="Quem fez o que, quando e em qual contexto. A trilha e somente-insercao."
        breadcrumbs={[{ label: 'Administracao' }, { label: 'Auditoria' }]}
        metadata={<span>Horarios em {context.tenantTimezone}</span>}
      />

      <Card>
        <CardHeader
          title="Trilha de auditoria"
          description={`Ultimas ${entries.length} acoes registradas`}
        />
        {entries.length === 0 ? (
          <EmptyState
            title="Nenhum registro"
            description="Nenhuma acao auditada nesta empresa ainda."
            icon={<IconHistory />}
          />
        ) : (
          <CardBody className="p-0">
            <div className="hidden md:block">
              <Table caption="Acoes registradas nesta empresa">
                <THead>
                  <TR>
                    <TH>Quando</TH>
                    <TH>Acao</TH>
                    <TH>Entidade</TH>
                    <TH>Origem</TH>
                  </TR>
                </THead>
                <TBody>
                  {entries.map((entry) => (
                    <TR key={entry.id}>
                      <TD className="whitespace-nowrap text-ink-600">
                        {formatter.format(entry.createdAt)}
                      </TD>
                      <TD className="font-mono text-small text-ink-900">{entry.action}</TD>
                      <TD className="text-ink-600">{entry.entityType}</TD>
                      <TD>
                        <Badge>{entry.origin}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <CardList label="Acoes registradas nesta empresa" className="md:hidden">
              {entries.map((entry) => (
                <CardListItem key={entry.id}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-mono text-small break-words text-ink-900">
                      {entry.action}
                    </p>
                    <Badge>{entry.origin}</Badge>
                  </div>
                  <p className="mt-1 text-small text-ink-500">
                    {formatter.format(entry.createdAt)} · {entry.entityType}
                  </p>
                </CardListItem>
              ))}
            </CardList>
          </CardBody>
        )}
      </Card>
    </div>
  );
}

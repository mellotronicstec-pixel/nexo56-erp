import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  Badge,
  Card,
  CardBody,
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
import { NotFoundError } from '@/core/errors';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { getRule, listExecutions } from '@/modules/automations/application/rule-service';

export const metadata: Metadata = { title: 'Execucoes da automacao' };

function statusBadge(status: string) {
  if (status === 'succeeded') return <Badge tone="success">Sucesso</Badge>;
  if (status === 'failed') return <Badge tone="danger">Falha</Badge>;
  if (status === 'skipped') return <Badge tone="neutral">Condicao nao satisfeita</Badge>;
  return <Badge tone="warning">Em andamento</Badge>;
}

export default async function AutomationExecutionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { context } = await requireAccessForPage(
    FEATURES.AUTOMATION_CORE,
    PERMISSIONS.AUTOMATIONS_VIEW,
  );

  let rule;
  try {
    rule = await getRule(context, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const executions = await listExecutions(context, id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={`Execucoes: ${rule.name}`}
        breadcrumbs={[
          { label: 'Configuracoes' },
          { label: 'Automacoes', href: '/configuracoes/automacoes' },
          { label: rule.name, href: `/configuracoes/automacoes/${id}` },
          { label: 'Execucoes' },
        ]}
      />

      <Card>
        {executions.length === 0 ? (
          <CardBody>
            <EmptyState title="Esta automacao ainda nao possui execucoes." />
          </CardBody>
        ) : (
          <CardBody className="p-0">
            <div className="hidden md:block">
              <Table caption="Historico de execucoes">
                <THead>
                  <TR>
                    <TH>Data/hora</TH>
                    <TH>Gatilho</TH>
                    <TH>Situacao</TH>
                    <TH>Versao</TH>
                    <TH>Detalhe</TH>
                  </TR>
                </THead>
                <TBody>
                  {executions.map((execution) => (
                    <TR key={execution.id}>
                      <TD>
                        {execution.createdAt.toLocaleString('pt-BR', {
                          timeZone: context.tenantTimezone,
                        })}
                      </TD>
                      <TD>{execution.triggerKind === 'schedule' ? 'Agendamento' : 'Evento'}</TD>
                      <TD>{statusBadge(execution.status)}</TD>
                      <TD>
                        {execution.ruleVersionNumber ? `v${execution.ruleVersionNumber}` : '—'}
                      </TD>
                      <TD>{execution.errorSummary ?? '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <CardList label="Historico de execucoes" className="md:hidden">
              {executions.map((execution) => (
                <CardListItem key={execution.id}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-small text-ink-700">
                      {execution.createdAt.toLocaleString('pt-BR', {
                        timeZone: context.tenantTimezone,
                      })}
                    </p>
                    {statusBadge(execution.status)}
                  </div>
                  {execution.errorSummary ? (
                    <p className="mt-1 text-small text-danger-700">{execution.errorSummary}</p>
                  ) : null}
                </CardListItem>
              ))}
            </CardList>
          </CardBody>
        )}
      </Card>
    </div>
  );
}

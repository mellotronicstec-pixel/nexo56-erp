import type { Metadata } from 'next';
import Link from 'next/link';
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
  linkButtonClass,
} from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listRules } from '@/modules/automations/application/rule-service';
import { formatCivilDateBR, todayIn } from '@/core/time/civil-date';

export const metadata: Metadata = { title: 'Automacoes' };

function statusBadge(rule: { enabled: boolean; archived: boolean }) {
  if (rule.archived) return <Badge tone="neutral">Arquivada</Badge>;
  return rule.enabled ? (
    <Badge tone="success">Habilitada</Badge>
  ) : (
    <Badge tone="neutral">Desabilitada</Badge>
  );
}

export default async function AutomationsPage() {
  const { context } = await requireAccessForPage(
    FEATURES.AUTOMATION_CORE,
    PERMISSIONS.AUTOMATIONS_VIEW,
  );
  const rules = await listRules(context);
  const canManage =
    context.tenantPermissions.has(PERMISSIONS.AUTOMATIONS_MANAGE) ||
    [...context.unitPermissions.values()].some((set) => set.has(PERMISSIONS.AUTOMATIONS_MANAGE));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Automacoes"
        description="Regras que reagem a fatos do sistema ou a horarios e disparam acoes controladas."
        breadcrumbs={[{ label: 'Configuracoes' }, { label: 'Automacoes' }]}
        actions={
          canManage ? (
            <Link href="/configuracoes/automacoes/nova" className={linkButtonClass('primary')}>
              Nova automacao
            </Link>
          ) : undefined
        }
      />

      <Card>
        {rules.length === 0 ? (
          <CardBody>
            <EmptyState
              title="Nenhuma automacao configurada."
              description="Crie a primeira regra para comecar."
            />
          </CardBody>
        ) : (
          <CardBody className="p-0">
            <div className="hidden md:block">
              <Table caption="Regras de automacao">
                <THead>
                  <TR>
                    <TH>Nome</TH>
                    <TH>Situacao</TH>
                    <TH>Gatilho</TH>
                    <TH>Escopo</TH>
                    <TH>Versao</TH>
                    <TH>Atualizada em</TH>
                    <TH srOnly>Abrir</TH>
                  </TR>
                </THead>
                <TBody>
                  {rules.map((rule) => (
                    <TR key={rule.id}>
                      <TD>
                        <Link
                          href={`/configuracoes/automacoes/${rule.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {rule.name}
                        </Link>
                      </TD>
                      <TD>{statusBadge(rule)}</TD>
                      <TD>{rule.triggerLabel ?? '—'}</TD>
                      <TD>
                        {rule.scopeKind === 'TENANT_WIDE'
                          ? 'Toda a empresa'
                          : `${rule.unitIds.length} unidade(s)`}
                      </TD>
                      <TD>{rule.currentVersionNumber ? `v${rule.currentVersionNumber}` : '—'}</TD>
                      <TD>{formatCivilDateBR(todayIn(context.tenantTimezone, rule.updatedAt))}</TD>
                      <TD align="right">
                        <Link
                          href={`/configuracoes/automacoes/${rule.id}`}
                          className={linkButtonClass('ghost', 'sm')}
                        >
                          Abrir
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <CardList label="Regras de automacao" className="md:hidden">
              {rules.map((rule) => (
                <CardListItem key={rule.id}>
                  <Link href={`/configuracoes/automacoes/${rule.id}`} className="block space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-ink-900">{rule.name}</p>
                      {statusBadge(rule)}
                    </div>
                    <p className="text-small text-ink-500">{rule.triggerLabel ?? '—'}</p>
                  </Link>
                </CardListItem>
              ))}
            </CardList>
          </CardBody>
        )}
      </Card>
    </div>
  );
}

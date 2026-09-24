import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  linkButtonClass,
} from '@/design-system/components';
import { NotFoundError } from '@/core/errors';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { getRule } from '@/modules/automations/application/rule-service';
import { findAction } from '@/modules/automations/domain/action-catalog';
import { listUnits } from '@/modules/tenancy/application/tenancy-queries';
import { listTemplates } from '@/modules/communications/application/template-service';
import { EnableToggleForm, ArchiveRuleForm, RuleEditor } from '../automation-forms';
import { triggersForClient } from '../trigger-client-info';

export const metadata: Metadata = { title: 'Automacao' };

export default async function AutomationRuleDetailPage({
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

  const canManage =
    context.tenantPermissions.has(PERMISSIONS.AUTOMATIONS_MANAGE) ||
    (rule.scopeKind === 'UNIT_SET' &&
      rule.unitIds.some((u) =>
        context.unitPermissions.get(u)?.has(PERMISSIONS.AUTOMATIONS_MANAGE),
      ));

  const allUnits = await listUnits(context);
  const units = allUnits
    .filter((u) => context.authorizedUnitIds.includes(u.id))
    .map((u) => ({ id: u.id, name: u.name }));

  let templates: Array<{ id: string; name: string; channel: string }> = [];
  try {
    const rows = await listTemplates(context);
    templates = rows
      .filter((t) => t.status === 'active')
      .map((t) => ({ id: t.id, name: t.name, channel: t.channel }));
  } catch {
    templates = [];
  }

  const hasExternalEffect = (rule.definition?.actions ?? []).some(
    (a) => findAction(a.key)?.hasExternalEffect,
  );
  const canTenantWide = context.tenantPermissions.has(PERMISSIONS.AUTOMATIONS_MANAGE);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={rule.name}
        breadcrumbs={[
          { label: 'Configuracoes' },
          { label: 'Automacoes', href: '/configuracoes/automacoes' },
          { label: rule.name },
        ]}
        actions={
          <Link
            href={`/configuracoes/automacoes/${id}/execucoes`}
            className={linkButtonClass('secondary')}
          >
            Ver execucoes
          </Link>
        }
        metadata={
          <div className="flex flex-wrap gap-2">
            {rule.archived ? (
              <Badge tone="neutral">Arquivada</Badge>
            ) : rule.enabled ? (
              <Badge tone="success">Habilitada</Badge>
            ) : (
              <Badge tone="neutral">Desabilitada</Badge>
            )}
            <Badge tone="neutral">
              {rule.scopeKind === 'TENANT_WIDE'
                ? 'Toda a empresa'
                : `${rule.unitIds.length} unidade(s)`}
            </Badge>
            {rule.currentVersionNumber ? (
              <Badge tone="neutral">v{rule.currentVersionNumber}</Badge>
            ) : null}
          </div>
        }
      />

      {canManage && !rule.archived ? (
        <Card>
          <CardHeader title="Situacao" headingLevel={2} />
          <CardBody className="flex flex-wrap items-center gap-4">
            <EnableToggleForm
              ruleId={id}
              enabled={rule.enabled}
              hasExternalEffect={hasExternalEffect}
            />
            <ArchiveRuleForm ruleId={id} />
          </CardBody>
        </Card>
      ) : null}

      {canManage && !rule.archived && rule.definition ? (
        <RuleEditor
          mode="edit"
          ruleId={id}
          initialTriggerKey={rule.definition.triggerKey}
          initialTriggerConfig={rule.definition.triggerConfig as { timeOfDay?: string } | undefined}
          initialConditions={rule.definition.conditions.all}
          initialActions={
            rule.definition.actions as Array<{ key: string; config: Record<string, unknown> }>
          }
          units={units}
          triggers={triggersForClient()}
          templates={templates}
          canTenantWide={canTenantWide}
        />
      ) : null}
    </div>
  );
}

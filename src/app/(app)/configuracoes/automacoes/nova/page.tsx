import type { Metadata } from 'next';
import { Card, CardBody, PageHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listUnits } from '@/modules/tenancy/application/tenancy-queries';
import { listTemplates } from '@/modules/communications/application/template-service';
import { RuleEditor } from '../automation-forms';
import { triggersForClient } from '../trigger-client-info';

export const metadata: Metadata = { title: 'Nova automacao' };

export default async function NewAutomationRulePage() {
  const { context } = await requireAccessForPage(
    FEATURES.AUTOMATION_CORE,
    PERMISSIONS.AUTOMATIONS_MANAGE,
  );

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

  const canTenantWide = context.tenantPermissions.has(PERMISSIONS.AUTOMATIONS_MANAGE);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Nova automacao"
        breadcrumbs={[
          { label: 'Configuracoes' },
          { label: 'Automacoes', href: '/configuracoes/automacoes' },
          { label: 'Nova automacao' },
        ]}
      />
      <Card>
        <CardBody>
          <RuleEditor
            mode="create"
            units={units}
            triggers={triggersForClient()}
            templates={templates}
            canTenantWide={canTenantWide}
          />
        </CardBody>
      </Card>
    </div>
  );
}

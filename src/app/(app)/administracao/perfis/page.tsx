import type { Metadata } from 'next';
import { Badge, Card, CardBody, CardHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listRoles } from '@/modules/users/application/user-queries';

export const metadata: Metadata = { title: 'Perfis e permissoes' };

export default async function RolesPage() {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_ACCESS_CONTROL,
    PERMISSIONS.ROLES_VIEW,
  );
  const roles = await listRoles(context);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Card>
        <CardHeader
          title="Perfis de acesso"
          description={`${roles.length} perfil(is) nesta empresa`}
        />
        <CardBody className="space-y-3">
          {roles.map((role) => (
            <div
              key={role.id}
              className="flex items-start justify-between gap-4 rounded-md border border-ink-200 p-4"
            >
              <div className="min-w-0">
                <p className="font-medium text-ink-900">{role.name}</p>
                <p className="mt-0.5 text-small text-ink-500">{role.description}</p>
                <p className="mt-1 font-mono text-small text-ink-400">{role.key}</p>
              </div>
              {role.isSystem ? <Badge tone="brand">sistema</Badge> : null}
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Suas permissoes" description="Permissoes efetivas da sessao atual" />
        <CardBody>
          <ul className="flex flex-wrap gap-2">
            {[...context.permissions].sort().map((permission) => (
              <li key={permission}>
                <Badge>{permission}</Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Section,
} from '@/design-system/components';
import { IconShield } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { listRolesWithCounts } from '@/modules/access-control/application/role-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { effectivePermissions, hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { CreateRoleForm } from './role-forms';
import { createRoleAction } from './actions';

export const metadata: Metadata = { title: 'Perfis de acesso' };

export default async function RolesPage() {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_ACCESS_CONTROL,
    PERMISSIONS.ROLES_VIEW,
  );

  const roles = await listRolesWithCounts(context);
  const canManage = hasPermission(context, PERMISSIONS.ROLES_MANAGE);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Perfis de acesso"
        description="Um perfil reune permissoes. Ele e atribuido a uma pessoa no tenant inteiro ou apenas em uma unidade."
        breadcrumbs={[{ label: 'Administracao' }, { label: 'Perfis de acesso' }]}
        metadata={<span>{roles.length} perfil(is) nesta empresa</span>}
      />

      {canManage ? (
        <Card>
          <CardHeader
            title="Novo perfil"
            description="Um perfil e um conjunto reutilizavel de permissoes."
          />
          <CardBody>
            <CreateRoleForm action={createRoleAction} />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Perfis de acesso"
          description={`${roles.length} perfil(is) nesta empresa`}
        />
        {roles.length === 0 ? (
          <EmptyState
            title="Nenhum perfil"
            description="Esta empresa ainda nao possui perfis de acesso."
            icon={<IconShield />}
          />
        ) : null}

        <CardBody className="space-y-3">
          {roles.map((role) => (
            <div
              key={role.id}
              className="flex flex-col gap-2 rounded-md border border-ink-200 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-ink-900">{role.name}</p>
                  {role.isSystem ? <Badge tone="brand">sistema</Badge> : null}
                  <Badge tone={role.permissionCount === 0 ? 'warning' : 'neutral'}>
                    {role.permissionCount} permiss{role.permissionCount === 1 ? 'ao' : 'oes'}
                  </Badge>
                  <Badge>{role.assignmentCount} atribuicao(oes)</Badge>
                </div>
                {role.description ? (
                  <p className="mt-1 text-small text-ink-500">{role.description}</p>
                ) : null}
                <p className="mt-1 font-mono text-small text-ink-500">{role.key}</p>
              </div>

              <Link
                href={`/administracao/perfis/${role.id}`}
                className="touch-target inline-flex items-center text-ui font-semibold text-brand-600 hover:text-brand-700 hover:underline md:min-h-0"
              >
                Ver permissoes
                <span className="sr-only"> do perfil {role.name}</span>
              </Link>
            </div>
          ))}
        </CardBody>
      </Card>

      <Section
        id="seu-acesso"
        title="Seu acesso"
        description="Permissoes efetivas no contexto atual: seus papeis de tenant mais os papeis da unidade ativa."
      >
        <Card>
          <CardBody>
            <ul className="flex flex-wrap gap-2">
              {[...effectivePermissions(context)].sort().map((permission) => (
                <li key={permission}>
                  <Badge>{permission}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}

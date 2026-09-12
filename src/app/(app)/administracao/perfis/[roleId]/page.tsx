import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, CardBody, CardHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import {
  findRoleInTenant,
  listRolePermissions,
} from '@/modules/access-control/application/role-service';
import {
  isHighRisk,
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  PERMISSIONS,
} from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { effectivePermissions, hasPermission } from '@/modules/tenancy/domain/tenant-context';
import {
  DeleteRoleForm,
  RoleMetadataForm,
  RolePermissionsForm,
  type PermissionGroupView,
} from '../role-forms';
import { deleteRoleAction, setRolePermissionsAction, updateRoleAction } from '../actions';

export const metadata: Metadata = { title: 'Permissoes do perfil' };

export default async function RoleDetailPage({ params }: { params: Promise<{ roleId: string }> }) {
  const { roleId } = await params;
  const { context } = await requireAccessForPage(
    FEATURES.CORE_ACCESS_CONTROL,
    PERMISSIONS.ROLES_VIEW,
  );

  const role = await findRoleInTenant(context, roleId).catch(() => null);
  if (!role) notFound();

  const granted = new Set(await listRolePermissions(context, role.id));
  const own = effectivePermissions(context);

  const canManage = hasPermission(context, PERMISSIONS.ROLES_MANAGE);
  const canManagePermissions = hasPermission(context, PERMISSIONS.ROLES_MANAGE_PERMISSIONS);
  const readOnly = !canManagePermissions || role.isSystem;

  const catalog = new Map(PERMISSION_CATALOG.map((permission) => [permission.key, permission]));

  const groups: PermissionGroupView[] = PERMISSION_GROUPS.map((group) => ({
    key: group.key,
    name: group.name,
    description: group.description,
    permissions: group.permissions.map((key) => {
      const definition = catalog.get(key);
      return {
        key,
        name: definition?.name ?? key,
        description: definition?.description ?? '',
        highRisk: isHighRisk(key),
        granted: granted.has(key),
        // So se concede permissao sensivel que a propria pessoa possui.
        grantable: !isHighRisk(key) || own.has(key),
      };
    }),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/administracao/perfis" className="text-ui text-brand-600 hover:text-brand-700">
          ← Perfis de acesso
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 font-heading text-h2 font-bold tracking-tight text-ink-900">
          {role.name}
          {role.isSystem ? <Badge tone="brand">sistema</Badge> : null}
        </h1>
        {role.description ? <p className="mt-1 text-ui text-ink-500">{role.description}</p> : null}
      </div>

      {role.isSystem ? (
        <Alert tone="info" title="Perfil estrutural">
          O Administrador e o caminho administrativo da empresa. Nome e permissoes sao fixos, e ele
          nao pode ser excluido — e o que impede a empresa de ficar sem ninguem no comando.
        </Alert>
      ) : null}

      {!canManagePermissions && !role.isSystem ? (
        <Alert tone="info">
          Voce pode consultar as permissoes deste perfil, mas alterar exige a permissao
          &quot;Alterar permissoes de perfis&quot;.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Permissoes"
          description="O que este perfil autoriza. Onde ele vale e definido na atribuicao ao usuario."
        />
        <CardBody>
          <RolePermissionsForm
            action={setRolePermissionsAction}
            roleId={role.id}
            groups={groups}
            readOnly={readOnly}
          />
        </CardBody>
      </Card>

      {canManage && !role.isSystem ? (
        <>
          <Card>
            <CardHeader title="Dados do perfil" />
            <CardBody>
              <RoleMetadataForm
                action={updateRoleAction}
                roleId={role.id}
                name={role.name}
                description={role.description}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Excluir perfil"
              description="As atribuicoes deste perfil serao removidas dos usuarios."
            />
            <CardBody>
              <DeleteRoleForm action={deleteRoleAction} roleId={role.id} />
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, CardBody, CardHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { listUserAssignments } from '@/modules/access-control/application/assignment-service';
import { listRolesWithCounts } from '@/modules/access-control/application/role-service';
import { PERMISSIONS, ROLE_SCOPES } from '@/modules/access-control/domain/permissions';
import { countActiveSessions } from '@/modules/auth/application/session-management';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listUnits } from '@/modules/tenancy/application/tenancy-queries';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { listUserMemberships } from '@/modules/users/application/membership-service';
import { findUserInTenant } from '@/modules/users/application/user-service';
import { ActionForm, AssignRoleForm, RenameUserForm } from '../user-forms';
import {
  assignRoleAction,
  grantUnitAction,
  resetPasswordAction,
  revokeRoleAction,
  revokeUnitAction,
  revokeUserSessionsAction,
  setUserStatusAction,
  updateUserAction,
} from '../actions';

export const metadata: Metadata = { title: 'Acesso do usuario' };

/**
 * Ficha de acesso de um usuario (Prompt 03, itens 49, 50 e 71).
 *
 * As quatro dimensoes aparecem SEPARADAS, como o modelo manda: dados,
 * vinculo de unidade (membership), perfis (autorizacao) e seguranca.
 */
export default async function UserAccessPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const { context } = await requireAccessForPage(FEATURES.CORE_USERS, PERMISSIONS.USERS_VIEW);

  // Usuario de outro tenant nao e encontrado — 404, sem revelar que existe.
  const user = await findUserInTenant(context, userId).catch(() => null);
  if (!user) notFound();

  const [memberships, assignments, allUnits, roles, activeSessions] = await Promise.all([
    listUserMemberships(context, user.id),
    listUserAssignments(context, user.id),
    listUnits(context),
    listRolesWithCounts(context),
    countActiveSessions(context, user.id),
  ]);

  const canManage = hasPermission(context, PERMISSIONS.USERS_MANAGE);
  const canManageAccess = hasPermission(context, PERMISSIONS.USERS_MANAGE_ACCESS);
  const canResetPassword = hasPermission(context, PERMISSIONS.USERS_RESET_PASSWORD);
  const canRevokeSessions = hasPermission(context, PERMISSIONS.SESSIONS_REVOKE);

  const memberUnitIds = new Set(memberships.map((membership) => membership.unitId));
  const availableUnits = allUnits.filter((unit) => !memberUnitIds.has(unit.id));
  const unitName = (id: string) => allUnits.find((unit) => unit.id === id)?.name ?? id;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link
          href="/administracao/usuarios"
          className="text-ui text-brand-600 hover:text-brand-700"
        >
          ← Usuarios
        </Link>
        <h1 className="mt-2 font-heading text-h2 font-bold tracking-tight text-ink-900">
          {user.name}
        </h1>
        <p className="mt-1 text-ui text-ink-500">{user.email}</p>
      </div>

      {/* --- 1. Dados ------------------------------------------------------ */}
      <Card>
        <CardHeader
          title="Dados do usuario"
          action={
            <Badge tone={user.status === 'active' ? 'success' : 'neutral'}>
              {user.status === 'active' ? 'ativo' : 'inativo'}
            </Badge>
          }
        />
        <CardBody className="space-y-4">
          {canManage ? (
            <RenameUserForm action={updateUserAction} userId={user.id} currentName={user.name} />
          ) : (
            <p className="text-ui text-ink-600">{user.name}</p>
          )}

          {canManage && user.id !== context.userId ? (
            <div className="border-t border-ink-200 pt-4">
              <ActionForm
                action={setUserStatusAction}
                fields={{ userId: user.id, activate: user.status === 'active' ? 'false' : 'true' }}
                label={user.status === 'active' ? 'Inativar usuario' : 'Reativar usuario'}
                variant={user.status === 'active' ? 'destructive' : 'primary'}
                confirmLabel={
                  user.status === 'active'
                    ? 'Inativar este usuario e encerrar todas as suas sessoes?'
                    : undefined
                }
              />
              <p className="mt-2 text-small text-ink-500">
                Inativar encerra as sessoes ativas e bloqueia novos logins. O historico e
                preservado.
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* --- 2. Membership -------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Unidades"
          description="Onde a pessoa pode operar. Vinculo nao concede permissao — quem concede sao os perfis."
        />
        <CardBody className="space-y-3">
          {memberships.length === 0 ? (
            <p className="text-ui text-ink-500">Nenhuma unidade vinculada.</p>
          ) : (
            <ul className="space-y-2">
              {memberships.map((membership) => (
                <li
                  key={membership.unitId}
                  className="flex flex-col gap-2 rounded-md border border-ink-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-medium text-ink-900">{membership.unitName}</span>
                  {canManageAccess ? (
                    <ActionForm
                      action={revokeUnitAction}
                      fields={{ userId: user.id, unitId: membership.unitId }}
                      label="Remover vinculo"
                      variant="ghost"
                      confirmLabel="Remover o vinculo tambem remove os perfis que valiam nesta unidade. Continuar?"
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canManageAccess && availableUnits.length > 0 ? (
            <div className="border-t border-ink-200 pt-3">
              <ActionForm
                action={grantUnitAction}
                fields={{ userId: user.id }}
                label="Vincular unidade"
              >
                <div className="space-y-1.5">
                  <label htmlFor="grant-unit" className="block text-ui font-medium text-ink-700">
                    Unidade
                  </label>
                  <select
                    id="grant-unit"
                    name="unitId"
                    className="h-10 w-full rounded-md border border-ink-300 bg-white px-3 text-ui text-ink-900 shadow-xs sm:max-w-xs"
                  >
                    {availableUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                </div>
              </ActionForm>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* --- 3. Autorizacao ------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Perfis de acesso"
          description="O que a pessoa pode fazer, e onde esse perfil vale."
        />
        <CardBody className="space-y-4">
          {assignments.tenantRoles.length === 0 && assignments.unitRoles.length === 0 ? (
            <p className="text-ui text-ink-500">Nenhum perfil atribuido.</p>
          ) : (
            <ul className="space-y-2">
              {assignments.tenantRoles.map((assignment) => (
                <li
                  key={`tenant-${assignment.roleId}`}
                  className="flex flex-col gap-2 rounded-md border border-ink-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-ink-900">{assignment.roleName}</p>
                    <p className="text-small text-ink-500">Todas as unidades autorizadas</p>
                  </div>
                  {canManageAccess ? (
                    <ActionForm
                      action={revokeRoleAction}
                      fields={{
                        userId: user.id,
                        roleId: assignment.roleId,
                        scope: ROLE_SCOPES.TENANT,
                      }}
                      label="Remover"
                      variant="ghost"
                    />
                  ) : null}
                </li>
              ))}

              {assignments.unitRoles.map((assignment) => (
                <li
                  key={`unit-${assignment.roleId}-${assignment.unitId}`}
                  className="flex flex-col gap-2 rounded-md border border-ink-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-ink-900">{assignment.roleName}</p>
                    <p className="text-small text-ink-500">
                      Somente em {unitName(assignment.unitId)}
                    </p>
                  </div>
                  {canManageAccess ? (
                    <ActionForm
                      action={revokeRoleAction}
                      fields={{
                        userId: user.id,
                        roleId: assignment.roleId,
                        scope: ROLE_SCOPES.UNIT,
                        unitId: assignment.unitId,
                      }}
                      label="Remover"
                      variant="ghost"
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canManageAccess ? (
            <div className="border-t border-ink-200 pt-4">
              <AssignRoleForm
                action={assignRoleAction}
                userId={user.id}
                roles={roles.map((role) => ({ id: role.id, name: role.name }))}
                units={memberships.map((membership) => ({
                  id: membership.unitId,
                  name: membership.unitName,
                }))}
              />
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* --- 4. Seguranca --------------------------------------------------- */}
      {canResetPassword || canRevokeSessions ? (
        <Card>
          <CardHeader title="Seguranca" description={`${activeSessions} sessao(oes) ativa(s)`} />
          <CardBody className="space-y-4">
            {canResetPassword ? (
              <div>
                <ActionForm
                  action={resetPasswordAction}
                  fields={{ userId: user.id }}
                  label="Gerar codigo de redefinicao"
                />
                <p className="mt-2 text-small text-ink-500">
                  Gera um codigo de uso unico, valido por 1 hora. Voce nao ve nem define a senha da
                  pessoa.
                </p>
              </div>
            ) : null}

            {canRevokeSessions ? (
              <div className="border-t border-ink-200 pt-4">
                <ActionForm
                  action={revokeUserSessionsAction}
                  fields={{ userId: user.id }}
                  label="Encerrar todas as sessoes"
                  variant="destructive"
                  confirmLabel="Encerrar todas as sessoes ativas deste usuario?"
                />
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : (
        <Alert tone="info">
          Voce nao tem permissao para redefinir senha nem encerrar sessoes deste usuario.
        </Alert>
      )}
    </div>
  );
}

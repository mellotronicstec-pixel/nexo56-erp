import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { listUsers } from '@/modules/users/application/user-queries';
import { CreateUserForm } from './user-forms';
import { createUserAction } from './actions';

export const metadata: Metadata = { title: 'Usuarios' };

/**
 * Lista de usuarios da empresa (Prompt 03, item 50).
 *
 * Responsiva de verdade (item 66): tabela no desktop, cartoes no mobile — e
 * nao uma tabela espremida ate ficar ilegivel.
 */
export default async function UsersPage() {
  const { context } = await requireAccessForPage(FEATURES.CORE_USERS, PERMISSIONS.USERS_VIEW);
  const users = await listUsers(context);
  const canManage = hasPermission(context, PERMISSIONS.USERS_MANAGE);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {canManage ? (
        <Card>
          <CardHeader
            title="Novo usuario"
            description="O acesso e concedido depois, na ficha da pessoa."
          />
          <CardBody>
            <CreateUserForm action={createUserAction} />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Usuarios" description={`${users.length} usuario(s) nesta empresa`} />

        {users.length === 0 ? (
          <EmptyState
            title="Nenhum usuario"
            description="Esta empresa ainda nao possui usuarios."
          />
        ) : (
          <CardBody className="p-0">
            {/* Desktop */}
            <table className="hidden w-full text-ui md:table">
              <thead className="border-b border-ink-200 bg-ink-50 text-left">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium text-ink-600">
                    Nome
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium text-ink-600">
                    E-mail
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium text-ink-600">
                    Situacao
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium text-ink-600">
                    <span className="sr-only">Acoes</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-5 py-3 font-medium text-ink-900">{user.name}</td>
                    <td className="px-5 py-3 text-ink-600">{user.email}</td>
                    <td className="px-5 py-3">
                      <Badge tone={user.status === 'active' ? 'success' : 'neutral'}>
                        {user.status === 'active' ? 'ativo' : 'inativo'}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/administracao/usuarios/${user.id}`}
                        className="text-ui font-semibold text-brand-600 hover:text-brand-700"
                      >
                        Gerenciar acesso
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile: cartoes, nao tabela comprimida */}
            <ul className="divide-y divide-ink-200 md:hidden">
              {users.map((user) => (
                <li key={user.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">{user.name}</p>
                      <p className="truncate text-small text-ink-500">{user.email}</p>
                    </div>
                    <Badge tone={user.status === 'active' ? 'success' : 'neutral'}>
                      {user.status === 'active' ? 'ativo' : 'inativo'}
                    </Badge>
                  </div>
                  <Link
                    href={`/administracao/usuarios/${user.id}`}
                    className="touch-target mt-2 inline-flex items-center text-ui font-semibold text-brand-600"
                  >
                    Gerenciar acesso
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        )}
      </Card>

      {!canManage ? (
        <Alert tone="info">
          Voce pode consultar os usuarios, mas nao tem permissao para cria-los ou altera-los.
        </Alert>
      ) : null}
    </div>
  );
}

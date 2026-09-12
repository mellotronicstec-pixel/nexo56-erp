import type { Metadata } from 'next';
import { Badge, Card, CardBody, CardHeader, EmptyState } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listUsers } from '@/modules/users/application/user-queries';

export const metadata: Metadata = { title: 'Usuarios' };

/** Consulta estrutural minima (Prompt 01, item 59). Sem CRUD nesta etapa. */
export default async function UsersPage() {
  const { context } = await requireAccessForPage(FEATURES.CORE_USERS, PERMISSIONS.USERS_VIEW);
  const users = await listUsers(context);

  return (
    <div className="mx-auto max-w-5xl">
      <Card>
        <CardHeader title="Usuarios" description={`${users.length} usuario(s) nesta empresa`} />
        {users.length === 0 ? (
          <EmptyState
            title="Nenhum usuario"
            description="Esta empresa ainda nao possui usuarios."
          />
        ) : (
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-ui">
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
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-5 py-3 font-medium text-ink-900">{user.name}</td>
                    <td className="px-5 py-3 text-ink-600">{user.email}</td>
                    <td className="px-5 py-3">
                      <Badge tone={user.status === 'active' ? 'success' : 'neutral'}>
                        {user.status === 'active' ? 'ativo' : user.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        )}
      </Card>
    </div>
  );
}

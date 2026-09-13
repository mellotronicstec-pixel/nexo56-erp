import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
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
import { IconUsers } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { listUsers } from '@/modules/users/application/user-queries';
import { CreateUserForm } from './user-forms';
import { createUserAction } from './actions';

export const metadata: Metadata = { title: 'Usuarios' };

/**
 * Lista de usuarios da empresa (Prompt 03, item 50; Prompt 04, itens 20, 21
 * e 41).
 *
 * Segue o padrao de listagem do Design System:
 *   PageHeader -> acao -> tabela/cartoes -> estados
 *
 * Responsiva de verdade (item 21): tabela a partir de `md`, cartoes abaixo
 * disso — e nao uma tabela espremida ate ficar ilegivel.
 */
export default async function UsersPage() {
  const { context } = await requireAccessForPage(FEATURES.CORE_USERS, PERMISSIONS.USERS_VIEW);
  const users = await listUsers(context);
  const canManage = hasPermission(context, PERMISSIONS.USERS_MANAGE);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Usuarios"
        description="Pessoas com acesso a esta empresa. O acesso as unidades e os perfis sao concedidos na ficha de cada uma."
        breadcrumbs={[{ label: 'Administracao' }, { label: 'Usuarios' }]}
        metadata={<span>{users.length} usuario(s) cadastrado(s)</span>}
      />

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
      ) : (
        <Alert tone="info">
          Voce pode consultar os usuarios, mas nao tem permissao para cria-los ou altera-los.
        </Alert>
      )}

      <Card>
        <CardHeader title="Usuarios" description={`${users.length} usuario(s) nesta empresa`} />

        {users.length === 0 ? (
          <EmptyState
            title="Nenhum usuario"
            description="Esta empresa ainda nao possui usuarios."
            icon={<IconUsers />}
          />
        ) : (
          <CardBody className="p-0">
            {/* Tablet e desktop */}
            <div className="hidden md:block">
              <Table caption="Usuarios desta empresa">
                <THead>
                  <TR>
                    <TH>Nome</TH>
                    <TH>E-mail</TH>
                    <TH>Situacao</TH>
                    <TH align="right" srOnly>
                      Acoes
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {users.map((user) => (
                    <TR key={user.id}>
                      <TD className="font-medium text-ink-900">{user.name}</TD>
                      <TD className="text-ink-600">{user.email}</TD>
                      <TD>
                        <Badge tone={user.status === 'active' ? 'success' : 'neutral'}>
                          {user.status === 'active' ? 'ativo' : 'inativo'}
                        </Badge>
                      </TD>
                      <TD align="right">
                        <Link
                          href={`/administracao/usuarios/${user.id}`}
                          className="text-ui font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          Gerenciar acesso
                          <span className="sr-only"> de {user.name}</span>
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            {/* Mobile: cartoes, nao tabela comprimida */}
            <CardList label="Usuarios desta empresa" className="md:hidden">
              {users.map((user) => (
                <CardListItem key={user.id}>
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
                    <span className="sr-only"> de {user.name}</span>
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

import Link from 'next/link';
import { Badge, Card, CardBody, CardHeader, PageHeader, Section } from '@/design-system/components';
import { IconChevronRight } from '@/design-system/icons';
import { requireContextForPage } from '@/modules/auth/application/current-context';
import { effectivePermissions } from '@/modules/tenancy/domain/tenant-context';
import { listTenantFeatureStates } from '@/modules/features/application/effective-access';
import { listUnits } from '@/modules/tenancy/application/tenancy-queries';

/**
 * Pagina inicial autenticada (Prompt 01, item 58).
 *
 * Mostra apenas o que EXISTE: empresa, unidade, usuario, estado real da
 * modularidade e atalhos para as telas que a pessoa realmente pode abrir. Nao
 * ha faturamento, OS, estoque, grafico ou KPI — esses dados ainda nao existem
 * no sistema e inventa-los seria mentira (Prompt 01, item 83; Prompt 04,
 * itens 48 e 122).
 */
export default async function HomePage() {
  const context = await requireContextForPage();
  const [units, featureStates] = await Promise.all([
    listUnits(context),
    listTenantFeatureStates(context),
  ]);

  const activeFeatures = featureStates.filter((state) => state.decision.allowed);

  /**
   * Atalhos estruturais (item 48). Cada um so aparece se a pessoa tem a
   * permissao — o mesmo criterio do menu, pelos mesmos motivos. Nenhum atalho
   * leva a tela inexistente.
   */
  const permissions = effectivePermissions(context);
  const shortcuts = [
    {
      href: '/administracao/usuarios',
      label: 'Usuarios',
      description: 'Cadastro, vinculos e perfis das pessoas.',
      allowed: permissions.has('users.view'),
    },
    {
      href: '/administracao/perfis',
      label: 'Perfis de acesso',
      description: 'Quais permissoes cada perfil concede.',
      allowed: permissions.has('roles.view'),
    },
    {
      href: '/minha-conta',
      label: 'Minha conta',
      description: 'Sua senha e suas sessoes ativas.',
      allowed: true,
    },
  ].filter((shortcut) => shortcut.allowed);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={`Ola, ${context.userName.split(' ')[0]}`}
        description="Fundacao tecnica do Nexo56. Os modulos operacionais serao adicionados nas proximas etapas."
        metadata={
          <>
            <span>{context.tenantName}</span>
            {context.activeUnitId ? (
              <span>
                {units.find((unit) => unit.id === context.activeUnitId)?.name ?? 'Unidade ativa'}
              </span>
            ) : null}
          </>
        }
      />

      <Section id="atalhos" title="Atalhos" description="As telas que voce pode abrir agora.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((shortcut) => (
            <Card key={shortcut.href} interactive>
              <CardBody>
                <Link
                  href={shortcut.href}
                  className="flex items-start justify-between gap-3 rounded-md"
                >
                  <span className="min-w-0">
                    <span className="block font-heading text-h5 font-semibold text-ink-900">
                      {shortcut.label}
                    </span>
                    <span className="mt-1 block text-small text-ink-500">
                      {shortcut.description}
                    </span>
                  </span>
                  <IconChevronRight size={18} className="mt-1 text-ink-400" />
                </Link>
              </CardBody>
            </Card>
          ))}
        </div>
      </Section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title="Empresa" description="Dados do tenant desta sessao" />
          <CardBody>
            <dl className="space-y-3 text-ui">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">Nome</dt>
                <dd className="text-right font-medium text-ink-900">{context.tenantName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">Identificador</dt>
                <dd className="text-right font-mono text-small text-ink-700">
                  {context.tenantSlug}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">Fuso horario</dt>
                <dd className="text-right text-ink-700">{context.tenantTimezone}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">Unidades</dt>
                <dd className="text-right text-ink-700">{units.length}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Seu acesso" description="Perfis e permissoes efetivas" />
          <CardBody>
            <dl className="space-y-3 text-ui">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">Usuario</dt>
                <dd className="text-right font-medium text-ink-900">{context.userName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">Perfis</dt>
                <dd className="flex flex-wrap justify-end gap-1">
                  {context.tenantRoles.length > 0 ? (
                    context.tenantRoles.map((role) => (
                      <Badge key={role.roleId} tone="brand">
                        {role.roleName}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-ink-500">nenhum</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">Permissoes</dt>
                <dd className="text-right text-ink-700">{effectivePermissions(context).size}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">Unidades autorizadas</dt>
                <dd className="text-right text-ink-700">{context.authorizedUnitIds.length}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Funcionalidades ativas"
          description="Resultado do Effective Access para esta empresa e este usuario"
        />
        <CardBody>
          <ul className="flex flex-wrap gap-2">
            {activeFeatures.map((state) => (
              <li key={state.featureKey}>
                <Badge tone={state.type === 'CORE' ? 'neutral' : 'success'}>
                  {state.featureKey}
                </Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

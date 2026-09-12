import { Badge, Card, CardBody, CardHeader } from '@/design-system/components';
import { requireContextForPage } from '@/modules/auth/application/current-context';
import { effectivePermissions } from '@/modules/tenancy/domain/tenant-context';
import { listTenantFeatureStates } from '@/modules/features/application/effective-access';
import { listUnits } from '@/modules/tenancy/application/tenancy-queries';

/**
 * Pagina inicial autenticada (Prompt 01, item 58).
 *
 * Mostra apenas o que EXISTE: empresa, unidade, usuario e estado real da
 * modularidade. Nao ha faturamento, OS, estoque, grafico ou KPI — esses dados
 * ainda nao existem no sistema e inventa-los seria mentira (item 83).
 */
export default async function HomePage() {
  const context = await requireContextForPage();
  const [units, featureStates] = await Promise.all([
    listUnits(context),
    listTenantFeatureStates(context),
  ]);

  const activeFeatures = featureStates.filter((state) => state.decision.allowed);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="font-heading text-h2 font-bold tracking-tight text-ink-900">
          Ola, {context.userName.split(' ')[0]}
        </h1>
        <p className="mt-1 text-ui text-ink-500">
          Fundacao tecnica do Nexo56. Os modulos operacionais serao adicionados nas proximas etapas.
        </p>
      </header>

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

import type { Metadata } from 'next';
import { Alert, Badge, Card, CardBody, CardHeader } from '@/design-system/components';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES, findFeature } from '@/modules/features/domain/catalog';
import { listTenantFeatureStates } from '@/modules/features/application/effective-access';
import { ModuleToggle } from './module-toggle';

export const metadata: Metadata = { title: 'Modulos e funcionalidades' };

const REASON_LABEL: Record<
  string,
  { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  ALLOWED: { text: 'Ativo', tone: 'success' },
  PLAN_NOT_ENTITLED: { text: 'Indisponivel no plano', tone: 'warning' },
  TENANT_DISABLED: { text: 'Inativo', tone: 'neutral' },
  DEPENDENCY_UNSATISFIED: { text: 'Dependencia necessaria', tone: 'warning' },
  FEATURE_DEPRECATED: { text: 'Descontinuada', tone: 'danger' },
  UNKNOWN_FEATURE: { text: 'Desconhecida', tone: 'danger' },
  PERMISSION_DENIED: { text: 'Sem permissao', tone: 'neutral' },
};

/**
 * Central de Modulos (Prompt 00, item 15 — versao da fundacao).
 * Mostra o estado real de cada funcionalidade segundo o Effective Access.
 */
export default async function ModulesPage() {
  const { context } = await requireAccessForPage(FEATURES.CORE_FEATURES, PERMISSIONS.FEATURES_VIEW);
  const states = await listTenantFeatureStates(context);
  const canManage = hasPermission(context, PERMISSIONS.FEATURES_MANAGE);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Alert tone="info" title="Desativar nao apaga dados">
        Ao desativar uma funcionalidade, o historico e preservado. Ao reativar, os dados anteriores
        continuam disponiveis.
      </Alert>

      <Card>
        <CardHeader
          title="Modulos e funcionalidades"
          description="Disponibilidade efetiva = catalogo x plano x configuracao da empresa x suas permissoes"
        />
        <CardBody className="space-y-3">
          {states.map((state) => {
            const definition = findFeature(state.featureKey);
            const label = REASON_LABEL[state.decision.reason] ?? REASON_LABEL.UNKNOWN_FEATURE!;
            const isCore = state.type === 'CORE';

            return (
              <div
                key={state.featureKey}
                className="flex flex-col gap-3 rounded-md border border-ink-200 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink-900">
                      {definition?.name ?? state.featureKey}
                    </p>
                    <Badge tone={isCore ? 'brand' : 'neutral'}>{state.type}</Badge>
                    <Badge tone={label.tone}>{label.text}</Badge>
                  </div>
                  {definition ? (
                    <p className="mt-1 text-small text-ink-500">{definition.description}</p>
                  ) : null}
                  <p className="mt-1 font-mono text-small text-ink-400">{state.featureKey}</p>
                  {state.decision.missingDependencies?.length ? (
                    <p className="mt-1 text-small text-warning-700">
                      Depende de: {state.decision.missingDependencies.join(', ')}
                    </p>
                  ) : null}
                </div>

                <div className="shrink-0">
                  {isCore ? (
                    <span className="text-small text-ink-500">Estrutural — nao desativavel</span>
                  ) : canManage ? (
                    <ModuleToggle featureKey={state.featureKey} enabled={state.decision.allowed} />
                  ) : null}
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  linkButtonClass,
  PageHeader,
} from '@/design-system/components';
import { IconWarranty } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listWarrantyPolicies } from '@/modules/warranties/application/warranty-policy-service';
import {
  formatDuration,
  warrantyTypeLabel,
  type DurationUnit,
} from '@/modules/warranties/domain/warranty';
import { changePolicyStatusAction, createPolicyAction, updatePolicyAction } from '../actions';
import { PolicyForm, PolicyStatusForm } from './policy-forms';

export const metadata: Metadata = { title: 'Politicas de garantia' };

/**
 * Politicas de garantia (Prompt 13, itens 6 a 9 e 91).
 *
 * POLITICA E PADRAO SUGERIDO, nao a verdade da garantia emitida (ADR-062). A
 * garantia COPIA os termos no momento da emissao e nunca mais volta aqui para
 * le-los. E por isso que esta tela pode ser editada sem medo: nada do que
 * mudar aqui reescreve um certificado ja entregue.
 *
 * A TELA EXIGE `warranties.settings.manage`, que e permissao de configuracao —
 * separada de emitir garantia e de consultar. Quem atende no balcao emite; quem
 * decide o padrao da casa e outra pessoa.
 */
export default async function WarrantyPoliciesPage() {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_WARRANTIES,
    PERMISSIONS.WARRANTIES_SETTINGS_MANAGE,
  );

  const politicas = await listWarrantyPolicies(context);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Politicas de garantia"
        description="O padrao que a casa oferece: tipo, prazo, o que cobre e o que nao cobre."
        breadcrumbs={[{ label: 'Garantias', href: '/garantias' }, { label: 'Politicas' }]}
        metadata={<span>{politicas.length} politica(s)</span>}
        actions={
          <Link href="/garantias/lista" className={linkButtonClass('secondary')}>
            Ver garantias
          </Link>
        }
      />

      <Alert tone="info">
        Alterar uma politica muda apenas as proximas emissoes. Garantias ja emitidas guardam os
        termos da epoca, e o certificado delas continua identico.
      </Alert>

      <Card>
        <CardHeader
          title="Politicas cadastradas"
          description="A politica desativada some das emissoes novas e continua explicando as antigas."
          headingLevel={2}
        />
        <CardBody className="p-0">
          {politicas.length === 0 ? (
            <EmptyState
              icon={<IconWarranty />}
              title="Nenhuma politica cadastrada"
              description="Sem politica, cada garantia e preenchida a mao. Cadastre ao menos o padrao de bancada."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {politicas.map((politica) => (
                <li key={politica.id} className="space-y-3 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">{politica.name}</p>
                      <p className="text-small text-ink-500">
                        {warrantyTypeLabel(politica.type)} ·{' '}
                        {formatDuration(
                          politica.durationAmount,
                          politica.durationUnit as DurationUnit,
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={politica.status === 'active' ? 'success' : 'neutral'}>
                        {politica.status === 'active' ? 'Ativa' : 'Inativa'}
                      </Badge>
                      <PolicyStatusForm
                        policyId={politica.id}
                        status={politica.status}
                        action={changePolicyStatusAction}
                      />
                    </div>
                  </div>

                  <details className="rounded-md border border-ink-200 p-3">
                    <summary className="touch-target inline-flex cursor-pointer items-center text-ui font-semibold text-brand-600">
                      Editar politica
                    </summary>
                    <div className="mt-3">
                      <PolicyForm policy={politica} action={updatePolicyAction} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Nova politica"
          description="O padrao que o balcao vai sugerir na proxima emissao."
          headingLevel={2}
        />
        <CardBody>
          <PolicyForm action={createPolicyAction} />
        </CardBody>
      </Card>
    </div>
  );
}

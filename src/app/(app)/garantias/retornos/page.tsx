import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardList,
  CardListItem,
  EmptyState,
  linkButtonClass,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { IconWarranty } from '@/design-system/icons';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listWarrantyReturns } from '@/modules/warranties/application/warranty-queries';
import {
  COVERAGE_ASSESSMENT_LABEL,
  formatWarrantyNumber,
  warrantyTypeLabel,
  type CoverageAssessment,
} from '@/modules/warranties/domain/warranty';
import { dataCivil, instante } from '../format';

export const metadata: Metadata = { title: 'Retornos em garantia' };

/**
 * Retornos em garantia (Prompt 13, itens 85 e 87).
 *
 * O RETORNO RECUSADO APARECE IGUAL AO ACEITO. Esconder a recusa deixaria a
 * lista bonita e a loja cega: quando o cliente voltar pela terceira vez
 * discutindo a mesma coisa, e o registro das duas recusas anteriores que
 * permite responder com fato em vez de memoria.
 *
 * DUAS INFORMACOES SEPARADAS, e as duas importam: se a garantia ESTAVA valendo
 * no dia do retorno, e se o defeito foi avaliado como coberto. Uma garantia
 * vigente com defeito fora da cobertura nao gera conserto gratuito — e uma
 * coluna so faria a tela mentir nesse caso exato.
 */
export default async function WarrantyReturnsPage() {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_WARRANTIES,
    PERMISSIONS.WARRANTIES_VIEW,
  );

  const retornos = await listWarrantyReturns(context, 100);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Retornos em garantia"
        description="Aparelhos que voltaram, o que foi avaliado e qual Ordem de Servico nasceu disso."
        breadcrumbs={[{ label: 'Garantias', href: '/garantias' }, { label: 'Retornos' }]}
        metadata={<span>{retornos.length} retorno(s) recente(s)</span>}
        actions={
          <Link href="/garantias/lista" className={linkButtonClass('secondary')}>
            Ver garantias
          </Link>
        }
      />

      {context.authorizedUnitIds.length === 0 ? (
        <Alert tone="warning">
          Voce nao tem nenhuma unidade autorizada, entao nao ha retornos para mostrar.
        </Alert>
      ) : null}

      <Alert tone="info">
        O retorno nasce na ficha da garantia — e la que o atendente ve o que esta coberto antes de
        prometer conserto gratuito.
      </Alert>

      <Card>
        {retornos.length === 0 ? (
          <EmptyState
            icon={<IconWarranty />}
            title="Nenhum retorno registrado"
            description="Nenhum aparelho voltou em garantia nestas unidades."
          />
        ) : (
          <CardBody className="p-0">
            <div className="hidden overflow-x-auto md:block">
              <Table caption="Retornos em garantia das unidades autorizadas">
                <THead>
                  <TR>
                    <TH>Registrado em</TH>
                    <TH>Garantia</TH>
                    <TH>Cliente</TH>
                    <TH>Valia no dia</TH>
                    <TH>Avaliacao</TH>
                    <TH>OS de garantia</TH>
                  </TR>
                </THead>
                <TBody>
                  {retornos.map((retorno) => (
                    <TR key={retorno.id}>
                      <TD className="whitespace-nowrap">
                        {instante(retorno.registeredAt)}
                        <span className="block text-small text-ink-500">
                          referencia {dataCivil(retorno.referenceDate)}
                        </span>
                      </TD>
                      <TD className="whitespace-nowrap">
                        <Link
                          href={`/garantias/${retorno.warrantyId}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          {formatWarrantyNumber(retorno.warrantyNumber)}
                        </Link>
                        <span className="block text-small text-ink-500">
                          {warrantyTypeLabel(retorno.warrantyType)}
                        </span>
                      </TD>
                      <TD>{retorno.customerName ?? '—'}</TD>
                      <TD>
                        <Badge tone={retorno.wasEnforceable === 1 ? 'success' : 'neutral'}>
                          {retorno.wasEnforceable === 1 ? 'Sim' : 'Nao'}
                        </Badge>
                      </TD>
                      <TD>
                        <Badge
                          tone={
                            retorno.coverageAssessment === 'covered'
                              ? 'success'
                              : retorno.coverageAssessment === 'not_covered'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {COVERAGE_ASSESSMENT_LABEL[
                            retorno.coverageAssessment as CoverageAssessment
                          ] ?? retorno.coverageAssessment}
                        </Badge>
                      </TD>
                      <TD>
                        {retorno.returnServiceOrderId && retorno.returnNumber !== null ? (
                          <Link
                            href={`/ordens-de-servico/${retorno.returnServiceOrderId}`}
                            className="font-semibold text-brand-600 hover:underline"
                          >
                            OS {retorno.returnNumber}
                          </Link>
                        ) : (
                          <span className="text-ink-500">Nenhuma</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <CardList label="Retornos em garantia" className="md:hidden">
              {retornos.map((retorno) => (
                <CardListItem key={retorno.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/garantias/${retorno.warrantyId}`}
                        className="touch-target inline-flex items-center font-medium text-brand-600"
                      >
                        {formatWarrantyNumber(retorno.warrantyNumber)}
                      </Link>
                      <p className="truncate text-small text-ink-500">
                        {retorno.customerName ?? '—'}
                      </p>
                      <p className="text-small text-ink-500">{instante(retorno.registeredAt)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        tone={
                          retorno.coverageAssessment === 'covered'
                            ? 'success'
                            : retorno.coverageAssessment === 'not_covered'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {COVERAGE_ASSESSMENT_LABEL[
                          retorno.coverageAssessment as CoverageAssessment
                        ] ?? retorno.coverageAssessment}
                      </Badge>
                      <Badge tone={retorno.wasEnforceable === 1 ? 'success' : 'neutral'}>
                        {retorno.wasEnforceable === 1 ? 'Valia no dia' : 'Nao valia no dia'}
                      </Badge>
                    </div>
                  </div>

                  {retorno.returnServiceOrderId && retorno.returnNumber !== null ? (
                    <Link
                      href={`/ordens-de-servico/${retorno.returnServiceOrderId}`}
                      className="touch-target mt-2 inline-flex items-center text-ui font-semibold text-brand-600"
                    >
                      Abrir OS {retorno.returnNumber}
                    </Link>
                  ) : (
                    <p className="mt-2 text-small text-ink-500">Sem Ordem de Servico de garantia</p>
                  )}
                </CardListItem>
              ))}
            </CardList>
          </CardBody>
        )}
      </Card>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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
import { formatBRL } from '@/core/money/format';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import { loadCertificate } from '@/modules/warranties/application/warranty-certificate-service';
import { listWarrantyCosts } from '@/modules/warranties/application/warranty-cost-service';
import { findWarrantyDetail } from '@/modules/warranties/application/warranty-queries';
import {
  canCancel,
  canRevoke,
  certificatePathFor,
  COST_KIND_LABEL,
  COVERAGE_ASSESSMENT_LABEL,
  COVERAGE_KIND_LABEL,
  daysRemaining,
  DURATION_UNIT_LABEL,
  explainNotEnforceable,
  formatDuration,
  formatWarrantyNumber,
  isPartialCoverage,
  TEMPORAL_CLASS_LABEL,
  warrantyTimelineLabel,
  warrantyTypeLabel,
  WARRANTY_STATUS_LABEL,
  WARRANTY_STATUS_TONE,
  WARRANTY_TYPE_HINT,
  type CostKind,
  type WarrantyType,
  type CoverageAssessment,
  type CoverageKind,
  type DurationUnit,
  type WarrantyStatus,
} from '@/modules/warranties/domain/warranty';
import {
  cancelWarrantyAction,
  issueCertificateAction,
  recordCostAction,
  registerReturnAction,
  revokeWarrantyAction,
} from '../actions';
import { dataCivil, instante } from '../format';
import {
  IssueCertificateForm,
  LifecycleForm,
  RecordCostForm,
  RegisterReturnForm,
} from './warranty-forms';

interface PageProps {
  params: Promise<{ warrantyId: string }>;
}

export const metadata: Metadata = { title: 'Garantia' };

/**
 * Ficha da garantia (Prompt 13, itens 85, 87 e 88).
 *
 * A TELA DIZ O QUE ESTA COBERTO, nao "tem garantia". O caso que obriga isso e
 * rotineiro: a OS trocou a fonte, reparou a placa e fez limpeza, mas a
 * garantia cobre APENAS o reparo da fonte. Um "sim" na tela transformaria o
 * retorno por defeito na placa em garantia aceita, e a loja consertaria de
 * graca um servico que nunca garantiu.
 *
 * "ACIONAVEL" E CALCULADO AQUI, contra a data civil de hoje no fuso da
 * EMPRESA — nunca `new Date()` do navegador. Uma garantia que termina dia 15
 * termina no dia 15 da loja, e nao no dia 15 de quem abriu a tela viajando.
 *
 * O QUE NAO ESTA ACIONAVEL DIZ POR QUE. "Nao acionavel" sozinho faz o
 * atendente inventar a explicacao no balcao; a tela entrega a frase pronta —
 * terminou em tal dia, foi revogada, ainda nao comecou.
 */
export default async function WarrantyDetailPage({ params }: PageProps) {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_WARRANTIES,
    PERMISSIONS.WARRANTIES_VIEW,
  );

  const { warrantyId } = await params;
  const detail = await findWarrantyDetail(context, warrantyId);

  /** Garantia de outra empresa e garantia inexistente terminam no mesmo lugar. */
  if (!detail) notFound();

  const { warranty, temporal, enforceable, referenceDate } = detail;
  const status = warranty.status as WarrantyStatus;
  const impediment = explainNotEnforceable(warranty, referenceDate);
  const parcial = isPartialCoverage(warranty.coversWholeService === 1);

  const podeRetornar = hasPermission(context, PERMISSIONS.WARRANTIES_RETURN_CREATE);
  /**
   * A PERMISSAO e o ESTADO sao duas perguntas distintas, e as duas valem.
   *
   * Quem pode cancelar nem sempre pode cancelar ESTA garantia: uma ja
   * revogada nao se cancela. Quem decide isso e o dominio (`canCancel` /
   * `canRevoke`), nao uma comparacao repetida em cada tela — assim a regra
   * muda num lugar so quando mudar.
   */
  const podeCancelar =
    hasPermission(context, PERMISSIONS.WARRANTIES_CANCEL) && canCancel(warranty.status);
  const podeRevogar =
    hasPermission(context, PERMISSIONS.WARRANTIES_REVOKE) && canRevoke(warranty.status);
  const podeVerCustos = hasPermission(context, PERMISSIONS.WARRANTIES_COSTS_VIEW);
  const podeLancarCusto = hasPermission(context, PERMISSIONS.WARRANTIES_COSTS_MANAGE);
  const podeEmitir = hasPermission(context, PERMISSIONS.WARRANTIES_ISSUE);

  /**
   * Custos so sao lidos por quem PODE. A consulta recusa sozinha, mas pedir
   * para depois tratar a excecao deixaria a pagina inteira quebrar para o
   * atendente — que precisa da cobertura e nao precisa da margem da loja.
   */
  const [certificado, custos] = await Promise.all([
    loadCertificate(context, warrantyId),
    podeVerCustos ? listWarrantyCosts(context, warrantyId) : Promise.resolve(null),
  ]);

  const numero = formatWarrantyNumber(warranty.number);
  const restam = daysRemaining(warranty, referenceDate);

  const opcoesDeRetorno = detail.returns.map((retorno) => ({
    id: retorno.id,
    label: `${instante(retorno.registeredAt)}${
      retorno.returnServiceOrderNumber !== null ? ` · OS ${retorno.returnServiceOrderNumber}` : ''
    }`,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={numero}
        /*
          `as never` silenciaria o compilador e esconderia erro de nome de
          campo — foi assim que um bug real passou neste prompt. O cast
          explicito para o tipo certo continua conferindo a forma.
        */
        description={`${warrantyTypeLabel(warranty.type)} — ${
          WARRANTY_TYPE_HINT[warranty.type as WarrantyType] ?? ''
        }`}
        breadcrumbs={[
          { label: 'Garantias', href: '/garantias' },
          { label: 'Lista', href: '/garantias/lista' },
          { label: numero },
        ]}
        metadata={
          <span>
            {detail.customer?.name ?? 'Cliente nao encontrado'} · {detail.unitName ?? '—'}
          </span>
        }
        actions={
          detail.originServiceOrder ? (
            <Link
              href={`/ordens-de-servico/${detail.originServiceOrder.id}`}
              className={linkButtonClass('secondary')}
            >
              Abrir OS {detail.originServiceOrder.number}
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={WARRANTY_STATUS_TONE[status] ?? 'neutral'}>
          {WARRANTY_STATUS_LABEL[status] ?? warranty.status}
        </Badge>
        <Badge tone={temporal === 'valid' ? 'success' : 'neutral'}>
          {TEMPORAL_CLASS_LABEL[temporal]}
        </Badge>
        <Badge tone={enforceable ? 'success' : 'neutral'}>
          {enforceable ? 'Acionavel hoje' : 'Nao acionavel hoje'}
        </Badge>
        {parcial ? <Badge tone="warning">Cobertura parcial</Badge> : null}
      </div>

      {impediment ? <Alert tone="warning">{impediment}</Alert> : null}

      {enforceable && restam >= 0 && restam <= 30 ? (
        <Alert tone="info">
          Restam {restam} dia(s) de cobertura. O ultimo dia coberto ({dataCivil(warranty.endsOn)})
          conta inteiro.
        </Alert>
      ) : null}

      {/*
        `min-w-0` NAO E DECORACAO: item de grid nasce com `min-width: auto` e
        cresce ate o min-content do conteudo. Sem isso, um termo longo sem
        espaco estica o cartao e a pagina inteira rola na horizontal em 360px.
      */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader
            title="Vigencia"
            description="Dia de calendario no fuso da empresa. O ultimo dia conta inteiro."
            headingLevel={2}
          />
          <CardBody>
            <dl className="grid grid-cols-2 gap-4 text-ui">
              <div>
                <dt className="text-small text-ink-500">Inicio</dt>
                <dd className="font-medium text-ink-900">{dataCivil(warranty.startsOn)}</dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Ultimo dia coberto</dt>
                <dd className="font-medium text-ink-900">{dataCivil(warranty.endsOn)}</dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Prazo concedido</dt>
                <dd className="font-medium text-ink-900">
                  {formatDuration(warranty.durationAmount, warranty.durationUnit as DurationUnit)}
                </dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Unidade</dt>
                <dd className="font-medium text-ink-900">{detail.unitName ?? '—'}</dd>
              </div>
            </dl>

            <p className="mt-4 text-small text-ink-500">
              Contado em {DURATION_UNIT_LABEL[warranty.durationUnit as DurationUnit] ?? '—'}. Nao
              existe coluna &quot;expirada&quot; guardada no banco: a vigencia e comparada com a
              data de hoje toda vez que a tela abre.
            </p>
          </CardBody>
        </Card>

        <Card className="min-w-0">
          <CardHeader
            title="Aparelho e origem"
            description="A quem esta garantia pertence e de onde ela nasceu."
            headingLevel={2}
          />
          <CardBody>
            <dl className="space-y-3 text-ui">
              <div>
                <dt className="text-small text-ink-500">Cliente</dt>
                <dd className="font-medium text-ink-900">{detail.customer?.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Aparelho</dt>
                <dd className="font-medium text-ink-900">
                  {detail.equipment
                    ? [detail.equipment.kind, detail.equipment.brand, detail.equipment.model]
                        .filter(Boolean)
                        .join(' ')
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Ordem de Servico de origem</dt>
                <dd className="font-medium text-ink-900">
                  {detail.originServiceOrder ? (
                    <Link
                      href={`/ordens-de-servico/${detail.originServiceOrder.id}`}
                      className="touch-target inline-flex items-center text-brand-600 hover:underline"
                    >
                      OS {detail.originServiceOrder.number}
                    </Link>
                  ) : (
                    'Sem OS — garantia registrada diretamente sobre o aparelho.'
                  )}
                </dd>
              </div>
              {warranty.manufacturer || warranty.externalReference ? (
                <div>
                  <dt className="text-small text-ink-500">Fabricante / referencia</dt>
                  <dd className="font-medium text-ink-900">
                    {[warranty.manufacturer, warranty.externalReference]
                      .filter(Boolean)
                      .join(' · ')}
                  </dd>
                </div>
              ) : null}
              {warranty.partDescription || warranty.partCode ? (
                <div>
                  <dt className="text-small text-ink-500">Peca garantida</dt>
                  <dd className="font-medium text-ink-900">
                    {[warranty.partDescription, warranty.partCode].filter(Boolean).join(' · ')}
                    {warranty.installedOn ? (
                      <span className="block text-small font-normal text-ink-500">
                        Instalada em {dataCivil(warranty.installedOn)}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="O que esta coberto"
          description="Garantia nao e um sim ou nao: e uma lista do que a loja assumiu."
          headingLevel={2}
        />
        <CardBody className="space-y-4">
          {parcial ? (
            <Alert tone="warning">
              Esta garantia cobre APENAS os itens listados abaixo. Um defeito fora dessa lista nao
              esta coberto, mesmo dentro do prazo.
            </Alert>
          ) : (
            <Alert tone="info">
              Esta garantia cobre o servico realizado como um todo, exceto o que estiver nas
              exclusoes.
            </Alert>
          )}

          {detail.coverage.length === 0 ? (
            <p className="text-ui text-ink-500">
              Nenhum item de cobertura detalhado. Vale o resumo abaixo.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100 rounded-md border border-ink-200">
              {detail.coverage.map((item) => (
                <li key={item.id} className="flex flex-wrap gap-2 px-3 py-2">
                  <Badge tone="brand">
                    {COVERAGE_KIND_LABEL[item.kind as CoverageKind] ?? item.kind}
                  </Badge>
                  <span className="min-w-0 flex-1 text-ui text-ink-900">{item.description}</span>
                </li>
              ))}
            </ul>
          )}

          {warranty.coverageSummary ? (
            <div>
              <h3 className="text-ui font-semibold text-ink-900">Resumo da cobertura</h3>
              <p className="whitespace-pre-line text-ui text-ink-700">{warranty.coverageSummary}</p>
            </div>
          ) : null}

          {warranty.exclusions ? (
            <div>
              <h3 className="text-ui font-semibold text-ink-900">Exclusoes</h3>
              <p className="whitespace-pre-line text-ui text-ink-700">{warranty.exclusions}</p>
            </div>
          ) : null}

          {warranty.terms ? (
            <div>
              <h3 className="text-ui font-semibold text-ink-900">Termos</h3>
              <p className="whitespace-pre-line text-ui text-ink-700">{warranty.terms}</p>
            </div>
          ) : null}

          <p className="text-small text-ink-500">
            Estes termos sao os da EMISSAO. Se a politica da empresa mudar amanha, esta garantia
            continua valendo pelo que foi prometido hoje.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Certificado"
          description="Documento com os termos congelados no momento da emissao, com soma de verificacao."
          headingLevel={2}
        />
        <CardBody className="space-y-4">
          {certificado ? (
            <>
              <dl className="grid gap-3 sm:grid-cols-3 text-ui">
                <div className="min-w-0">
                  <dt className="text-small text-ink-500">Emitido em</dt>
                  <dd className="font-medium text-ink-900">{instante(certificado.issuedAt)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-small text-ink-500">Formato</dt>
                  <dd className="font-medium text-ink-900">HTML</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-small text-ink-500">Soma de verificacao</dt>
                  <dd className="truncate font-mono text-small text-ink-700">
                    {certificado.checksum}
                  </dd>
                </div>
              </dl>

              <Link
                href={certificatePathFor(certificado.token)}
                className={linkButtonClass('secondary', 'sm', 'touch-target')}
              >
                Ver certificado
              </Link>

              <p className="text-small text-ink-500">
                O link e o QR carregam apenas uma referencia opaca — nunca CPF, telefone, endereco
                ou o numero do cliente. Um QR e uma imagem que qualquer pessoa na fila do balcao
                consegue fotografar. Abrir o certificado ainda exige sessao valida: o token
                identifica, nao autoriza.
              </p>

              <p className="text-small text-ink-500">
                Nao ha PDF neste momento: o certificado existe como HTML com snapshot e soma de
                verificacao. Imprimir pelo navegador funciona; gerar arquivo PDF ainda nao.
              </p>
            </>
          ) : (
            <p className="text-ui text-ink-500">Nenhum certificado gerado para esta garantia.</p>
          )}

          {podeEmitir ? (
            <IssueCertificateForm
              warrantyId={warrantyId}
              existing={Boolean(certificado)}
              action={issueCertificateAction}
            />
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Retornos"
          description="Aparelhos que voltaram sob esta garantia. A recusa tambem fica registrada."
          headingLevel={2}
        />
        <CardBody className="p-0">
          {detail.returns.length === 0 ? (
            <EmptyState
              icon={<IconWarranty />}
              title="Nenhum retorno"
              description="Este aparelho nao voltou sob esta garantia."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {detail.returns.map((retorno) => (
                <li key={retorno.id} className="space-y-1 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ui font-medium text-ink-900">
                      {instante(retorno.registeredAt)}
                    </span>
                    <Badge
                      tone={
                        retorno.coverageAssessment === 'covered' && retorno.wasEnforceable === 1
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
                    {/*
                      "Estava valendo NO DIA" e diferente de "esta valendo
                      hoje". O retorno guarda o que era verdade quando o
                      aparelho voltou: uma garantia que venceu depois nao
                      transforma retroativamente um retorno aceito em recusado.
                    */}
                    <Badge tone={retorno.wasEnforceable === 1 ? 'success' : 'neutral'}>
                      {retorno.wasEnforceable === 1
                        ? 'Garantia valia no dia'
                        : 'Garantia nao valia no dia'}
                    </Badge>
                  </div>

                  <p className="text-ui text-ink-700">{retorno.customerReport}</p>

                  <p className="text-small text-ink-500">
                    Data de referencia: {dataCivil(retorno.referenceDate)}
                    {retorno.returnServiceOrderId && retorno.returnServiceOrderNumber !== null ? (
                      <>
                        {' · '}
                        <Link
                          href={`/ordens-de-servico/${retorno.returnServiceOrderId}`}
                          className="touch-target inline-flex items-center font-semibold text-brand-600"
                        >
                          OS {retorno.returnServiceOrderNumber}
                        </Link>
                      </>
                    ) : (
                      ' · sem Ordem de Servico de garantia'
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {podeRetornar ? (
        <Card>
          <CardHeader
            title="Registrar retorno"
            description="O aparelho voltou. Registrar o retorno e o ato; a Ordem de Servico nova sai dele."
            headingLevel={2}
          />
          <CardBody>
            <RegisterReturnForm
              warrantyId={warrantyId}
              action={registerReturnAction}
              enforceable={enforceable}
              impediment={impediment}
            />
          </CardBody>
        </Card>
      ) : null}

      {podeVerCustos && custos ? (
        <Card>
          <CardHeader
            title="Custos da garantia"
            description="Quanto esta garantia custou a loja. Isto mede gasto interno e nao gera cobranca."
            headingLevel={2}
          />
          <CardBody className="space-y-4">
            {custos.items.length === 0 ? (
              <p className="text-ui text-ink-500">Nenhum custo registrado.</p>
            ) : (
              <>
                <ul className="divide-y divide-ink-100 rounded-md border border-ink-200">
                  {custos.items.map((custo) => (
                    <li
                      key={custo.id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-ui text-ink-900">{custo.description}</p>
                        <p className="text-small text-ink-500">
                          {COST_KIND_LABEL[custo.kind as CostKind] ?? custo.kind}
                        </p>
                      </div>
                      <span className="whitespace-nowrap font-semibold tabular-nums text-ink-900">
                        {formatBRL(custo.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-right text-ui font-semibold tabular-nums text-ink-900">
                  Total: {formatBRL(custos.total)}
                </p>
              </>
            )}

            <p className="text-small text-ink-500">
              Conserto em garantia valida e gratuito para o cliente por definicao. Nenhum titulo,
              nenhum movimento no razao e nenhuma cobranca nascem daqui.
            </p>

            {podeLancarCusto ? (
              <RecordCostForm
                warrantyId={warrantyId}
                returns={opcoesDeRetorno}
                action={recordCostAction}
              />
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Historico"
          description="Tudo que aconteceu com esta garantia, em ordem, com quem fez."
          headingLevel={2}
        />
        <CardBody className="p-0">
          {detail.timeline.length === 0 ? (
            <EmptyState
              icon={<IconWarranty />}
              title="Sem historico"
              description="Nenhum evento registrado para esta garantia."
            />
          ) : (
            <ol className="divide-y divide-ink-100">
              {detail.timeline.map((evento) => (
                <li key={evento.id} className="space-y-1 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ui font-medium text-ink-900">
                      {warrantyTimelineLabel(evento.kind)}
                    </span>
                    <span className="text-small text-ink-500">{instante(evento.occurredAt)}</span>
                    <span className="text-small text-ink-500">{evento.actorName ?? 'Sistema'}</span>
                  </div>
                  {evento.summary ? <p className="text-ui text-ink-700">{evento.summary}</p> : null}
                  {evento.reason ? (
                    <p className="text-small text-ink-500">Motivo: {evento.reason}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      {podeCancelar || podeRevogar ? (
        <Card>
          <CardHeader
            title="Encerrar a garantia"
            description="Dois atos diferentes, nenhum deles apaga retorno ja registrado."
            headingLevel={2}
          />
          <CardBody className="grid gap-6 lg:grid-cols-2">
            {podeCancelar ? (
              <div className="min-w-0">
                <h3 className="mb-2 text-ui font-semibold text-ink-900">Cancelar</h3>
                <LifecycleForm
                  warrantyId={warrantyId}
                  kind="cancel"
                  action={cancelWarrantyAction}
                />
              </div>
            ) : null}

            {podeRevogar ? (
              <div className="min-w-0">
                <h3 className="mb-2 text-ui font-semibold text-ink-900">Revogar</h3>
                <LifecycleForm
                  warrantyId={warrantyId}
                  kind="revoke"
                  action={revokeWarrantyAction}
                />
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

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
  linkButtonClass,
  MetricCard,
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
import { hasPermission } from '@/modules/tenancy/domain/tenant-context';
import {
  listWarranties,
  listWarrantyReturns,
  loadWarrantyOverview,
} from '@/modules/warranties/application/warranty-queries';
import {
  COVERAGE_ASSESSMENT_LABEL,
  daysRemaining,
  formatWarrantyNumber,
  referenceDateFor,
  warrantyTypeLabel,
  type CoverageAssessment,
} from '@/modules/warranties/domain/warranty';
import { dataCivil, instante } from './format';

export const metadata: Metadata = { title: 'Garantias' };

/**
 * Visao geral de Garantias (Prompt 13, itens 85 e 86).
 *
 * SO METRICAS CUJA DEFINICAO E CONFERIVEL. Nao ha "indice de qualidade", nao
 * ha ranking de tecnico e nao ha "taxa de retrabalho": um numero que aponta
 * pessoas muda o comportamento da equipe antes de melhorar o processo — o
 * tecnico passa a evitar o conserto dificil, nao a errar menos.
 *
 * "RETORNO COBERTO" USA A DEFINICAO DO DOMINIO, nao "qualquer OS nova do mesmo
 * cliente": retorno com garantia vigente no dia E avaliado como coberto.
 *
 * TUDO E DAS UNIDADES AUTORIZADAS. A garantia dada pela loja do centro nao e
 * assunto da loja do bairro, e somar as duas responderia uma pergunta que
 * ninguem faz no balcao.
 */

/** O mes corrente, em data civil no fuso da empresa. */
function periodoDoMes(timeZone: string): { from: string; to: string } {
  const hoje = referenceDateFor(timeZone);
  const [ano, mes] = hoje.split('-');
  const ultimo = new Date(Date.UTC(Number(ano), Number(mes), 0)).getUTCDate();
  return { from: `${ano}-${mes}-01`, to: `${ano}-${mes}-${String(ultimo).padStart(2, '0')}` };
}

export default async function WarrantiesOverviewPage() {
  const { context } = await requireAccessForPage(
    FEATURES.OPERATIONS_WARRANTIES,
    PERMISSIONS.WARRANTIES_VIEW,
  );

  const periodo = periodoDoMes(context.tenantTimezone);
  const hoje = referenceDateFor(context.tenantTimezone);

  const [overview, vencendo, retornos] = await Promise.all([
    loadWarrantyOverview(context, periodo),
    listWarranties(context, { temporal: 'valid', expiringInDays: 30, pageSize: 10 }),
    listWarrantyReturns(context, 8),
  ]);

  const podeEmitir = hasPermission(context, PERMISSIONS.WARRANTIES_ISSUE);
  const podeConfigurar = hasPermission(context, PERMISSIONS.WARRANTIES_SETTINGS_MANAGE);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Garantias"
        description="O que a loja garantiu, por quanto tempo, sobre o que — e o que voltou."
        breadcrumbs={[{ label: 'Garantias' }]}
        metadata={
          <span>
            Periodo: {dataCivil(periodo.from)} a {dataCivil(periodo.to)}
          </span>
        }
        actions={
          <Link href="/garantias/lista" className={linkButtonClass('primary')}>
            Ver todas as garantias
          </Link>
        }
      />

      {/*
        A NAVEGACAO DO MODULO FICA NO CORPO, nao no cabecalho.

        O slot de acoes do PageHeader e `shrink-0` de proposito — a acao
        principal nao deve encolher. Tres ou quatro botoes ali dentro fazem a
        pagina inteira rolar na horizontal em 768px, como ja aconteceu no
        Financeiro. Aqui a barra quebra linha a vontade.
      */}
      <nav aria-label="Secoes de Garantias" className="flex flex-wrap gap-2">
        <Link href="/garantias/lista" className={linkButtonClass('secondary')}>
          Garantias
        </Link>
        <Link href="/garantias/retornos" className={linkButtonClass('secondary')}>
          Retornos
        </Link>
        {podeConfigurar ? (
          <Link href="/garantias/politicas" className={linkButtonClass('secondary')}>
            Politicas
          </Link>
        ) : null}
      </nav>

      {context.authorizedUnitIds.length === 0 ? (
        <Alert tone="warning">
          Voce nao tem nenhuma unidade autorizada, entao nao ha garantias para mostrar.
        </Alert>
      ) : null}

      <section aria-labelledby="titulo-indicadores" className="space-y-3">
        <h2 id="titulo-indicadores" className="text-heading-sm text-ink-900">
          Situacao
        </h2>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Garantias vigentes"
            value={String(overview.active)}
            hint="Ativas e dentro da vigencia hoje, no fuso da empresa. Nao ha coluna 'expirada' para alguem esquecer de atualizar."
          />
          <MetricCard
            label="Vencem em 30 dias"
            value={String(overview.expiringSoon)}
            hint="Vigentes hoje cujo ultimo dia coberto cai nos proximos 30 dias."
          />
          <MetricCard
            label="Retornos no mes"
            value={String(overview.returnsInPeriod)}
            hint="Retornos registrados no periodo, cobertos ou nao. Registrar o retorno recusado tambem e registrar."
          />
          <MetricCard
            label="Retornos cobertos no mes"
            value={String(overview.returnsCovered)}
            hint="Retorno com garantia vigente no dia E avaliado como coberto. Nao e 'qualquer OS nova do mesmo cliente'."
          />
        </div>
      </section>

      <Card>
        <CardHeader
          title="Proximas a vencer"
          description="Quem ainda tem cobertura e por pouco tempo. Serve para o balcao responder antes de o cliente perguntar."
          headingLevel={2}
          action={
            <Link
              href="/garantias/lista?vencendo=30"
              className="touch-target inline-flex items-center text-ui font-semibold text-brand-600 hover:underline"
            >
              Ver lista
            </Link>
          }
        />
        <CardBody className="p-0">
          {vencendo.items.length === 0 ? (
            <EmptyState
              icon={<IconWarranty />}
              title="Nenhuma garantia vencendo"
              description="Nenhuma garantia vigente termina nos proximos 30 dias nestas unidades."
              action={
                podeEmitir ? (
                  /*
                    O ALVO DE TOQUE VEM ANTES DO TAMANHO VISUAL.

                    `sm` mede 32px de altura, e num estado vazio esta e a UNICA
                    coisa clicavel da tela: em 360px o dedo erra. `touch-target`
                    devolve os 44px do item 54 sem mexer no resto do estilo,
                    porque `min-height` vence a altura fixa quando e maior.

                    Descoberto pela jornada no navegador, nao pela leitura do
                    codigo — o estado vazio so aparece quando nao ha dado.
                  */
                  <Link
                    href="/garantias/lista"
                    className={linkButtonClass('secondary', 'sm', 'touch-target')}
                  >
                    Ver garantias
                  </Link>
                ) : null
              }
            />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <Table caption="Garantias vigentes que vencem nos proximos 30 dias">
                  <THead>
                    <TR>
                      <TH>Garantia</TH>
                      <TH>Cliente</TH>
                      <TH>Aparelho</TH>
                      <TH>Ultimo dia</TH>
                      <TH align="right">Restam</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {vencendo.items.map((item) => (
                      <TR key={item.id}>
                        <TD className="whitespace-nowrap">
                          <Link
                            href={`/garantias/${item.id}`}
                            className="font-medium text-brand-600 hover:underline"
                          >
                            {formatWarrantyNumber(item.number)}
                          </Link>
                          <span className="block text-small text-ink-500">
                            {warrantyTypeLabel(item.type)}
                          </span>
                        </TD>
                        <TD>{item.customerName ?? '—'}</TD>
                        <TD>{item.equipmentLabel ?? '—'}</TD>
                        <TD className="whitespace-nowrap">{dataCivil(item.endsOn)}</TD>
                        <TD align="right" className="whitespace-nowrap tabular-nums">
                          {daysRemaining(item, hoje)} dia(s)
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>

              <CardList label="Garantias proximas a vencer" className="md:hidden">
                {vencendo.items.map((item) => (
                  <CardListItem key={item.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/garantias/${item.id}`}
                          className="touch-target inline-flex items-center font-medium text-brand-600"
                        >
                          {formatWarrantyNumber(item.number)}
                        </Link>
                        <p className="truncate text-small text-ink-500">
                          {item.customerName ?? '—'}
                        </p>
                        <p className="truncate text-small text-ink-500">
                          {item.equipmentLabel ?? '—'}
                        </p>
                      </div>
                      <Badge tone="warning">{daysRemaining(item, hoje)} dia(s)</Badge>
                    </div>
                    <p className="mt-2 text-small text-ink-500">
                      Ultimo dia coberto: {dataCivil(item.endsOn)}
                    </p>
                  </CardListItem>
                ))}
              </CardList>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Retornos recentes"
          description="Aparelhos que voltaram. O retorno recusado aparece aqui igual ao aceito — a recusa tambem e historico."
          headingLevel={2}
          action={
            <Link
              href="/garantias/retornos"
              className="touch-target inline-flex items-center text-ui font-semibold text-brand-600 hover:underline"
            >
              Ver retornos
            </Link>
          }
        />
        <CardBody className="p-0">
          {retornos.length === 0 ? (
            <EmptyState
              icon={<IconWarranty />}
              title="Nenhum retorno registrado"
              description="Nenhum aparelho voltou em garantia nestas unidades. O retorno nasce na ficha da garantia."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {retornos.map((retorno) => (
                <li key={retorno.id} className="flex flex-wrap gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/garantias/${retorno.warrantyId}`}
                      className="touch-target inline-flex items-center font-medium text-brand-600"
                    >
                      {formatWarrantyNumber(retorno.warrantyNumber)}
                    </Link>
                    <p className="truncate text-small text-ink-500">
                      {retorno.customerName ?? '—'} · {warrantyTypeLabel(retorno.warrantyType)}
                    </p>
                    <p className="text-small text-ink-500">{instante(retorno.registeredAt)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
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
                    {retorno.returnServiceOrderId && retorno.returnNumber !== null ? (
                      <Link
                        href={`/ordens-de-servico/${retorno.returnServiceOrderId}`}
                        className="touch-target inline-flex items-center text-small font-semibold text-brand-600"
                      >
                        OS {retorno.returnNumber}
                      </Link>
                    ) : (
                      <span className="text-small text-ink-500">Sem OS de garantia</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className="text-small text-ink-500">
        Emitir garantia, registrar retorno e reclassificar sao permissoes separadas de consultar.
        Nenhuma delas envia mensagem ao cliente — avisar continua sendo ato humano.
      </p>
    </div>
  );
}

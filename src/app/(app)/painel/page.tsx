import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BarList,
  Card,
  CardBody,
  CardHeader,
  linkButtonClass,
  MetricCard,
  PageHeader,
  Section,
} from '@/design-system/components';
import { formatCivilDateBR } from '@/core/time/civil-date';
import { formatBRL } from '@/core/money/format';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { listUnits } from '@/modules/tenancy/application/tenancy-queries';
import { loadDashboard } from '@/modules/analytics/application/dashboard-query-service';
import { PERIOD_KEYS, PERIOD_LABEL } from '@/modules/analytics/domain/analytics-scope';

export const metadata: Metadata = { title: 'Painel' };

/**
 * O PAINEL (Prompt 18).
 *
 * "Dashboard le; dominio decide." Nada aqui altera status, aprova orcamento,
 * movimenta estoque ou envia mensagem — cada numero e uma LEITURA agregada
 * dos modulos oficiais, com definicao e origem demonstraveis (o texto embaixo
 * de cada cartao, vindo do Metric Catalog).
 *
 * O ESTADO DO FILTRO VIVE NA URL (periodo e unidade), mesma convencao da
 * Central de Trabalho: link compartilhavel, revalidado sempre no servidor.
 */

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function hrefCom(
  atual: { period: string; unitId: string | null },
  mudanca: Partial<typeof atual>,
): string {
  const params = new URLSearchParams();
  const period = mudanca.period ?? atual.period;
  if (period !== '30d') params.set('periodo', period);
  const unitId = mudanca.unitId === undefined ? atual.unitId : mudanca.unitId;
  if (unitId) params.set('unidade', unitId);
  const texto = params.toString();
  return texto ? `/painel?${texto}` : '/painel';
}

function formatPercent(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.ANALYTICS_DASHBOARD,
    PERMISSIONS.ANALYTICS_VIEW,
  );

  const params = await searchParams;
  const periodoParam = single(params.periodo);
  const unidadeParam = single(params.unidade);

  const [dashboard, todasAsUnidades] = await Promise.all([
    loadDashboard(context, {
      period: periodoParam,
      unitIds: unidadeParam ? [unidadeParam] : undefined,
    }),
    listUnits(context),
  ]);

  const unidadesAutorizadas = todasAsUnidades.filter((unit) =>
    context.authorizedUnitIds.includes(unit.id),
  );

  const atual = {
    period: dashboard.scope.period.key,
    unitId: dashboard.scope.allUnitsSelected ? null : (dashboard.scope.selectedUnitIds[0] ?? null),
  };

  const os = dashboard.serviceOrders;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Painel"
        description="Indicadores agregados dos modulos operacionais. Leitura, nunca acao."
        breadcrumbs={[{ label: 'Painel' }]}
        metadata={
          <span>
            {dashboard.scope.period.label} · {formatCivilDateBR(dashboard.scope.period.from)} a{' '}
            {formatCivilDateBR(dashboard.scope.period.to)}
          </span>
        }
      />

      {/* Filtro de periodo. Link, nao form: estado inteiro cabe na URL. */}
      <nav aria-label="Periodo" className="flex flex-wrap gap-2">
        {PERIOD_KEYS.filter((key) => key !== 'custom').map((key) => (
          <Link
            key={key}
            href={hrefCom(atual, { period: key })}
            aria-current={dashboard.scope.period.key === key ? 'page' : undefined}
            className={linkButtonClass(
              dashboard.scope.period.key === key ? 'primary' : 'secondary',
              'sm',
            )}
          >
            {PERIOD_LABEL[key]}
          </Link>
        ))}
      </nav>

      {/* Filtro de unidade. "Todas" SEMPRE significa as autorizadas (item 22). */}
      {unidadesAutorizadas.length > 1 ? (
        <nav aria-label="Unidade" className="flex flex-wrap gap-2">
          <Link
            href={hrefCom(atual, { unitId: null })}
            aria-current={dashboard.scope.allUnitsSelected ? 'page' : undefined}
            className={linkButtonClass(
              dashboard.scope.allUnitsSelected ? 'primary' : 'secondary',
              'sm',
            )}
          >
            Todas as unidades
          </Link>
          {unidadesAutorizadas.map((unit) => (
            <Link
              key={unit.id}
              href={hrefCom(atual, { unitId: unit.id })}
              aria-current={
                !dashboard.scope.allUnitsSelected && atual.unitId === unit.id ? 'page' : undefined
              }
              className={linkButtonClass(
                !dashboard.scope.allUnitsSelected && atual.unitId === unit.id
                  ? 'primary'
                  : 'secondary',
                'sm',
              )}
            >
              {unit.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {/* --- Ordens de Servico: sempre presente, e CORE. -------------------- */}
      <Section id="os" title="Ordens de Servico" description="A operacao de assistencia, primeiro.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="OS em aberto"
            value={os.openTotal}
            hint="Situacoes nao terminais, agora."
          />
          <MetricCard
            label="Entradas no periodo"
            value={os.createdInPeriod}
            hint={
              <Link
                href={`/ordens-de-servico?de=${dashboard.scope.period.from}&ate=${dashboard.scope.period.to}`}
              >
                Ver lista &rarr;
              </Link>
            }
          />
          <MetricCard
            label="Finalizacoes no periodo"
            value={os.completedInPeriod}
            hint="status_changed_at no periodo."
          />
          <MetricCard
            label="Cancelamentos no periodo"
            value={os.cancelledInPeriod}
            hint="status_changed_at no periodo."
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="OS por situacao" description="Todas as situacoes oficiais, agora." />
            <CardBody>
              <BarList
                items={os.statusDistribution.map((row) => ({
                  key: row.status,
                  label: row.label,
                  value: row.total,
                  href: `/ordens-de-servico?situacao=${row.status}`,
                }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Antiguidade do backlog aberto"
              description="Dias corridos desde a abertura."
            />
            <CardBody>
              <BarList
                items={os.backlogAging.map((bucket) => ({
                  key: bucket.key,
                  label: bucket.label,
                  value: bucket.total,
                  tone: 'neutral',
                }))}
              />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Tempo de ciclo"
            description="Abertura ate finalizacao, so OS finalizadas no periodo."
          />
          <CardBody>
            {os.cycleTime ? (
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="font-heading text-h3 font-bold text-ink-900">
                    {os.cycleTime.medianDays.toFixed(1)}
                  </p>
                  <p className="text-small text-ink-500">Mediana (dias)</p>
                </div>
                <div>
                  <p className="font-heading text-h3 font-bold text-ink-900">
                    {os.cycleTime.averageDays.toFixed(1)}
                  </p>
                  <p className="text-small text-ink-500">Media (dias)</p>
                </div>
                <div>
                  <p className="font-heading text-h3 font-bold text-ink-900">
                    {os.cycleTime.sampleSize}
                  </p>
                  <p className="text-small text-ink-500">OS na amostra</p>
                </div>
              </div>
            ) : (
              <p className="text-ui text-ink-500">Sem dados suficientes no periodo selecionado.</p>
            )}
          </CardBody>
        </Card>
      </Section>

      {/* --- Orcamentos --------------------------------------------------- */}
      {dashboard.quotes ? (
        <Section id="orcamentos" title="Orcamentos">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Enviados no periodo" value={dashboard.quotes.sentInPeriod} />
            <MetricCard label="Aprovados no periodo" value={dashboard.quotes.approvedInPeriod} />
            <MetricCard label="Rejeitados no periodo" value={dashboard.quotes.rejectedInPeriod} />
            <MetricCard
              label="Taxa de decisao aprovada"
              value={formatPercent(dashboard.quotes.approvalRate)}
              hint="Pendentes nao entram no calculo."
            />
          </div>
        </Section>
      ) : null}

      {/* --- Financeiro ----------------------------------------------------- */}
      {dashboard.finance ? (
        <Section id="financeiro" title="Financeiro">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              label="Recebimentos liquidados"
              value={formatBRL(dashboard.finance.settlementsInPeriod)}
              hint="No periodo selecionado."
            />
            <MetricCard
              label="Contas a receber em aberto"
              value={formatBRL(dashboard.finance.receivableOpen)}
              hint="Agora, independente do periodo."
            />
            <MetricCard
              label="Contas a receber vencidas"
              value={formatBRL(dashboard.finance.receivableOverdue)}
              hint="Subconjunto do saldo em aberto."
            />
          </div>
        </Section>
      ) : null}

      {/* --- Estoque e Compras ------------------------------------------- */}
      {dashboard.inventory || dashboard.purchasing ? (
        <Section id="estoque-compras" title="Estoque e Compras">
          <div className="grid gap-3 sm:grid-cols-3">
            {dashboard.inventory ? (
              <MetricCard
                label="Itens abaixo do minimo"
                value={dashboard.inventory.lowStockCount}
              />
            ) : null}
            {dashboard.purchasing ? (
              <>
                <MetricCard label="Necessidades em aberto" value={dashboard.purchasing.openNeeds} />
                <MetricCard label="Pedidos em aberto" value={dashboard.purchasing.openOrders} />
              </>
            ) : null}
          </div>
        </Section>
      ) : null}

      {/* --- Garantias ------------------------------------------------------ */}
      {dashboard.warranties ? (
        <Section id="garantias" title="Garantias">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard label="Garantias vigentes" value={dashboard.warranties.activeCount} />
            <MetricCard label="Retornos no periodo" value={dashboard.warranties.returnsInPeriod} />
          </div>
        </Section>
      ) : null}

      {/* --- Agenda ----------------------------------------------------------- */}
      {dashboard.agenda ? (
        <Section id="agenda" title="Agenda">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard label="Tarefas vencidas" value={dashboard.agenda.overdueTasks} />
            <MetricCard label="Tarefas para hoje" value={dashboard.agenda.todayTasks} />
          </div>
        </Section>
      ) : null}

      {/* --- Comunicacao -------------------------------------------------- */}
      {dashboard.communications ? (
        <Section
          id="comunicacao"
          title="Comunicacao"
          description="Mensagens registradas — nao ha confirmacao de entrega nem de leitura."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard
              label="Mensagens registradas"
              value={dashboard.communications.registeredInPeriod}
            />
            <MetricCard
              label="Mensagens com falha"
              value={dashboard.communications.failedInPeriod}
            />
          </div>
        </Section>
      ) : null}
    </div>
  );
}

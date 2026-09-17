import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  linkButtonClass,
  PageHeader,
  Section,
} from '@/design-system/components';
import { IconCamera, IconHistory } from '@/design-system/icons';
import { can } from '@/modules/access-control/application/authorization-service';
import { requireAccessForPage } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { formatCivilDateBR, isOverdue, isDueOrOverdue } from '@/core/time/civil-date';
import {
  POWER_CABLE_LABEL,
  VOLTAGE_LABEL,
  conditionLabel,
  equipmentTitle,
} from '@/modules/equipment/domain/equipment';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  findServiceOrderDetail,
  getServiceOrderNumberFormat,
  listUnitMembers,
} from '@/modules/service-orders/application/service-order-queries';
import {
  getQuoteNumberFormat,
  listQuotesForServiceOrder,
} from '@/modules/quotes/application/quote-queries';
import { isDeliveryPreparationDone } from '@/modules/service-orders/application/workflow-service';
import {
  formatServiceOrderNumber,
  timelineLabel,
} from '@/modules/service-orders/domain/service-order';
import {
  CANCEL_RULE,
  TASK_STATUS_LABEL,
  manualTransitionsFrom,
  type TaskStatus,
} from '@/modules/service-orders/domain/workflow';
import {
  assignTechnicianAction,
  cancelServiceOrderAction,
  completeTaskAction,
  notifyCustomerReadyAction,
  requestPartPickupAction,
  rescheduleFollowUpAction,
  transitionAction,
} from '../actions';
import {
  CompleteTaskButton,
  FollowUpPanel,
  NotifyCustomerPanel,
  PartPickupPanel,
  TechnicianPanel,
  WorkflowPanel,
  type TransitionOption,
} from './workflow-panel';
import {
  listReservationsForServiceOrder,
  searchPartsForPicker,
} from '@/modules/inventory/application/inventory-queries';
import {
  consumeReservationAction,
  releaseReservationAction,
  reservePartAction,
} from '../../estoque/actions';
import { findServiceOrderCharge } from '@/modules/finance/application/finance-integration-service';
import { formatTitleNumber } from '@/modules/finance/domain/finance';
import { Money } from '@/core/money/money';
import { todayIn } from '@/core/time/civil-date';
import { createServiceOrderChargeAction } from '../../financeiro/actions';
import { FinanceSection } from './finance-section';
import { PartsSection } from './parts-section';
import { QuoteSection } from './orcamentos/quote-section';

export const metadata: Metadata = { title: 'Ordem de Servico' };

/**
 * Ficha da Ordem de Servico (Prompt 07, itens 51 a 60; Prompt 08, itens 78 a 86).
 *
 * Esta e a BASE do futuro workspace da OS. Hoje ela mostra exatamente o que
 * existe: identificacao, cliente, aparelho, o que o cliente relatou, o que veio
 * no recebimento, a situacao no workflow, quem e o responsavel, o proximo
 * acompanhamento, as tarefas e a linha do tempo real.
 *
 * NAO HA ABA VAZIA (item 58) nem botao sem backend (item 60). Diagnostico,
 * orcamento, pecas e garantia terao seu lugar aqui quando existirem — e aba
 * "em breve" e pior do que a ausencia dela, porque ensina a equipe a ignorar a
 * interface.
 *
 * QUEM DECIDE O QUE APARECE NAO E ESTA PAGINA (Prompt 08, item 79). Ela
 * pergunta a maquina de estados quais transicoes existem a partir da situacao
 * atual e pergunta ao controle de acesso quais delas esta pessoa pode executar
 * NA UNIDADE DA ORDEM — que nem sempre e a unidade ativa da sessao. A
 * revalidacao no servidor continua acontecendo dentro de cada caso de uso: o
 * que a tela esconde, o backend tambem recusa.
 */
export default async function ServiceOrderDetailPage({
  params,
}: {
  params: Promise<{ serviceOrderId: string }>;
}) {
  const { context } = await requireAccessForPage(
    FEATURES.CORE_SERVICE_ORDERS,
    PERMISSIONS.SERVICE_ORDERS_VIEW,
  );

  const { serviceOrderId } = await params;

  const [detail, numberFormat] = await Promise.all([
    findServiceOrderDetail(context, serviceOrderId),
    getServiceOrderNumberFormat(context.tenantId),
  ]);

  // Outra empresa, outra unidade e inexistente terminam no mesmo lugar.
  if (!detail) notFound();

  const { order, customer, equipmentItem, unitName, openedByName, intake, timeline } = detail;
  const number = formatServiceOrderNumber(order.number, numberFormat.prefix, numberFormat.padding);
  const title = equipmentTitle(equipmentItem);

  /**
   * Permissoes SEMPRE na unidade da ordem (item 81).
   *
   * Usar a unidade ativa aqui deixaria alguem com acesso a duas lojas mexer na
   * ordem da loja B enquanto olha a loja A — e a lista de botoes ficaria
   * diferente do que o caso de uso aceita.
   */
  const unitScope = { featureKey: FEATURES.CORE_SERVICE_ORDERS, unitId: order.unitId } as const;
  const [
    canUpdateDecision,
    canCancelDecision,
    canAssignDecision,
    canFollowUpDecision,
    canTasksDecision,
    canViewQuotesDecision,
    canCreateQuoteDecision,
  ] = await Promise.all([
    can(context, { ...unitScope, permission: PERMISSIONS.SERVICE_ORDERS_UPDATE }),
    can(context, { ...unitScope, permission: CANCEL_RULE.permission }),
    can(context, { ...unitScope, permission: PERMISSIONS.SERVICE_ORDERS_ASSIGN_TECHNICIAN }),
    can(context, { ...unitScope, permission: PERMISSIONS.SERVICE_ORDERS_MANAGE_FOLLOW_UP }),
    can(context, { ...unitScope, permission: PERMISSIONS.SERVICE_ORDERS_MANAGE_TASKS }),
    can(context, {
      permission: PERMISSIONS.QUOTES_VIEW,
      featureKey: FEATURES.CORE_QUOTES,
      unitId: order.unitId,
    }),
    can(context, {
      permission: PERMISSIONS.QUOTES_CREATE,
      featureKey: FEATURES.CORE_QUOTES,
      unitId: order.unitId,
    }),
  ]);

  /**
   * As transicoes vem da maquina de estados, nao de um `if` nesta pagina. O
   * filtro por permissao e por transicao porque finalizar exige permissao
   * propria (item 51).
   */
  const candidates = manualTransitionsFrom(order.status).filter(
    (rule) => rule.to !== CANCEL_RULE.to,
  );
  const allowed = await Promise.all(
    candidates.map((rule) => can(context, { ...unitScope, permission: rule.permission })),
  );
  const transitions: TransitionOption[] = candidates
    .filter((_, index) => allowed[index]?.allowed === true)
    .map((rule) => ({
      to: rule.to,
      label: rule.label,
      requiresReason: rule.requiresReason === true,
      ...(rule.hint ? { hint: rule.hint } : {}),
    }));

  const cancelOption: TransitionOption | null =
    canCancelDecision.allowed && manualTransitionsFrom(order.status).length > 0
      ? {
          to: CANCEL_RULE.to,
          label: CANCEL_RULE.label,
          requiresReason: true,
          ...(CANCEL_RULE.hint ? { hint: CANCEL_RULE.hint } : {}),
        }
      : null;

  /**
   * A lista de responsaveis so e consultada quando a pessoa pode atribuir, e a
   * condicao da acao "Informar Ordem Disponivel" so e consultada no estado em
   * que ela existe — nao ha consulta paga para desenhar o que nao aparece.
   */
  /**
   * O modulo de Estoque e OPCIONAL (Prompt 10, itens 84 a 87). Quando ele esta
   * desligado — ou a pessoa nao tem `inventory.view` — a secao de pecas
   * simplesmente nao existe nesta pagina, e a OS continua inteira.
   */
  const canViewInventoryDecision = await can(context, {
    permission: PERMISSIONS.INVENTORY_VIEW,
    featureKey: FEATURES.OPERATIONS_INVENTORY,
    unitId: order.unitId,
  });

  const canReserveDecision = canViewInventoryDecision.allowed
    ? await can(context, {
        permission: PERMISSIONS.INVENTORY_RESERVE,
        featureKey: FEATURES.OPERATIONS_INVENTORY,
        unitId: order.unitId,
      })
    : { allowed: false };

  const canConsumeDecision = canViewInventoryDecision.allowed
    ? await can(context, {
        permission: PERMISSIONS.INVENTORY_ISSUE,
        featureKey: FEATURES.OPERATIONS_INVENTORY,
        unitId: order.unitId,
      })
    : { allowed: false };

  /**
   * COMPRAS E OPCIONAL E SEPARADO (Prompt 11, itens 29, 80 e 84).
   *
   * A OS nao sabe comprar nada: ela apenas oferece o atalho para registrar que
   * uma peca falta. Se o modulo estiver desligado — ou a pessoa nao puder
   * registrar necessidade — a secao simplesmente nao existe, e a OS continua
   * inteira. Nada aqui muda a situacao da Ordem de Servico.
   */
  const canCreateNeedDecision = await can(context, {
    permission: PERMISSIONS.PURCHASES_CREATE,
    featureKey: FEATURES.OPERATIONS_PURCHASING,
    unitId: order.unitId,
  });

  /**
   * FINANCEIRO E OPCIONAL (Prompt 12, itens 29, 68 e 91).
   *
   * Duas permissoes, de proposito: `finance.view` mostra a secao; criar a
   * cobranca exige `finance.receivables.manage`. O tecnico que acompanha o
   * atendimento ve quanto falta receber sem poder emitir cobranca, e isso e o
   * arranjo comum numa loja de tres pessoas.
   */
  const canViewFinanceDecision = await can(context, {
    permission: PERMISSIONS.FINANCE_VIEW,
    featureKey: FEATURES.FINANCE_CORE,
    unitId: order.unitId,
  });

  const canChargeDecision = canViewFinanceDecision.allowed
    ? await can(context, {
        permission: PERMISSIONS.FINANCE_RECEIVABLES_MANAGE,
        featureKey: FEATURES.FINANCE_CORE,
        unitId: order.unitId,
      })
    : { allowed: false };

  const [members, preparationDone, quoteList, quoteNumberFormat, reservationList, partChoices] =
    await Promise.all([
      canAssignDecision.allowed ? listUnitMembers(context, order.unitId) : Promise.resolve([]),
      order.status === 'awaiting_delivery_preparation'
        ? isDeliveryPreparationDone(context, order.id)
        : Promise.resolve(false),
      canViewQuotesDecision.allowed
        ? listQuotesForServiceOrder(context, order.id)
        : Promise.resolve([]),
      canViewQuotesDecision.allowed
        ? getQuoteNumberFormat(context.tenantId)
        : Promise.resolve({ prefix: 'ORC', padding: 6 }),
      canViewInventoryDecision.allowed
        ? listReservationsForServiceOrder(context, order.id)
        : Promise.resolve([]),
      canReserveDecision.allowed ? searchPartsForPicker(context, '', 50) : Promise.resolve([]),
    ]);

  /** A cobranca ja existente, quando ha: e ela que a secao mostra. */
  const charge = canViewFinanceDecision.allowed
    ? await findServiceOrderCharge(context, order.id)
    : null;

  /**
   * O valor sugerido sai do orcamento APROVADO. Nao e o maior orcamento nem o
   * ultimo: e o que o cliente aceitou. Sem orcamento aprovado nao ha sugestao,
   * e a pessoa informa o valor — nao se inventa um numero.
   */
  const approvedQuote = quoteList.find((quote) => quote.status === 'approved') ?? null;

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: context.tenantTimezone,
  });

  const openTasks = detail.tasks.filter((task) => task.status === 'open');
  const followUpLate = order.followUpAt
    ? isOverdue(order.followUpAt, context.tenantTimezone)
    : false;
  const followUpDue = order.followUpAt
    ? isDueOrOverdue(order.followUpAt, context.tenantTimezone)
    : false;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/*
        No celular o cabecalho e o que responde primeiro: qual OS, de quem,
        qual aparelho (itens 77 e 78). Nada de KPI inventado (item 52).
      */}
      <PageHeader
        title={number}
        eyebrow={title}
        breadcrumbs={[
          { label: 'Ordens de Servico', href: '/ordens-de-servico' },
          { label: number },
        ]}
        metadata={
          <>
            {/* `py-1` deixa o link tocavel no celular (24px minimo, item 78). */}
            <Link
              href={`/clientes/${customer.id}`}
              className="inline-flex items-center py-1 hover:underline"
            >
              {customer.name}
            </Link>
            <span>{unitName ?? 'Unidade removida'}</span>
            <span>Aberta em {formatter.format(order.openedAt)}</span>
          </>
        }
        actions={
          canUpdateDecision.allowed ? (
            <Link
              href={`/ordens-de-servico/${order.id}/editar`}
              className={linkButtonClass('secondary')}
            >
              Corrigir abertura
            </Link>
          ) : null
        }
      />

      {/*
        SITUACAO E ACOES juntas, no topo (itens 78 e 84). Quem abre a ficha no
        celular precisa ver onde a ordem esta e o que fazer em seguida sem
        rolar a tela.
      */}
      <WorkflowPanel
        serviceOrderId={order.id}
        status={order.status}
        version={order.version}
        transitions={transitions}
        canCancel={cancelOption}
        transitionAction={transitionAction}
        cancelAction={cancelServiceOrderAction}
      />

      <Card>
        <CardBody>
          <dl className="grid gap-4 text-ui sm:grid-cols-2">
            <div>
              <dt className="text-small text-ink-500">Aberta por</dt>
              <dd className="text-ink-900">{openedByName ?? 'Sistema'}</dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Tecnico responsavel</dt>
              <dd className="text-ink-900">
                {detail.technicianName ?? 'Ainda sem responsavel definido'}
              </dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Proximo acompanhamento</dt>
              <dd className="text-ink-900">
                {order.followUpAt ? (
                  <span className="flex flex-wrap items-center gap-2">
                    {formatCivilDateBR(order.followUpAt)}
                    {/* Cor com rotulo em texto ao lado (item 86). */}
                    {followUpLate ? (
                      <Badge tone="danger">Vencido</Badge>
                    ) : followUpDue ? (
                      <Badge tone="warning">Vence hoje</Badge>
                    ) : null}
                  </span>
                ) : (
                  'Sem acompanhamento agendado'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-small text-ink-500">Tarefas abertas</dt>
              <dd className="text-ink-900">
                {openTasks.length === 0 ? 'Nenhuma' : `${openTasks.length} tarefa(s)`}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      {/*
        RESPONSABILIDADE E ACOMPANHAMENTO (itens 26 a 29 e 39). Cada painel so
        aparece para quem tem a permissao correspondente NA UNIDADE DA ORDEM.
      */}
      {canAssignDecision.allowed || canFollowUpDecision.allowed ? (
        <Section
          id="acompanhamento"
          title="Responsabilidade e acompanhamento"
          description="Quem conserta e quando esta ordem volta a pedir atencao."
        >
          <Card>
            <CardBody className="grid gap-6 sm:grid-cols-2">
              {canAssignDecision.allowed ? (
                <TechnicianPanel
                  serviceOrderId={order.id}
                  technicianId={order.assignedTechnicianId}
                  members={members}
                  action={assignTechnicianAction}
                />
              ) : null}
              {canFollowUpDecision.allowed ? (
                <FollowUpPanel
                  serviceOrderId={order.id}
                  followUpAt={order.followUpAt}
                  action={rescheduleFollowUpAction}
                />
              ) : null}
            </CardBody>
          </Card>
        </Section>
      ) : null}

      {/*
        TAREFAS (itens 22, 23, 30 a 32). Tarefa NAO e situacao: a ordem pode
        estar Aguardando Peca com ou sem a tarefa de busca aberta, e concluir a
        preparacao nao muda a situacao sozinho.
      */}
      <Section
        id="tarefas"
        title="Tarefas"
        description="O trabalho pratico desta ordem. Concluir uma tarefa nao muda a situacao sozinho."
      >
        <Card>
          <CardBody className="space-y-4">
            {detail.tasks.length === 0 ? (
              <p className="text-ui text-ink-600">Nenhuma tarefa registrada nesta ordem.</p>
            ) : (
              <ul className="divide-y divide-ink-200">
                {detail.tasks.map((task) => {
                  const late =
                    task.status === 'open' &&
                    task.dueDate !== null &&
                    isOverdue(task.dueDate, context.tenantTimezone);

                  return (
                    <li key={task.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium text-ink-900">{task.title}</p>
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={task.status === 'done' ? 'success' : 'neutral'}>
                            {TASK_STATUS_LABEL[task.status as TaskStatus] ?? task.status}
                          </Badge>
                          {late ? <Badge tone="danger">Atrasada</Badge> : null}
                        </span>
                      </div>
                      {task.description ? (
                        <p className="mt-1 text-ui text-ink-700">{task.description}</p>
                      ) : null}
                      <p className="mt-1 text-small text-ink-500">
                        {task.dueDate ? `Prazo ${formatCivilDateBR(task.dueDate)}` : 'Sem prazo'}
                        {task.assigneeName ? ` · ${task.assigneeName}` : ''}
                        {task.completedAt
                          ? ` · Concluida em ${formatter.format(task.completedAt)}`
                          : ''}
                      </p>
                      {task.status === 'open' && canTasksDecision.allowed ? (
                        <CompleteTaskButton taskId={task.id} action={completeTaskAction} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {/*
              "Buscar Peca" e ACAO, nao estado (itens 13 e 16): a ordem segue
              Aguardando Peca depois de registrada.
            */}
            {order.status === 'awaiting_part' && canTasksDecision.allowed ? (
              <PartPickupPanel serviceOrderId={order.id} action={requestPartPickupAction} />
            ) : null}

            {/*
              "Informar Ordem Disponivel" e a UNICA porta para Aguardando
              Cliente Retirar (itens 17, 62 e 132), e depende da preparacao
              concluida.
            */}
            {order.status === 'awaiting_delivery_preparation' ? (
              <NotifyCustomerPanel
                serviceOrderId={order.id}
                version={order.version}
                ready={preparationDone}
                action={notifyCustomerReadyAction}
              />
            ) : null}
          </CardBody>
        </Card>
      </Section>

      {/*
        ORCAMENTOS (Prompt 09, itens 80 e 81).
        A secao so aparece para quem pode ver orcamentos — e so existe porque o
        modulo existe. Ate o Prompt 08 a ficha nao tinha nada disto, justamente
        para nao prometer o que nao havia.
      */}
      {canViewQuotesDecision.allowed ? (
        <Section
          id="orcamentos"
          title="Orcamentos"
          description="Propostas comerciais deste atendimento. O cliente so ve o que for enviado."
        >
          <QuoteSection
            serviceOrderId={order.id}
            quotes={quoteList}
            numberFormat={quoteNumberFormat}
            canCreate={canCreateQuoteDecision.allowed}
            timeZone={context.tenantTimezone}
            idempotencyKey={`os-${order.id}-orc-${quoteList.length}`}
          />
        </Section>
      ) : null}

      {/*
        PECAS — reserva e consumo (Prompt 10, itens 69 e 103 a 105).
        Fica DEPOIS do orcamento de proposito: a ordem na tela conta a historia
        do atendimento, e a peca so vira compromisso quando alguem decide
        reserva-la. Aprovar orcamento nao reserva nada.
      */}
      {canViewInventoryDecision.allowed ? (
        <Section
          id="pecas"
          title="Pecas"
          description="Pecas reservadas e consumidas neste atendimento. Reservar e consumir nao mudam a situacao da Ordem de Servico."
        >
          <PartsSection
            serviceOrderId={order.id}
            reservations={reservationList}
            parts={partChoices.map((part) => ({
              id: part.id,
              code: part.code,
              name: part.name,
            }))}
            canReserve={canReserveDecision.allowed}
            canConsume={canConsumeDecision.allowed}
            reserveAction={reservePartAction}
            releaseAction={releaseReservationAction}
            consumeAction={consumeReservationAction}
          />
        </Section>
      ) : null}

      {/*
        FINANCEIRO (Prompt 12, itens 29 e 68).

        A secao fica DEPOIS de pecas e ANTES de compras porque e essa a ordem
        do atendimento: orca, separa a peca, e so entao cobra. Ela NUNCA muda
        a situacao da Ordem de Servico — o Financeiro nao escreve em
        `service_orders`, e pagar nao e a mesma coisa que retirar o aparelho.
      */}
      {canViewFinanceDecision.allowed ? (
        <Section
          id="financeiro"
          title="Financeiro"
          description="Cobranca deste atendimento. Gerar, receber ou quitar nao muda a situacao da Ordem de Servico."
        >
          <FinanceSection
            serviceOrderId={order.id}
            charge={
              charge
                ? {
                    id: charge.id,
                    number: charge.number,
                    amount: charge.amount,
                    settledAmount: charge.settledAmount,
                    outstanding: Money.parse(charge.amount)
                      .subtract(Money.parse(charge.settledAmount))
                      .toString(),
                    status: charge.status,
                    dueDate: charge.dueDate,
                    installmentCount: charge.installmentCount,
                    formattedNumber: formatTitleNumber('receivable', charge.number),
                  }
                : null
            }
            suggestedAmount={approvedQuote?.total ?? null}
            suggestedDescription={`Servico da OS ${number}`}
            today={todayIn(context.tenantTimezone)}
            canCreate={canChargeDecision.allowed}
            action={createServiceOrderChargeAction}
          />
        </Section>
      ) : null}

      {/*
        COMPRAS — o atalho, nao o modulo (Prompt 11, item 29).
        A OS nao compra: ela registra que a peca falta. Quem autoriza a despesa
        e quem recebe a mercadoria estao em Compras, e a situacao desta OS nao
        muda por causa de nenhum dos dois.
      */}
      {canCreateNeedDecision.allowed ? (
        <Section
          id="compras"
          title="Compras"
          description="Quando a peca nao esta no estoque, registre a necessidade. Registrar nao compra nada e nao muda a situacao desta Ordem de Servico."
        >
          <Card>
            <CardBody>
              <Link
                href={`/compras/necessidades?os=${order.id}`}
                className={linkButtonClass('secondary')}
              >
                Registrar necessidade de compra
              </Link>
            </CardBody>
          </Card>
        </Section>
      ) : null}

      {/*
        RELATO DO CLIENTE em bloco proprio, com rotulo explicito de que nao e
        diagnostico (item 22). `whitespace-pre-wrap` preserva as quebras de
        linha digitadas; React escapa o conteudo, entao nao ha caminho que
        interprete HTML aqui.
      */}
      <Section
        id="relato"
        title="Relato do cliente"
        description="O que a pessoa contou no balcao. Nao e diagnostico tecnico."
      >
        <Card>
          <CardBody>
            <p className="whitespace-pre-wrap text-ui text-ink-800">{order.customerReport}</p>
          </CardBody>
        </Card>
      </Section>

      {order.internalNotes ? (
        <Section
          id="observacoes"
          title="Observacoes internas"
          description="Recado da equipe. Nao e apresentado ao cliente."
        >
          <Card>
            <CardBody>
              <p className="whitespace-pre-wrap text-ui text-ink-800">{order.internalNotes}</p>
            </CardBody>
          </Card>
        </Section>
      ) : null}

      <Section
        id="equipamento"
        title="Equipamento"
        description="Identificacao do aparelho atendido nesta ordem."
      >
        <Card>
          <CardBody className="space-y-4">
            <dl className="grid gap-4 text-ui sm:grid-cols-2">
              <div>
                <dt className="text-small text-ink-500">Tipo</dt>
                <dd className="text-ink-900">{equipmentItem.kind}</dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Marca e modelo</dt>
                <dd className="text-ink-900">{title}</dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Numero de serie</dt>
                <dd className="text-ink-900">{equipmentItem.serial ?? 'Nao informado'}</dd>
              </div>
              <div>
                <dt className="text-small text-ink-500">Tensao</dt>
                <dd className="text-ink-900">
                  {VOLTAGE_LABEL[equipmentItem.voltage as keyof typeof VOLTAGE_LABEL] ??
                    'Nao identificada'}
                </dd>
              </div>
            </dl>
            <Link
              href={`/equipamentos/${equipmentItem.id}`}
              className="touch-target inline-flex items-center text-ui font-semibold text-brand-600 hover:underline md:min-h-0"
            >
              Abrir a ficha do equipamento
            </Link>
          </CardBody>
        </Card>
      </Section>

      {/*
        RECEBIMENTO: lido do modulo de Equipamentos, nunca copiado (itens 55 e
        56). A OS mostra a inspecao, os acessorios e as fotos de entrada; a
        fonte continua sendo o recebimento.
      */}
      {intake ? (
        <Section
          id="recebimento"
          title="Recebimento de origem"
          description="Como o aparelho chegou. Os dados pertencem ao recebimento, e sao apenas exibidos aqui."
        >
          <Card>
            <CardBody className="space-y-4">
              <dl className="grid gap-4 text-ui sm:grid-cols-2">
                <div>
                  <dt className="text-small text-ink-500">Entrada</dt>
                  <dd className="text-ink-900">{formatter.format(intake.receivedAt)}</dd>
                </div>
                <div>
                  <dt className="text-small text-ink-500">Cabo de forca</dt>
                  <dd className="text-ink-900">
                    {POWER_CABLE_LABEL[intake.powerCable as keyof typeof POWER_CABLE_LABEL] ?? '—'}
                  </dd>
                </div>
              </dl>

              {intake.accessories.length > 0 ? (
                <div>
                  <p className="text-small text-ink-500">Acessorios entregues</p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {intake.accessories.map((accessory) => (
                      <li key={accessory.id}>
                        <Badge>
                          {accessory.quantity > 1 ? `${accessory.quantity}x ` : ''}
                          {accessory.label}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {intake.conditions.length > 0 ? (
                <div>
                  <p className="text-small text-ink-500">Estado na entrada</p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {intake.conditions.map((condition) => (
                      <li key={condition.id}>
                        <Badge tone="warning">{conditionLabel(condition.conditionKey)}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {intake.inspectionNotes ? (
                <p className="whitespace-pre-wrap text-ui text-ink-700">{intake.inspectionNotes}</p>
              ) : null}
            </CardBody>
          </Card>
        </Section>
      ) : null}

      {/*
        FOTOS: a imagem continua no storage privado do equipamento e e servida
        pela rota autenticada (item 56). A OS aponta para ela — nao ha copia.
      */}
      <Section
        id="fotos"
        title="Fotos"
        description="Imagens do equipamento e da entrada, servidas pela rota autenticada."
      >
        <Card>
          {detail.equipmentMedia.length === 0 ? (
            <EmptyState
              icon={<IconCamera />}
              title="Nenhuma foto"
              description="Este aparelho ainda nao tem fotos registradas."
            />
          ) : (
            <CardBody>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {detail.equipmentMedia.map((media) => (
                  <li key={media.id} className="rounded-md border border-ink-200 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- rota autenticada, fora do otimizador */}
                    <img
                      src={`/api/midia/${media.id}`}
                      alt={media.caption ?? 'Foto do equipamento'}
                      className="h-32 w-full rounded-md object-cover"
                      loading="lazy"
                    />
                  </li>
                ))}
              </ul>
            </CardBody>
          )}
        </Card>
      </Section>

      {/*
        HISTORICO ESTRUTURAL (itens 38 e 59): somente fatos que aconteceram de
        verdade. Nada de "em breve" e nada de evento futuro inventado.
      */}
      <Section
        id="historico"
        title="Historico"
        description="Os fatos desta Ordem de Servico, do mais recente para o mais antigo."
      >
        <Card>
          {timeline.length === 0 ? (
            <EmptyState
              icon={<IconHistory />}
              title="Sem registros"
              description="Nenhum fato foi registrado nesta ordem ainda."
            />
          ) : (
            <CardBody>
              <ul className="divide-y divide-ink-200">
                {timeline.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                    <p className="font-medium text-ink-900">
                      {entry.summary ?? timelineLabel(entry.kind)}
                    </p>
                    {/*
                      O MOTIVO ESCRITO APARECE AQUI (item 108). Exigir a
                      justificativa no cancelamento e guarda-la sem nunca
                      mostra-la transformaria a exigencia em burocracia: quem
                      abre a ficha meses depois precisa ler POR QUE a ordem foi
                      encerrada, nao so que foi.
                    */}
                    {entry.reason ? (
                      <p className="whitespace-pre-wrap text-ui text-ink-700">{entry.reason}</p>
                    ) : null}
                    <p className="text-small text-ink-500">
                      {formatter.format(entry.occurredAt)}
                      {entry.actorName ? ` · ${entry.actorName}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </CardBody>
          )}
        </Card>
      </Section>
    </div>
  );
}

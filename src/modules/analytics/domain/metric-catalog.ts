import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';
import { FEATURES, type FeatureKey } from '@/modules/features/domain/catalog';

/**
 * CATALOGO DE METRICAS DO PAINEL (Prompt 18, itens 9 a 11 e 20 a 25).
 *
 * "Todo numero exibido precisa ter uma definicao e uma origem demonstraveis."
 *
 * ESTE ARQUIVO E A UNICA AUTORIDADE sobre o que uma metrica significa, de
 * onde ela vem e quem pode ve-la. `DashboardQueryService` e os adaptadores de
 * dominio SO PODEM produzir um numero para uma chave que exista aqui — nada
 * na tela nasce de uma consulta ad hoc sem definicao (item 8).
 *
 * Metric Definition != Metric Query != Dashboard Widget (item 10): esta
 * definicao e DADO ESTATICO (nome, formula, requisitos de acesso). A consulta
 * que produz o VALOR vive nos adaptadores em `application/*-metrics.ts`. O
 * componente React que desenha o cartao nao sabe nada disto — ele recebe um
 * valor ja pronto.
 */

export type MetricDomain =
  | 'service_orders'
  | 'quotes'
  | 'finance'
  | 'inventory'
  | 'purchasing'
  | 'warranties'
  | 'agenda'
  | 'communications';

export const METRIC_DOMAIN_LABEL: Record<MetricDomain, string> = {
  service_orders: 'Ordens de Servico',
  quotes: 'Orcamentos',
  finance: 'Financeiro',
  inventory: 'Estoque',
  purchasing: 'Compras',
  warranties: 'Garantias',
  agenda: 'Agenda',
  communications: 'Comunicacao',
};

export type MetricUnit = 'count' | 'money_brl' | 'days' | 'percent';

/**
 * `instant`  -> retrato de AGORA, independente do filtro de periodo (ex.: OS
 *               abertas, garantias vigentes).
 * `period`   -> depende do filtro de periodo selecionado (ex.: OS finalizadas
 *               entre duas datas).
 */
export type MetricGranularity = 'instant' | 'period';

export interface MetricDefinition {
  readonly key: string;
  readonly label: string;
  /** Texto pt-BR usado como ajuda/tooltip (item 135): a definicao, em uma frase. */
  readonly description: string;
  readonly domain: MetricDomain;
  /** Descricao tecnica curta da regra de agregacao — nao e SQL literal. */
  readonly formula: string;
  readonly unit: MetricUnit;
  readonly granularity: MetricGranularity;
  readonly requiredFeatureKey: FeatureKey;
  readonly requiredPermission: PermissionKey;
  /** O que a UI mostra quando nao ha amostra (item 44) — nunca "0" enganoso. */
  readonly emptyBehavior: string;
  /** `true` quando existe um link de drill-down reconciliado (itens 45 e 46). */
  readonly hasDrilldown: boolean;
}

export const METRIC_CATALOG: readonly MetricDefinition[] = [
  // --- Ordens de Servico -----------------------------------------------------
  {
    key: 'os.status_distribution',
    label: 'OS por situacao',
    description:
      'Quantidade de Ordens de Servico da unidade em cada situacao oficial do fluxo, agora.',
    domain: 'service_orders',
    formula: 'COUNT(*) agrupado por service_orders.status, sem filtro de periodo.',
    unit: 'count',
    granularity: 'instant',
    requiredFeatureKey: FEATURES.CORE_SERVICE_ORDERS,
    requiredPermission: PERMISSIONS.SERVICE_ORDERS_VIEW,
    emptyBehavior: 'Cada situacao sem OS aparece com 0 — nunca some da lista.',
    hasDrilldown: true,
  },
  {
    key: 'os.open_total',
    label: 'OS em aberto',
    description:
      'Ordens de Servico em qualquer situacao NAO terminal (todas exceto Finalizada e Cancelada), agora.',
    domain: 'service_orders',
    formula: 'Soma das situacoes nao terminais de os.status_distribution.',
    unit: 'count',
    granularity: 'instant',
    requiredFeatureKey: FEATURES.CORE_SERVICE_ORDERS,
    requiredPermission: PERMISSIONS.SERVICE_ORDERS_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao ha OS aberta na unidade.',
    hasDrilldown: false,
  },
  {
    key: 'os.created_in_period',
    label: 'Entradas no periodo',
    description:
      'Ordens de Servico cuja abertura (service_orders.opened_at) cai no periodo selecionado.',
    domain: 'service_orders',
    formula: 'COUNT(*) WHERE opened_at BETWEEN inicio E fim do periodo (fuso do tenant).',
    unit: 'count',
    granularity: 'period',
    requiredFeatureKey: FEATURES.CORE_SERVICE_ORDERS,
    requiredPermission: PERMISSIONS.SERVICE_ORDERS_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao houve abertura no periodo.',
    hasDrilldown: true,
  },
  {
    key: 'os.completed_in_period',
    label: 'Finalizacoes no periodo',
    description:
      'Ordens de Servico que estao Finalizadas HOJE e cuja ultima mudanca de situacao (status_changed_at) cai no periodo. Como Finalizada e situacao terminal, esse instante e a propria finalizacao.',
    domain: 'service_orders',
    formula:
      "COUNT(*) WHERE status = 'completed' AND status_changed_at BETWEEN inicio E fim do periodo.",
    unit: 'count',
    granularity: 'period',
    requiredFeatureKey: FEATURES.CORE_SERVICE_ORDERS,
    requiredPermission: PERMISSIONS.SERVICE_ORDERS_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao houve finalizacao no periodo.',
    hasDrilldown: false,
  },
  {
    key: 'os.cancelled_in_period',
    label: 'Cancelamentos no periodo',
    description:
      'Ordens de Servico canceladas cuja ultima mudanca de situacao (status_changed_at) cai no periodo. Nunca somada com finalizacoes.',
    domain: 'service_orders',
    formula:
      "COUNT(*) WHERE status = 'cancelled' AND status_changed_at BETWEEN inicio E fim do periodo.",
    unit: 'count',
    granularity: 'period',
    requiredFeatureKey: FEATURES.CORE_SERVICE_ORDERS,
    requiredPermission: PERMISSIONS.SERVICE_ORDERS_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao houve cancelamento no periodo.',
    hasDrilldown: false,
  },
  {
    key: 'os.backlog_aging',
    label: 'Antiguidade do backlog aberto',
    description:
      'Ordens de Servico atualmente abertas, agrupadas por dias corridos desde a abertura (opened_at) ate hoje.',
    domain: 'service_orders',
    formula:
      'COUNT(*) agrupado em faixas de (hoje - opened_at) para OS nao terminais, independente do periodo selecionado.',
    unit: 'count',
    granularity: 'instant',
    requiredFeatureKey: FEATURES.CORE_SERVICE_ORDERS,
    requiredPermission: PERMISSIONS.SERVICE_ORDERS_VIEW,
    emptyBehavior: 'Cada faixa sem OS aparece com 0.',
    hasDrilldown: false,
  },
  {
    key: 'os.cycle_time',
    label: 'Tempo de ciclo',
    description:
      'Dias corridos entre abertura (opened_at) e finalizacao (status_changed_at) das OS finalizadas no periodo. Mediana e media, lado a lado.',
    domain: 'service_orders',
    formula:
      "Para status='completed' com status_changed_at no periodo: dias corridos entre a data civil de opened_at e a de status_changed_at, no fuso do tenant (ADR-084); mediana e media da amostra.",
    unit: 'days',
    granularity: 'period',
    requiredFeatureKey: FEATURES.CORE_SERVICE_ORDERS,
    requiredPermission: PERMISSIONS.SERVICE_ORDERS_VIEW,
    emptyBehavior: '"Sem dados suficientes" quando nenhuma OS foi finalizada no periodo.',
    hasDrilldown: false,
  },

  // --- Orcamentos --------------------------------------------------------
  {
    key: 'quote.sent_in_period',
    label: 'Orcamentos enviados',
    description: 'Orcamentos cujo envio (quotes.sent_at) cai no periodo selecionado.',
    domain: 'quotes',
    formula: 'COUNT(*) WHERE sent_at BETWEEN inicio E fim do periodo.',
    unit: 'count',
    granularity: 'period',
    requiredFeatureKey: FEATURES.CORE_QUOTES,
    requiredPermission: PERMISSIONS.QUOTES_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao houve envio no periodo.',
    hasDrilldown: false,
  },
  {
    key: 'quote.approved_in_period',
    label: 'Orcamentos aprovados',
    description:
      "Orcamentos com status 'approved' cuja decisao (quotes.decided_at) cai no periodo.",
    domain: 'quotes',
    formula: "COUNT(*) WHERE status = 'approved' AND decided_at BETWEEN inicio E fim do periodo.",
    unit: 'count',
    granularity: 'period',
    requiredFeatureKey: FEATURES.CORE_QUOTES,
    requiredPermission: PERMISSIONS.QUOTES_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao houve aprovacao no periodo.',
    hasDrilldown: false,
  },
  {
    key: 'quote.rejected_in_period',
    label: 'Orcamentos rejeitados',
    description:
      "Orcamentos com status 'rejected' cuja decisao (quotes.decided_at) cai no periodo.",
    domain: 'quotes',
    formula: "COUNT(*) WHERE status = 'rejected' AND decided_at BETWEEN inicio E fim do periodo.",
    unit: 'count',
    granularity: 'period',
    requiredFeatureKey: FEATURES.CORE_QUOTES,
    requiredPermission: PERMISSIONS.QUOTES_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao houve rejeicao no periodo.',
    hasDrilldown: false,
  },
  {
    key: 'quote.approval_rate',
    label: 'Taxa de decisao aprovada',
    description:
      'aprovados / (aprovados + rejeitados) no periodo, pela data de decisao. Orcamentos ainda pendentes NAO entram no denominador.',
    domain: 'quotes',
    formula: 'approved_in_period / (approved_in_period + rejected_in_period).',
    unit: 'percent',
    granularity: 'period',
    requiredFeatureKey: FEATURES.CORE_QUOTES,
    requiredPermission: PERMISSIONS.QUOTES_VIEW,
    emptyBehavior: '"—" quando nao houve nenhuma decisao (aprovada ou rejeitada) no periodo.',
    hasDrilldown: false,
  },

  // --- Financeiro ----------------------------------------------------------
  {
    key: 'finance.settlements_in_period',
    label: 'Recebimentos liquidados',
    description:
      'Soma das liquidacoes financeiras confirmadas (nao estornadas) de titulos a RECEBER, pela data em que o dinheiro se moveu, no periodo.',
    domain: 'finance',
    formula:
      "SUM(financial_settlements.amount) WHERE direction='receivable' AND status='confirmed' AND effective_date no periodo. Reaproveita loadFinanceOverview().receivedInPeriod.",
    unit: 'money_brl',
    granularity: 'period',
    requiredFeatureKey: FEATURES.FINANCE_CORE,
    requiredPermission: PERMISSIONS.FINANCE_VIEW,
    emptyBehavior: 'Mostra R$ 0,00 quando realmente nao houve liquidacao no periodo.',
    hasDrilldown: false,
  },
  {
    key: 'finance.receivable_open',
    label: 'Contas a receber em aberto',
    description:
      'Saldo em aberto (valor do titulo menos o ja liquidado) dos titulos a receber com status aberto ou parcialmente liquidado, agora.',
    domain: 'finance',
    formula:
      "SUM(amount - settled_amount) WHERE direction='receivable' AND status IN ('open','partially_settled'). Reaproveita loadFinanceOverview().receivableOpen.",
    unit: 'money_brl',
    granularity: 'instant',
    requiredFeatureKey: FEATURES.FINANCE_CORE,
    requiredPermission: PERMISSIONS.FINANCE_VIEW,
    emptyBehavior: 'Mostra R$ 0,00 quando realmente nao ha saldo em aberto.',
    hasDrilldown: false,
  },
  {
    key: 'finance.receivable_overdue',
    label: 'Contas a receber vencidas',
    description:
      'Igual a "Contas a receber em aberto", restrito aos titulos com vencimento anterior a hoje.',
    domain: 'finance',
    formula:
      'Mesma base de finance.receivable_open, com due_date < hoje. Reaproveita loadFinanceOverview().receivableOverdue.',
    unit: 'money_brl',
    granularity: 'instant',
    requiredFeatureKey: FEATURES.FINANCE_CORE,
    requiredPermission: PERMISSIONS.FINANCE_VIEW,
    emptyBehavior: 'Mostra R$ 0,00 quando realmente nao ha titulo vencido.',
    hasDrilldown: false,
  },

  // --- Estoque ---------------------------------------------------------------
  {
    key: 'inventory.low_stock_count',
    label: 'Itens abaixo do minimo',
    description:
      'Numero de pecas cujo saldo disponivel (em estoque menos reservado) esta abaixo da quantidade minima configurada.',
    domain: 'inventory',
    formula:
      'COUNT(*) WHERE minimum_quantity > 0 AND (on_hand - reserved) < minimum_quantity — a MESMA regra oficial do Prompt 10 (low-stock-job.ts).',
    unit: 'count',
    granularity: 'instant',
    requiredFeatureKey: FEATURES.OPERATIONS_INVENTORY,
    requiredPermission: PERMISSIONS.INVENTORY_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao ha peca abaixo do minimo.',
    hasDrilldown: false,
  },

  // --- Compras ---------------------------------------------------------------
  {
    key: 'purchasing.open_needs',
    label: 'Necessidades de compra em aberto',
    description: "Necessidades de compra com status 'open', agora.",
    domain: 'purchasing',
    formula: "COUNT(*) WHERE status = 'open'.",
    unit: 'count',
    granularity: 'instant',
    requiredFeatureKey: FEATURES.OPERATIONS_PURCHASING,
    requiredPermission: PERMISSIONS.PURCHASES_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao ha necessidade em aberto.',
    hasDrilldown: false,
  },
  {
    key: 'purchasing.open_orders',
    label: 'Pedidos de compra em aberto',
    description:
      "Pedidos de compra em 'placed' ou 'partially_received' — ja enviados ao fornecedor e ainda nao totalmente recebidos.",
    domain: 'purchasing',
    formula: "COUNT(*) WHERE status IN ('placed','partially_received').",
    unit: 'count',
    granularity: 'instant',
    requiredFeatureKey: FEATURES.OPERATIONS_PURCHASING,
    requiredPermission: PERMISSIONS.PURCHASES_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao ha pedido em aberto.',
    hasDrilldown: false,
  },

  // --- Garantias ---------------------------------------------------------
  {
    key: 'warranty.active_count',
    label: 'Garantias vigentes',
    description: "Garantias com status 'active' cuja vigencia (startsOn/endsOn) cobre hoje.",
    domain: 'warranties',
    formula:
      "COUNT(*) WHERE status='active' AND startsOn <= hoje <= endsOn (mesma regra de temporalClassOf === 'valid').",
    unit: 'count',
    granularity: 'instant',
    requiredFeatureKey: FEATURES.OPERATIONS_WARRANTIES,
    requiredPermission: PERMISSIONS.WARRANTIES_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao ha garantia vigente.',
    hasDrilldown: false,
  },
  {
    key: 'warranty.returns_in_period',
    label: 'Retornos em garantia',
    description:
      'Retornos em garantia (warranty_returns) registrados no periodo, pela data de registro.',
    domain: 'warranties',
    formula: 'COUNT(*) WHERE warranty_returns.registered_at no periodo.',
    unit: 'count',
    granularity: 'period',
    requiredFeatureKey: FEATURES.OPERATIONS_WARRANTIES,
    requiredPermission: PERMISSIONS.WARRANTIES_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao houve retorno no periodo.',
    hasDrilldown: false,
  },

  // --- Agenda --------------------------------------------------------------
  {
    key: 'agenda.overdue_tasks',
    label: 'Tarefas vencidas',
    description: 'Tarefas da Agenda em aberto cujo prazo (due_date) ja passou, agora.',
    domain: 'agenda',
    formula:
      "COUNT(*) WHERE status='open' AND due_date < hoje (mesma regra de bucketFor === 'overdue').",
    unit: 'count',
    granularity: 'instant',
    requiredFeatureKey: FEATURES.OPERATIONS_AGENDA,
    requiredPermission: PERMISSIONS.AGENDA_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao ha tarefa vencida.',
    hasDrilldown: false,
  },
  {
    key: 'agenda.today_tasks',
    label: 'Tarefas para hoje',
    description: 'Tarefas da Agenda em aberto cujo prazo (due_date) e hoje.',
    domain: 'agenda',
    formula: "COUNT(*) WHERE status='open' AND due_date = hoje.",
    unit: 'count',
    granularity: 'instant',
    requiredFeatureKey: FEATURES.OPERATIONS_AGENDA,
    requiredPermission: PERMISSIONS.AGENDA_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao ha tarefa para hoje.',
    hasDrilldown: false,
  },

  // --- Comunicacao ---------------------------------------------------------
  {
    key: 'communication.registered_in_period',
    label: 'Mensagens registradas',
    description:
      'Mensagens de comunicacao com o cliente registradas no periodo (qualquer status). NAO indica entrega nem leitura — o provedor real ainda nao esta integrado (ADR-078).',
    domain: 'communications',
    formula: 'COUNT(*) WHERE created_at no periodo.',
    unit: 'count',
    granularity: 'period',
    requiredFeatureKey: FEATURES.COMMUNICATIONS_CORE,
    requiredPermission: PERMISSIONS.COMMUNICATIONS_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao houve mensagem no periodo.',
    hasDrilldown: false,
  },
  {
    key: 'communication.failed_in_period',
    label: 'Mensagens com falha',
    description: "Mensagens com status 'failed' registradas no periodo.",
    domain: 'communications',
    formula: "COUNT(*) WHERE status = 'failed' AND created_at no periodo.",
    unit: 'count',
    granularity: 'period',
    requiredFeatureKey: FEATURES.COMMUNICATIONS_CORE,
    requiredPermission: PERMISSIONS.COMMUNICATIONS_VIEW,
    emptyBehavior: 'Mostra 0 quando realmente nao houve falha no periodo.',
    hasDrilldown: false,
  },
] as const;

const BY_KEY = new Map<string, MetricDefinition>(METRIC_CATALOG.map((m) => [m.key, m]));

export function findMetric(key: string): MetricDefinition | undefined {
  return BY_KEY.get(key);
}

export function metricsForDomain(domain: MetricDomain): readonly MetricDefinition[] {
  return METRIC_CATALOG.filter((m) => m.domain === domain);
}

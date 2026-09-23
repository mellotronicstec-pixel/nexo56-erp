import 'server-only';
import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';
import { permissionsInScope } from '@/modules/access-control/application/authorization-service';
import { checkManyAccess } from '@/modules/features/application/effective-access';
import { FEATURES, type FeatureKey } from '@/modules/features/domain/catalog';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  resolveAnalyticsScope,
  type AnalyticsScope,
} from '@/modules/analytics/domain/analytics-scope';
import {
  loadAgendaMetrics,
  type AgendaMetrics,
} from '@/modules/analytics/application/agenda-metrics';
import {
  loadCommunicationMetrics,
  type CommunicationMetrics,
} from '@/modules/analytics/application/communication-metrics';
import {
  loadFinanceMetrics,
  type FinanceMetrics,
} from '@/modules/analytics/application/finance-metrics';
import {
  loadInventoryMetrics,
  type InventoryMetrics,
} from '@/modules/analytics/application/inventory-metrics';
import {
  loadPurchasingMetrics,
  type PurchasingMetrics,
} from '@/modules/analytics/application/purchasing-metrics';
import { loadQuoteMetrics, type QuoteMetrics } from '@/modules/analytics/application/quote-metrics';
import {
  loadServiceOrderMetrics,
  type ServiceOrderMetrics,
} from '@/modules/analytics/application/service-order-metrics';
import {
  loadWarrantyMetrics,
  type WarrantyMetrics,
} from '@/modules/analytics/application/warranty-metrics';

/**
 * O PAINEL, EM UMA CHAMADA (Prompt 18).
 *
 * "Dashboard Access + Feature Access + Domain Permission + Unit Scope =
 * Metric Access" (item 25): NENHUM adaptador de dominio e chamado antes de
 * confirmar as quatro coisas. Um cartao escondido no React NAO E SEGURANCA
 * se o dado continua saindo da consulta (item 26) — por isso a decisao mora
 * aqui, no servidor, e nunca no componente.
 *
 * `analytics.view` ABRE A TELA (verificado por `requireAccessForPage` na
 * propria pagina, antes desta funcao rodar). Aqui dentro, CADA dominio exige
 * a SUA PROPRIA feature e permissao, na(s) MESMA(S) unidade(s) da consulta —
 * nunca herdada de `analytics.view` (item 24).
 */

export interface DashboardFilters {
  unitIds?: readonly string[];
  period?: string;
  from?: string;
  to?: string;
}

export interface DashboardView {
  scope: AnalyticsScope;
  serviceOrders: ServiceOrderMetrics;
  quotes: QuoteMetrics | null;
  finance: FinanceMetrics | null;
  inventory: InventoryMetrics | null;
  purchasing: PurchasingMetrics | null;
  warranties: WarrantyMetrics | null;
  agenda: AgendaMetrics | null;
  communications: CommunicationMetrics | null;
}

interface DomainRequirement {
  featureKey: FeatureKey;
  permission: PermissionKey;
}

const DOMAIN_REQUIREMENTS = {
  serviceOrders: {
    featureKey: FEATURES.CORE_SERVICE_ORDERS,
    permission: PERMISSIONS.SERVICE_ORDERS_VIEW,
  },
  quotes: { featureKey: FEATURES.CORE_QUOTES, permission: PERMISSIONS.QUOTES_VIEW },
  finance: { featureKey: FEATURES.FINANCE_CORE, permission: PERMISSIONS.FINANCE_VIEW },
  inventory: { featureKey: FEATURES.OPERATIONS_INVENTORY, permission: PERMISSIONS.INVENTORY_VIEW },
  purchasing: {
    featureKey: FEATURES.OPERATIONS_PURCHASING,
    permission: PERMISSIONS.PURCHASES_VIEW,
  },
  warranties: {
    featureKey: FEATURES.OPERATIONS_WARRANTIES,
    permission: PERMISSIONS.WARRANTIES_VIEW,
  },
  agenda: { featureKey: FEATURES.OPERATIONS_AGENDA, permission: PERMISSIONS.AGENDA_VIEW },
  communications: {
    featureKey: FEATURES.COMMUNICATIONS_CORE,
    permission: PERMISSIONS.COMMUNICATIONS_VIEW,
  },
} as const satisfies Record<string, DomainRequirement>;

type DomainKey = keyof typeof DOMAIN_REQUIREMENTS;

/**
 * Unidades ONDE ESTE DOMINIO PODE SER CONSULTADO: a feature precisa estar
 * disponivel para o tenant (nivel tenant, verificado uma vez) E a permissao
 * precisa valer NAQUELA unidade especifica (item 21) — um papel concedido
 * so na Unidade Norte nao autoriza ver Financeiro da Unidade Sul, mesmo que
 * as duas estejam com "todas as unidades" selecionado.
 */
function unitsAuthorizedFor(
  context: TenantContext,
  scope: AnalyticsScope,
  featureAllowed: boolean,
  permission: PermissionKey,
): readonly string[] {
  if (!featureAllowed) return [];
  return scope.selectedUnitIds.filter((unitId) =>
    permissionsInScope(context, unitId).has(permission),
  );
}

export async function loadDashboard(
  context: TenantContext,
  filters: DashboardFilters = {},
): Promise<DashboardView> {
  const scope = resolveAnalyticsScope(context, filters);

  /** UMA consulta de features para todos os dominios (um snapshot so). */
  const featureDecisions = await checkManyAccess(
    context,
    Object.values(DOMAIN_REQUIREMENTS).map((req) => ({ featureKey: req.featureKey })),
  );

  const domainScope = (key: DomainKey): AnalyticsScope => {
    const requirement = DOMAIN_REQUIREMENTS[key];
    const featureAllowed = featureDecisions.get(requirement.featureKey)?.allowed ?? false;
    const selectedUnitIds = unitsAuthorizedFor(
      context,
      scope,
      featureAllowed,
      requirement.permission,
    );
    return { ...scope, selectedUnitIds };
  };

  const osScope = domainScope('serviceOrders');
  const quotesScope = domainScope('quotes');
  const financeScope = domainScope('finance');
  const inventoryScope = domainScope('inventory');
  const purchasingScope = domainScope('purchasing');
  const warrantiesScope = domainScope('warranties');
  const agendaScope = domainScope('agenda');
  const communicationsScope = domainScope('communications');

  const quotesAllowed = quotesScope.selectedUnitIds.length > 0;
  const financeAllowed = financeScope.selectedUnitIds.length > 0;
  const inventoryAllowed = inventoryScope.selectedUnitIds.length > 0;
  const purchasingAllowed = purchasingScope.selectedUnitIds.length > 0;
  const warrantiesAllowed = warrantiesScope.selectedUnitIds.length > 0;
  const agendaAllowed = agendaScope.selectedUnitIds.length > 0;
  const communicationsAllowed = communicationsScope.selectedUnitIds.length > 0;

  const [
    serviceOrders,
    quotes,
    finance,
    inventory,
    purchasing,
    warranties,
    agenda,
    communications,
  ] = await Promise.all([
    loadServiceOrderMetrics(osScope),
    quotesAllowed ? loadQuoteMetrics(quotesScope) : Promise.resolve(null),
    financeAllowed ? loadFinanceMetrics(context, financeScope) : Promise.resolve(null),
    inventoryAllowed ? loadInventoryMetrics(inventoryScope) : Promise.resolve(null),
    purchasingAllowed ? loadPurchasingMetrics(purchasingScope) : Promise.resolve(null),
    warrantiesAllowed ? loadWarrantyMetrics(warrantiesScope) : Promise.resolve(null),
    agendaAllowed ? loadAgendaMetrics(agendaScope) : Promise.resolve(null),
    communicationsAllowed ? loadCommunicationMetrics(communicationsScope) : Promise.resolve(null),
  ]);

  return {
    scope,
    serviceOrders,
    quotes,
    finance,
    inventory,
    purchasing,
    warranties,
    agenda,
    communications,
  };
}

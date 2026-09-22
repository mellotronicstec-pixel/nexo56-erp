import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { buildOffsetPage, resolveOffset, type OffsetPage } from '@/core/db/pagination';
import { ValidationError } from '@/core/errors';
import { todayIn } from '@/core/time/civil-date';
import { can } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { equipmentTitle } from '@/modules/equipment/domain/equipment';
import type { ServiceOrderStatus } from '@/modules/service-orders/domain/workflow';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  type AttentionFlag,
  type AttentionSummary,
  attentionFlagsFor,
  isAttentionFlag,
  isWorkQueue,
  urgencyRankFor,
  WORK_QUEUES,
  type WorkCenterItem,
  type WorkQueue,
  type WorkQueueSummary,
  type WorkView,
  workQueueLabel,
} from '@/modules/work-center/domain/work-center';

/**
 * O QUERY SERVICE DA CENTRAL (Prompt 15).
 *
 * SO LEITURA. Este arquivo nao tem um unico `insert`, `update` ou `delete`, e
 * um teste de fronteira falha se algum aparecer. A Central mostra o que
 * precisa ser feito; cada dominio continua decidindo como aquilo pode ser
 * feito (ADR-077).
 *
 * POR QUE A CONSULTA E PROPRIA, e nao `listServiceOrders` reaproveitada: a
 * lista da OS responde "as ordens desta unidade, da mais recente para a mais
 * antiga". A Central responde outra pergunta — "o que exige atencao primeiro"
 * —, e isso muda o `ORDER BY`. Ordenar depois, em memoria, quebraria a
 * paginacao: a pagina 2 traria itens que deveriam estar na 1 (item 158).
 *
 * O resto e reaproveitado: rotulos e estados vem do Prompt 08, a paginacao vem
 * da fundacao, e os sinais de atencao sao os mesmos fatos que
 * `loadPendingWork` ja lia.
 *
 * A UNIDADE E A ATIVA, e a Central NAO aceita unidade pela URL. O produto ja
 * tem um seletor de unidade no cabecalho, que revalida no servidor e some
 * quando ha uma unidade so. Aceitar um `unit_id` da query string criaria um
 * segundo caminho para a mesma decisao — e um caminho a mais para errar
 * (itens 17 e 102).
 */

export interface WorkCenterFilters {
  view?: string;
  queue?: string;
  attention?: string;
  query?: string;
  page?: number;
}

export interface WorkCenterView {
  unitId: string | null;
  unitName: string | null;
  /** Hoje NA DATA CIVIL DA EMPRESA. A tela nao recalcula no fuso do browser. */
  today: string;
  view: WorkView;
  queue: WorkQueue | null;
  attention: AttentionFlag | null;
  query: string;
  summary: WorkQueueSummary[];
  attentionSummary: AttentionSummary;
  items: OffsetPage<WorkCenterItem>;
  /**
   * `false` quando `operations.agenda` esta indisponivel. A Central continua
   * inteira: muda apenas que tarefas gerais da Agenda deixam de contar como
   * "tarefa atrasada" e o atalho para a Agenda some (item 20).
   */
  agendaAvailable: boolean;
  /** `true` quando a pessoa pode ver as OS desta unidade. */
  canSeeOrders: boolean;
}

interface Scope {
  tenantId: string;
  unitId: string;
  today: string;
  view: WorkView;
  userId: string;
  agendaAvailable: boolean;
}

/**
 * A condicao COMUM a contagens e lista.
 *
 * Um unico lugar, de proposito: se o cartao dissesse 8 e a lista mostrasse 5
 * porque um filtro divergiu, a Central perderia a unica coisa que ela promete
 * — dizer a verdade sobre o que falta fazer (item 160).
 */
function baseCondition(scope: Scope): SQL {
  const ativo = sql`so.status NOT IN ('completed','cancelled')`;

  /**
   * "Minha visao" e VINCULO REAL: a OS em que a pessoa e a tecnica atribuida.
   * Nao inclui as sem responsavel — trabalho de ninguem nao e trabalho meu, e
   * fingir esse vinculo encheria a tela de itens que a pessoa nao reconhece
   * (item 115).
   */
  const daPessoa =
    scope.view === 'mine' ? sql` AND so.assigned_technician_id = ${scope.userId}` : sql``;

  return sql`so.tenant_id = ${scope.tenantId}
        AND so.unit_id = ${scope.unitId}
        AND ${ativo}${daPessoa}`;
}

/**
 * Tarefas VENCIDAS por Ordem de Servico, como tabela derivada.
 *
 * Duas origens, e a segunda so entra quando a Agenda esta disponivel: tarefa
 * de fluxo (`service_order_tasks`, CORE do Prompt 08) sempre; tarefa geral
 * (`agenda_tasks`) apenas com `operations.agenda` ligada. Com a Agenda
 * desligada o sinal nao some — ele volta a ser exatamente o que o nucleo
 * sabia sozinho.
 *
 * E tabela derivada, nao subconsulta correlacionada: uma consulta agregada
 * para a pagina inteira em vez de uma por linha (item 93).
 */
function overdueTasksJoin(scope: Scope): SQL {
  const doFluxo = sql`
        SELECT t.service_order_id AS service_order_id
          FROM service_order_tasks t
         WHERE t.tenant_id = ${scope.tenantId}
           AND t.unit_id = ${scope.unitId}
           AND t.status = 'open'
           AND t.due_date IS NOT NULL
           AND t.due_date < ${scope.today}`;

  const daAgenda = scope.agendaAvailable
    ? sql`
        UNION
        SELECT a.service_order_id AS service_order_id
          FROM agenda_tasks a
         WHERE a.tenant_id = ${scope.tenantId}
           AND a.unit_id = ${scope.unitId}
           AND a.status = 'open'
           AND a.service_order_id IS NOT NULL
           AND a.due_date IS NOT NULL
           AND a.due_date < ${scope.today}`
    : sql``;

  return sql`LEFT JOIN (
        SELECT DISTINCT service_order_id FROM (${doFluxo}${daAgenda}) AS origens
      ) AS atrasadas ON atrasadas.service_order_id = so.id`;
}

/** `1` quando a OS tem tarefa vencida; usado no filtro e na ordenacao. */
const HAS_OVERDUE_TASK = sql`(atrasadas.service_order_id IS NOT NULL)`;

// ---------------------------------------------------------------------------
// Contagens
// ---------------------------------------------------------------------------

interface QueueCountRow {
  status: string;
  total: number | string;
}

/**
 * As sete filas em UMA consulta agrupada (item 53).
 *
 * Uma consulta por cartao seriam sete idas ao banco para desenhar o cabecalho
 * da tela mais aberta do sistema. O `GROUP BY status` usa
 * `ix_service_order_unit_status (tenant_id, unit_id, status)`, que ja existe
 * desde o Prompt 07 — nenhum indice novo foi necessario.
 */
async function queueCounts(scope: Scope): Promise<WorkQueueSummary[]> {
  const linhas = await getDb().execute(sql`
    SELECT so.status AS status, COUNT(*) AS total
      FROM service_orders so
     WHERE ${baseCondition(scope)}
     GROUP BY so.status
  `);

  const porEstado = new Map<string, number>();
  for (const linha of (linhas as unknown as QueueCountRow[][])[0] ?? []) {
    porEstado.set(linha.status, Number(linha.total));
  }

  /** Fila sem nenhuma OS aparece com zero: sumir esconderia a fila existente. */
  return WORK_QUEUES.map((queue) => ({
    queue,
    label: workQueueLabel(queue),
    total: porEstado.get(queue) ?? 0,
  }));
}

interface AttentionCountRow {
  overdueFollowUp: number | string;
  followUpToday: number | string;
  overdueTask: number | string;
  unassigned: number | string;
}

/**
 * Os quatro sinais de atencao em UMA consulta.
 *
 * Contagem condicional em vez de quatro varreduras: a mesma linha e avaliada
 * uma vez para os quatro sinais.
 */
async function attentionCounts(scope: Scope): Promise<AttentionSummary> {
  const linhas = await getDb().execute(sql`
    SELECT
      SUM(so.follow_up_at IS NOT NULL AND so.follow_up_at < ${scope.today}) AS overdueFollowUp,
      SUM(so.follow_up_at = ${scope.today}) AS followUpToday,
      SUM(${HAS_OVERDUE_TASK}) AS overdueTask,
      SUM(so.assigned_technician_id IS NULL) AS unassigned
      FROM service_orders so
      ${overdueTasksJoin(scope)}
     WHERE ${baseCondition(scope)}
  `);

  const linha = (linhas as unknown as AttentionCountRow[][])[0]?.[0];

  return {
    overdueFollowUp: Number(linha?.overdueFollowUp ?? 0),
    followUpToday: Number(linha?.followUpToday ?? 0),
    overdueTask: Number(linha?.overdueTask ?? 0),
    unassigned: Number(linha?.unassigned ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

interface ItemRow {
  id: string;
  number: number;
  status: string;
  unitId: string;
  unitName: string | null;
  customerName: string;
  equipmentKind: string;
  equipmentBrand: string | null;
  equipmentModel: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  followUpAt: string | null;
  classification: string | null;
  openedAt: Date;
  openTaskCount: number | string;
  hasOverdueTask: number | string;
}

/**
 * A ORDENACAO MORA NO SQL, e espelha exatamente a precedencia do dominio.
 *
 * Ordenar em memoria depois de paginar traria a pagina errada; paginar sem
 * chave estavel repetiria ou perderia linhas entre paginas. Por isso o
 * `ORDER BY` termina em `so.number`, que e unico por tenant (item 158).
 *
 * `compareWorkCenterItems` existe para a mesma regra ser testavel sem banco, e
 * um teste de integracao confere que as duas ordens coincidem.
 */
const ORDER_BY = (scope: Scope): SQL => sql`
    ORDER BY
      CASE
        WHEN so.follow_up_at IS NOT NULL AND so.follow_up_at < ${scope.today} THEN 0
        WHEN ${HAS_OVERDUE_TASK} THEN 1
        WHEN so.follow_up_at = ${scope.today} THEN 2
        ELSE 3
      END ASC,
      (so.follow_up_at IS NULL) ASC,
      so.follow_up_at ASC,
      so.number ASC`;

/** Filtro textual: numero exato OU nome do cliente. Sem curinga solto. */
function searchCondition(raw: string): SQL {
  const numero = Number.parseInt(raw.replace(/\D/g, ''), 10);
  const texto = raw.trim().toLowerCase();

  if (Number.isFinite(numero) && numero > 0) {
    return sql` AND (so.number = ${numero} OR c.name_normalized LIKE ${`%${texto}%`})`;
  }
  return sql` AND c.name_normalized LIKE ${`%${texto}%`}`;
}

function attentionCondition(flag: AttentionFlag, scope: Scope): SQL {
  if (flag === 'overdue_follow_up') {
    return sql` AND so.follow_up_at IS NOT NULL AND so.follow_up_at < ${scope.today}`;
  }
  if (flag === 'follow_up_today') return sql` AND so.follow_up_at = ${scope.today}`;
  if (flag === 'overdue_task') return sql` AND ${HAS_OVERDUE_TASK}`;
  return sql` AND so.assigned_technician_id IS NULL`;
}

async function listItems(
  scope: Scope,
  filters: { queue: WorkQueue | null; attention: AttentionFlag | null; query: string },
  page: { limit: number; offset: number },
): Promise<{ rows: WorkCenterItem[]; total: number }> {
  const daFila = filters.queue ? sql` AND so.status = ${filters.queue}` : sql``;
  const daAtencao = filters.attention ? attentionCondition(filters.attention, scope) : sql``;
  const daBusca = filters.query ? searchCondition(filters.query) : sql``;
  const onde = sql`${baseCondition(scope)}${daFila}${daAtencao}${daBusca}`;

  const db = getDb();

  const [linhas, totais] = await Promise.all([
    db.execute(sql`
      SELECT
        so.id                          AS id,
        so.number                      AS number,
        so.status                      AS status,
        so.unit_id                     AS unitId,
        u.name                         AS unitName,
        c.name                         AS customerName,
        e.kind                         AS equipmentKind,
        e.brand                        AS equipmentBrand,
        e.model                        AS equipmentModel,
        so.assigned_technician_id      AS assigneeId,
        t.name                         AS assigneeName,
        so.follow_up_at                AS followUpAt,
        so.classification              AS classification,
        so.opened_at                   AS openedAt,
        COALESCE(abertas.total, 0)     AS openTaskCount,
        ${HAS_OVERDUE_TASK}            AS hasOverdueTask
        FROM service_orders so
        JOIN customers c  ON c.id = so.customer_id  AND c.tenant_id = so.tenant_id
        JOIN equipment e  ON e.id = so.equipment_id AND e.tenant_id = so.tenant_id
        LEFT JOIN units u ON u.id = so.unit_id
        LEFT JOIN users t ON t.id = so.assigned_technician_id AND t.tenant_id = so.tenant_id
        ${overdueTasksJoin(scope)}
        LEFT JOIN (
          SELECT service_order_id, COUNT(*) AS total
            FROM service_order_tasks
           WHERE tenant_id = ${scope.tenantId}
             AND unit_id = ${scope.unitId}
             AND status = 'open'
           GROUP BY service_order_id
        ) AS abertas ON abertas.service_order_id = so.id
       WHERE ${onde}
       ${ORDER_BY(scope)}
       LIMIT ${page.limit} OFFSET ${page.offset}
    `),
    db.execute(sql`
      SELECT COUNT(*) AS total
        FROM service_orders so
        JOIN customers c ON c.id = so.customer_id AND c.tenant_id = so.tenant_id
        ${overdueTasksJoin(scope)}
       WHERE ${onde}
    `),
  ]);

  const brutas = (linhas as unknown as ItemRow[][])[0] ?? [];
  const total = Number(
    ((totais as unknown as Array<Array<{ total: number | string }>>)[0] ?? [])[0]?.total ?? 0,
  );

  const rows: WorkCenterItem[] = brutas.map((linha) => {
    const flags = attentionFlagsFor(
      {
        followUpAt: linha.followUpAt,
        hasOverdueTask: Number(linha.hasOverdueTask) === 1,
        assigneeId: linha.assigneeId,
      },
      scope.today,
    );

    return {
      serviceOrderId: linha.id,
      number: Number(linha.number),
      status: linha.status as ServiceOrderStatus,
      unitId: linha.unitId,
      unitName: linha.unitName,
      customerName: linha.customerName,
      /** Resumo compacto do aparelho, pelo helper oficial do Prompt 06. */
      equipmentSummary: equipmentTitle({
        kind: linha.equipmentKind,
        brand: linha.equipmentBrand,
        model: linha.equipmentModel,
      }),
      assigneeId: linha.assigneeId,
      assigneeName: linha.assigneeName,
      followUpAt: linha.followUpAt,
      openTaskCount: Number(linha.openTaskCount),
      flags,
      urgency: urgencyRankFor(flags),
      classification: linha.classification,
      openedAt: new Date(linha.openedAt),
    };
  });

  return { rows, total };
}

// ---------------------------------------------------------------------------
// Entrada publica
// ---------------------------------------------------------------------------

/** Entrada da URL e NAO CONFIAVEL: valor desconhecido volta ao padrao seguro. */
function parseView(raw: string | undefined): WorkView {
  return raw === 'mine' ? 'mine' : 'unit';
}

function parseQueue(raw: string | undefined): WorkQueue | null {
  const texto = raw?.trim();
  if (!texto) return null;
  if (!isWorkQueue(texto)) throw new ValidationError('Fila desconhecida.');
  return texto;
}

function parseAttention(raw: string | undefined): AttentionFlag | null {
  const texto = raw?.trim();
  if (!texto) return null;
  if (!isAttentionFlag(texto)) throw new ValidationError('Filtro de atencao desconhecido.');
  return texto;
}

/** Busca limitada: texto longo nao vira varredura, e nao e registrado em log. */
const SEARCH_MAX = 60;

function parseQuery(raw: string | undefined): string {
  const texto = raw?.trim() ?? '';
  if (texto.length > SEARCH_MAX) return texto.slice(0, SEARCH_MAX);
  return texto;
}

/**
 * A CENTRAL, em uma chamada.
 *
 * Autorizacao em duas camadas, e as duas importam: `work_center.view` abre a
 * TELA; `service_orders.view` na unidade abre o CONTEUDO. Quem tem a primeira
 * e nao a segunda ve a Central explicando que nao ha o que mostrar — nunca a
 * fila de outra pessoa (item 91).
 */
export async function loadWorkCenter(
  context: TenantContext,
  filters: WorkCenterFilters = {},
): Promise<WorkCenterView> {
  const today = todayIn(context.tenantTimezone);
  const view = parseView(filters.view);
  const queue = parseQueue(filters.queue);
  const attention = parseAttention(filters.attention);
  const query = parseQuery(filters.query);
  const { limit, offset, page } = resolveOffset({ page: filters.page });

  const vazia = (canSeeOrders: boolean, agendaAvailable: boolean): WorkCenterView => ({
    unitId: context.activeUnitId,
    unitName: null,
    today,
    view,
    queue,
    attention,
    query,
    summary: WORK_QUEUES.map((q) => ({ queue: q, label: workQueueLabel(q), total: 0 })),
    attentionSummary: { overdueFollowUp: 0, followUpToday: 0, overdueTask: 0, unassigned: 0 },
    items: buildOffsetPage<WorkCenterItem>([], 0, { page, pageSize: limit }),
    agendaAvailable,
    canSeeOrders,
  });

  const unitId = context.activeUnitId;
  if (!unitId) return vazia(false, false);

  /**
   * As tres decisoes de acesso em paralelo. `service_orders.view` decide o
   * conteudo; `operations.agenda` decide apenas a camada oportunista.
   */
  const [podeVerOrdens, temAgenda] = await Promise.all([
    can(context, {
      permission: PERMISSIONS.SERVICE_ORDERS_VIEW,
      featureKey: FEATURES.CORE_SERVICE_ORDERS,
      unitId,
    }),
    can(context, {
      permission: PERMISSIONS.AGENDA_VIEW,
      featureKey: FEATURES.OPERATIONS_AGENDA,
      unitId,
    }),
  ]);

  const agendaAvailable = temAgenda.allowed;
  if (!podeVerOrdens.allowed) return vazia(false, agendaAvailable);

  const scope: Scope = {
    tenantId: context.tenantId,
    unitId,
    today,
    view,
    userId: context.userId,
    agendaAvailable,
  };

  const [summary, attentionSummary, lista] = await Promise.all([
    queueCounts(scope),
    attentionCounts(scope),
    listItems(scope, { queue, attention, query }, { limit, offset }),
  ]);

  return {
    unitId,
    unitName: lista.rows[0]?.unitName ?? null,
    today,
    view,
    queue,
    attention,
    query,
    summary,
    attentionSummary,
    items: buildOffsetPage(lista.rows, lista.total, { page, pageSize: limit }),
    agendaAvailable,
    canSeeOrders: true,
  };
}

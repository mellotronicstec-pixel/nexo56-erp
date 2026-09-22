import 'server-only';
import { and, asc, desc, eq, inArray, isNotNull, lte, not, or, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { formatCivilDate, todayIn } from '@/core/time/civil-date';
import { ValidationError } from '@/core/errors';
import { can } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { customers } from '@/modules/customers/infrastructure/schema';
import { FEATURES } from '@/modules/features/domain/catalog';
import { serviceOrders, serviceOrderTasks } from '@/modules/service-orders/infrastructure/schema';
import { TERMINAL_STATUSES } from '@/modules/service-orders/domain/workflow';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { users } from '@/modules/users/infrastructure/schema';
import {
  type AgendaDay,
  type AgendaItem,
  type AgendaItemType,
  bucketFor,
  compareAgendaItems,
  countOverdue,
  defaultAgendaRange,
  groupAgendaByDay,
  isRangeTooWide,
  MAX_AGENDA_RANGE_DAYS,
  TASK_BUCKETS,
  type TaskBucket,
  type TaskPriority,
} from '@/modules/agenda/domain/agenda';
import { agendaAppointments, agendaTasks } from '@/modules/agenda/infrastructure/schema';

/**
 * A AGENDA E LEITURA, E SO LEITURA (ADR-073).
 *
 * Quatro origens respondem a mesma pergunta — "o que precisa acontecer?" —
 * cada uma com colunas proprias:
 *
 *   `agenda_tasks`         tarefa criada por uma pessoa (Prompt 14)
 *   `agenda_appointments`  compromisso com lugar no tempo (Prompt 14)
 *   `service_order_tasks`  tarefa do fluxo da OS (Prompt 08, intocada)
 *   `service_orders`       o proximo ponto de atencao da OS (Prompt 08)
 *
 * A tentacao obvia seria COPIAR as duas ultimas para `agenda_tasks` e ter uma
 * consulta so. Isso criaria duas verdades sobre o mesmo trabalho: concluir a
 * copia deixaria a original aberta, e a OS ficaria eternamente esperando uma
 * preparacao que alguem ja fez. Entao nada e copiado — a agenda LE as quatro e
 * devolve uma lista, marcando a origem de cada item.
 *
 * DEDUPLICACAO POR CONSTRUCAO (item 57): cada registro sai de exatamente uma
 * tabela. Nao existe caminho por onde o mesmo trabalho apareca duas vezes,
 * porque nao existe registro projetado em dois lugares.
 *
 * DESLIGAR A AGENDA NAO APAGA NADA (itens 12 e 187). `operations.agenda` e
 * OPCIONAL e governa estas TELAS. O follow-up continua vencendo, a varredura
 * continua rodando e a tarefa de preparacao continua sendo criada, porque
 * essas coisas sao do nucleo e nunca dependeram daqui.
 */

/** Uma consulta so: quais unidades esta pessoa pode ver na agenda. */
async function visibleUnits(
  context: TenantContext,
  requestedUnitId: string | null,
): Promise<string[]> {
  const candidatas = requestedUnitId
    ? context.authorizedUnitIds.filter((id) => id === requestedUnitId)
    : context.authorizedUnitIds;

  const decisoes = await Promise.all(
    candidatas.map(async (unitId) => ({
      unitId,
      permitido: (
        await can(context, {
          permission: PERMISSIONS.AGENDA_VIEW,
          featureKey: FEATURES.OPERATIONS_AGENDA,
          unitId,
        })
      ).allowed,
    })),
  );

  return decisoes.filter((d) => d.permitido).map((d) => d.unitId);
}

export interface AgendaRangeInput {
  /** Datas civis. Ausentes, valem a semana operacional a partir de hoje. */
  from?: string | null;
  to?: string | null;
  unitId?: string | null;
  assigneeId?: string | null;
  types?: readonly AgendaItemType[];
}

export interface AgendaView {
  from: string;
  to: string;
  /** Hoje NA DATA CIVIL DA EMPRESA — a tela nao recalcula no fuso do browser. */
  today: string;
  days: AgendaDay[];
  overdueCount: number;
  /** Unidades efetivamente consultadas; vazio significa "nada visivel". */
  unitIds: string[];
}

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

function civilOrNull(value: string | null | undefined): string | null {
  const texto = value?.trim();
  if (!texto) return null;
  if (!CIVIL.test(texto)) throw new ValidationError('Informe uma data valida.');
  return texto;
}

/**
 * A AGENDA DE UM PERIODO.
 *
 * O ATRASADO ENTRA SEMPRE, mesmo comecando antes de `from`. Uma tarefa que
 * venceu na semana passada nao deixa de existir porque a tela abriu em
 * "hoje" — e esconde-la seria exatamente o esquecimento que este modulo
 * existe para impedir (item 1). Por isso o filtro e `prazo <= to`, sem piso.
 *
 * O TETO EXISTE (item 103): sem ele, "de 2020 a 2030" viraria varredura de
 * historico com a tela travada. Noventa e dois dias cobrem um trimestre.
 */
export async function loadAgenda(
  context: TenantContext,
  input: AgendaRangeInput = {},
): Promise<AgendaView> {
  const today = todayIn(context.tenantTimezone);
  const padrao = defaultAgendaRange(today);
  const from = civilOrNull(input.from) ?? padrao.from;
  const to = civilOrNull(input.to) ?? padrao.to;

  if (to < from) {
    throw new ValidationError('O fim do periodo nao pode ser antes do inicio.');
  }
  if (isRangeTooWide(from, to)) {
    throw new ValidationError(`Escolha um periodo de ate ${MAX_AGENDA_RANGE_DAYS} dias.`);
  }

  const unitIds = await visibleUnits(context, input.unitId?.trim() || null);
  if (unitIds.length === 0) {
    return { from, to, today, days: [], overdueCount: 0, unitIds: [] };
  }

  const assigneeId = input.assigneeId?.trim() || null;
  const tipos = new Set<AgendaItemType>(
    input.types && input.types.length > 0
      ? input.types
      : ['task', 'appointment', 'service_order_task', 'follow_up'],
  );

  const janela: JanelaLeitura = { to, includeNoDue: false };

  const partes = await Promise.all([
    tipos.has('task') ? readTasks(context, unitIds, janela, assigneeId, today) : [],
    tipos.has('appointment') ? readAppointments(context, unitIds, from, to, assigneeId) : [],
    tipos.has('service_order_task')
      ? readServiceOrderTasks(context, unitIds, janela, assigneeId, today)
      : [],
    tipos.has('follow_up') ? readFollowUps(context, unitIds, janela, assigneeId, today) : [],
  ]);

  const itens = partes.flat();

  return {
    from,
    to,
    today,
    days: groupAgendaByDay(itens),
    overdueCount: countOverdue(itens),
    unitIds,
  };
}

// ---------------------------------------------------------------------------
// Origem 1: tarefas da propria Agenda
// ---------------------------------------------------------------------------

interface JanelaLeitura {
  /** Limite superior em data civil, ou `null` para "tudo que estiver aberto". */
  to: string | null;
  /** Se os itens sem prazo entram. A agenda diz nao; "Minhas tarefas" diz sim. */
  includeNoDue: boolean;
}

async function readTasks(
  context: TenantContext,
  unitIds: string[],
  janela: JanelaLeitura,
  assigneeId: string | null,
  today: string,
): Promise<AgendaItem[]> {
  const linhas = await getDb()
    .select({
      id: agendaTasks.id,
      title: agendaTasks.title,
      notes: agendaTasks.notes,
      unitId: agendaTasks.unitId,
      assigneeId: agendaTasks.assigneeId,
      dueDate: agendaTasks.dueDate,
      status: agendaTasks.status,
      priority: agendaTasks.priority,
      serviceOrderId: agendaTasks.serviceOrderId,
      serviceOrderNumber: serviceOrders.number,
      customerName: customers.name,
    })
    .from(agendaTasks)
    .leftJoin(
      serviceOrders,
      and(
        eq(serviceOrders.id, agendaTasks.serviceOrderId),
        eq(serviceOrders.tenantId, agendaTasks.tenantId),
      ),
    )
    .leftJoin(
      customers,
      and(eq(customers.id, agendaTasks.customerId), eq(customers.tenantId, agendaTasks.tenantId)),
    )
    .where(
      and(
        eq(agendaTasks.tenantId, context.tenantId),
        inArray(agendaTasks.unitId, unitIds),
        eq(agendaTasks.status, 'open'),
        /**
         * Tarefa SEM PRAZO nao entra na AGENDA: ela nao tem dia em que caia.
         * Ela nao desaparece — vive em "Tarefas" e no balde "Sem prazo" de
         * "Minhas tarefas", que e onde alguem a procura (item 106).
         */
        janela.includeNoDue ? undefined : isNotNull(agendaTasks.dueDate),
        janela.to ? lte(agendaTasks.dueDate, janela.to) : undefined,
        assigneeId ? eq(agendaTasks.assigneeId, assigneeId) : undefined,
      ),
    )
    .orderBy(asc(agendaTasks.dueDate))
    .limit(500);

  return linhas.map((linha) => ({
    type: 'task' as const,
    id: linha.id,
    title: linha.title,
    unitId: linha.unitId,
    assigneeId: linha.assigneeId,
    dueDate: linha.dueDate,
    startAt: null,
    endAt: null,
    allDay: false,
    status: linha.status,
    priority: linha.priority as TaskPriority,
    serviceOrderId: linha.serviceOrderId,
    serviceOrderNumber: linha.serviceOrderNumber,
    customerName: linha.customerName,
    overdue: linha.dueDate !== null && linha.dueDate < today,
  }));
}

// ---------------------------------------------------------------------------
// Origem 2: compromissos
// ---------------------------------------------------------------------------

/**
 * O dia de um compromisso COM HORARIO e o dia da EMPRESA, nao o dia UTC.
 *
 * Uma visita as 22h de Sao Paulo acontece no dia seguinte em UTC. Agrupar pelo
 * dia UTC jogaria essa visita para a quinta na tela de quem a marcou para
 * quarta — e a pessoa procuraria o compromisso no dia errado.
 *
 * Por isso a consulta busca uma FAIXA FOLGADA de instantes (um dia a mais de
 * cada lado, mais que o maior deslocamento de fuso que existe) e o recorte
 * fino acontece aqui, na data civil ja convertida.
 */
async function readAppointments(
  context: TenantContext,
  unitIds: string[],
  from: string,
  to: string,
  assigneeId: string | null,
): Promise<AgendaItem[]> {
  const folgaInicio = new Date(`${from}T00:00:00.000Z`);
  folgaInicio.setUTCDate(folgaInicio.getUTCDate() - 1);
  const folgaFim = new Date(`${to}T00:00:00.000Z`);
  folgaFim.setUTCDate(folgaFim.getUTCDate() + 2);

  const linhas = await getDb()
    .select({
      id: agendaAppointments.id,
      title: agendaAppointments.title,
      unitId: agendaAppointments.unitId,
      assigneeId: agendaAppointments.assigneeId,
      allDay: agendaAppointments.allDay,
      startAt: agendaAppointments.startAt,
      endAt: agendaAppointments.endAt,
      startDate: agendaAppointments.startDate,
      endDate: agendaAppointments.endDate,
      status: agendaAppointments.status,
      serviceOrderId: agendaAppointments.serviceOrderId,
      serviceOrderNumber: serviceOrders.number,
      customerName: customers.name,
    })
    .from(agendaAppointments)
    .leftJoin(
      serviceOrders,
      and(
        eq(serviceOrders.id, agendaAppointments.serviceOrderId),
        eq(serviceOrders.tenantId, agendaAppointments.tenantId),
      ),
    )
    .leftJoin(
      customers,
      and(
        eq(customers.id, agendaAppointments.customerId),
        eq(customers.tenantId, agendaAppointments.tenantId),
      ),
    )
    .where(
      and(
        eq(agendaAppointments.tenantId, context.tenantId),
        inArray(agendaAppointments.unitId, unitIds),
        eq(agendaAppointments.status, 'scheduled'),
        assigneeId ? eq(agendaAppointments.assigneeId, assigneeId) : undefined,
        or(
          and(
            eq(agendaAppointments.allDay, 0),
            sql`${agendaAppointments.startAt} >= ${folgaInicio}`,
            sql`${agendaAppointments.startAt} < ${folgaFim}`,
          ),
          and(
            eq(agendaAppointments.allDay, 1),
            lte(agendaAppointments.startDate, to),
            sql`${agendaAppointments.endDate} >= ${from}`,
          ),
        ),
      ),
    )
    .orderBy(asc(agendaAppointments.startAt))
    .limit(500);

  const itens: AgendaItem[] = [];

  for (const linha of linhas) {
    const diaInteiro = linha.allDay === 1;
    const dia = diaInteiro
      ? linha.startDate
      : linha.startAt
        ? formatCivilDate(linha.startAt, context.tenantTimezone)
        : null;

    /** Fora do periodo depois da conversao para o dia civil: nao entra. */
    if (!dia || dia > to) continue;
    if (!diaInteiro && dia < from) continue;

    itens.push({
      type: 'appointment',
      id: linha.id,
      title: linha.title,
      unitId: linha.unitId,
      assigneeId: linha.assigneeId,
      /** Dia inteiro que comecou antes do periodo aparece no primeiro dia visivel. */
      dueDate: diaInteiro && dia < from ? from : dia,
      startAt: linha.startAt,
      endAt: linha.endAt,
      allDay: diaInteiro,
      status: linha.status,
      priority: null,
      serviceOrderId: linha.serviceOrderId,
      serviceOrderNumber: linha.serviceOrderNumber,
      customerName: linha.customerName,
      /**
       * COMPROMISSO NAO ATRASA (item 47). O tempo passar nao prova que a visita
       * deixou de acontecer, e pintar de vermelho tudo que ja passou encheria a
       * tela de alarme sobre coisas que correram bem.
       */
      overdue: false,
    });
  }

  return itens;
}

// ---------------------------------------------------------------------------
// Origem 3: tarefas do fluxo da OS (Prompt 08 — lidas, nunca copiadas)
// ---------------------------------------------------------------------------

async function readServiceOrderTasks(
  context: TenantContext,
  unitIds: string[],
  janela: JanelaLeitura,
  assigneeId: string | null,
  today: string,
): Promise<AgendaItem[]> {
  const linhas = await getDb()
    .select({
      id: serviceOrderTasks.id,
      title: serviceOrderTasks.title,
      unitId: serviceOrderTasks.unitId,
      assigneeId: serviceOrderTasks.assigneeId,
      dueDate: serviceOrderTasks.dueDate,
      status: serviceOrderTasks.status,
      serviceOrderId: serviceOrderTasks.serviceOrderId,
      serviceOrderNumber: serviceOrders.number,
      customerName: customers.name,
    })
    .from(serviceOrderTasks)
    .innerJoin(
      serviceOrders,
      and(
        eq(serviceOrders.id, serviceOrderTasks.serviceOrderId),
        eq(serviceOrders.tenantId, serviceOrderTasks.tenantId),
      ),
    )
    .leftJoin(
      customers,
      and(
        eq(customers.id, serviceOrders.customerId),
        eq(customers.tenantId, serviceOrders.tenantId),
      ),
    )
    .where(
      and(
        eq(serviceOrderTasks.tenantId, context.tenantId),
        inArray(serviceOrderTasks.unitId, unitIds),
        eq(serviceOrderTasks.status, 'open'),
        janela.includeNoDue ? undefined : isNotNull(serviceOrderTasks.dueDate),
        janela.to ? lte(serviceOrderTasks.dueDate, janela.to) : undefined,
        assigneeId ? eq(serviceOrderTasks.assigneeId, assigneeId) : undefined,
      ),
    )
    .orderBy(asc(serviceOrderTasks.dueDate))
    .limit(500);

  return linhas.map((linha) => ({
    type: 'service_order_task' as const,
    id: linha.id,
    title: linha.title,
    unitId: linha.unitId,
    assigneeId: linha.assigneeId,
    dueDate: linha.dueDate,
    startAt: null,
    endAt: null,
    allDay: false,
    status: linha.status,
    priority: null,
    serviceOrderId: linha.serviceOrderId,
    serviceOrderNumber: linha.serviceOrderNumber,
    customerName: linha.customerName,
    overdue: linha.dueDate !== null && linha.dueDate < today,
  }));
}

// ---------------------------------------------------------------------------
// Origem 4: o proximo ponto de atencao da OS (Prompt 08)
// ---------------------------------------------------------------------------

/**
 * O FOLLOW-UP NAO VIROU TAREFA (itens 17 e 68).
 *
 * `service_orders.follow_up_at` ja existe desde o Prompt 08, ja e varrido por
 * `sweepOverdueFollowUps` e ja e o que impede a OS parada de sumir. Migra-lo
 * para `agenda_tasks` exigiria que a varredura passasse a depender de um
 * modulo OPCIONAL: desligar a Agenda apagaria a rede de seguranca que a
 * empresa tem hoje. Entao ele fica onde esta, e a agenda o LE.
 *
 * Nao ha backfill porque nao ha o que migrar: nenhuma linha muda de tabela.
 */
async function readFollowUps(
  context: TenantContext,
  unitIds: string[],
  janela: JanelaLeitura,
  assigneeId: string | null,
  today: string,
): Promise<AgendaItem[]> {
  const linhas = await getDb()
    .select({
      id: serviceOrders.id,
      number: serviceOrders.number,
      unitId: serviceOrders.unitId,
      assigneeId: serviceOrders.assignedTechnicianId,
      followUpAt: serviceOrders.followUpAt,
      status: serviceOrders.status,
      customerName: customers.name,
    })
    .from(serviceOrders)
    .leftJoin(
      customers,
      and(
        eq(customers.id, serviceOrders.customerId),
        eq(customers.tenantId, serviceOrders.tenantId),
      ),
    )
    .where(
      and(
        eq(serviceOrders.tenantId, context.tenantId),
        inArray(serviceOrders.unitId, unitIds),
        isNotNull(serviceOrders.followUpAt),
        janela.to ? lte(serviceOrders.followUpAt, janela.to) : undefined,
        /** OS encerrada nao tem proximo ponto de atencao. */
        not(inArray(serviceOrders.status, [...TERMINAL_STATUSES])),
        assigneeId ? eq(serviceOrders.assignedTechnicianId, assigneeId) : undefined,
      ),
    )
    .orderBy(asc(serviceOrders.followUpAt))
    .limit(500);

  return linhas.map((linha) => ({
    type: 'follow_up' as const,
    id: linha.id,
    title: `Acompanhar a OS ${linha.number}`,
    unitId: linha.unitId,
    assigneeId: linha.assigneeId,
    dueDate: linha.followUpAt,
    startAt: null,
    endAt: null,
    allDay: false,
    status: linha.status,
    priority: null,
    serviceOrderId: linha.id,
    serviceOrderNumber: linha.number,
    customerName: linha.customerName,
    overdue: linha.followUpAt !== null && linha.followUpAt < today,
  }));
}

// ---------------------------------------------------------------------------
// "Minhas tarefas" (itens 33, 106 e 107)
// ---------------------------------------------------------------------------

export interface MyTasksView {
  today: string;
  buckets: Array<{ bucket: TaskBucket; items: AgendaItem[] }>;
  overdueCount: number;
  total: number;
}

/**
 * A FILA DE UMA PESSOA, sem recorte de periodo.
 *
 * Aqui nao ha janela: o que esta aberto e meu esta nesta tela, inclusive o que
 * venceu ha um mes e o que nao tem prazo nenhum. A agenda responde "o que tem
 * para esta semana?"; esta tela responde "o que eu devo?". Aplicar o teto de
 * 92 dias aqui esconderia justamente a tarefa mais esquecida.
 *
 * As TRES origens com responsavel entram: tarefa da Agenda, tarefa de fluxo da
 * OS e follow-up da OS de que a pessoa e o tecnico. Compromisso nao entra —
 * ele nao e divida, e compromisso; a agenda e o lugar dele.
 */
export async function loadMyTasks(context: TenantContext): Promise<MyTasksView> {
  const today = todayIn(context.tenantTimezone);
  const unitIds = await visibleUnits(context, null);

  if (unitIds.length === 0 || !context.userId) {
    return { today, buckets: [], overdueCount: 0, total: 0 };
  }

  const janela: JanelaLeitura = { to: null, includeNoDue: true };

  const partes = await Promise.all([
    readTasks(context, unitIds, janela, context.userId, today),
    readServiceOrderTasks(context, unitIds, janela, context.userId, today),
    readFollowUps(context, unitIds, janela, context.userId, today),
  ]);

  const itens = partes.flat().sort(compareAgendaItems);

  const baldes: Array<{ bucket: TaskBucket; items: AgendaItem[] }> = [];
  for (const balde of TASK_BUCKETS) {
    const items = itens.filter((item) => bucketFor(item.dueDate, today) === balde);
    if (items.length > 0) baldes.push({ bucket: balde, items });
  }

  return {
    today,
    buckets: baldes,
    overdueCount: countOverdue(itens),
    total: itens.length,
  };
}

// ---------------------------------------------------------------------------
// Lista de tarefas com filtros (itens 110 a 114)
// ---------------------------------------------------------------------------

export interface TaskListFilters {
  unitId?: string | null;
  assigneeId?: string | null;
  status?: string | null;
  priority?: string | null;
  serviceOrderId?: string | null;
  /** Pagina de 1 em diante. */
  page?: number;
}

export interface TaskListRow {
  id: string;
  title: string;
  notes: string | null;
  unitId: string;
  status: string;
  priority: TaskPriority;
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  serviceOrderId: string | null;
  serviceOrderNumber: number | null;
  customerName: string | null;
  overdue: boolean;
  version: number;
}

export interface TaskListView {
  rows: TaskListRow[];
  page: number;
  pageSize: number;
  total: number;
  today: string;
}

export const TASK_PAGE_SIZE = 25;

/**
 * A LISTA DE TAREFAS DA UNIDADE — so `agenda_tasks`.
 *
 * Aqui NAO entram tarefas de fluxo nem follow-ups, de proposito: esta tela
 * edita, atribui e cancela, e nenhuma dessas acoes se aplica a um registro de
 * outro modulo. Misturar origens numa tela de edicao acabaria oferecendo
 * "cancelar" para um follow-up, que nao tem como ser cancelado.
 *
 * Quem quer ver tudo junto abre a Agenda, que e leitura.
 */
export async function listTasks(
  context: TenantContext,
  filters: TaskListFilters = {},
): Promise<TaskListView> {
  const today = todayIn(context.tenantTimezone);
  const unitIds = await visibleUnits(context, filters.unitId?.trim() || null);

  if (unitIds.length === 0) {
    return { rows: [], page: 1, pageSize: TASK_PAGE_SIZE, total: 0, today };
  }

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const status = filters.status?.trim() || null;
  const priority = filters.priority?.trim() || null;
  const assigneeId = filters.assigneeId?.trim() || null;
  const serviceOrderId = filters.serviceOrderId?.trim() || null;

  const condicao = and(
    eq(agendaTasks.tenantId, context.tenantId),
    inArray(agendaTasks.unitId, unitIds),
    status ? eq(agendaTasks.status, status) : undefined,
    priority ? eq(agendaTasks.priority, priority) : undefined,
    assigneeId ? eq(agendaTasks.assigneeId, assigneeId) : undefined,
    serviceOrderId ? eq(agendaTasks.serviceOrderId, serviceOrderId) : undefined,
  );

  const db = getDb();

  const [linhas, contagem] = await Promise.all([
    db
      .select({
        id: agendaTasks.id,
        title: agendaTasks.title,
        notes: agendaTasks.notes,
        unitId: agendaTasks.unitId,
        status: agendaTasks.status,
        priority: agendaTasks.priority,
        dueDate: agendaTasks.dueDate,
        assigneeId: agendaTasks.assigneeId,
        assigneeName: users.name,
        serviceOrderId: agendaTasks.serviceOrderId,
        serviceOrderNumber: serviceOrders.number,
        customerName: customers.name,
        version: agendaTasks.version,
      })
      .from(agendaTasks)
      .leftJoin(
        users,
        and(eq(users.id, agendaTasks.assigneeId), eq(users.tenantId, agendaTasks.tenantId)),
      )
      .leftJoin(
        serviceOrders,
        and(
          eq(serviceOrders.id, agendaTasks.serviceOrderId),
          eq(serviceOrders.tenantId, agendaTasks.tenantId),
        ),
      )
      .leftJoin(
        customers,
        and(eq(customers.id, agendaTasks.customerId), eq(customers.tenantId, agendaTasks.tenantId)),
      )
      .where(condicao)
      /**
       * Abertas primeiro, e dentro delas a mais vencida no topo. `due_date`
       * nulo vai para o fim: sem prazo nao disputa urgencia com quem tem.
       */
      .orderBy(
        asc(agendaTasks.status),
        sql`${agendaTasks.dueDate} IS NULL`,
        asc(agendaTasks.dueDate),
        desc(agendaTasks.createdAt),
      )
      .limit(TASK_PAGE_SIZE)
      .offset((page - 1) * TASK_PAGE_SIZE),

    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(agendaTasks)
      .where(condicao),
  ]);

  return {
    rows: linhas.map((linha) => ({
      ...linha,
      priority: linha.priority as TaskPriority,
      overdue: linha.status === 'open' && linha.dueDate !== null && linha.dueDate < today,
    })),
    page,
    pageSize: TASK_PAGE_SIZE,
    total: Number(contagem[0]?.total ?? 0),
    today,
  };
}

/** Uma tarefa, para a ficha e para o formulario de edicao. */
export interface TaskDetail extends TaskListRow {
  /** Hoje NA DATA CIVIL DA EMPRESA — a ficha nao recalcula no fuso do browser. */
  today: string;
}

export async function findTask(context: TenantContext, taskId: string): Promise<TaskDetail | null> {
  const unitIds = await visibleUnits(context, null);
  if (unitIds.length === 0) return null;

  const today = todayIn(context.tenantTimezone);

  const [linha] = await getDb()
    .select({
      id: agendaTasks.id,
      title: agendaTasks.title,
      notes: agendaTasks.notes,
      unitId: agendaTasks.unitId,
      status: agendaTasks.status,
      priority: agendaTasks.priority,
      dueDate: agendaTasks.dueDate,
      assigneeId: agendaTasks.assigneeId,
      assigneeName: users.name,
      serviceOrderId: agendaTasks.serviceOrderId,
      serviceOrderNumber: serviceOrders.number,
      customerName: customers.name,
      version: agendaTasks.version,
    })
    .from(agendaTasks)
    .leftJoin(
      users,
      and(eq(users.id, agendaTasks.assigneeId), eq(users.tenantId, agendaTasks.tenantId)),
    )
    .leftJoin(
      serviceOrders,
      and(
        eq(serviceOrders.id, agendaTasks.serviceOrderId),
        eq(serviceOrders.tenantId, agendaTasks.tenantId),
      ),
    )
    .leftJoin(
      customers,
      and(eq(customers.id, agendaTasks.customerId), eq(customers.tenantId, agendaTasks.tenantId)),
    )
    .where(
      and(
        eq(agendaTasks.tenantId, context.tenantId),
        eq(agendaTasks.id, taskId),
        inArray(agendaTasks.unitId, unitIds),
      ),
    )
    .limit(1);

  if (!linha) return null;

  return {
    ...linha,
    priority: linha.priority as TaskPriority,
    overdue: linha.status === 'open' && linha.dueDate !== null && linha.dueDate < today,
    today,
  };
}

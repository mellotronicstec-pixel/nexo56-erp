import 'server-only';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  like,
  lt,
  lte,
  or,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { getDb } from '@/core/db/client';
import { buildOffsetPage, resolveOffset, type OffsetPage } from '@/core/db/pagination';
import { customers } from '@/modules/customers/infrastructure/schema';
import { normalizeSearchable, normalizeSerial } from '@/modules/equipment/domain/equipment';
import {
  equipment,
  equipmentIntakeAccessories,
  equipmentIntakeConditions,
  equipmentIntakes,
  equipmentMedia,
} from '@/modules/equipment/infrastructure/schema';
import {
  SERVICE_ORDER_NUMBER_PADDING,
  SERVICE_ORDER_NUMBER_PREFIX,
  parseServiceOrderNumber,
} from '@/modules/service-orders/domain/service-order';
import {
  serviceOrderTasks,
  serviceOrderTimeline,
  serviceOrders,
} from '@/modules/service-orders/infrastructure/schema';
import { todayIn } from '@/core/time/civil-date';
import { SEQUENCE_TYPES, peekSequence } from '@/modules/tenancy/application/sequence-service';
import { units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Consultas de Ordens de Servico (Prompt 07, itens 45 a 50 e 102).
 *
 * TODA consulta carrega o escopo: `tenant_id` sempre, `unit_id` quando a
 * listagem e da operacao. Nao existe aqui um `findById(id)` sem escopo — e o
 * tipo de atalho que, um refactor depois, vira IDOR entre empresas.
 *
 * A listagem faz DUAS consultas para N ordens (a pagina e o total), com os
 * dados de cliente, equipamento e unidade vindo por JOIN — nunca uma consulta
 * por linha (item 50).
 */

export interface ServiceOrderNumberFormat {
  prefix: string;
  padding: number;
}

/**
 * Prefixo e zeros a esquerda vigentes no tenant.
 *
 * Uma consulta por PAGINA, nao por linha: a pagina le uma vez e formata todos
 * os numeros com o mesmo resultado.
 */
export async function getServiceOrderNumberFormat(
  tenantId: string,
): Promise<ServiceOrderNumberFormat> {
  const sequence = await peekSequence(tenantId, SEQUENCE_TYPES.SERVICE_ORDER);
  return {
    prefix: sequence?.prefix ?? SERVICE_ORDER_NUMBER_PREFIX,
    padding: sequence?.padding ?? SERVICE_ORDER_NUMBER_PADDING,
  };
}

export interface ServiceOrderListFilters {
  query?: string;
  customerId?: string;
  /** Abertas a partir desta data (inclusive), em ISO `YYYY-MM-DD`. */
  from?: string;
  /** Abertas ate esta data (inclusive), em ISO `YYYY-MM-DD`. */
  to?: string;
  /** Situacao do workflow (Prompt 08, item 88). */
  status?: string;
  /** Tecnico responsavel (item 90). */
  technicianId?: string;
  /** Acompanhamento: vencido, hoje, ou nos proximos dias (item 89). */
  followUp?: 'overdue' | 'today' | 'upcoming';
  page?: number;
  pageSize?: number;
}

export interface ServiceOrderListItem {
  id: string;
  number: number;
  status: string;
  openedAt: Date;
  /** Data civil ISO, ou `null` quando a ordem saiu do radar. */
  followUpAt: string | null;
  technicianName: string | null;
  openTaskCount: number;
  customerId: string;
  customerName: string;
  equipmentId: string;
  equipmentKind: string;
  equipmentBrand: string | null;
  equipmentModel: string | null;
  equipmentSerial: string | null;
  unitName: string | null;
}

/**
 * Condicao de busca (itens 45 e 46).
 *
 * O NUMERO TEM PRIORIDADE E CAMINHO PROPRIO: quem digita "OS #1024" ou "1024"
 * esta procurando uma ordem especifica, e a consulta vira igualdade sobre a
 * coluna indexada — nao um `LIKE '%1024%'` que varreria a tabela e ainda
 * devolveria a OS 21024 junto.
 *
 * Como o mesmo campo tambem procura por cliente e aparelho, a condicao de
 * numero entra em OR com as de texto: digitar "1024" acha a OS 1024 e, se
 * existir, o aparelho cujo modelo contem 1024.
 */
function buildSearch(rawQuery: string): SQL | undefined {
  const conditions: SQL[] = [];

  const numeric = parseServiceOrderNumber(rawQuery);
  if (numeric !== null) conditions.push(eq(serviceOrders.number, numeric));

  const text = normalizeSearchable(rawQuery);
  if (text) {
    conditions.push(
      like(customers.nameNormalized, `%${text}%`),
      like(equipment.kindNormalized, `%${text}%`),
      like(equipment.brandNormalized, `%${text}%`),
      like(equipment.modelNormalized, `%${text}%`),
    );

    const serial = normalizeSerial(rawQuery);
    if (serial.length >= 3) conditions.push(like(equipment.serialNormalized, `%${serial}%`));
  }

  if (conditions.length === 0) return undefined;
  return or(...conditions);
}

/** Limite superior do dia informado, para `openedAt <= fim do dia`. */
function endOfDay(isoDate: string): Date {
  return new Date(`${isoDate}T23:59:59.999Z`);
}

/**
 * Lista as Ordens de Servico da UNIDADE ATIVA.
 *
 * Sem unidade ativa nao ha o que listar: a OS pertence a uma unidade, e
 * mostrar a soma de todas as lojas contrariaria o isolamento que o Prompt 03
 * estabeleceu. A pagina avisa e oferece o seletor de unidade.
 */
export async function listServiceOrders(
  context: TenantContext,
  filters: ServiceOrderListFilters = {},
): Promise<OffsetPage<ServiceOrderListItem>> {
  const { limit, offset, page } = resolveOffset(filters);

  if (!context.activeUnitId) {
    return buildOffsetPage<ServiceOrderListItem>([], 0, { page, pageSize: limit });
  }

  const db = getDb();

  /** Hoje no fuso do tenant: "vencido" e relativo a quem opera. */
  const today = todayIn(context.tenantTimezone);

  const where = and(
    eq(serviceOrders.tenantId, context.tenantId),
    eq(serviceOrders.unitId, context.activeUnitId),
    filters.query ? buildSearch(filters.query) : undefined,
    filters.customerId ? eq(serviceOrders.customerId, filters.customerId) : undefined,
    filters.from
      ? gte(serviceOrders.openedAt, new Date(`${filters.from}T00:00:00.000Z`))
      : undefined,
    filters.to ? lte(serviceOrders.openedAt, endOfDay(filters.to)) : undefined,
    filters.status ? eq(serviceOrders.status, filters.status) : undefined,
    filters.technicianId ? eq(serviceOrders.assignedTechnicianId, filters.technicianId) : undefined,
    /**
     * Filtros de acompanhamento (item 89). Ordem terminal nunca entra: ela ja
     * perdeu o follow-up na transicao, e listar "vencida" uma ordem finalizada
     * seria ruido puro.
     */
    filters.followUp === 'overdue' ? lt(serviceOrders.followUpAt, today) : undefined,
    filters.followUp === 'today' ? eq(serviceOrders.followUpAt, today) : undefined,
    filters.followUp === 'upcoming' ? gt(serviceOrders.followUpAt, today) : undefined,
    filters.followUp ? isNotNull(serviceOrders.followUpAt) : undefined,
  );

  const technician = alias(users, 'technician');

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: serviceOrders.id,
        number: serviceOrders.number,
        status: serviceOrders.status,
        openedAt: serviceOrders.openedAt,
        followUpAt: serviceOrders.followUpAt,
        customerId: serviceOrders.customerId,
        customerName: customers.name,
        equipmentId: serviceOrders.equipmentId,
        equipmentKind: equipment.kind,
        equipmentBrand: equipment.brand,
        equipmentModel: equipment.model,
        equipmentSerial: equipment.serial,
        unitName: units.name,
        technicianName: technician.name,
      })
      .from(serviceOrders)
      .innerJoin(customers, eq(customers.id, serviceOrders.customerId))
      .innerJoin(equipment, eq(equipment.id, serviceOrders.equipmentId))
      .leftJoin(units, eq(units.id, serviceOrders.unitId))
      // Tecnico por JOIN, nao por consulta por linha (item 93).
      .leftJoin(technician, eq(technician.id, serviceOrders.assignedTechnicianId))
      .where(where)
      // Mais recentes primeiro, com `id` como desempate deterministico.
      .orderBy(desc(serviceOrders.openedAt), desc(serviceOrders.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(serviceOrders)
      .innerJoin(customers, eq(customers.id, serviceOrders.customerId))
      .innerJoin(equipment, eq(equipment.id, serviceOrders.equipmentId))
      .where(where),
  ]);

  /**
   * Tarefas abertas da PAGINA inteira em UMA consulta agregada (item 93).
   * Uma consulta por linha transformaria uma lista de 25 ordens em 26 idas ao
   * banco — e a lista da unidade e a tela mais aberta do sistema.
   */
  const openTasks = new Map<string, number>();
  if (rows.length > 0) {
    const counts = await db
      .select({ serviceOrderId: serviceOrderTasks.serviceOrderId, total: count() })
      .from(serviceOrderTasks)
      .where(
        and(
          eq(serviceOrderTasks.tenantId, context.tenantId),
          eq(serviceOrderTasks.status, 'open'),
          inArray(
            serviceOrderTasks.serviceOrderId,
            rows.map((row) => row.id),
          ),
        ),
      )
      .groupBy(serviceOrderTasks.serviceOrderId);

    for (const row of counts) openTasks.set(row.serviceOrderId, Number(row.total));
  }

  const items: ServiceOrderListItem[] = rows.map((row) => ({
    ...row,
    openTaskCount: openTasks.get(row.id) ?? 0,
  }));

  return buildOffsetPage(items, Number(totals?.total ?? 0), { page, pageSize: limit });
}

export interface ServiceOrderDetail {
  order: {
    id: string;
    number: number;
    status: string;
    openedAt: Date;
    customerReport: string;
    internalNotes: string | null;
    unitId: string;
    intakeId: string | null;
    updatedAt: Date;
    /** Versao lida. Volta no formulario para travar a concorrencia (item 11). */
    version: number;
    followUpAt: string | null;
    assignedTechnicianId: string | null;
    /**
     * Classificacao da ordem (Prompt 13, item 30). `standard` ou
     * `warranty_internal`.
     *
     * NAO E STATUS e nao entra na maquina de estados: e o que a ordem E, nao
     * onde ela esta. Uma OS de garantia percorre o mesmo fluxo de qualquer
     * outra — o que muda e por que ela nasceu e onde ela comeca.
     */
    classification: string;
  };
  customer: { id: string; name: string; kind: string };
  equipmentItem: {
    id: string;
    kind: string;
    brand: string | null;
    model: string | null;
    serial: string | null;
    voltage: string;
  };
  unitName: string | null;
  openedByName: string | null;
  technicianName: string | null;
  tasks: {
    id: string;
    kind: string;
    title: string;
    description: string | null;
    status: string;
    dueDate: string | null;
    assigneeName: string | null;
    completedAt: Date | null;
  }[];
  intake: {
    id: string;
    receivedAt: Date;
    powerCable: string;
    inspectionNotes: string | null;
    accessories: { id: string; label: string; quantity: number }[];
    conditions: { id: string; conditionKey: string; note: string | null }[];
    media: { id: string; kind: string; caption: string | null }[];
  } | null;
  /** Fotos do equipamento que nao pertencem a um recebimento. */
  equipmentMedia: { id: string; kind: string; caption: string | null }[];
  timeline: {
    id: string;
    kind: string;
    summary: string | null;
    /** Justificativa escrita, quando a transicao exigiu uma. */
    reason: string | null;
    actorName: string | null;
    occurredAt: Date;
  }[];
}

/**
 * Ficha completa da OS.
 *
 * ID de outra empresa e ID de outra unidade devolvem `null`, igual a ID
 * inexistente (itens 63 e 65): responder "sem permissao" confirmaria que
 * aquela ordem existe.
 */
export async function findServiceOrderDetail(
  context: TenantContext,
  serviceOrderId: string,
): Promise<ServiceOrderDetail | null> {
  const db = getDb();

  const [row] = await db
    .select({
      id: serviceOrders.id,
      number: serviceOrders.number,
      status: serviceOrders.status,
      openedAt: serviceOrders.openedAt,
      customerReport: serviceOrders.customerReport,
      internalNotes: serviceOrders.internalNotes,
      unitId: serviceOrders.unitId,
      intakeId: serviceOrders.intakeId,
      updatedAt: serviceOrders.updatedAt,
      version: serviceOrders.version,
      followUpAt: serviceOrders.followUpAt,
      assignedTechnicianId: serviceOrders.assignedTechnicianId,
      classification: serviceOrders.classification,
      createdBy: serviceOrders.createdBy,
      customerId: customers.id,
      customerName: customers.name,
      customerKind: customers.kind,
      equipmentId: equipment.id,
      equipmentKind: equipment.kind,
      equipmentBrand: equipment.brand,
      equipmentModel: equipment.model,
      equipmentSerial: equipment.serial,
      equipmentVoltage: equipment.voltage,
      unitName: units.name,
    })
    .from(serviceOrders)
    .innerJoin(customers, eq(customers.id, serviceOrders.customerId))
    .innerJoin(equipment, eq(equipment.id, serviceOrders.equipmentId))
    .leftJoin(units, eq(units.id, serviceOrders.unitId))
    .where(and(eq(serviceOrders.tenantId, context.tenantId), eq(serviceOrders.id, serviceOrderId)))
    .limit(1);

  if (!row) return null;
  if (!context.authorizedUnitIds.includes(row.unitId)) return null;

  /**
   * Nomes de quem abriu e de quem conserta em UMA consulta, nao duas
   * (item 93). Sao no maximo dois ids, e com frequencia o mesmo.
   */
  const peopleIds = [...new Set([row.createdBy, row.assignedTechnicianId].filter(Boolean))];
  const people = new Map<string, string>();
  if (peopleIds.length > 0) {
    const found = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, context.tenantId), inArray(users.id, peopleIds as string[])));
    for (const person of found) people.set(person.id, person.name);
  }

  /**
   * O recebimento e LIDO, nao copiado (itens 10, 55 e 56).
   *
   * Acessorios, inspecao e fotos continuam morando no recebimento. Duplicar
   * aqui criaria duas verdades sobre o mesmo atendimento, e a segunda ficaria
   * desatualizada no primeiro ajuste.
   */
  let intake: ServiceOrderDetail['intake'] = null;
  if (row.intakeId) {
    const [intakeRow] = await db
      .select({
        id: equipmentIntakes.id,
        receivedAt: equipmentIntakes.receivedAt,
        powerCable: equipmentIntakes.powerCable,
        inspectionNotes: equipmentIntakes.inspectionNotes,
      })
      .from(equipmentIntakes)
      .where(
        and(eq(equipmentIntakes.tenantId, context.tenantId), eq(equipmentIntakes.id, row.intakeId)),
      )
      .limit(1);

    if (intakeRow) {
      const [accessories, conditions, media] = await Promise.all([
        db
          .select({
            id: equipmentIntakeAccessories.id,
            label: equipmentIntakeAccessories.label,
            quantity: equipmentIntakeAccessories.quantity,
          })
          .from(equipmentIntakeAccessories)
          .where(
            and(
              eq(equipmentIntakeAccessories.tenantId, context.tenantId),
              eq(equipmentIntakeAccessories.intakeId, intakeRow.id),
            ),
          )
          .orderBy(asc(equipmentIntakeAccessories.label)),
        db
          .select({
            id: equipmentIntakeConditions.id,
            conditionKey: equipmentIntakeConditions.conditionKey,
            note: equipmentIntakeConditions.note,
          })
          .from(equipmentIntakeConditions)
          .where(
            and(
              eq(equipmentIntakeConditions.tenantId, context.tenantId),
              eq(equipmentIntakeConditions.intakeId, intakeRow.id),
            ),
          ),
        db
          .select({
            id: equipmentMedia.id,
            kind: equipmentMedia.kind,
            caption: equipmentMedia.caption,
          })
          .from(equipmentMedia)
          .where(
            and(
              eq(equipmentMedia.tenantId, context.tenantId),
              eq(equipmentMedia.intakeId, intakeRow.id),
            ),
          )
          .orderBy(desc(equipmentMedia.createdAt)),
      ]);

      intake = { ...intakeRow, accessories, conditions, media };
    }
  }

  const [ownMedia, timelineRows, taskRows] = await Promise.all([
    db
      .select({ id: equipmentMedia.id, kind: equipmentMedia.kind, caption: equipmentMedia.caption })
      .from(equipmentMedia)
      .where(
        and(
          eq(equipmentMedia.tenantId, context.tenantId),
          eq(equipmentMedia.equipmentId, row.equipmentId),
        ),
      )
      .orderBy(desc(equipmentMedia.createdAt))
      .limit(12),
    db
      .select({
        id: serviceOrderTimeline.id,
        kind: serviceOrderTimeline.kind,
        summary: serviceOrderTimeline.summary,
        reason: serviceOrderTimeline.reason,
        actorId: serviceOrderTimeline.actorId,
        occurredAt: serviceOrderTimeline.occurredAt,
      })
      .from(serviceOrderTimeline)
      .where(
        and(
          eq(serviceOrderTimeline.tenantId, context.tenantId),
          eq(serviceOrderTimeline.serviceOrderId, serviceOrderId),
        ),
      )
      .orderBy(desc(serviceOrderTimeline.occurredAt), desc(serviceOrderTimeline.id))
      .limit(50),
    /** Tarefas da ordem, abertas primeiro. */
    db
      .select({
        id: serviceOrderTasks.id,
        kind: serviceOrderTasks.kind,
        title: serviceOrderTasks.title,
        description: serviceOrderTasks.description,
        status: serviceOrderTasks.status,
        dueDate: serviceOrderTasks.dueDate,
        assigneeId: serviceOrderTasks.assigneeId,
        completedAt: serviceOrderTasks.completedAt,
      })
      .from(serviceOrderTasks)
      .where(
        and(
          eq(serviceOrderTasks.tenantId, context.tenantId),
          eq(serviceOrderTasks.serviceOrderId, serviceOrderId),
        ),
      )
      .orderBy(asc(serviceOrderTasks.status), asc(serviceOrderTasks.dueDate))
      .limit(20),
  ]);

  /**
   * Nomes dos autores da linha do tempo e dos responsaveis pelas tarefas em UMA
   * consulta — nao uma por fato nem uma por tarefa (item 93).
   */
  const actorIds = [
    ...new Set(
      [
        ...timelineRows.map((entry) => entry.actorId),
        ...taskRows.map((task) => task.assigneeId),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const actors = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, context.tenantId), inArray(users.id, actorIds)));
    for (const actor of actors) actorNames.set(actor.id, actor.name);
  }

  const tasks = taskRows.map((task) => ({
    id: task.id,
    kind: task.kind,
    title: task.title,
    description: task.description,
    status: task.status,
    dueDate: task.dueDate,
    assigneeName: task.assigneeId ? (actorNames.get(task.assigneeId) ?? null) : null,
    completedAt: task.completedAt,
  }));

  return {
    order: {
      id: row.id,
      number: row.number,
      status: row.status,
      openedAt: row.openedAt,
      customerReport: row.customerReport,
      internalNotes: row.internalNotes,
      unitId: row.unitId,
      intakeId: row.intakeId,
      updatedAt: row.updatedAt,
      version: row.version,
      followUpAt: row.followUpAt,
      assignedTechnicianId: row.assignedTechnicianId,
      classification: row.classification,
    },
    customer: { id: row.customerId, name: row.customerName, kind: row.customerKind },
    equipmentItem: {
      id: row.equipmentId,
      kind: row.equipmentKind,
      brand: row.equipmentBrand,
      model: row.equipmentModel,
      serial: row.equipmentSerial,
      voltage: row.equipmentVoltage,
    },
    unitName: row.unitName,
    openedByName: row.createdBy ? (people.get(row.createdBy) ?? null) : null,
    technicianName: row.assignedTechnicianId
      ? (people.get(row.assignedTechnicianId) ?? null)
      : null,
    tasks,
    intake,
    equipmentMedia: ownMedia,
    timeline: timelineRows.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      summary: entry.summary,
      reason: entry.reason,
      actorName: entry.actorId ? (actorNames.get(entry.actorId) ?? null) : null,
      occurredAt: entry.occurredAt,
    })),
  };
}

/**
 * Ordens ja abertas para um conjunto de recebimentos.
 *
 * UMA consulta para a lista inteira: a ficha do equipamento e a lista de
 * recebimentos usam isto para decidir entre "Abrir Ordem de Servico" e
 * "Ver OS #123" sem consultar uma vez por linha.
 */
export async function mapServiceOrdersByIntake(
  context: TenantContext,
  intakeIds: readonly string[],
): Promise<Map<string, { id: string; number: number }>> {
  const result = new Map<string, { id: string; number: number }>();
  if (intakeIds.length === 0) return result;

  const rows = await getDb()
    .select({
      id: serviceOrders.id,
      number: serviceOrders.number,
      intakeId: serviceOrders.intakeId,
    })
    .from(serviceOrders)
    .where(
      and(
        eq(serviceOrders.tenantId, context.tenantId),
        inArray(serviceOrders.intakeId, [...intakeIds]),
      ),
    );

  for (const row of rows) {
    if (row.intakeId) result.set(row.intakeId, { id: row.id, number: row.number });
  }
  return result;
}

/** Busca direta pelo numero exato, dentro da unidade ativa (item 97). */
export async function findServiceOrderByNumber(
  context: TenantContext,
  number: number,
): Promise<{ id: string; number: number } | null> {
  if (!context.activeUnitId) return null;

  const [row] = await getDb()
    .select({ id: serviceOrders.id, number: serviceOrders.number })
    .from(serviceOrders)
    .where(
      and(
        eq(serviceOrders.tenantId, context.tenantId),
        eq(serviceOrders.unitId, context.activeUnitId),
        eq(serviceOrders.number, number),
      ),
    )
    .limit(1);

  return row ?? null;
}

import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  int,
  mysqlTable,
  text,
  tinyint,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { civilDate, id, idRef, instant, tenantId, timestamps, unitId } from '@/core/db/columns';
import { customers } from '@/modules/customers/infrastructure/schema';
import { equipment } from '@/modules/equipment/infrastructure/schema';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';
import { warranties } from '@/modules/warranties/infrastructure/schema';

/**
 * SCHEMA DE AGENDA E TAREFAS (Prompt 14).
 *
 * DUAS TABELAS, e a separacao entre elas e o produto principal deste prompt:
 *
 *   agenda_tasks         algo que uma PESSOA precisa fazer, com prazo opcional
 *   agenda_appointments  um COMPROMISSO que ocupa posicao na agenda
 *
 * O QUE ESTE SCHEMA NAO CRIA, e por que:
 *
 * Nao ha tabela de follow-up. O acompanhamento da Ordem de Servico ja existe
 * desde o Prompt 08 como `service_orders.follow_up_at` — uma data civil que se
 * move com o fluxo da ordem e some quando ela encerra. Duplicar isso aqui
 * criaria duas verdades sobre o mesmo prazo, e a segunda ficaria velha no
 * primeiro reagendamento (ADR-073).
 *
 * Nao ha tabela nova para as tarefas do fluxo da OS. `service_order_tasks`,
 * tambem do Prompt 08, ja e isso: uma tarefa ABERTA por tipo por ordem, com a
 * unicidade garantida no banco. A Agenda a LE e a apresenta junto das suas,
 * sem copiar linha nenhuma.
 *
 * Nao ha coluna `overdue`. Atraso e derivado (item 28).
 * Nao ha recorrencia (item 58) nem lembretes (item 59): nao foram construidos,
 * e coluna sem comportamento e promessa falsa.
 */

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

export const agendaTasks = mysqlTable(
  'agenda_tasks',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),

    /**
     * A UNIDADE E OBRIGATORIA (item 25).
     *
     * Tarefa operacional acontece onde o trabalho acontece. Sem unidade, a
     * fila de "sem responsavel" de uma loja mostraria o trabalho da outra — e
     * quem abre a loja de manha precisa ver a SUA bancada.
     */
    unitId: unitId().notNull(),

    title: varchar('title', { length: 160 }).notNull(),
    /** Texto livre de quem criou. Renderizado como TEXTO, nunca como HTML. */
    notes: text('notes'),

    /** `open` | `completed` | `cancelled`. Nunca `overdue` (item 27). */
    status: varchar('status', { length: 20 }).notNull().default('open'),
    /** `low` | `normal` | `high` | `urgent`. */
    priority: varchar('priority', { length: 10 }).notNull().default('normal'),

    /**
     * Prazo como DATA CIVIL, e nao instante.
     *
     * "Ate sexta" e um dia inteiro no fuso de quem opera; guardar como
     * timestamp faria a tarefa que vence hoje aparecer vencida ontem conforme
     * o relogio do servidor. E a mesma escolha do follow-up e da tarefa de
     * fluxo da OS — trocar de semantica agora criaria duas regras de prazo no
     * mesmo produto (ADR-074).
     */
    dueDate: civilDate('due_date'),

    /** Nulo = fila sem dono. E proposital: trabalho sem responsavel nao some. */
    assigneeId: idRef('assignee_id'),
    createdBy: idRef('created_by'),

    /**
     * Chave de intencao (itens 40 e 41).
     *
     * O formulario gera uma por montagem, entao duplo clique reencontra a
     * tarefa em vez de criar a segunda. Fica disponivel para quem, no futuro,
     * criar tarefa por regra de dominio: a chave deterministica e o que impede
     * o reprocessamento de um evento de virar cinco tarefas iguais.
     */
    idempotencyKey: varchar('idempotency_key', { length: 120 }),

    /** Vinculos de contexto. Todos OPCIONAIS: tarefa administrativa nao tem OS. */
    serviceOrderId: idRef('service_order_id'),
    customerId: idRef('customer_id'),
    equipmentId: idRef('equipment_id'),
    warrantyId: idRef('warranty_id'),

    completedAt: instant('completed_at'),
    completedBy: idRef('completed_by'),
    cancelledAt: instant('cancelled_at'),
    cancelledBy: idRef('cancelled_by'),
    cancelReason: varchar('cancel_reason', { length: 300 }),

    /** Concorrencia otimista: completar e cancelar disputam a mesma linha. */
    version: int('version', { unsigned: true }).notNull().default(1),

    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_agenda_task_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_agenda_task_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_agenda_task_assignee_tenant',
      columns: [table.assigneeId, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_agenda_task_created_by_tenant',
      columns: [table.createdBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /**
     * A OS e da MESMA UNIDADE da tarefa (item 43).
     *
     * FK composta com `unit_id`: nao adianta o navegador mandar o id de uma
     * ordem da outra loja — o banco recusa a linha.
     */
    foreignKey({
      name: 'fk_agenda_task_order_unit',
      columns: [table.serviceOrderId, table.unitId],
      foreignColumns: [serviceOrders.id, serviceOrders.unitId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_agenda_task_customer_tenant',
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_agenda_task_equipment_tenant',
      columns: [table.equipmentId, table.tenantId],
      foreignColumns: [equipment.id, equipment.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /**
     * Garantia e vinculo OPCIONAL (item 72). A FK existe no banco, mas
     * desligar o modulo de Garantias nao quebra a Agenda: o campo fica nulo.
     */
    foreignKey({
      name: 'fk_agenda_task_warranty_tenant',
      columns: [table.warrantyId, table.tenantId],
      foreignColumns: [warranties.id, warranties.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /**
     * A TRAVA DE DUPLICACAO (itens 40, 148 e 149).
     *
     * Vale para qualquer situacao, nao so para tarefas abertas: se a chave ja
     * produziu uma tarefa, reprocessar o comando reencontra AQUELA — mesmo que
     * ela ja tenha sido concluida. Limitar a trava as abertas faria o retry de
     * um evento antigo ressuscitar trabalho que a bancada ja fechou.
     */
    unique('uq_agenda_task_idempotency').on(table.tenantId, table.idempotencyKey),

    check('ck_agenda_task_status', sql`status IN ('open','done','cancelled')`),
    check('ck_agenda_task_priority', sql`priority IN ('low','normal','high','urgent')`),

    /** A fila da unidade: o que venceu, o que vence hoje. */
    index('ix_agenda_task_unit_due').on(table.tenantId, table.unitId, table.status, table.dueDate),
    /** "Minhas tarefas". */
    index('ix_agenda_task_assignee').on(
      table.tenantId,
      table.assigneeId,
      table.status,
      table.dueDate,
    ),
    index('ix_agenda_task_order').on(table.tenantId, table.serviceOrderId),
  ],
);

// ---------------------------------------------------------------------------
// Compromissos
// ---------------------------------------------------------------------------

export const agendaAppointments = mysqlTable(
  'agenda_appointments',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    unitId: unitId().notNull(),

    title: varchar('title', { length: 160 }).notNull(),
    notes: text('notes'),

    /** `scheduled` | `cancelled`. NAO existe `completed` (item 47). */
    status: varchar('status', { length: 20 }).notNull().default('scheduled'),

    /**
     * HORARIO OU DIA INTEIRO — nunca os dois (item 49).
     *
     * Com horario, valem `start_at`/`end_at`, instantes UTC como todo o resto
     * do sistema. Dia inteiro vale `start_date`/`end_date`, datas CIVIS: um
     * evento de dia inteiro nao e "00:00 as 23:59 UTC", que em Sao Paulo
     * comecaria as 21h do dia anterior.
     */
    allDay: tinyint('all_day').notNull().default(0),
    startAt: instant('start_at'),
    endAt: instant('end_at'),
    startDate: civilDate('start_date'),
    endDate: civilDate('end_date'),

    assigneeId: idRef('assignee_id'),
    createdBy: idRef('created_by'),

    serviceOrderId: idRef('service_order_id'),
    customerId: idRef('customer_id'),
    equipmentId: idRef('equipment_id'),
    warrantyId: idRef('warranty_id'),

    cancelledAt: instant('cancelled_at'),
    cancelledBy: idRef('cancelled_by'),
    cancelReason: varchar('cancel_reason', { length: 300 }),

    /**
     * CHAVE DE INTENCAO, igual a das tarefas (itens 40 e 41).
     *
     * Um compromisso duplicado nao e ruido inofensivo: sao dois blocos
     * identicos no mesmo horario, e quem olha a agenda nao sabe qual dos dois
     * alguem ja resolveu. O duplo clique precisa reencontrar o compromisso,
     * nao criar o segundo.
     */
    idempotencyKey: varchar('idempotency_key', { length: 120 }),

    version: int('version', { unsigned: true }).notNull().default(1),

    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_agenda_appt_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_agenda_appt_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_agenda_appt_assignee_tenant',
      columns: [table.assigneeId, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_agenda_appt_created_by_tenant',
      columns: [table.createdBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_agenda_appt_order_unit',
      columns: [table.serviceOrderId, table.unitId],
      foreignColumns: [serviceOrders.id, serviceOrders.unitId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_agenda_appt_customer_tenant',
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_agenda_appt_equipment_tenant',
      columns: [table.equipmentId, table.tenantId],
      foreignColumns: [equipment.id, equipment.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_agenda_appt_warranty_tenant',
      columns: [table.warrantyId, table.tenantId],
      foreignColumns: [warranties.id, warranties.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_agenda_appt_idempotency').on(table.tenantId, table.idempotencyKey),

    check('ck_agenda_appt_status', sql`status IN ('scheduled','cancelled')`),
    /** O fim vem depois do inicio. Colunas simples: o InnoDB aceita (item 48). */
    check('ck_agenda_appt_period', sql`end_at IS NULL OR start_at IS NULL OR end_at > start_at`),
    check(
      'ck_agenda_appt_all_day_period',
      sql`end_date IS NULL OR start_date IS NULL OR end_date >= start_date`,
    ),

    /** Consulta por intervalo: e assim que a agenda pergunta "e esta semana?". */
    index('ix_agenda_appt_unit_start').on(table.tenantId, table.unitId, table.startAt),
    index('ix_agenda_appt_unit_day').on(table.tenantId, table.unitId, table.startDate),
    index('ix_agenda_appt_assignee').on(table.tenantId, table.assigneeId, table.startAt),
    index('ix_agenda_appt_order').on(table.tenantId, table.serviceOrderId),
  ],
);

export type AgendaTaskRow = typeof agendaTasks.$inferSelect;
export type AgendaAppointmentRow = typeof agendaAppointments.$inferSelect;

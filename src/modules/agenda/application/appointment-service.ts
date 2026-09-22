import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { affectedRows } from '@/core/db/affected-rows';
import { isDuplicateKeyError } from '@/core/db/duplicate-key';
import { runInTransaction } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  APPOINTMENT_NOTES_MAX,
  APPOINTMENT_TITLE_MAX,
  type AppointmentWhen,
  CANCEL_REASON_MAX,
  CANCEL_REASON_MIN,
  validateAppointmentWhen,
} from '@/modules/agenda/domain/agenda';
import { agendaAppointments } from '@/modules/agenda/infrastructure/schema';
import { assertAssignee, blank, parse, resolveUnit } from './agenda-guards';
import { assertContextLinks } from './agenda-links';

/**
 * COMPROMISSOS (Prompt 14, itens 5 e 45 a 49).
 *
 * Um compromisso OCUPA UM LUGAR NO TEMPO: das 14h as 15h de quinta, ou o dia
 * 12 inteiro. Uma tarefa tem prazo — "ate sexta" —, o que e outra coisa: o
 * prazo diz quando o trabalho vence, o compromisso diz quando a pessoa estara
 * ocupada. Guardar os dois na mesma tabela obrigaria toda consulta a perguntar
 * "mas este aqui e dos que ocupam horario?", e alguma consulta esqueceria.
 *
 * NAO EXISTE `completed` (item 47). O tempo passar nao prova que a visita
 * aconteceu; marcar como realizado tudo que ja passou registraria como
 * atendimento feito justamente o dia em que ninguem foi.
 *
 * NAO HA RECORRENCIA (item 58) e NAO HA MOTOR DE LEMBRETES (item 59). Nada
 * aqui avisa ninguem: criar "visita ao cliente" nao manda mensagem alguma.
 */

const linkSchema = z.string().trim().optional().or(z.literal(''));

const instantSchema = z
  .string()
  .trim()
  .datetime({ offset: true, message: 'Informe um horario valido.' });

const civilSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data valida.');

/**
 * HORARIO OU DIA INTEIRO — a entrada e uma uniao, nao quatro campos soltos
 * (item 49). Com quatro campos opcionais, "dia inteiro das 14h" seria
 * representavel, e o que e representavel acaba gravado.
 */
const whenSchema = z.discriminatedUnion('allDay', [
  z.object({
    allDay: z.literal(false),
    startAt: instantSchema,
    endAt: instantSchema,
  }),
  z.object({
    allDay: z.literal(true),
    startDate: civilSchema,
    endDate: civilSchema,
  }),
]);

const createSchema = z
  .object({
    title: z.string().trim().min(1, 'Descreva o compromisso.').max(APPOINTMENT_TITLE_MAX),
    notes: z.string().trim().max(APPOINTMENT_NOTES_MAX).optional().or(z.literal('')),
    unitId: linkSchema,
    assigneeId: linkSchema,
    serviceOrderId: linkSchema,
    customerId: linkSchema,
    equipmentId: linkSchema,
    warrantyId: linkSchema,
    idempotencyKey: z.string().trim().max(120).optional().or(z.literal('')),
  })
  .and(whenSchema);

export type CreateAppointmentInput = z.infer<typeof createSchema>;

/** Converte a entrada validada no tipo do dominio, que sabe julgar o periodo. */
function toWhen(input: z.infer<typeof whenSchema>): AppointmentWhen {
  return input.allDay
    ? { allDay: true, startDate: input.startDate, endDate: input.endDate }
    : { allDay: false, startAt: new Date(input.startAt), endAt: new Date(input.endAt) };
}

/**
 * As quatro colunas temporais, preenchidas de modo que apenas um par exista.
 * O par nao usado vai a `null` EXPLICITAMENTE: num reagendamento que troca dia
 * inteiro por horario, deixar o par antigo intacto guardaria as duas versoes
 * do quando, e a consulta por intervalo encontraria o compromisso duas vezes.
 */
function whenColumns(when: AppointmentWhen) {
  return when.allDay
    ? {
        allDay: 1,
        startAt: null,
        endAt: null,
        startDate: when.startDate,
        endDate: when.endDate,
      }
    : {
        allDay: 0,
        startAt: when.startAt,
        endAt: when.endAt,
        startDate: null,
        endDate: null,
      };
}

function assertWhen(when: AppointmentWhen): void {
  const problema = validateAppointmentWhen(when);
  if (problema) throw new ValidationError(problema);
}

export interface CreatedAppointment {
  appointmentId: string;
  /** `true` quando a chave de intencao reencontrou um compromisso ja criado. */
  reused: boolean;
}

export async function createAppointment(
  context: TenantContext,
  rawInput: unknown,
): Promise<CreatedAppointment> {
  const input = parse(createSchema, rawInput);
  const unitId = resolveUnit(context, blank(input.unitId));

  await authorize(context, {
    permission: PERMISSIONS.AGENDA_APPOINTMENTS_MANAGE,
    featureKey: FEATURES.OPERATIONS_AGENDA,
    unitId,
  });

  const when = toWhen(input);
  assertWhen(when);

  const assigneeId = blank(input.assigneeId);
  if (assigneeId) await assertAssignee(context, assigneeId, unitId);

  const links = await assertContextLinks(context, {
    unitId,
    serviceOrderId: blank(input.serviceOrderId),
    customerId: blank(input.customerId),
    equipmentId: blank(input.equipmentId),
    warrantyId: blank(input.warrantyId),
  });

  const idempotencyKey = blank(input.idempotencyKey);
  if (idempotencyKey) {
    const existente = await findByKey(context, idempotencyKey);
    if (existente) return { appointmentId: existente, reused: true };
  }

  const appointmentId = newId();
  const now = new Date();

  try {
    await runInTransaction(async (tx, emit) => {
      await tx.insert(agendaAppointments).values({
        id: appointmentId,
        tenantId: context.tenantId,
        unitId,
        title: input.title,
        notes: blank(input.notes),
        status: 'scheduled',
        ...whenColumns(when),
        assigneeId,
        createdBy: context.userId,
        idempotencyKey,
        serviceOrderId: links.serviceOrderId,
        customerId: links.customerId,
        equipmentId: links.equipmentId,
        warrantyId: links.warrantyId,
        createdAt: now,
        updatedAt: now,
      });

      await recordAudit(
        {
          action: AUDIT_ACTIONS.APPOINTMENT_CREATED,
          entityType: 'agenda_appointment',
          entityId: appointmentId,
          tenantId: context.tenantId,
          unitId,
          userId: context.userId,
          after: {
            allDay: when.allDay,
            hasAssignee: Boolean(assigneeId),
            serviceOrderId: links.serviceOrderId,
          },
        },
        tx,
      );

      await emit({
        type: EVENT_TYPES.APPOINTMENT_CREATED,
        tenantId: context.tenantId,
        payload: {
          appointmentId,
          unitId,
          assigneeId,
          serviceOrderId: links.serviceOrderId,
        },
      });
    });
  } catch (error) {
    /** Duas requisicoes com a mesma chave: quem perdeu recebe o vencedor. */
    if (idempotencyKey && isDuplicateKeyError(error)) {
      const vencedor = await findByKey(context, idempotencyKey);
      if (vencedor) return { appointmentId: vencedor, reused: true };
    }
    throw error;
  }

  return { appointmentId, reused: false };
}

async function findByKey(context: TenantContext, idempotencyKey: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: agendaAppointments.id })
    .from(agendaAppointments)
    .where(
      and(
        eq(agendaAppointments.tenantId, context.tenantId),
        eq(agendaAppointments.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  return row?.id ?? null;
}

interface AppointmentRow {
  id: string;
  unitId: string;
  status: string;
  assigneeId: string | null;
  version: number;
}

async function loadAppointment(
  context: TenantContext,
  appointmentId: string,
): Promise<AppointmentRow> {
  const [row] = await getDb()
    .select({
      id: agendaAppointments.id,
      unitId: agendaAppointments.unitId,
      status: agendaAppointments.status,
      assigneeId: agendaAppointments.assigneeId,
      version: agendaAppointments.version,
    })
    .from(agendaAppointments)
    .where(
      and(
        eq(agendaAppointments.tenantId, context.tenantId),
        eq(agendaAppointments.id, appointmentId),
      ),
    )
    .limit(1);

  /** Compromisso de outra empresa e compromisso inexistente sao a mesma resposta. */
  if (!row) throw new NotFoundError('Compromisso nao encontrado.');
  if (!context.authorizedUnitIds.includes(row.unitId)) {
    throw new NotFoundError('Compromisso nao encontrado.');
  }
  return row;
}

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(APPOINTMENT_TITLE_MAX).optional(),
    notes: z.string().trim().max(APPOINTMENT_NOTES_MAX).optional().or(z.literal('')),
    assigneeId: linkSchema,
    /** `true` limpa o responsavel; sem isso, `assigneeId` vazio e "nao mexa". */
    clearAssignee: z.coerce.boolean().optional(),
    expectedVersion: z.coerce.number().int().optional(),
  })
  .and(z.union([whenSchema, z.object({ allDay: z.undefined() })]));

/**
 * Edita e REAGENDA (item 46).
 *
 * Reagendar e mover o mesmo compromisso, nao cancelar e criar outro: o
 * historico precisa mostrar que a visita foi adiada, e nao que uma visita
 * sumiu e outra apareceu. Por isso a linha e a mesma e o evento e
 * `APPOINTMENT_RESCHEDULED` — emitido so quando o quando realmente mudou.
 */
export async function updateAppointment(
  context: TenantContext,
  appointmentId: string,
  rawInput: unknown,
): Promise<void> {
  const input = parse(updateSchema, rawInput);
  const appointment = await loadAppointment(context, appointmentId);

  await authorize(context, {
    permission: PERMISSIONS.AGENDA_APPOINTMENTS_MANAGE,
    featureKey: FEATURES.OPERATIONS_AGENDA,
    unitId: appointment.unitId,
  });

  if (appointment.status !== 'scheduled') {
    throw new BusinessRuleError('Este compromisso foi cancelado. Nao ha o que reagendar.');
  }

  const mudancas: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) mudancas.title = input.title;
  if (input.notes !== undefined) mudancas.notes = blank(input.notes);

  const assigneeId = blank(input.assigneeId);
  if (input.clearAssignee) {
    mudancas.assigneeId = null;
  } else if (assigneeId) {
    await assertAssignee(context, assigneeId, appointment.unitId);
    mudancas.assigneeId = assigneeId;
  }

  let reagendou = false;
  if (input.allDay !== undefined) {
    const when = toWhen(input);
    assertWhen(when);
    Object.assign(mudancas, whenColumns(when));
    reagendou = true;
  }

  await runInTransaction(async (tx, emit) => {
    const resultado = await tx
      .update(agendaAppointments)
      .set({ ...mudancas, version: sql`${agendaAppointments.version} + 1` })
      .where(
        and(
          eq(agendaAppointments.id, appointmentId),
          eq(agendaAppointments.tenantId, context.tenantId),
          /** A condicao de negocio vai no `WHERE` do `UPDATE` (ADR-044). */
          eq(agendaAppointments.status, 'scheduled'),
          input.expectedVersion === undefined
            ? undefined
            : eq(agendaAppointments.version, input.expectedVersion),
        ),
      );

    if (affectedRows(resultado) === 0) {
      throw new ConflictError(
        'Este compromisso mudou enquanto voce editava. Abra de novo para ver o estado atual.',
      );
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.APPOINTMENT_UPDATED,
        entityType: 'agenda_appointment',
        entityId: appointmentId,
        tenantId: context.tenantId,
        unitId: appointment.unitId,
        userId: context.userId,
        after: {
          changed: Object.keys(mudancas).filter((k) => k !== 'updatedAt'),
          rescheduled: reagendou,
        },
      },
      tx,
    );

    if (reagendou) {
      await emit({
        type: EVENT_TYPES.APPOINTMENT_RESCHEDULED,
        tenantId: context.tenantId,
        payload: { appointmentId, unitId: appointment.unitId },
      });
    }
  });
}

/**
 * Cancela o compromisso — a unica saida que ele tem (item 47).
 *
 * O motivo e obrigatorio porque um compromisso que some da agenda sem
 * explicacao vira, uma semana depois, uma pergunta que ninguem responde.
 */
export async function cancelAppointment(
  context: TenantContext,
  appointmentId: string,
  rawReason: string,
  expectedVersion?: number,
): Promise<void> {
  const appointment = await loadAppointment(context, appointmentId);

  await authorize(context, {
    permission: PERMISSIONS.AGENDA_APPOINTMENTS_MANAGE,
    featureKey: FEATURES.OPERATIONS_AGENDA,
    unitId: appointment.unitId,
  });

  if (appointment.status !== 'scheduled') {
    throw new BusinessRuleError('Este compromisso ja foi cancelado.');
  }

  const reason = rawReason.trim();
  if (reason.length < CANCEL_REASON_MIN) {
    throw new ValidationError(
      `Explique por que o compromisso foi cancelado (ao menos ${CANCEL_REASON_MIN} caracteres).`,
    );
  }
  if (reason.length > CANCEL_REASON_MAX) {
    throw new ValidationError(`O motivo nao pode passar de ${CANCEL_REASON_MAX} caracteres.`);
  }

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    const resultado = await tx
      .update(agendaAppointments)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: context.userId,
        cancelReason: reason,
        updatedAt: now,
        version: sql`${agendaAppointments.version} + 1`,
      })
      .where(
        and(
          eq(agendaAppointments.id, appointmentId),
          eq(agendaAppointments.tenantId, context.tenantId),
          eq(agendaAppointments.status, 'scheduled'),
          expectedVersion === undefined
            ? undefined
            : eq(agendaAppointments.version, expectedVersion),
        ),
      );

    if (affectedRows(resultado) === 0) {
      throw new ConflictError('Este compromisso ja foi cancelado por outra pessoa.');
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.APPOINTMENT_CANCELLED,
        entityType: 'agenda_appointment',
        entityId: appointmentId,
        tenantId: context.tenantId,
        unitId: appointment.unitId,
        userId: context.userId,
        after: { cancelledBy: context.userId, reason },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.APPOINTMENT_CANCELLED,
      tenantId: context.tenantId,
      payload: { appointmentId, unitId: appointment.unitId },
    });
  });
}

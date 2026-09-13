import 'server-only';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { BusinessRuleError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { equipment, equipmentIntakes } from '@/modules/equipment/infrastructure/schema';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import {
  CUSTOMER_REPORT_MAX,
  INTERNAL_NOTES_MAX,
  SERVICE_ORDER_INITIAL_STATUS,
  SERVICE_ORDER_NUMBER_PADDING,
  SERVICE_ORDER_NUMBER_PREFIX,
  TIMELINE_KINDS,
  normalizeCustomerReport,
} from '@/modules/service-orders/domain/service-order';
import {
  serviceOrderTimeline,
  serviceOrders,
} from '@/modules/service-orders/infrastructure/schema';
import {
  SEQUENCE_TYPES,
  allocateSequenceNumber,
} from '@/modules/tenancy/application/sequence-service';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Abertura e correcao de Ordens de Servico (Prompt 07).
 *
 * TUDO O QUE IMPORTA ACONTECE AQUI, NAO NA PAGINA (itens 99 e 101). A camada
 * de aplicacao e a mesma que a futura API e o Nexo56 Mobile vao consumir; se
 * a regra morasse no componente React, o aplicativo teria de reimplementa-la
 * e as duas versoes divergiriam no primeiro ajuste.
 */

export const serviceOrderInputSchema = z.object({
  equipmentId: z.string().min(1, 'Selecione o equipamento.'),
  /** Recebimento de origem. Opcional: ver `createServiceOrder`. */
  intakeId: z.string().optional().or(z.literal('')),
  customerReport: z
    .string()
    .trim()
    .min(1, 'Descreva o que o cliente relatou.')
    .max(CUSTOMER_REPORT_MAX, 'Relato muito longo.'),
  internalNotes: z.string().trim().max(INTERNAL_NOTES_MAX).optional().or(z.literal('')),
  /** Chave do comando, gerada pelo navegador. Ver o bloco de idempotencia. */
  idempotencyKey: z.string().trim().max(80).optional().or(z.literal('')),
});

export type ServiceOrderInput = z.infer<typeof serviceOrderInputSchema>;

export interface CreatedServiceOrder {
  serviceOrderId: string;
  number: number;
  /** `true` quando o comando ja havia sido executado e nada foi criado agora. */
  reused: boolean;
}

/** Busca uma OS pela chave de idempotencia, dentro do tenant. */
async function findByIdempotencyKey(
  tenantId: string,
  key: string,
): Promise<{ id: string; number: number } | null> {
  const [existing] = await getDb()
    .select({ id: serviceOrders.id, number: serviceOrders.number })
    .from(serviceOrders)
    .where(and(eq(serviceOrders.tenantId, tenantId), eq(serviceOrders.idempotencyKey, key)))
    .limit(1);

  return existing ?? null;
}

/** Busca a OS ja aberta para um recebimento, dentro do tenant. */
async function findByIntake(
  tenantId: string,
  intakeId: string,
): Promise<{ id: string; number: number } | null> {
  const [existing] = await getDb()
    .select({ id: serviceOrders.id, number: serviceOrders.number })
    .from(serviceOrders)
    .where(and(eq(serviceOrders.tenantId, tenantId), eq(serviceOrders.intakeId, intakeId)))
    .limit(1);

  return existing ?? null;
}

/** Detecta a violacao de UNIQUE do MySQL sem depender da mensagem em ingles. */
function isDuplicateKeyError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    const code = (current as { code?: string }).code;
    const errno = (current as { errno?: number }).errno;
    if (code === 'ER_DUP_ENTRY' || errno === 1062) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Abre uma Ordem de Servico.
 *
 * A UNIDADE VEM DO CONTEXTO (itens 40 e 63). Nunca do formulario: aceitar
 * `unitId` do navegador permitiria a quem opera a loja Centro carimbar
 * servico na Norte, e a OS e justamente o registro de quem assumiu o
 * trabalho.
 *
 * COM OU SEM RECEBIMENTO (item 12). O caminho normal do balcao e
 * Recebimento -> OS, e a interface leva por ele. Mas abrir OS direto de um
 * equipamento ja cadastrado e um caso real: o aparelho que ja estava na
 * bancada de um atendimento anterior, o retorno combinado por telefone, a
 * empresa que traz a maquina sem passar pelo balcao. Recusar isso obrigaria
 * o atendente a inventar um recebimento que nao aconteceu — dado falso para
 * satisfazer o sistema. Quando ha recebimento, o vinculo e historico e a
 * unidade tem de bater (item 11).
 */
export async function createServiceOrder(
  context: TenantContext,
  rawInput: unknown,
): Promise<CreatedServiceOrder> {
  const parsed = serviceOrderInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  const input = parsed.data;

  const unitId = context.activeUnitId;
  if (!unitId) {
    throw new ValidationError(
      'Selecione a unidade que vai executar o servico antes de abrir a Ordem de Servico.',
    );
  }

  const idempotencyKey = input.idempotencyKey || null;
  const intakeId = input.intakeId || null;

  /**
   * IDEMPOTENCIA, PRIMEIRA CAMADA (itens 32, 93 e 127).
   *
   * A consulta antecipada resolve o caso comum — duplo clique, F5, retentativa
   * depois de queda de rede — sem gastar um numero da sequencia. A corrida
   * real (dois envios simultaneos) escapa daqui e e barrada pelo UNIQUE do
   * banco, tratado no final desta funcao.
   */
  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(context.tenantId, idempotencyKey);
    if (existing) {
      return { serviceOrderId: existing.id, number: existing.number, reused: true };
    }
  }

  const db = getDb();

  const [targetEquipment] = await db
    .select({ id: equipment.id, customerId: equipment.customerId })
    .from(equipment)
    .where(and(eq(equipment.tenantId, context.tenantId), eq(equipment.id, input.equipmentId)))
    .limit(1);

  // Equipamento de outra empresa e equipamento inexistente terminam igual.
  if (!targetEquipment) throw new NotFoundError('Equipamento nao encontrado.');

  if (intakeId) {
    const [intake] = await db
      .select({
        id: equipmentIntakes.id,
        unitId: equipmentIntakes.unitId,
        equipmentId: equipmentIntakes.equipmentId,
      })
      .from(equipmentIntakes)
      .where(
        and(eq(equipmentIntakes.tenantId, context.tenantId), eq(equipmentIntakes.id, intakeId)),
      )
      .limit(1);

    if (!intake) throw new NotFoundError('Recebimento nao encontrado.');

    /**
     * COERENCIA DE UNIDADE (item 11).
     *
     * Barrado aqui com mensagem util e, de novo, pela FK composta
     * `(intake_id, unit_id)` no banco — porque a checagem da aplicacao some
     * no dia em que alguem escrever um segundo caminho de criacao.
     */
    if (intake.unitId !== unitId) {
      throw new BusinessRuleError(
        'Este recebimento foi registrado em outra unidade. Troque para a unidade do recebimento para abrir a Ordem de Servico.',
      );
    }

    if (intake.equipmentId !== input.equipmentId) {
      throw new BusinessRuleError('O recebimento informado nao e deste equipamento.');
    }

    /** Um recebimento, uma OS principal (item 33). */
    const already = await findByIntake(context.tenantId, intakeId);
    if (already) {
      throw new BusinessRuleError(
        'Este recebimento ja possui uma Ordem de Servico. Abra a Ordem existente em vez de criar outra.',
      );
    }
  }

  const customerReport = normalizeCustomerReport(input.customerReport);
  const serviceOrderId = newId();
  const now = new Date();

  try {
    /**
     * TUDO NA MESMA TRANSACAO (item 34): numero, OS, linha do tempo,
     * auditoria e evento. Se qualquer parte falhar, nao sobra nem numero
     * alocado sem documento nem documento sem trilha.
     */
    const number = await runInTransaction(async (tx, emit) => {
      const allocated = await allocateSequenceNumber(
        tx as TransactionExecutor,
        context.tenantId,
        SEQUENCE_TYPES.SERVICE_ORDER,
        { prefix: SERVICE_ORDER_NUMBER_PREFIX, padding: SERVICE_ORDER_NUMBER_PADDING },
      );

      await tx.insert(serviceOrders).values({
        id: serviceOrderId,
        tenantId: context.tenantId,
        unitId,
        number: allocated.value,
        customerId: targetEquipment.customerId,
        equipmentId: input.equipmentId,
        intakeId,
        status: SERVICE_ORDER_INITIAL_STATUS,
        customerReport,
        internalNotes: input.internalNotes || null,
        openedAt: now,
        idempotencyKey,
        createdBy: context.userId,
        updatedBy: context.userId,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(serviceOrderTimeline).values({
        id: newId(),
        tenantId: context.tenantId,
        serviceOrderId,
        kind: TIMELINE_KINDS.CREATED,
        summary: 'Ordem de Servico aberta',
        // Sem PII: referencias e contagens, nunca o relato do cliente.
        metadata: { number: allocated.value, fromIntake: intakeId !== null },
        actorId: context.userId,
        occurredAt: now,
      });

      await recordAudit(
        {
          action: AUDIT_ACTIONS.SERVICE_ORDER_CREATED,
          entityType: 'service_order',
          entityId: serviceOrderId,
          tenantId: context.tenantId,
          unitId,
          userId: context.userId,
          after: {
            number: allocated.value,
            equipmentId: input.equipmentId,
            customerId: targetEquipment.customerId,
            intakeId,
            status: SERVICE_ORDER_INITIAL_STATUS,
            // Tamanho, nao conteudo: o relato pode conter dado pessoal.
            customerReportLength: customerReport.length,
          },
        },
        tx,
      );

      await emit({
        type: EVENT_TYPES.SERVICE_ORDER_CREATED,
        tenantId: context.tenantId,
        payload: {
          serviceOrderId,
          number: allocated.value,
          unitId,
          customerId: targetEquipment.customerId,
          equipmentId: input.equipmentId,
          intakeId,
          openedBy: context.userId,
        },
      });

      return allocated.value;
    });

    return { serviceOrderId, number, reused: false };
  } catch (error) {
    /**
     * IDEMPOTENCIA, SEGUNDA CAMADA.
     *
     * Dois envios simultaneos passam juntos pela consulta antecipada; o
     * segundo bate no UNIQUE. Em vez de devolver erro para quem so clicou
     * duas vezes, reencontramos a OS que o primeiro criou.
     */
    if (isDuplicateKeyError(error)) {
      if (idempotencyKey) {
        const existing = await findByIdempotencyKey(context.tenantId, idempotencyKey);
        if (existing) {
          return { serviceOrderId: existing.id, number: existing.number, reused: true };
        }
      }
      if (intakeId) {
        const existing = await findByIntake(context.tenantId, intakeId);
        if (existing) {
          throw new BusinessRuleError(
            'Este recebimento ja possui uma Ordem de Servico. Abra a Ordem existente em vez de criar outra.',
          );
        }
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Correcao dos dados de abertura (itens 23, 42, 43 e 111)
// ---------------------------------------------------------------------------

export const serviceOrderUpdateSchema = z.object({
  customerReport: z
    .string()
    .trim()
    .min(1, 'Descreva o que o cliente relatou.')
    .max(CUSTOMER_REPORT_MAX, 'Relato muito longo.'),
  internalNotes: z.string().trim().max(INTERNAL_NOTES_MAX).optional().or(z.literal('')),
});

/**
 * Corrige os dados de ABERTURA.
 *
 * O QUE ESTA FUNCAO DELIBERADAMENTE NAO FAZ (itens 41, 42 e 43): trocar a
 * unidade, o cliente ou o equipamento da OS. Os tres sao a identidade do
 * atendimento — quem assumiu, para quem, sobre qual aparelho. Deixar isso
 * como edicao trivial faria o historico de um aparelho migrar silenciosamente
 * para outro, e uma OS com fotos, inspecao e recebimento de um televisor
 * passaria a falar de um micro-ondas sem que nada no sistema registrasse a
 * troca. Correcao desse tipo, quando for necessaria, sera caso de uso proprio
 * e auditado.
 *
 * ALTERAR O RELATO E AUDITADO COM O VALOR ANTERIOR (item 23): o relato e o que
 * o cliente disse, e sobrescrever isso em silencio apagaria a versao original
 * da historia justamente quando ela passa a importar.
 */
export async function updateServiceOrder(
  context: TenantContext,
  serviceOrderId: string,
  rawInput: unknown,
): Promise<void> {
  const parsed = serviceOrderUpdateSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  const input = parsed.data;

  const db = getDb();
  const [current] = await db
    .select({
      id: serviceOrders.id,
      unitId: serviceOrders.unitId,
      number: serviceOrders.number,
      customerReport: serviceOrders.customerReport,
      internalNotes: serviceOrders.internalNotes,
    })
    .from(serviceOrders)
    .where(and(eq(serviceOrders.tenantId, context.tenantId), eq(serviceOrders.id, serviceOrderId)))
    .limit(1);

  if (!current) throw new NotFoundError('Ordem de Servico nao encontrada.');

  /** A OS e da unidade: quem nao opera nela nao a corrige (item 63). */
  if (!context.authorizedUnitIds.includes(current.unitId)) {
    throw new NotFoundError('Ordem de Servico nao encontrada.');
  }

  const customerReport = normalizeCustomerReport(input.customerReport);
  const internalNotes = input.internalNotes || null;

  const reportChanged = customerReport !== current.customerReport;
  const notesChanged = internalNotes !== current.internalNotes;
  if (!reportChanged && !notesChanged) return;

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx
      .update(serviceOrders)
      .set({ customerReport, internalNotes, updatedBy: context.userId, updatedAt: now })
      .where(
        and(eq(serviceOrders.tenantId, context.tenantId), eq(serviceOrders.id, serviceOrderId)),
      );

    await tx.insert(serviceOrderTimeline).values({
      id: newId(),
      tenantId: context.tenantId,
      serviceOrderId,
      kind: reportChanged ? TIMELINE_KINDS.CUSTOMER_REPORT_UPDATED : TIMELINE_KINDS.DETAILS_UPDATED,
      summary: reportChanged ? 'Relato do cliente atualizado' : 'Observacoes internas atualizadas',
      metadata: { reportChanged, notesChanged },
      actorId: context.userId,
      occurredAt: now,
    });

    if (reportChanged) {
      /**
       * O relato ANTERIOR vai para a auditoria por inteiro (item 23).
       *
       * E a unica excecao consciente a regra de nao copiar texto livre para a
       * trilha: sem o valor de antes, "relato alterado" nao permite reconstruir
       * o que o cliente havia dito. A trilha ja e area de acesso restrito, e o
       * `redact()` continua neutralizando segredo e documento.
       */
      await recordAudit(
        {
          action: AUDIT_ACTIONS.SERVICE_ORDER_CUSTOMER_REPORT_UPDATED,
          entityType: 'service_order',
          entityId: serviceOrderId,
          tenantId: context.tenantId,
          unitId: current.unitId,
          userId: context.userId,
          before: { customerReport: current.customerReport },
          after: { customerReport },
        },
        tx,
      );
    }

    if (notesChanged) {
      await recordAudit(
        {
          action: AUDIT_ACTIONS.SERVICE_ORDER_UPDATED,
          entityType: 'service_order',
          entityId: serviceOrderId,
          tenantId: context.tenantId,
          unitId: current.unitId,
          userId: context.userId,
          before: { hasInternalNotes: current.internalNotes !== null },
          after: { hasInternalNotes: internalNotes !== null },
        },
        tx,
      );
    }

    await emit({
      type: EVENT_TYPES.SERVICE_ORDER_UPDATED,
      tenantId: context.tenantId,
      payload: {
        serviceOrderId,
        number: current.number,
        unitId: current.unitId,
        reportChanged,
        notesChanged,
        updatedBy: context.userId,
      },
    });
  });
}

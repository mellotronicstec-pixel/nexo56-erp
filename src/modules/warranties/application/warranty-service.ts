import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { affectedRows } from '@/core/db/affected-rows';
import { isDuplicateKeyError } from '@/core/db/duplicate-key';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { todayIn } from '@/core/time/civil-date';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import {
  AUDIT_ACTIONS,
  recordAudit,
  type AuditAction,
} from '@/modules/audit/application/audit-service';
import { equipment } from '@/modules/equipment/infrastructure/schema';
import { EVENT_TYPES, type EventType } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import {
  SEQUENCE_TYPES,
  allocateSequenceNumber,
} from '@/modules/tenancy/application/sequence-service';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  canCancel,
  canRevoke,
  COVERAGE_DESCRIPTION_MAX,
  COVERAGE_KINDS,
  COVERAGE_SUMMARY_MAX,
  DURATION_MAX,
  DURATION_MIN,
  DURATION_UNITS,
  EXCLUSIONS_MAX,
  formatWarrantyNumber,
  normalizeWarrantyReason,
  TERMS_MAX,
  WARRANTY_NUMBER_PADDING,
  WARRANTY_NUMBER_PREFIX,
  WARRANTY_TIMELINE_KINDS,
  WARRANTY_TYPES,
  warrantyEndDate,
  type DurationUnit,
} from '@/modules/warranties/domain/warranty';
import {
  warranties,
  warrantyCoverageItems,
  warrantyTimeline,
} from '@/modules/warranties/infrastructure/schema';
import { loadWarrantyPolicy } from './warranty-policy-service';

/**
 * EMISSAO E CICLO DE VIDA DA GARANTIA (Prompt 13, itens 12, 53, 54 e 62).
 *
 * A GARANTIA NASCE DE UM ATO HUMANO, e o Prompt 13 escolheu isso de propósito
 * (ADR-063). O Prompt 12 deixou `SERVICE_ORDER_FINANCIAL_SETTLED` publicado
 * como gancho, e a tentacao era emitir garantia ao receber o dinheiro. Nao e
 * seguro: pagamento integral nao prova entrega fisica. O cliente paga por PIX
 * na terca e busca o aparelho na sexta — datar a cobertura na terca tiraria
 * tres dias do cliente, em silencio.
 *
 * O que habilita a emissao e a FINALIZACAO da OS, que no workflow deste
 * projeto significa literalmente "o cliente retirou o aparelho". E mesmo
 * assim a emissao continua sendo um clique de uma pessoa autorizada.
 */

const coverageItemSchema = z.object({
  kind: z.enum(COVERAGE_KINDS),
  description: z
    .string()
    .trim()
    .min(1, 'Descreva o que esta coberto.')
    .max(COVERAGE_DESCRIPTION_MAX),
  partId: z.string().trim().optional().or(z.literal('')),
});

const issueSchema = z.object({
  type: z.enum(WARRANTY_TYPES),
  equipmentId: z.string().trim().min(1, 'Selecione o equipamento.'),
  serviceOrderId: z.string().trim().optional().or(z.literal('')),
  policyId: z.string().trim().optional().or(z.literal('')),

  /** Quando omitidos, vem da politica. Nunca sao LIDOS da politica depois. */
  durationAmount: z.coerce.number().int().min(DURATION_MIN).max(DURATION_MAX).optional(),
  durationUnit: z.enum(DURATION_UNITS).optional(),

  startsOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data de inicio valida.')
    .optional()
    .or(z.literal('')),

  coverageSummary: z.string().trim().max(COVERAGE_SUMMARY_MAX).optional().or(z.literal('')),
  exclusions: z.string().trim().max(EXCLUSIONS_MAX).optional().or(z.literal('')),
  terms: z.string().trim().max(TERMS_MAX).optional().or(z.literal('')),

  /** `false` = cobertura PARCIAL (item 16). Declarado, nunca deduzido. */
  coversWholeService: z.coerce.boolean().default(true),
  coverageItems: z.array(coverageItemSchema).min(1, 'Informe ao menos um item de cobertura.'),

  // --- garantia de fabrica --------------------------------------------------
  manufacturer: z.string().trim().max(160).optional().or(z.literal('')),
  externalReference: z.string().trim().max(120).optional().or(z.literal('')),

  // --- garantia de peca -----------------------------------------------------
  partId: z.string().trim().optional().or(z.literal('')),
  partDescription: z.string().trim().max(200).optional().or(z.literal('')),
  partCode: z.string().trim().max(60).optional().or(z.literal('')),
  partQuantity: z.string().trim().optional().or(z.literal('')),
  installedOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('')),
  stockMovementId: z.string().trim().optional().or(z.literal('')),
  supplierId: z.string().trim().optional().or(z.literal('')),

  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  idempotencyKey: z.string().trim().max(120).optional().or(z.literal('')),
});

export type IssueWarrantyInput = z.infer<typeof issueSchema>;

export interface IssuedWarranty {
  warrantyId: string;
  number: number;
  formattedNumber: string;
  startsOn: string;
  endsOn: string;
  reused: boolean;
}

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

async function findByIdempotencyKey(tenantId: string, key: string) {
  const [row] = await getDb()
    .select({
      id: warranties.id,
      number: warranties.number,
      type: warranties.type,
      startsOn: warranties.startsOn,
      endsOn: warranties.endsOn,
    })
    .from(warranties)
    .where(and(eq(warranties.tenantId, tenantId), eq(warranties.idempotencyKey, key)))
    .limit(1);
  return row ?? null;
}

/**
 * Emite a garantia com SNAPSHOT dos termos.
 *
 * A politica e lida UMA vez, aqui, e o que ela diz e copiado para dentro da
 * garantia. Depois disso a garantia nao volta a consultar a politica — nem
 * para mostrar, nem para imprimir, nem para decidir vigencia (ADR-062).
 */
export async function issueWarranty(
  context: TenantContext,
  rawInput: unknown,
): Promise<IssuedWarranty> {
  const input = parse(issueSchema, rawInput);
  const db = getDb();

  // --- equipamento e dono --------------------------------------------------
  const [alvo] = await db
    .select({ id: equipment.id, customerId: equipment.customerId })
    .from(equipment)
    .where(and(eq(equipment.tenantId, context.tenantId), eq(equipment.id, input.equipmentId)))
    .limit(1);

  if (!alvo) throw new NotFoundError('Equipamento nao encontrado.');

  // --- OS de origem --------------------------------------------------------
  const serviceOrderId = input.serviceOrderId || null;
  let unitId = context.activeUnitId;
  let customerId = alvo.customerId;

  if (serviceOrderId) {
    const [os] = await db
      .select({
        id: serviceOrders.id,
        unitId: serviceOrders.unitId,
        status: serviceOrders.status,
        customerId: serviceOrders.customerId,
        equipmentId: serviceOrders.equipmentId,
        statusChangedAt: serviceOrders.statusChangedAt,
      })
      .from(serviceOrders)
      .where(
        and(eq(serviceOrders.tenantId, context.tenantId), eq(serviceOrders.id, serviceOrderId)),
      )
      .limit(1);

    if (!os) throw new NotFoundError('Ordem de Servico nao encontrada.');

    /** A garantia cobre o aparelho DAQUELA ordem (item 36). */
    if (os.equipmentId !== input.equipmentId) {
      throw new BusinessRuleError('A Ordem de Servico informada nao e deste equipamento.');
    }

    /**
     * SO OS FINALIZADA HABILITA GARANTIA INTERNA (ADR-063, item 10).
     *
     * `completed` neste workflow significa "o cliente retirou o aparelho" —
     * e o ato formal de entrega que o Prompt 08 ja modelava. Antes disso o
     * aparelho esta na loja, e uma cobertura que comeca com o aparelho na
     * bancada consome prazo do cliente sem que ele tenha o produto na mao.
     */
    if (input.type === 'internal' && os.status !== 'completed') {
      throw new BusinessRuleError(
        'A Garantia Interna so pode ser emitida depois que a Ordem de Servico for finalizada, quando o cliente retira o aparelho.',
      );
    }

    unitId = os.unitId;
    customerId = os.customerId;
  }

  if (!unitId) {
    throw new ValidationError('Selecione a unidade antes de emitir a garantia.');
  }
  if (!context.authorizedUnitIds.includes(unitId)) {
    throw new NotFoundError('Unidade nao encontrada.');
  }

  /** Autorizacao na unidade que CONCEDE, nunca na unidade ativa da sessao. */
  await authorize(context, {
    permission: PERMISSIONS.WARRANTIES_ISSUE,
    featureKey: FEATURES.OPERATIONS_WARRANTIES,
    unitId,
  });

  // --- idempotencia, primeira camada ---------------------------------------
  const idempotencyKey = input.idempotencyKey || null;
  if (idempotencyKey) {
    const existente = await findByIdempotencyKey(context.tenantId, idempotencyKey);
    if (existente) {
      return {
        warrantyId: existente.id,
        number: existente.number,
        formattedNumber: formatWarrantyNumber(existente.number),
        startsOn: existente.startsOn,
        endsOn: existente.endsOn,
        reused: true,
      };
    }
  }

  // --- snapshot dos termos --------------------------------------------------
  const policy = input.policyId ? await loadWarrantyPolicy(context, input.policyId) : null;

  if (policy && policy.status !== 'active') {
    throw new BusinessRuleError('Esta politica de garantia esta inativa.');
  }
  if (policy && policy.type !== input.type) {
    throw new BusinessRuleError('A politica escolhida e de outro tipo de garantia.');
  }

  const durationAmount = input.durationAmount ?? policy?.durationAmount;
  const durationUnit = (input.durationUnit ?? policy?.durationUnit) as DurationUnit | undefined;

  if (!durationAmount || !durationUnit) {
    throw new ValidationError(
      'Informe a duracao da garantia, ou escolha uma politica que ja a defina.',
    );
  }

  const startsOn = input.startsOn || todayIn(context.tenantTimezone);
  const endsOn = warrantyEndDate(startsOn, durationAmount, durationUnit);

  const warrantyId = newId();
  const now = new Date();

  try {
    const number = await runInTransaction(async (tx, emit) => {
      const allocated = await allocateSequenceNumber(
        tx as TransactionExecutor,
        context.tenantId,
        SEQUENCE_TYPES.WARRANTY,
        { prefix: WARRANTY_NUMBER_PREFIX, padding: WARRANTY_NUMBER_PADDING },
      );

      await tx.insert(warranties).values({
        id: warrantyId,
        tenantId: context.tenantId,
        unitId,
        number: allocated.value,
        type: input.type,
        policyId: input.policyId || null,
        customerId,
        equipmentId: input.equipmentId,
        serviceOrderId,

        /** SNAPSHOT: copiado agora, nunca relido da politica (ADR-062). */
        durationAmount,
        durationUnit,
        coverageSummary: input.coverageSummary || policy?.coverageSummary || null,
        exclusions: input.exclusions || policy?.exclusions || null,
        terms: input.terms || policy?.terms || null,

        coversWholeService: input.coversWholeService ? 1 : 0,
        startsOn,
        endsOn,

        /**
         * Nasce ATIVA: emitir e o ato, e um rascunho que ninguem lembra de
         * ativar vira cliente sem garantia com o papel na mao. O rascunho
         * existe no modelo para quem quiser preparar antes, e nao e o
         * caminho desta funcao.
         */
        status: 'active',

        manufacturer: input.manufacturer || null,
        externalReference: input.externalReference || null,

        partId: input.partId || null,
        partDescription: input.partDescription || null,
        partCode: input.partCode || null,
        partQuantity: input.partQuantity || null,
        installedOn: input.installedOn || null,
        stockMovementId: input.stockMovementId || null,
        supplierId: input.supplierId || null,

        notes: input.notes || null,
        idempotencyKey,
        activatedAt: now,
        activatedBy: context.userId,
        createdBy: context.userId,
        updatedBy: context.userId,
        createdAt: now,
        updatedAt: now,
      });

      for (const [indice, item] of input.coverageItems.entries()) {
        await tx.insert(warrantyCoverageItems).values({
          id: newId(),
          tenantId: context.tenantId,
          warrantyId,
          kind: item.kind,
          description: item.description,
          partId: item.partId || null,
          position: indice,
          createdAt: now,
          updatedAt: now,
        });
      }

      await writeWarrantyTimeline(tx as TransactionExecutor, {
        tenantId: context.tenantId,
        warrantyId,
        kind: WARRANTY_TIMELINE_KINDS.ACTIVATED,
        summary: `Garantia ${formatWarrantyNumber(allocated.value)} emitida, valida de ${startsOn} a ${endsOn}`,
        actorId: context.userId,
        occurredAt: now,
      });

      await recordAudit(
        {
          action: AUDIT_ACTIONS.WARRANTY_ACTIVATED,
          entityType: 'warranty',
          entityId: warrantyId,
          tenantId: context.tenantId,
          unitId,
          userId: context.userId,
          after: {
            number: allocated.value,
            type: input.type,
            equipmentId: input.equipmentId,
            serviceOrderId,
            policyId: input.policyId || null,
            startsOn,
            endsOn,
            coversWholeService: input.coversWholeService,
            coverageItems: input.coverageItems.length,
          },
        },
        tx,
      );

      await emit({
        type: EVENT_TYPES.WARRANTY_ACTIVATED,
        tenantId: context.tenantId,
        /** Identificadores e datas; nunca nome, documento ou contato. */
        payload: {
          warrantyId,
          number: allocated.value,
          type: input.type,
          unitId,
          equipmentId: input.equipmentId,
          serviceOrderId,
          startsOn,
          endsOn,
        },
      });

      return allocated.value;
    });

    return {
      warrantyId,
      number,
      formattedNumber: formatWarrantyNumber(number),
      startsOn,
      endsOn,
      reused: false,
    };
  } catch (error) {
    /**
     * IDEMPOTENCIA, SEGUNDA CAMADA (itens 56 e 60).
     *
     * Dois envios simultaneos passam juntos pela consulta antecipada; o
     * segundo bate no UNIQUE. Reencontramos a garantia que o primeiro criou
     * em vez de devolver erro para quem so clicou duas vezes.
     */
    if (isDuplicateKeyError(error) && idempotencyKey) {
      const existente = await findByIdempotencyKey(context.tenantId, idempotencyKey);
      if (existente) {
        return {
          warrantyId: existente.id,
          number: existente.number,
          formattedNumber: formatWarrantyNumber(existente.number),
          startsOn: existente.startsOn,
          endsOn: existente.endsOn,
          reused: true,
        };
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Cancelamento e revogacao (item 62)
// ---------------------------------------------------------------------------

/**
 * CANCELAR: a garantia nao deveria existir.
 *
 * Emitida por engano, na OS errada, em duplicidade. O historico permanece — a
 * garantia nao e apagada, ela passa a constar como cancelada, com motivo e
 * autor.
 */
export async function cancelWarranty(
  context: TenantContext,
  warrantyId: string,
  rawReason: string,
): Promise<void> {
  await changeWarrantyLifecycle(context, warrantyId, {
    to: 'cancelled',
    rawReason,
    permission: PERMISSIONS.WARRANTIES_CANCEL,
    allowed: canCancel,
    refusal: 'Esta garantia nao pode ser cancelada na situacao atual.',
    timelineKind: WARRANTY_TIMELINE_KINDS.CANCELLED,
    auditAction: AUDIT_ACTIONS.WARRANTY_CANCELLED,
    eventType: EVENT_TYPES.WARRANTY_CANCELLED,
    reasonWhat: 'do cancelamento',
  });
}

/**
 * REVOGAR: a cobertura existia e deixou de valer.
 *
 * Violacao de lacre, intervencao de terceiro, uso fora do previsto. Diferente
 * de cancelar, e a diferenca e o que a historia conta: "emiti errado" e "o
 * cliente abriu o aparelho" nao podem virar o mesmo registro.
 *
 * REVOGAR NAO APAGA RETORNOS JA REGISTRADOS (item 62). O que aconteceu
 * aconteceu; a revogacao vale de agora em diante.
 */
export async function revokeWarranty(
  context: TenantContext,
  warrantyId: string,
  rawReason: string,
): Promise<void> {
  await changeWarrantyLifecycle(context, warrantyId, {
    to: 'revoked',
    rawReason,
    permission: PERMISSIONS.WARRANTIES_REVOKE,
    allowed: canRevoke,
    refusal: 'So uma garantia ativa pode ser revogada.',
    timelineKind: WARRANTY_TIMELINE_KINDS.REVOKED,
    auditAction: AUDIT_ACTIONS.WARRANTY_REVOKED,
    eventType: EVENT_TYPES.WARRANTY_REVOKED,
    reasonWhat: 'da revogacao',
  });
}

async function changeWarrantyLifecycle(
  context: TenantContext,
  warrantyId: string,
  spec: {
    to: 'cancelled' | 'revoked';
    rawReason: string;
    permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
    allowed: (status: string) => boolean;
    refusal: string;
    timelineKind: string;
    auditAction: AuditAction;
    eventType: EventType;
    reasonWhat: string;
  },
): Promise<void> {
  const current = await loadWarranty(context, warrantyId);

  await authorize(context, {
    permission: spec.permission,
    featureKey: FEATURES.OPERATIONS_WARRANTIES,
    unitId: current.unitId,
  });

  if (!spec.allowed(current.status)) throw new BusinessRuleError(spec.refusal);

  const reason = normalizeWarrantyReason(spec.rawReason, spec.reasonWhat);
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    /**
     * A CONDICAO DE NEGOCIO VAI NO `WHERE` (ADR-044).
     *
     * Duas pessoas revogando ao mesmo tempo: uma consegue, a outra encontra
     * `affectedRows = 0` e recebe conflito. Nao ha `SELECT` antes decidindo, e
     * por isso nao ha janela entre a decisao e a escrita.
     */
    const updated = await tx
      .update(warranties)
      .set({
        status: spec.to,
        cancelledAt: now,
        cancelReason: reason,
        version: sql`${warranties.version} + 1`,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(warranties.id, warrantyId),
          eq(warranties.tenantId, context.tenantId),
          eq(warranties.status, current.status),
        ),
      );

    if (affectedRows(updated) === 0) {
      throw new ConflictError(
        'Esta garantia foi alterada por outra pessoa. Recarregue a pagina e tente de novo.',
      );
    }

    await writeWarrantyTimeline(tx as TransactionExecutor, {
      tenantId: context.tenantId,
      warrantyId,
      kind: spec.timelineKind,
      summary:
        spec.to === 'cancelled'
          ? 'Garantia cancelada'
          : 'Garantia revogada: a cobertura deixou de valer',
      reason,
      actorId: context.userId,
      occurredAt: now,
    });

    await recordAudit(
      {
        action: spec.auditAction,
        entityType: 'warranty',
        entityId: warrantyId,
        tenantId: context.tenantId,
        unitId: current.unitId,
        userId: context.userId,
        before: { status: current.status },
        after: { status: spec.to, reasonLength: reason.length },
      },
      tx,
    );

    await emit({
      type: spec.eventType,
      tenantId: context.tenantId,
      /** Sem o texto do motivo: ele pode descrever o comportamento do cliente. */
      payload: { warrantyId, number: current.number, unitId: current.unitId, status: spec.to },
    });
  });
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function loadWarranty(context: TenantContext, warrantyId: string) {
  const [row] = await getDb()
    .select()
    .from(warranties)
    .where(and(eq(warranties.tenantId, context.tenantId), eq(warranties.id, warrantyId)))
    .limit(1);

  /** Garantia de outra empresa e garantia inexistente terminam no mesmo lugar. */
  if (!row) throw new NotFoundError('Garantia nao encontrada.');
  if (!context.authorizedUnitIds.includes(row.unitId)) {
    throw new NotFoundError('Garantia nao encontrada.');
  }
  return row;
}

export async function listCoverageItems(context: TenantContext, warrantyId: string) {
  return getDb()
    .select({
      id: warrantyCoverageItems.id,
      kind: warrantyCoverageItems.kind,
      description: warrantyCoverageItems.description,
      partId: warrantyCoverageItems.partId,
    })
    .from(warrantyCoverageItems)
    .where(
      and(
        eq(warrantyCoverageItems.tenantId, context.tenantId),
        eq(warrantyCoverageItems.warrantyId, warrantyId),
      ),
    )
    .orderBy(warrantyCoverageItems.position);
}

/** A unica porta de escrita da linha do tempo da garantia. */
export async function writeWarrantyTimeline(
  tx: TransactionExecutor,
  entry: {
    tenantId: string;
    warrantyId: string;
    kind: string;
    summary: string;
    reason?: string | null;
    actorId: string | null;
    occurredAt: Date;
  },
): Promise<void> {
  await tx.insert(warrantyTimeline).values({
    id: newId(),
    tenantId: entry.tenantId,
    warrantyId: entry.warrantyId,
    kind: entry.kind,
    summary: entry.summary,
    reason: entry.reason ?? null,
    actorId: entry.actorId,
    occurredAt: entry.occurredAt,
  });
}

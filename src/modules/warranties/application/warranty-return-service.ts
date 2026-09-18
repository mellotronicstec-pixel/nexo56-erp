import 'server-only';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { affectedRows } from '@/core/db/affected-rows';
import { isDuplicateKeyError } from '@/core/db/duplicate-key';
import { runInTransaction, type TransactionExecutor } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  applyServiceOrderCreation,
  planServiceOrderCreation,
} from '@/modules/service-orders/application/service-order-service';
import {
  applyTransition,
  planTransition,
} from '@/modules/service-orders/application/workflow-service';
import { TIMELINE_KINDS } from '@/modules/service-orders/domain/service-order';
import {
  serviceOrderTimeline,
  serviceOrders,
} from '@/modules/service-orders/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import {
  canReclassify,
  COVERAGE_ASSESSMENTS,
  DEFAULT_SERVICE_ORDER_CLASSIFICATION,
  explainNotEnforceable,
  formatWarrantyNumber,
  isWarrantyEnforceable,
  normalizeReclassificationReason,
  referenceDateFor,
  shouldCreateWarrantyServiceOrder,
  WARRANTY_TIMELINE_KINDS,
} from '@/modules/warranties/domain/warranty';
import { warranties, warrantyReturns } from '@/modules/warranties/infrastructure/schema';
import { loadWarranty, writeWarrantyTimeline } from './warranty-service';

/**
 * RETORNO EM GARANTIA (Prompt 13, itens 22 a 27).
 *
 * A REGRA IMUTAVEL DESTE PROJETO (item 23): quando um equipamento retorna com
 * Garantia Interna valida e aplicavel, cria-se uma NOVA Ordem de Servico
 * vinculada a original. A original NUNCA e reaberta.
 *
 * POR QUE NAO REABRIR (item 24). A OS antiga e o registro do que foi feito:
 * tem numero, parecer, orcamento aprovado, pecas consumidas e data de
 * entrega. Reabri-la para o retorno significaria sobrescrever tudo isso — e a
 * loja perderia a resposta para "o que exatamente foi consertado da primeira
 * vez?", que e justamente a pergunta que uma garantia existe para responder.
 *
 * ATOMICIDADE (item 92). Retorno, nova OS, vinculo, duas linhas do tempo,
 * auditoria e eventos acontecem numa UNICA transacao. Isso so e possivel
 * porque a criacao da OS foi dividida em `planServiceOrderCreation` e
 * `applyServiceOrderCreation` (ADR-049): Garantias chama a primitiva oficial
 * DENTRO da propria transacao, sem transacao aninhada e sem reimplementar a
 * abertura de OS.
 */

const returnSchema = z.object({
  warrantyId: z.string().trim().min(1, 'Selecione a garantia.'),
  /**
   * O RELATO DE AGORA (item 82).
   *
   * Campo obrigatorio e proprio. "Nao liga" e "voltou a desligar depois de 20
   * minutos" sao queixas diferentes, e copiar a antiga como se fosse a atual
   * apagaria a unica evidencia de que o defeito mudou.
   */
  customerReport: z.string().trim().min(1, 'Descreva o que o cliente relatou agora.').max(4000),
  coverageAssessment: z.enum(COVERAGE_ASSESSMENTS),
  assessmentNotes: z.string().trim().max(2000).optional().or(z.literal('')),
  /** Unidade que ATENDE o retorno. Pode diferir da que concedeu (item 38). */
  unitId: z.string().trim().optional().or(z.literal('')),
  internalNotes: z.string().trim().max(2000).optional().or(z.literal('')),
  idempotencyKey: z.string().trim().max(120).optional().or(z.literal('')),
});

export interface RegisteredReturn {
  returnId: string;
  /** Nula quando o retorno nao gerou OS de garantia — e isso e normal. */
  serviceOrderId: string | null;
  serviceOrderNumber: number | null;
  createdServiceOrder: boolean;
  reused: boolean;
  /** Por que nao gerou OS de garantia, quando nao gerou. */
  refusalReason: string | null;
}

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

async function findReturnByKey(tenantId: string, key: string) {
  const [row] = await getDb()
    .select({
      id: warrantyReturns.id,
      returnServiceOrderId: warrantyReturns.returnServiceOrderId,
    })
    .from(warrantyReturns)
    .where(and(eq(warrantyReturns.tenantId, tenantId), eq(warrantyReturns.idempotencyKey, key)))
    .limit(1);
  return row ?? null;
}

async function numberOf(serviceOrderId: string | null): Promise<number | null> {
  if (!serviceOrderId) return null;
  const [row] = await getDb()
    .select({ number: serviceOrders.number })
    .from(serviceOrders)
    .where(eq(serviceOrders.id, serviceOrderId))
    .limit(1);
  return row?.number ?? null;
}

export async function registerWarrantyReturn(
  context: TenantContext,
  rawInput: unknown,
): Promise<RegisteredReturn> {
  const input = parse(returnSchema, rawInput);
  const warranty = await loadWarranty(context, input.warrantyId);

  const unitId = input.unitId || context.activeUnitId;
  if (!unitId) {
    throw new ValidationError('Selecione a unidade que vai atender o retorno.');
  }
  if (!context.authorizedUnitIds.includes(unitId)) {
    throw new NotFoundError('Unidade nao encontrada.');
  }

  /** Autorizacao na unidade que ATENDE — e onde o trabalho vai acontecer. */
  await authorize(context, {
    permission: PERMISSIONS.WARRANTIES_RETURN_CREATE,
    featureKey: FEATURES.OPERATIONS_WARRANTIES,
    unitId,
  });

  // --- idempotencia, primeira camada (item 57) -----------------------------
  const idempotencyKey = input.idempotencyKey || null;
  if (idempotencyKey) {
    const existente = await findReturnByKey(context.tenantId, idempotencyKey);
    if (existente) {
      return {
        returnId: existente.id,
        serviceOrderId: existente.returnServiceOrderId,
        serviceOrderNumber: await numberOf(existente.returnServiceOrderId),
        createdServiceOrder: false,
        reused: true,
        refusalReason: null,
      };
    }
  }

  /**
   * A DATA QUE DECIDE (item 34).
   *
   * Do servidor, no fuso da EMPRESA — nunca o relogio do navegador. Um celular
   * com a data adiantada transformaria garantia vencida em vigente, e a loja
   * consertaria de graca por causa de um ajuste de fuso.
   */
  const referenceDate = referenceDateFor(context.tenantTimezone);
  const enforceable = isWarrantyEnforceable(
    {
      status: warranty.status,
      type: warranty.type,
      startsOn: warranty.startsOn,
      endsOn: warranty.endsOn,
    },
    referenceDate,
  );

  const criarOs = shouldCreateWarrantyServiceOrder({
    warrantyType: warranty.type,
    enforceable,
    assessment: input.coverageAssessment,
  });

  /**
   * Por que NAO vai gerar OS de garantia, quando nao vai (item 33).
   *
   * Registrar o retorno continua valendo: o fato de o aparelho ter voltado e
   * informacao, mesmo quando a garantia nao cobre. O que nao acontece e a OS
   * gratuita — e o atendente segue pelo caminho normal.
   */
  const refusalReason = criarOs
    ? null
    : (explainNotEnforceable(
        {
          status: warranty.status,
          type: warranty.type,
          startsOn: warranty.startsOn,
          endsOn: warranty.endsOn,
        },
        referenceDate,
      ) ??
      (input.coverageAssessment === 'not_covered'
        ? 'O defeito relatado foi avaliado como fora da cobertura desta garantia.'
        : input.coverageAssessment === 'undetermined'
          ? 'A cobertura ainda depende de parecer tecnico.'
          : 'Somente a Garantia Interna origina Ordem de Servico de garantia.'));

  const returnId = newId();
  const now = new Date();

  try {
    const resultado = await runInTransaction(async (tx, emit) => {
      let serviceOrderId: string | null = null;
      let serviceOrderNumber: number | null = null;

      if (criarOs) {
        /**
         * A PRIMITIVA OFICIAL DE ABERTURA (item 26).
         *
         * Nao ha `INSERT INTO service_orders` aqui. O plano e montado pelo
         * proprio modulo de Ordens de Servico e aplicado na NOSSA transacao —
         * numeracao, linha do tempo, auditoria e evento inclusos.
         */
        const plan = await planServiceOrderCreation(context, {
          equipmentId: warranty.equipmentId,
          customerReport: input.customerReport,
          internalNotes: input.internalNotes,
          unitId,
          /**
           * A ORIGEM decide o estado inicial, e so ela (itens 27 e 110). Nao
           * se passa `status` — nem aqui, nem em lugar nenhum.
           */
          origin: warranty.serviceOrderId
            ? {
                kind: 'warranty_return',
                warrantyId: warranty.id,
                originalServiceOrderId: warranty.serviceOrderId,
              }
            : { kind: 'standard' },
        });

        const criada = await applyServiceOrderCreation(
          tx as TransactionExecutor,
          emit,
          context,
          plan,
          now,
        );
        serviceOrderId = criada.serviceOrderId;
        serviceOrderNumber = criada.number;
      }

      await tx.insert(warrantyReturns).values({
        id: returnId,
        tenantId: context.tenantId,
        warrantyId: warranty.id,
        unitId,
        equipmentId: warranty.equipmentId,
        customerId: warranty.customerId,
        originalServiceOrderId: warranty.serviceOrderId,
        returnServiceOrderId: serviceOrderId,
        customerReport: input.customerReport,
        referenceDate,
        coverageAssessment: input.coverageAssessment,
        assessmentNotes: input.assessmentNotes || null,
        /** Congelado: a garantia podia ser revogada depois, e o fato fica. */
        wasEnforceable: enforceable ? 1 : 0,
        idempotencyKey,
        registeredAt: now,
        createdBy: context.userId,
        updatedBy: context.userId,
        createdAt: now,
        updatedAt: now,
      });

      await writeWarrantyTimeline(tx as TransactionExecutor, {
        tenantId: context.tenantId,
        warrantyId: warranty.id,
        kind: WARRANTY_TIMELINE_KINDS.RETURN_REGISTERED,
        summary: criarOs
          ? 'Retorno registrado e coberto pela garantia'
          : `Retorno registrado sem cobertura: ${refusalReason ?? 'fora da garantia'}`,
        actorId: context.userId,
        occurredAt: now,
      });

      if (serviceOrderId && serviceOrderNumber !== null) {
        await writeWarrantyTimeline(tx as TransactionExecutor, {
          tenantId: context.tenantId,
          warrantyId: warranty.id,
          kind: WARRANTY_TIMELINE_KINDS.RETURN_ORDER_CREATED,
          summary: `Ordem de Servico de garantia criada: OS ${serviceOrderNumber}`,
          actorId: context.userId,
          occurredAt: now,
        });

        /**
         * A OS ORIGINAL GANHA UM FATO, e NADA MAIS (item 24).
         *
         * Nenhum `UPDATE` no status, no parecer ou no orcamento dela: uma
         * linha na historia dizendo que o aparelho voltou. A OS original
         * continua finalizada, exatamente como estava.
         */
        if (warranty.serviceOrderId) {
          await tx.insert(serviceOrderTimeline).values({
            id: newId(),
            tenantId: context.tenantId,
            serviceOrderId: warranty.serviceOrderId,
            kind: TIMELINE_KINDS.WARRANTY_RETURN_LINKED,
            summary: `Retorno em garantia: OS ${serviceOrderNumber}`,
            metadata: { warrantyId: warranty.id, returnServiceOrderId: serviceOrderId },
            actorId: context.userId,
            occurredAt: now,
          });
        }

        await emit({
          type: EVENT_TYPES.WARRANTY_RETURN_SERVICE_ORDER_CREATED,
          tenantId: context.tenantId,
          payload: {
            warrantyId: warranty.id,
            warrantyReturnId: returnId,
            serviceOrderId,
            originalServiceOrderId: warranty.serviceOrderId,
            unitId,
          },
        });
      }

      await recordAudit(
        {
          action: AUDIT_ACTIONS.WARRANTY_RETURN_REGISTERED,
          entityType: 'warranty_return',
          entityId: returnId,
          tenantId: context.tenantId,
          unitId,
          userId: context.userId,
          after: {
            warrantyId: warranty.id,
            equipmentId: warranty.equipmentId,
            referenceDate,
            wasEnforceable: enforceable,
            coverageAssessment: input.coverageAssessment,
            createdServiceOrder: criarOs,
            returnServiceOrderId: serviceOrderId,
            // Tamanho, nao conteudo: o relato pode conter dado pessoal.
            customerReportLength: input.customerReport.length,
          },
        },
        tx,
      );

      await emit({
        type: EVENT_TYPES.WARRANTY_RETURN_REGISTERED,
        tenantId: context.tenantId,
        payload: {
          warrantyId: warranty.id,
          warrantyReturnId: returnId,
          unitId,
          equipmentId: warranty.equipmentId,
          wasEnforceable: enforceable,
          coverageAssessment: input.coverageAssessment,
        },
      });

      return { serviceOrderId, serviceOrderNumber };
    });

    return {
      returnId,
      serviceOrderId: resultado.serviceOrderId,
      serviceOrderNumber: resultado.serviceOrderNumber,
      createdServiceOrder: criarOs,
      reused: false,
      refusalReason,
    };
  } catch (error) {
    /**
     * IDEMPOTENCIA, SEGUNDA CAMADA (itens 57 e 58).
     *
     * Dois atendentes clicando ao mesmo tempo com a mesma chave: o segundo
     * bate no UNIQUE e reencontra o retorno do primeiro. UMA nova OS, nunca
     * duas.
     */
    if (isDuplicateKeyError(error) && idempotencyKey) {
      const existente = await findReturnByKey(context.tenantId, idempotencyKey);
      if (existente) {
        return {
          returnId: existente.id,
          serviceOrderId: existente.returnServiceOrderId,
          serviceOrderNumber: await numberOf(existente.returnServiceOrderId),
          createdServiceOrder: false,
          reused: true,
          refusalReason: null,
        };
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Reclassificacao (itens 29 a 32)
// ---------------------------------------------------------------------------

const reclassifySchema = z.object({
  serviceOrderId: z.string().trim().min(1),
  reason: z.string(),
  expectedVersion: z.coerce.number().int().optional(),
});

/**
 * A OS DE GARANTIA VAI PARA O FLUXO COMERCIAL (itens 29 a 32).
 *
 * O tecnico abriu o aparelho e concluiu que o defeito nao e o que a loja
 * garantiu — oxidacao posterior, queda, intervencao de terceiro. O conserto
 * continua possivel, mas agora e servico pago.
 *
 * TRES EXIGENCIAS, e nenhuma e negociavel:
 *
 *   1. AUTORIDADE TECNICA por permissao (`warranties.reclassify`), nunca pelo
 *      nome do cargo (item 69). "Tecnico" e um texto que cada empresa escreve
 *      como quer; permissao e o que o sistema sabe conferir.
 *   2. JUSTIFICATIVA TECNICA escrita, com minimo real (item 31). Quem ler
 *      daqui a seis meses — e o cliente que vai receber a cobranca — precisa
 *      entender por que deixou de ser garantia.
 *   3. O WORKFLOW OFICIAL decide o estado (item 32). Esta funcao NAO escreve
 *      `service_orders.status`: ela pede a transicao a maquina de estados, que
 *      recusa se a transicao nao existir.
 *
 * O DESTINO E `awaiting_technical_opinion`. A OS de garantia nasceu em
 * Aguardando Conserto porque o parecer ja existia; ao descobrir que o defeito
 * e outro, o parecer volta a ser necessario — e dali o fluxo normal segue para
 * orcamento, exatamente como em qualquer atendimento pago.
 */
export async function reclassifyWarrantyServiceOrder(
  context: TenantContext,
  rawInput: unknown,
): Promise<{ serviceOrderId: string; to: string }> {
  const input = parse(reclassifySchema, rawInput);

  const [order] = await getDb()
    .select({
      id: serviceOrders.id,
      unitId: serviceOrders.unitId,
      number: serviceOrders.number,
      status: serviceOrders.status,
      classification: serviceOrders.classification,
      warrantyId: serviceOrders.warrantyId,
      customerId: serviceOrders.customerId,
    })
    .from(serviceOrders)
    .where(
      and(eq(serviceOrders.tenantId, context.tenantId), eq(serviceOrders.id, input.serviceOrderId)),
    )
    .limit(1);

  if (!order) throw new NotFoundError('Ordem de Servico nao encontrada.');
  if (!context.authorizedUnitIds.includes(order.unitId)) {
    throw new NotFoundError('Ordem de Servico nao encontrada.');
  }

  await authorize(context, {
    permission: PERMISSIONS.WARRANTIES_RECLASSIFY,
    featureKey: FEATURES.OPERATIONS_WARRANTIES,
    unitId: order.unitId,
  });

  if (!canReclassify(order.classification)) {
    throw new BusinessRuleError(
      'Esta Ordem de Servico nao e de Garantia Interna; nao ha o que reclassificar.',
    );
  }

  const reason = normalizeReclassificationReason(input.reason);

  /** Planejado ANTES da transacao: valida, autoriza e nao grava nada. */
  const plan = await planTransition(context, {
    serviceOrderId: order.id,
    to: 'awaiting_technical_opinion',
    reason,
    /**
     * `via` identifica a ACAO que autoriza esta transicao `actionOnly`.
     *
     * Sem ele a maquina de estados recusa — e e assim que a regra do Prompt 08
     * continua valendo: o seletor generico de situacao nao alcanca este
     * caminho, so a reclassificacao alcanca.
     */
    via: 'warranty_reclassification',
    expectedVersion: input.expectedVersion,
  });

  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    /**
     * A CLASSIFICACAO muda com compare-and-swap na propria classificacao.
     *
     * Dois tecnicos reclassificando a mesma OS ao mesmo tempo: o primeiro
     * troca `warranty_internal` por `standard`; o segundo encontra
     * `affectedRows = 0` — porque o `WHERE` exige a classificacao anterior —
     * e recebe conflito, sem duplicar linha do tempo nem evento (item 61).
     */
    const updated = await tx
      .update(serviceOrders)
      .set({
        classification: DEFAULT_SERVICE_ORDER_CLASSIFICATION,
        updatedBy: context.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(serviceOrders.id, order.id),
          eq(serviceOrders.tenantId, context.tenantId),
          eq(serviceOrders.classification, 'warranty_internal'),
        ),
      );

    if (affectedRows(updated) === 0) {
      throw new ConflictError(
        'Esta Ordem de Servico ja foi reclassificada por outra pessoa. Recarregue a pagina.',
      );
    }

    /** O WORKFLOW escreve o status. Garantias nunca escreve (item 109). */
    await applyTransition(tx as TransactionExecutor, emit, context, plan, now);

    await tx.insert(serviceOrderTimeline).values({
      id: newId(),
      tenantId: context.tenantId,
      serviceOrderId: order.id,
      kind: TIMELINE_KINDS.WARRANTY_RECLASSIFIED,
      summary: 'Reclassificada de Garantia Interna para atendimento sujeito a orcamento',
      metadata: { warrantyId: order.warrantyId, reasonLength: reason.length },
      actorId: context.userId,
      occurredAt: now,
    });

    if (order.warrantyId) {
      await writeWarrantyTimeline(tx as TransactionExecutor, {
        tenantId: context.tenantId,
        warrantyId: order.warrantyId,
        kind: WARRANTY_TIMELINE_KINDS.RECLASSIFIED,
        summary: `OS ${order.number} reclassificada para atendimento sujeito a orcamento`,
        reason,
        actorId: context.userId,
        occurredAt: now,
      });
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.WARRANTY_RETURN_RECLASSIFIED,
        entityType: 'service_order',
        entityId: order.id,
        tenantId: context.tenantId,
        unitId: order.unitId,
        userId: context.userId,
        before: { classification: 'warranty_internal', status: order.status },
        after: {
          classification: DEFAULT_SERVICE_ORDER_CLASSIFICATION,
          status: 'awaiting_technical_opinion',
          /** A justificativa INTEIRA fica na auditoria: e o registro formal. */
          reason,
        },
      },
      tx,
    );

    /**
     * O FATO DE COMUNICACAO PENDENTE (item 30).
     *
     * O cliente esperava conserto gratuito e vai receber orcamento; alguem
     * precisa avisa-lo. O Prompt 16 nao existe, entao NADA e enviado — nem
     * WhatsApp, nem e-mail, nem SMS. O evento fica no outbox SEM o texto da
     * justificativa: ela descreve o estado do aparelho e o comportamento do
     * cliente, e um payload de evento nao e lugar para isso.
     */
    await emit({
      type: EVENT_TYPES.WARRANTY_RETURN_RECLASSIFIED_TO_QUOTE,
      tenantId: context.tenantId,
      payload: {
        serviceOrderId: order.id,
        serviceOrderNumber: order.number,
        warrantyId: order.warrantyId,
        customerId: order.customerId,
        unitId: order.unitId,
        /** Para o canal futuro saber que ha o que dizer, sem dizer o que. */
        requiresCustomerNotice: true,
      },
    });
  });

  return { serviceOrderId: order.id, to: 'awaiting_technical_opinion' };
}

/** Garantias potencialmente aplicaveis a um equipamento (item 22). */
export async function findApplicableWarranties(
  context: TenantContext,
  equipmentId: string,
): Promise<
  Array<{
    id: string;
    number: number;
    type: string;
    startsOn: string;
    endsOn: string;
    status: string;
    serviceOrderId: string | null;
    enforceable: boolean;
  }>
> {
  const referenceDate = referenceDateFor(context.tenantTimezone);

  const rows = await getDb()
    .select({
      id: warranties.id,
      number: warranties.number,
      type: warranties.type,
      startsOn: warranties.startsOn,
      endsOn: warranties.endsOn,
      status: warranties.status,
      serviceOrderId: warranties.serviceOrderId,
      unitId: warranties.unitId,
    })
    .from(warranties)
    .where(and(eq(warranties.tenantId, context.tenantId), eq(warranties.equipmentId, equipmentId)))
    .orderBy(warranties.endsOn);

  /**
   * Mostra TODAS, marcando quais valem.
   *
   * Esconder as vencidas pareceria limpo e seria pior: o atendente precisa
   * saber que existiu uma garantia e que ela terminou semana passada, para
   * poder explicar isso ao cliente em vez de dizer "nao encontrei nada".
   */
  return rows
    .filter((row) => context.authorizedUnitIds.includes(row.unitId))
    .map((row) => ({
      id: row.id,
      number: row.number,
      type: row.type,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      status: row.status,
      serviceOrderId: row.serviceOrderId,
      enforceable: isWarrantyEnforceable(row, referenceDate),
    }));
}

export { formatWarrantyNumber };

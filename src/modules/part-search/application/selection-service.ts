import 'server-only';
import { z } from 'zod';
import { authorize } from '@/modules/access-control/application/authorization-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { BusinessRuleError, NotFoundError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { createPurchaseNeed } from '@/modules/purchasing/application/purchase-need-service';
import { listOpenNeedsForUnit } from '@/modules/purchasing/application/purchasing-queries';
import { partSearchError } from '../domain/part-search-request';
import {
  attachPurchaseNeedToSelection,
  findCandidateInTenant,
  findOfferInTenant,
  findSelectionInTenant,
  findSessionInTenant,
  insertSelection,
} from '../infrastructure/part-search-repository';

/**
 * SELECAO HUMANA E NECESSIDADE DE COMPRA (Prompt 21, itens 88 a 98, 146).
 *
 * DUAS ACOES, DELIBERADAMENTE SEPARADAS:
 *
 *   1. `selectCandidate`   — so REGISTRA a escolha. Nunca compra, nunca
 *      reserva, nunca move estoque (item 95/146). Bloqueia `incompativel`
 *      (item 90) e exige confirmacao consciente extra para `nao_verificada`
 *      (item 91).
 *   2. `createPurchaseNeedFromSelection` — OPCIONAL, so quando o candidate
 *      selecionado ja corresponde a uma peca real do catalogo (`partId`).
 *      Usa a porta OFICIAL de Compras (`createPurchaseNeed`) — nunca insere
 *      em `purchase_needs` diretamente (item 99/100).
 *
 * IDEMPOTENCIA (item 98): `purchase_needs` nao tem `idempotency_key` na V1
 * (verificado no schema real de Compras) e alterar o schema de outro modulo
 * esta fora do escopo deste prompt (item 71). A estrategia adotada e
 * CONSULTAR necessidades ABERTAS da unidade antes de criar — mesma peca,
 * mesma OS (quando ha) reaproveita a necessidade existente em vez de
 * duplicar. Ha uma janela de corrida entre a consulta e a criacao
 * (documentada honestamente no relatorio final) — aceitavel para V1 porque
 * a acao exige clique humano explicito, nao e disparada em massa.
 */

const selectInputSchema = z.object({
  sessionId: z.string().trim().min(1),
  candidateId: z.string().trim().min(1),
  offerId: z.string().trim().min(1).optional(),
  /** Exigido quando o rotulo e `nao_verificada` (item 91) — confirmacao consciente. */
  unverifiedAcknowledged: z.boolean().default(false),
});

export async function selectCandidate(
  context: TenantContext,
  rawInput: unknown,
): Promise<{ selectionId: string }> {
  const parsed = selectInputSchema.safeParse(rawInput);
  if (!parsed.success) throw partSearchError('PART_SEARCH_QUERY_INVALID');
  const input = parsed.data;

  const session = await findSessionInTenant(context.tenantId, input.sessionId);
  if (!session) throw partSearchError('PART_SEARCH_CONTEXT_NOT_FOUND');

  await authorize(context, {
    permission: PERMISSIONS.PARTS_SEARCH,
    unitId: session.unitId,
    featureKey: FEATURES.AI_PART_SEARCH,
  });

  const candidate = await findCandidateInTenant(context.tenantId, input.candidateId);
  if (!candidate || candidate.sessionId !== session.id) {
    throw partSearchError('PART_SEARCH_CANDIDATE_NOT_FOUND');
  }

  if (input.offerId) {
    const offer = await findOfferInTenant(context.tenantId, input.offerId);
    if (!offer || offer.candidateId !== candidate.id) {
      throw partSearchError('PART_SEARCH_CANDIDATE_NOT_FOUND');
    }
  }

  if (candidate.compatibilityLabel === 'incompativel') {
    throw partSearchError('PART_SEARCH_INCOMPATIBLE_SELECTION');
  }
  if (candidate.compatibilityLabel === 'nao_verificada' && !input.unverifiedAcknowledged) {
    throw partSearchError('PART_SEARCH_UNVERIFIED_CONFIRMATION_REQUIRED');
  }

  const selectionId = newId();
  await insertSelection({
    id: selectionId,
    tenantId: context.tenantId,
    sessionId: session.id,
    candidateId: candidate.id,
    offerId: input.offerId ?? null,
    selectedBy: context.userId,
    unverifiedAcknowledged: input.unverifiedAcknowledged,
  });

  return { selectionId };
}

const createNeedInputSchema = z.object({
  selectionId: z.string().trim().min(1),
  quantity: z.string().trim().min(1, 'Informe a quantidade.'),
  justification: z.string().trim().max(400).optional(),
});

export async function createPurchaseNeedFromSelection(
  context: TenantContext,
  rawInput: unknown,
): Promise<{ purchaseNeedId: string; reused: boolean }> {
  const parsed = createNeedInputSchema.safeParse(rawInput);
  if (!parsed.success) throw partSearchError('PART_SEARCH_QUERY_INVALID');
  const input = parsed.data;

  const selection = await findSelectionInTenant(context.tenantId, input.selectionId);
  if (!selection) throw new NotFoundError('Selecao nao encontrada.');

  if (selection.purchaseNeedId) {
    return { purchaseNeedId: selection.purchaseNeedId, reused: true };
  }

  const session = await findSessionInTenant(context.tenantId, selection.sessionId);
  if (!session) throw partSearchError('PART_SEARCH_CONTEXT_NOT_FOUND');

  const candidate = await findCandidateInTenant(context.tenantId, selection.candidateId);
  if (!candidate) throw partSearchError('PART_SEARCH_CANDIDATE_NOT_FOUND');

  /**
   * SO EXISTE necessidade de compra quando o candidate ja e uma peca real do
   * catalogo (item 8/97). Um resultado externo puro nao pode virar
   * necessidade de compra sozinho — cadastrar a peca e um ato humano, no
   * Estoque, fora da Busca de Pecas.
   */
  if (!candidate.partId) {
    throw new BusinessRuleError(
      'Este resultado ainda nao corresponde a uma peca cadastrada no Estoque. Cadastre a peca antes de criar uma necessidade de compra.',
    );
  }

  await authorize(context, {
    permission: PERMISSIONS.PURCHASES_CREATE,
    unitId: session.unitId,
    featureKey: FEATURES.OPERATIONS_PURCHASING,
  });

  const openNeeds = await listOpenNeedsForUnit(context, session.unitId);
  const existing = openNeeds.find(
    (need) => need.partId === candidate.partId && need.serviceOrderId === session.serviceOrderId,
  );

  if (existing) {
    await attachPurchaseNeedToSelection(
      context.tenantId,
      selection.id,
      existing.id,
      context.userId,
    );
    return { purchaseNeedId: existing.id, reused: true };
  }

  const purchaseNeedId = await createPurchaseNeed(context, {
    unitId: session.unitId,
    partId: candidate.partId,
    quantity: input.quantity,
    origin: session.serviceOrderId ? 'service_order' : 'manual',
    serviceOrderId: session.serviceOrderId ?? undefined,
    justification: input.justification,
  });

  await attachPurchaseNeedToSelection(
    context.tenantId,
    selection.id,
    purchaseNeedId,
    context.userId,
  );

  return { purchaseNeedId, reused: false };
}

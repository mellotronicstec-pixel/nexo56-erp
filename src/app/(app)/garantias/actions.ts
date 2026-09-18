'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { requireContext } from '@/modules/auth/application/current-context';
import { issueCertificate } from '@/modules/warranties/application/warranty-certificate-service';
import { recordWarrantyCost } from '@/modules/warranties/application/warranty-cost-service';
import {
  changeWarrantyPolicyStatus,
  createWarrantyPolicy,
  updateWarrantyPolicy,
} from '@/modules/warranties/application/warranty-policy-service';
import {
  reclassifyWarrantyServiceOrder,
  registerWarrantyReturn,
} from '@/modules/warranties/application/warranty-return-service';
import {
  cancelWarranty,
  issueWarranty,
  revokeWarranty,
} from '@/modules/warranties/application/warranty-service';
import { EMPTY_WARRANTY_STATE, type WarrantyActionState } from './action-state';
import { assertSameOrigin } from '../actions';

/**
 * Server Actions de Garantias (Prompt 13, item 91).
 *
 * CAMADA FINA DE PROPOSITO. Ela le o formulario e chama o caso de uso; nenhuma
 * regra mora aqui, porque a mesma regra tem de valer quando a chamada vier da
 * futura API, do Nexo56 Mobile ou do Portal.
 *
 * O FRONTEND NUNCA E AUTORIDADE sobre vigencia, cobertura, empresa, unidade,
 * permissao, estado inicial da nova OS ou reclassificacao. Tudo isso o caso de
 * uso recalcula e confere.
 */

async function run(
  operation: string,
  work: () => Promise<WarrantyActionState>,
): Promise<WarrantyActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      return await work();
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha em acao de garantia', {
          module: 'warranties',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...EMPTY_WARRANTY_STATE, error: toUserMessage(error) };
    }
  });
}

function text(formData: FormData, field: string): string {
  return String(formData.get(field) ?? '').trim();
}

function optional(formData: FormData, field: string): string | undefined {
  const value = text(formData, field);
  return value === '' ? undefined : value;
}

function refresh(warrantyId?: string): void {
  revalidatePath('/garantias');
  revalidatePath('/garantias/retornos');
  if (warrantyId) revalidatePath(`/garantias/${warrantyId}`);
}

/**
 * Os itens de cobertura vem como listas paralelas do formulario.
 *
 * Um par `coverageKind[i]` / `coverageDescription[i]` por linha. Linhas com
 * descricao vazia sao descartadas: o formulario oferece varias e a pessoa
 * normalmente preenche duas.
 */
function coverageItems(formData: FormData) {
  const kinds = formData.getAll('coverageKind').map(String);
  const descriptions = formData.getAll('coverageDescription').map(String);
  const partIds = formData.getAll('coveragePartId').map(String);

  return descriptions
    .map((description, index) => ({
      kind: kinds[index] ?? 'labor',
      description: description.trim(),
      partId: partIds[index]?.trim() || undefined,
    }))
    .filter((item) => item.description.length > 0);
}

// ---------------------------------------------------------------------------
// Emissao
// ---------------------------------------------------------------------------

export async function issueWarrantyAction(
  _previous: WarrantyActionState,
  formData: FormData,
): Promise<WarrantyActionState> {
  let createdId: string | null = null;

  const result = await run('issueWarranty', async () => {
    const context = await requireContext();
    const created = await issueWarranty(context, {
      type: text(formData, 'type'),
      equipmentId: text(formData, 'equipmentId'),
      serviceOrderId: optional(formData, 'serviceOrderId'),
      policyId: optional(formData, 'policyId'),
      durationAmount: optional(formData, 'durationAmount'),
      durationUnit: optional(formData, 'durationUnit'),
      startsOn: optional(formData, 'startsOn'),
      coverageSummary: optional(formData, 'coverageSummary'),
      exclusions: optional(formData, 'exclusions'),
      terms: optional(formData, 'terms'),
      coversWholeService: text(formData, 'coversWholeService') !== 'partial',
      coverageItems: coverageItems(formData),
      manufacturer: optional(formData, 'manufacturer'),
      externalReference: optional(formData, 'externalReference'),
      partId: optional(formData, 'partId'),
      partDescription: optional(formData, 'partDescription'),
      partCode: optional(formData, 'partCode'),
      installedOn: optional(formData, 'installedOn'),
      notes: optional(formData, 'notes'),
      /** Duplo clique reencontra a garantia (item 56). */
      idempotencyKey: optional(formData, 'commandKey'),
    });

    createdId = created.warrantyId;
    refresh(createdId);

    /**
     * A garantia pode nascer SEM Ordem de Servico (fabrica, peca, estendida).
     * Sem a guarda, o caminho revalidado seria `/ordens-de-servico/` — a lista
     * inteira — em vez de uma ficha.
     */
    const ordem = optional(formData, 'serviceOrderId');
    if (ordem) revalidatePath(`/ordens-de-servico/${ordem}`);

    return {
      ...EMPTY_WARRANTY_STATE,
      success: created.reused
        ? 'Esta garantia ja havia sido emitida. Nada foi duplicado.'
        : `Garantia ${created.formattedNumber} emitida, valida ate ${created.endsOn}.`,
    };
  });

  // `redirect` lanca por design: fica fora do try.
  if (createdId) redirect(`/garantias/${createdId}`);
  return result;
}

export async function issueCertificateAction(
  _previous: WarrantyActionState,
  formData: FormData,
): Promise<WarrantyActionState> {
  return run('issueCertificate', async () => {
    const context = await requireContext();
    const warrantyId = text(formData, 'warrantyId');
    const result = await issueCertificate(context, warrantyId);
    refresh(warrantyId);

    return {
      ...EMPTY_WARRANTY_STATE,
      success: result.reused
        ? 'Certificado gerado novamente a partir dos termos da emissao.'
        : 'Certificado gerado.',
    };
  });
}

// ---------------------------------------------------------------------------
// Retorno
// ---------------------------------------------------------------------------

export async function registerReturnAction(
  _previous: WarrantyActionState,
  formData: FormData,
): Promise<WarrantyActionState> {
  let novaOs: string | null = null;

  const result = await run('registerReturn', async () => {
    const context = await requireContext();
    const warrantyId = text(formData, 'warrantyId');

    const registrado = await registerWarrantyReturn(context, {
      warrantyId,
      customerReport: text(formData, 'customerReport'),
      coverageAssessment: text(formData, 'coverageAssessment'),
      assessmentNotes: optional(formData, 'assessmentNotes'),
      unitId: optional(formData, 'unitId'),
      internalNotes: optional(formData, 'internalNotes'),
      /** Dois atendentes clicando juntos criam UMA OS (itens 57 e 58). */
      idempotencyKey: optional(formData, 'commandKey'),
    });

    refresh(warrantyId);
    novaOs = registrado.serviceOrderId;

    if (registrado.reused) {
      return {
        ...EMPTY_WARRANTY_STATE,
        success: 'Este retorno ja havia sido registrado. Nada foi duplicado.',
      };
    }

    if (registrado.createdServiceOrder) {
      return {
        ...EMPTY_WARRANTY_STATE,
        success: `Retorno registrado. Ordem de Servico ${registrado.serviceOrderNumber} criada em Aguardando Conserto.`,
      };
    }

    /**
     * A recusa e DITA, nao escondida: o atendente precisa saber o que
     * responder ao cliente que veio esperando conserto gratuito.
     */
    return {
      ...EMPTY_WARRANTY_STATE,
      success:
        `Retorno registrado sem Ordem de Servico de garantia. ${registrado.refusalReason ?? ''} O atendimento pode seguir pelo caminho normal.`.trim(),
    };
  });

  if (novaOs) redirect(`/ordens-de-servico/${novaOs}`);
  return result;
}

export async function reclassifyAction(
  _previous: WarrantyActionState,
  formData: FormData,
): Promise<WarrantyActionState> {
  return run('reclassify', async () => {
    const context = await requireContext();
    const serviceOrderId = text(formData, 'serviceOrderId');

    await reclassifyWarrantyServiceOrder(context, {
      serviceOrderId,
      reason: text(formData, 'reason'),
      expectedVersion: optional(formData, 'expectedVersion'),
    });

    revalidatePath(`/ordens-de-servico/${serviceOrderId}`);
    refresh(optional(formData, 'warrantyId'));

    return {
      ...EMPTY_WARRANTY_STATE,
      success:
        'Reclassificada. A Ordem de Servico voltou para Aguardando Parecer Tecnico e segue o fluxo comercial. O cliente precisa ser avisado — o Nexo56 nao envia mensagem.',
    };
  });
}

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

export async function cancelWarrantyAction(
  _previous: WarrantyActionState,
  formData: FormData,
): Promise<WarrantyActionState> {
  return run('cancelWarranty', async () => {
    const context = await requireContext();
    const warrantyId = text(formData, 'warrantyId');
    await cancelWarranty(context, warrantyId, text(formData, 'reason'));
    refresh(warrantyId);
    return {
      ...EMPTY_WARRANTY_STATE,
      success: 'Garantia cancelada. O historico continua registrado.',
    };
  });
}

export async function revokeWarrantyAction(
  _previous: WarrantyActionState,
  formData: FormData,
): Promise<WarrantyActionState> {
  return run('revokeWarranty', async () => {
    const context = await requireContext();
    const warrantyId = text(formData, 'warrantyId');
    await revokeWarranty(context, warrantyId, text(formData, 'reason'));
    refresh(warrantyId);
    return {
      ...EMPTY_WARRANTY_STATE,
      success:
        'Garantia revogada. Os retornos ja registrados continuam no historico — revogar vale de agora em diante.',
    };
  });
}

// ---------------------------------------------------------------------------
// Custos
// ---------------------------------------------------------------------------

export async function recordCostAction(
  _previous: WarrantyActionState,
  formData: FormData,
): Promise<WarrantyActionState> {
  return run('recordCost', async () => {
    const context = await requireContext();
    const warrantyId = text(formData, 'warrantyId');

    await recordWarrantyCost(context, {
      warrantyId,
      warrantyReturnId: optional(formData, 'warrantyReturnId'),
      serviceOrderId: optional(formData, 'serviceOrderId'),
      kind: text(formData, 'kind'),
      description: text(formData, 'description'),
      amount: text(formData, 'amount'),
    });

    refresh(warrantyId);
    return {
      ...EMPTY_WARRANTY_STATE,
      success: 'Custo registrado. Isto mede o gasto da loja e nao cria lancamento financeiro.',
    };
  });
}

// ---------------------------------------------------------------------------
// Politicas
// ---------------------------------------------------------------------------

export async function createPolicyAction(
  _previous: WarrantyActionState,
  formData: FormData,
): Promise<WarrantyActionState> {
  return run('createPolicy', async () => {
    const context = await requireContext();
    await createWarrantyPolicy(context, {
      name: text(formData, 'name'),
      type: text(formData, 'type'),
      durationAmount: text(formData, 'durationAmount'),
      durationUnit: text(formData, 'durationUnit'),
      coverageSummary: optional(formData, 'coverageSummary'),
      exclusions: optional(formData, 'exclusions'),
      terms: optional(formData, 'terms'),
    });
    revalidatePath('/garantias/politicas');
    return { ...EMPTY_WARRANTY_STATE, success: 'Politica criada.' };
  });
}

export async function updatePolicyAction(
  _previous: WarrantyActionState,
  formData: FormData,
): Promise<WarrantyActionState> {
  return run('updatePolicy', async () => {
    const context = await requireContext();
    await updateWarrantyPolicy(
      context,
      text(formData, 'policyId'),
      {
        name: text(formData, 'name'),
        type: text(formData, 'type'),
        durationAmount: text(formData, 'durationAmount'),
        durationUnit: text(formData, 'durationUnit'),
        coverageSummary: optional(formData, 'coverageSummary'),
        exclusions: optional(formData, 'exclusions'),
        terms: optional(formData, 'terms'),
      },
      optional(formData, 'expectedVersion') ? Number(text(formData, 'expectedVersion')) : undefined,
    );
    revalidatePath('/garantias/politicas');
    return {
      ...EMPTY_WARRANTY_STATE,
      success: 'Politica atualizada. Garantias ja emitidas continuam com os termos da epoca.',
    };
  });
}

export async function changePolicyStatusAction(
  _previous: WarrantyActionState,
  formData: FormData,
): Promise<WarrantyActionState> {
  return run('changePolicyStatus', async () => {
    const context = await requireContext();
    const status = text(formData, 'status') === 'inactive' ? 'inactive' : 'active';
    await changeWarrantyPolicyStatus(context, text(formData, 'policyId'), status);
    revalidatePath('/garantias/politicas');
    return {
      ...EMPTY_WARRANTY_STATE,
      success:
        status === 'inactive'
          ? 'Politica desativada. Ela para de aparecer em emissoes novas e continua explicando as antigas.'
          : 'Politica reativada.',
    };
  });
}

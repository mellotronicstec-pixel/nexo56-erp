'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage, ValidationError } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { requireContext } from '@/modules/auth/application/current-context';
import {
  archiveRule,
  createRule,
  setRuleEnabled,
  updateRuleDefinition,
} from '@/modules/automations/application/rule-service';
import { assertSameOrigin } from '../../actions';
import { EMPTY_AUTOMATION_STATE, type AutomationActionState } from './action-state';

async function run(
  operation: string,
  work: () => Promise<AutomationActionState>,
): Promise<AutomationActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      return await work();
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha em acao de automacao', {
          module: 'automations',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...EMPTY_AUTOMATION_STATE, error: toUserMessage(error) };
    }
  });
}

function parseDefinitionJson(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ValidationError('A definicao da regra ficou vazia.');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError('A definicao da regra ficou em um formato invalido.');
  }
}

export async function createRuleAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const result = await run('createRule', async () => {
    const context = await requireContext();
    const scopeKind = String(formData.get('scopeKind') ?? 'UNIT_SET');
    const { ruleId } = await createRule(context, {
      name: String(formData.get('name') ?? '').trim(),
      scopeKind,
      unitIds: formData.getAll('unitIds').map(String),
      definition: parseDefinitionJson(formData.get('definitionJson')),
    });
    revalidatePath('/configuracoes/automacoes');
    return { ...EMPTY_AUTOMATION_STATE, success: 'Regra criada, desabilitada.', ruleId };
  });

  if (result.ruleId && !result.error) redirect(`/configuracoes/automacoes/${result.ruleId}`);
  return result;
}

export async function updateRuleDefinitionAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  return run('updateRuleDefinition', async () => {
    const context = await requireContext();
    const ruleId = String(formData.get('ruleId') ?? '');
    const { versionNumber } = await updateRuleDefinition(
      context,
      ruleId,
      parseDefinitionJson(formData.get('definitionJson')),
    );
    revalidatePath(`/configuracoes/automacoes/${ruleId}`);
    revalidatePath('/configuracoes/automacoes');
    return { ...EMPTY_AUTOMATION_STATE, success: `Nova versao salva (v${versionNumber}).`, ruleId };
  });
}

export async function setRuleEnabledAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  return run('setRuleEnabled', async () => {
    const context = await requireContext();
    const ruleId = String(formData.get('ruleId') ?? '');
    const enabled = formData.get('enabled') === 'true';
    await setRuleEnabled(context, ruleId, enabled);
    revalidatePath(`/configuracoes/automacoes/${ruleId}`);
    revalidatePath('/configuracoes/automacoes');
    return {
      ...EMPTY_AUTOMATION_STATE,
      success: enabled ? 'Regra habilitada.' : 'Regra desabilitada.',
      ruleId,
    };
  });
}

export async function archiveRuleAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  return run('archiveRule', async () => {
    const context = await requireContext();
    const ruleId = String(formData.get('ruleId') ?? '');
    await archiveRule(context, ruleId);
    revalidatePath('/configuracoes/automacoes');
    return { ...EMPTY_AUTOMATION_STATE, success: 'Regra arquivada.', ruleId };
  });
}

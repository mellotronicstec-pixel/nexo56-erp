'use server';

import { revalidatePath } from 'next/cache';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { requireAccess } from '@/modules/access-control/application/guard';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { setTenantFeature } from '@/modules/features/application/tenant-configuration';
import { logger } from '@/core/logging/logger';

export interface ModuleFormState {
  error: string | null;
  success: string | null;
}

/**
 * Ativa/desativa uma funcionalidade para a empresa.
 *
 * A permissao e revalidada AQUI, no servidor, independentemente do que a
 * interface mostrou (Prompt 01, item 27).
 */
export async function toggleFeatureAction(
  _previous: ModuleFormState,
  formData: FormData,
): Promise<ModuleFormState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      const { context } = await requireAccess(FEATURES.CORE_FEATURES, PERMISSIONS.FEATURES_MANAGE);

      const featureKey = String(formData.get('featureKey') ?? '');
      const enabled = formData.get('enabled') === 'true';

      await setTenantFeature(context, { featureKey, enabled });
      revalidatePath('/administracao/modulos');

      return {
        error: null,
        success: enabled
          ? 'Funcionalidade ativada.'
          : 'Funcionalidade desativada. Os dados foram preservados.',
      };
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha ao alterar modularidade', {
          module: 'features',
          operation: 'toggleFeatureAction',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { error: toUserMessage(error), success: null };
    }
  });
}

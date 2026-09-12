'use server';

import { revalidatePath } from 'next/cache';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { requireAuthorization } from '@/modules/access-control/application/authorization-service';
import {
  createRole,
  deleteRole,
  setRolePermissions,
  updateRole,
} from '@/modules/access-control/application/role-service';
import { PERMISSIONS } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';
import { type RoleActionState } from './action-state';
import { assertSameOrigin } from '../../actions';

async function run(
  operation: string,
  work: () => Promise<RoleActionState>,
): Promise<RoleActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      const result = await work();
      revalidatePath('/administracao/perfis');
      return result;
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha em acao de perfis', {
          module: 'access-control',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { error: toUserMessage(error), success: null };
    }
  });
}

export async function createRoleAction(
  _previous: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  return run('createRole', async () => {
    const context = await requireAuthorization({
      permission: PERMISSIONS.ROLES_MANAGE,
      featureKey: FEATURES.CORE_ACCESS_CONTROL,
    });
    await createRole(context, {
      name: formData.get('name'),
      description: formData.get('description') ?? '',
    });
    return { error: null, success: 'Perfil criado.' };
  });
}

export async function updateRoleAction(
  _previous: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  return run('updateRole', async () => {
    const context = await requireAuthorization({ permission: PERMISSIONS.ROLES_MANAGE });
    await updateRole(context, String(formData.get('roleId') ?? ''), {
      name: formData.get('name'),
      description: formData.get('description') ?? '',
    });
    return { error: null, success: 'Perfil atualizado.' };
  });
}

export async function deleteRoleAction(
  _previous: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  return run('deleteRole', async () => {
    const context = await requireAuthorization({ permission: PERMISSIONS.ROLES_MANAGE });
    await deleteRole(context, String(formData.get('roleId') ?? ''));
    return { error: null, success: 'Perfil excluido.' };
  });
}

/**
 * Altera as permissoes do perfil.
 *
 * Exige `roles.manage_permissions` — separada de `roles.manage` porque e o
 * caminho classico de escalonamento de privilegio (itens 56 e 57).
 */
export async function setRolePermissionsAction(
  _previous: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  return run('setRolePermissions', async () => {
    const context = await requireAuthorization({
      permission: PERMISSIONS.ROLES_MANAGE_PERMISSIONS,
    });
    await setRolePermissions(
      context,
      String(formData.get('roleId') ?? ''),
      formData.getAll('permissions').map(String),
    );
    return { error: null, success: 'Permissoes do perfil atualizadas.' };
  });
}

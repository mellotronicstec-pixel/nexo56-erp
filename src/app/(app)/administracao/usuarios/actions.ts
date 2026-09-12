'use server';

import { revalidatePath } from 'next/cache';
import { runWithContext } from '@/core/context/request-context';
import { isAppError, toUserMessage } from '@/core/errors';
import { logger } from '@/core/logging/logger';
import { requireAuthorization } from '@/modules/access-control/application/authorization-service';
import { assignRole, revokeRole } from '@/modules/access-control/application/assignment-service';
import { PERMISSIONS, ROLE_SCOPES } from '@/modules/access-control/domain/permissions';
import { issuePasswordReset } from '@/modules/auth/application/password-service';
import { revokeUserSessionsAsAdmin } from '@/modules/auth/application/session-management';
import { FEATURES } from '@/modules/features/domain/catalog';
import {
  grantUnitMembership,
  revokeUnitMembership,
} from '@/modules/users/application/membership-service';
import {
  activateUser,
  createUser,
  deactivateUser,
  updateUser,
} from '@/modules/users/application/user-service';
import { EMPTY_STATE, type ActionState } from './action-state';
import { assertSameOrigin } from '../../actions';

/**
 * Server Actions da administracao de usuarios.
 *
 * TODA action revalida a autorizacao no servidor (item 30). O botao escondido
 * na interface e conveniencia; a barreira esta aqui.
 *
 * As permissoes sao deliberadamente diferentes por operacao (item 49/56):
 * editar um nome exige `users.manage`, conceder acesso exige
 * `users.manage_access`, redefinir senha exige `users.reset_password`.
 */

async function run(operation: string, work: () => Promise<ActionState>): Promise<ActionState> {
  return runWithContext({ origin: 'web' }, async () => {
    try {
      await assertSameOrigin();
      const result = await work();
      revalidatePath('/administracao/usuarios');
      return result;
    } catch (error) {
      if (!isAppError(error)) {
        logger.error('Falha em acao administrativa', {
          module: 'users',
          operation,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { error: toUserMessage(error), success: null, secret: null };
    }
  });
}

export async function createUserAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run('createUser', async () => {
    const context = await requireAuthorization({
      permission: PERMISSIONS.USERS_MANAGE,
      featureKey: FEATURES.CORE_USERS,
    });

    const created = await createUser(context, {
      name: formData.get('name'),
      email: formData.get('email'),
    });

    return {
      error: null,
      success: 'Usuario criado.',
      secret: {
        label: 'Senha inicial',
        value: created.initialPassword,
        hint: 'Exibida apenas agora. Repasse por canal seguro e peca a troca no primeiro acesso.',
      },
    };
  });
}

export async function updateUserAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run('updateUser', async () => {
    const context = await requireAuthorization({ permission: PERMISSIONS.USERS_MANAGE });
    await updateUser(context, {
      userId: formData.get('userId'),
      name: formData.get('name'),
    });
    return { ...EMPTY_STATE, success: 'Dados atualizados.' };
  });
}

export async function setUserStatusAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run('setUserStatus', async () => {
    const context = await requireAuthorization({ permission: PERMISSIONS.USERS_MANAGE });
    const userId = String(formData.get('userId') ?? '');

    if (formData.get('activate') === 'true') {
      await activateUser(context, userId);
      return { ...EMPTY_STATE, success: 'Usuario reativado. Sera necessario novo login.' };
    }

    await deactivateUser(context, userId);
    return { ...EMPTY_STATE, success: 'Usuario inativado e sessoes encerradas.' };
  });
}

export async function grantUnitAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run('grantUnit', async () => {
    const context = await requireAuthorization({ permission: PERMISSIONS.USERS_MANAGE_ACCESS });
    await grantUnitMembership(
      context,
      String(formData.get('userId') ?? ''),
      String(formData.get('unitId') ?? ''),
    );
    return { ...EMPTY_STATE, success: 'Unidade vinculada.' };
  });
}

export async function revokeUnitAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run('revokeUnit', async () => {
    const context = await requireAuthorization({ permission: PERMISSIONS.USERS_MANAGE_ACCESS });
    await revokeUnitMembership(
      context,
      String(formData.get('userId') ?? ''),
      String(formData.get('unitId') ?? ''),
    );
    return {
      ...EMPTY_STATE,
      success: 'Vinculo removido, junto com os perfis que valiam nesta unidade.',
    };
  });
}

export async function assignRoleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run('assignRole', async () => {
    const context = await requireAuthorization({ permission: PERMISSIONS.USERS_MANAGE_ACCESS });
    const scope =
      formData.get('scope') === ROLE_SCOPES.UNIT ? ROLE_SCOPES.UNIT : ROLE_SCOPES.TENANT;

    await assignRole(context, {
      userId: String(formData.get('userId') ?? ''),
      roleId: String(formData.get('roleId') ?? ''),
      scope,
      unitId: scope === ROLE_SCOPES.UNIT ? String(formData.get('unitId') ?? '') : null,
    });

    return { ...EMPTY_STATE, success: 'Perfil atribuido.' };
  });
}

export async function revokeRoleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run('revokeRole', async () => {
    const context = await requireAuthorization({ permission: PERMISSIONS.USERS_MANAGE_ACCESS });
    const scope =
      formData.get('scope') === ROLE_SCOPES.UNIT ? ROLE_SCOPES.UNIT : ROLE_SCOPES.TENANT;

    await revokeRole(context, {
      userId: String(formData.get('userId') ?? ''),
      roleId: String(formData.get('roleId') ?? ''),
      scope,
      unitId: scope === ROLE_SCOPES.UNIT ? String(formData.get('unitId') ?? '') : null,
    });

    return { ...EMPTY_STATE, success: 'Perfil removido.' };
  });
}

export async function resetPasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run('resetPassword', async () => {
    const context = await requireAuthorization({ permission: PERMISSIONS.USERS_RESET_PASSWORD });
    const issued = await issuePasswordReset(context, String(formData.get('userId') ?? ''));

    return {
      error: null,
      success: 'Redefinicao iniciada.',
      secret: {
        label: 'Codigo de redefinicao',
        value: issued.token,
        hint: 'Valido por 1 hora, uso unico. Repasse por canal seguro — o envio por e-mail ainda nao esta disponivel.',
      },
    };
  });
}

export async function revokeUserSessionsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run('revokeUserSessions', async () => {
    const context = await requireAuthorization({ permission: PERMISSIONS.SESSIONS_REVOKE });
    const revoked = await revokeUserSessionsAsAdmin(context, String(formData.get('userId') ?? ''));
    return { ...EMPTY_STATE, success: `${revoked} sessao(oes) encerrada(s).` };
  });
}

import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { assertTenantKeepsAdmin } from '@/modules/access-control/application/admin-guard';
import { hashPassword } from '@/modules/auth/domain/password';
import { revokeAllUserSessions } from '@/modules/auth/application/session-service';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * Gestao de usuarios (Prompt 03, itens 43 a 49).
 *
 * SEPARACAO DELIBERADA (item 49): este servico cuida apenas dos DADOS do
 * usuario. Vinculo de unidade fica em `membership-service`, papeis em
 * `assignment-service`, senha e sessoes em `auth`. Nao existe um endpoint que
 * atualize tudo de uma vez — mass assignment e justamente o caminho curto para
 * escalonamento de privilegio.
 *
 * O `tenant_id` NUNCA vem da entrada: sai sempre do contexto autenticado
 * (item 46).
 */

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome completo.').max(160),
  /**
   * Normaliza ANTES de validar: `trim` e `toLowerCase` primeiro, e so entao a
   * checagem de formato. Na ordem inversa, um espaco acidental colado do
   * cadastro antigo virava "e-mail invalido" em vez de ser limpo.
   */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(190)
    .pipe(z.email({ message: 'Informe um e-mail valido.' })),
});

export const updateUserSchema = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(2, 'Informe o nome completo.').max(160),
});

export interface CreatedUser {
  userId: string;
  /**
   * Senha inicial gerada aleatoriamente, devolvida UMA UNICA VEZ para o
   * administrador repassar por canal seguro (item 47).
   *
   * Nao ha senha padrao global. Este valor nunca e gravado em log, auditoria
   * nem evento — apenas o hash vai para o banco.
   */
  initialPassword: string;
}

export async function createUser(context: TenantContext, input: unknown): Promise<CreatedUser> {
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');

  const db = getDb();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, context.tenantId), eq(users.email, parsed.data.email)))
    .limit(1);

  if (existing[0]) {
    throw new ConflictError('Ja existe um usuario com este e-mail nesta empresa.');
  }

  const userId = newId();
  const initialPassword = randomBytes(15).toString('base64url');
  const passwordHash = await hashPassword(initialPassword);
  const now = new Date();

  await runInTransaction(async (tx, emit) => {
    await tx.insert(users).values({
      id: userId,
      tenantId: context.tenantId,
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash,
      status: 'active',
      createdBy: context.userId,
      updatedBy: context.userId,
      createdAt: now,
      updatedAt: now,
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.USER_CREATED,
        entityType: 'user',
        entityId: userId,
        tenantId: context.tenantId,
        userId: context.userId,
        after: { name: parsed.data.name, email: parsed.data.email, status: 'active' },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.USER_CREATED,
      tenantId: context.tenantId,
      payload: { userId, createdBy: context.userId },
    });
  });

  return { userId, initialPassword };
}

export async function updateUser(context: TenantContext, input: unknown): Promise<void> {
  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');

  const target = await findUserInTenant(context, parsed.data.userId);

  if (target.name === parsed.data.name) return;

  await runInTransaction(async (tx, emit) => {
    await tx
      .update(users)
      .set({ name: parsed.data.name, updatedBy: context.userId, updatedAt: new Date() })
      .where(and(eq(users.id, target.id), eq(users.tenantId, context.tenantId)));

    await recordAudit(
      {
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: 'user',
        entityId: target.id,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { name: target.name },
        after: { name: parsed.data.name },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.USER_UPDATED,
      tenantId: context.tenantId,
      payload: { userId: target.id },
    });
  });
}

/**
 * Inativa um usuario (item 43).
 *
 * Nunca apaga: o historico do que essa pessoa fez precisa continuar existindo.
 * Revoga todas as sessoes na MESMA transacao — inativar sem cortar a sessao
 * ativa seria seguranca de fachada.
 */
export async function deactivateUser(context: TenantContext, userId: string): Promise<void> {
  const target = await findUserInTenant(context, userId);

  if (target.status !== 'active') return;

  if (target.id === context.userId) {
    throw new BusinessRuleError('Voce nao pode inativar a propria conta.');
  }

  await runInTransaction(async (tx, emit) => {
    await tx
      .update(users)
      .set({ status: 'inactive', updatedBy: context.userId, updatedAt: new Date() })
      .where(and(eq(users.id, target.id), eq(users.tenantId, context.tenantId)));

    // Com o usuario ja inativo nesta transacao, a contagem reflete o estado
    // final: se ele era o ultimo administrador, o commit nao acontece.
    await assertTenantKeepsAdmin(tx, context.tenantId, { operation: 'deactivateUser' });

    await revokeAllUserSessions(target.id, tx);

    await recordAudit(
      {
        action: AUDIT_ACTIONS.USER_DEACTIVATED,
        entityType: 'user',
        entityId: target.id,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { status: target.status },
        after: { status: 'inactive' },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.USER_DEACTIVATED,
      tenantId: context.tenantId,
      payload: { userId: target.id },
    });
  });
}

/**
 * Reativa um usuario (item 44).
 *
 * Vinculos e papeis anteriores sao preservados — mas nenhuma sessao e
 * restaurada: a pessoa precisa fazer login de novo.
 */
export async function activateUser(context: TenantContext, userId: string): Promise<void> {
  const target = await findUserInTenant(context, userId);
  if (target.status === 'active') return;

  await runInTransaction(async (tx, emit) => {
    await tx
      .update(users)
      .set({ status: 'active', updatedBy: context.userId, updatedAt: new Date() })
      .where(and(eq(users.id, target.id), eq(users.tenantId, context.tenantId)));

    await recordAudit(
      {
        action: AUDIT_ACTIONS.USER_ACTIVATED,
        entityType: 'user',
        entityId: target.id,
        tenantId: context.tenantId,
        userId: context.userId,
        before: { status: target.status },
        after: { status: 'active' },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.USER_ACTIVATED,
      tenantId: context.tenantId,
      payload: { userId: target.id },
    });
  });
}

/**
 * Busca um usuario DENTRO do tenant da sessao.
 *
 * Um ID valido de outro tenant simplesmente nao e encontrado — a resposta e
 * "nao existe", sem revelar que o registro existe em outra empresa (item 65).
 */
export async function findUserInTenant(
  context: TenantContext,
  userId: string,
): Promise<{ id: string; name: string; email: string; status: string }> {
  const rows = await getDb()
    .select({ id: users.id, name: users.name, email: users.email, status: users.status })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, context.tenantId)))
    .limit(1);

  const user = rows[0];
  if (!user) throw new NotFoundError('Usuario nao encontrado.');
  return user;
}

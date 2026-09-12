import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/db/client';
import { runInTransaction } from '@/core/db/unit-of-work';
import { AuthenticationError, BusinessRuleError, ValidationError } from '@/core/errors';
import { newId } from '@/core/ids/id';
import { AUDIT_ACTIONS, recordAudit } from '@/modules/audit/application/audit-service';
import { hashPassword, verifyPassword } from '@/modules/auth/domain/password';
import { revokeAllUserSessions } from '@/modules/auth/application/session-service';
import { passwordResetTokens } from '@/modules/auth/infrastructure/schema';
import { EVENT_TYPES } from '@/modules/events/domain/event';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { users } from '@/modules/users/infrastructure/schema';
import { findUserInTenant } from '@/modules/users/application/user-service';

/**
 * Senha: alteracao e redefinicao (Prompt 03, itens 34 a 37).
 *
 * POLITICA DE SENHA (item 34)
 *
 * Comprimento minimo de 10 caracteres, maximo de 512, sem exigir maiuscula,
 * numero ou simbolo. Essas regras antigas empurram as pessoas para
 * "Senha@123" — previsivel e curta — enquanto comprimento e o fator que de
 * fato aumenta o custo de um ataque. Bloqueamos a lista de senhas obviamente
 * fracas e mantemos scrypt + rate limiting fazendo o trabalho pesado.
 *
 * A senha NUNCA e truncada silenciosamente: acima do limite, a validacao
 * recusa e explica.
 */

/** Senhas obviamente fracas, recusadas independentemente do comprimento. */
const OBVIOUSLY_WEAK = new Set([
  '1234567890',
  '0123456789',
  'senha123456',
  'password123',
  'qwertyuiop',
  'abcdefghij',
  'nexo561234',
  '1111111111',
  'aaaaaaaaaa',
]);

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 512;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `A senha precisa de ao menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  .max(MAX_PASSWORD_LENGTH, 'A senha e longa demais.')
  .refine((value) => !OBVIOUSLY_WEAK.has(value.toLowerCase()), {
    message: 'Esta senha e previsivel demais. Escolha outra.',
  })
  .refine((value) => value.trim().length > 0, { message: 'A senha nao pode ser apenas espacos.' });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual.'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
    /** Encerrar as demais sessoes apos a troca. Padrao: sim. */
    revokeOtherSessions: z.boolean().default(true),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'A confirmacao nao confere com a nova senha.',
    path: ['confirmPassword'],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'A nova senha precisa ser diferente da atual.',
    path: ['newPassword'],
  });

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Alteracao da propria senha (item 35).
 * Exige a senha atual — ter a sessao aberta nao basta.
 */
export async function changeOwnPassword(context: TenantContext, input: unknown): Promise<void> {
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');

  const rows = await getDb()
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, context.userId), eq(users.tenantId, context.tenantId)))
    .limit(1);

  const current = rows[0];
  if (!current) throw new AuthenticationError('Sessao invalida.');

  if (!(await verifyPassword(parsed.data.currentPassword, current.passwordHash))) {
    // Auditado como falha, sem revelar nada alem do necessario.
    await recordAudit({
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      entityType: 'user',
      entityId: context.userId,
      tenantId: context.tenantId,
      userId: context.userId,
      metadata: { result: 'rejected', reason: 'invalid_current_password' },
    });
    throw new AuthenticationError('Senha atual incorreta.');
  }

  const newHash = await hashPassword(parsed.data.newPassword);

  await runInTransaction(async (tx, emit) => {
    await tx
      .update(users)
      .set({ passwordHash: newHash, updatedBy: context.userId, updatedAt: new Date() })
      .where(and(eq(users.id, context.userId), eq(users.tenantId, context.tenantId)));

    if (parsed.data.revokeOtherSessions) {
      // Revoga TUDO, inclusive a sessao atual: a action recria a sessao em
      // seguida, e assim nenhuma sessao antiga sobrevive a troca de senha.
      await revokeAllUserSessions(context.userId, tx);
    }

    // Nenhuma senha, hash ou token entra no registro (item 73).
    await recordAudit(
      {
        action: AUDIT_ACTIONS.PASSWORD_CHANGED,
        entityType: 'user',
        entityId: context.userId,
        tenantId: context.tenantId,
        userId: context.userId,
        metadata: {
          result: 'changed',
          revokedOtherSessions: parsed.data.revokeOtherSessions,
        },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.PASSWORD_CHANGED,
      tenantId: context.tenantId,
      payload: { userId: context.userId, by: 'self' },
    });
  });
}

export interface IssuedResetToken {
  /**
   * Token bruto, devolvido UMA UNICA VEZ.
   *
   * O banco guarda apenas o SHA-256. Enquanto nao existir envio de e-mail, o
   * administrador repassa este valor por canal seguro — ver docs/architecture.
   */
  token: string;
  expiresAt: Date;
}

export const RESET_TOKEN_TTL_MINUTES = 60;

/**
 * Administrador inicia a redefinicao de senha de outro usuario (item 37).
 *
 * O administrador NAO descobre nem define a senha: recebe apenas um token de
 * uso unico e prazo curto. A senha anterior continua valendo ate que o token
 * seja usado, e nao ha como recupera-la.
 *
 * LIMITACAO CONHECIDA E DOCUMENTADA: nao ha envio de e-mail implementado. O
 * token e entregue ao administrador na tela, que o repassa ao titular. Quando
 * houver infraestrutura de e-mail, o envio substitui essa etapa sem mudar o
 * resto do fluxo.
 */
export async function issuePasswordReset(
  context: TenantContext,
  targetUserId: string,
): Promise<IssuedResetToken> {
  const target = await findUserInTenant(context, targetUserId);

  if (target.status !== 'active') {
    throw new BusinessRuleError('Nao e possivel redefinir a senha de um usuario inativo.');
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  await runInTransaction(async (tx) => {
    // Invalida tokens anteriores ainda validos: um pedido novo revoga o antigo.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, target.id), isNull(passwordResetTokens.usedAt)));

    await tx.insert(passwordResetTokens).values({
      id: newId(),
      userId: target.id,
      tenantId: context.tenantId,
      tokenHash: hashToken(token),
      expiresAt,
      createdBy: context.userId,
      createdAt: new Date(),
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
        entityType: 'user',
        entityId: target.id,
        tenantId: context.tenantId,
        userId: context.userId,
        metadata: { requestedBy: 'admin', expiresAt: expiresAt.toISOString() },
      },
      tx,
    );
  });

  return { token, expiresAt };
}

export const completeResetSchema = z
  .object({
    token: z.string().min(10),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'A confirmacao nao confere com a nova senha.',
    path: ['confirmPassword'],
  });

/**
 * Conclui a redefinicao com o token.
 *
 * O token e de uso unico e expira. A mensagem de erro e a mesma para token
 * inexistente, expirado ou ja usado — nao revela qual foi o caso, nem se a
 * conta existe (item 36).
 */
export async function completePasswordReset(input: unknown): Promise<void> {
  const parsed = completeResetSchema.safeParse(input);
  if (!parsed.success)
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');

  const db = getDb();
  const rows = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      tenantId: passwordResetTokens.tenantId,
    })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashToken(parsed.data.token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const resetToken = rows[0];
  if (!resetToken) {
    throw new ValidationError('Este link de redefinicao e invalido ou expirou.');
  }

  const newHash = await hashPassword(parsed.data.newPassword);

  await runInTransaction(async (tx, emit) => {
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, resetToken.id));

    await tx
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, resetToken.userId));

    // Redefinir senha encerra todas as sessoes: se a conta estava comprometida,
    // manter sessao aberta anularia o proposito.
    await revokeAllUserSessions(resetToken.userId, tx);

    await recordAudit(
      {
        action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
        entityType: 'user',
        entityId: resetToken.userId,
        tenantId: resetToken.tenantId,
        userId: resetToken.userId,
        metadata: { result: 'completed', allSessionsRevoked: true },
      },
      tx,
    );

    await emit({
      type: EVENT_TYPES.PASSWORD_CHANGED,
      tenantId: resetToken.tenantId,
      payload: { userId: resetToken.userId, by: 'reset_token' },
    });
  });
}

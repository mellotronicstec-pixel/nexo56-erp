import 'server-only';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { getDb } from '@/core/db/client';
import { NotFoundError, ValidationError } from '@/core/errors';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * GUARDAS COMPARTILHADAS DA AGENDA.
 *
 * Tarefa e compromisso sao coisas diferentes (item 5) e por isso tem servicos
 * separados. Mas as perguntas de ENTRADA sao as mesmas nos dois: de qual
 * unidade e isso, quem pode ser o responsavel, o que vale como texto vazio.
 *
 * Elas moram aqui porque a alternativa — copiar a verificacao para cada
 * servico — garante que um dos lados va esquecer de atualizar quando a regra
 * mudar, e o lado esquecido e o que aceita o dado errado.
 */

/** Texto vazio, em formulario, e ausencia — nao string de zero caractere. */
export function blank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Valida a entrada e devolve a PRIMEIRA mensagem, nao a lista inteira:
 * quem preencheu o formulario conserta um problema por vez.
 */
export function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Dados invalidos.');
  }
  return parsed.data;
}

/**
 * A UNIDADE VEM DO BACKEND (item 32).
 *
 * A unidade ativa do navegador e conveniencia de tela; a autoridade e a lista
 * de unidades que o contexto autorizou. Uma unidade informada no formulario so
 * e aceita se estiver nessa lista — e nao ha caminho por onde o navegador
 * escolha outra.
 */
export function resolveUnit(context: TenantContext, requested: string | null): string {
  const unitId = requested ?? context.activeUnitId;
  if (!unitId) {
    throw new ValidationError('Escolha a unidade em que este item acontece.');
  }
  if (!context.authorizedUnitIds.includes(unitId)) {
    throw new NotFoundError('Unidade nao encontrada.');
  }
  return unitId;
}

/**
 * O responsavel precisa existir, ser da empresa, estar ativo e ACESSAR a
 * unidade do item (itens 31 e 154).
 *
 * Atribuir a quem nao opera naquela loja produz uma fila que a pessoa nunca
 * ve — e trabalho que ninguem ve e trabalho esquecido, que e exatamente o que
 * este modulo existe para impedir.
 */
export async function assertAssignee(
  context: TenantContext,
  assigneeId: string,
  unitId: string,
): Promise<void> {
  const rows = await getDb().execute(sql`
    SELECT u.id
      FROM users u
      JOIN user_units uu ON uu.user_id = u.id AND uu.unit_id = ${unitId}
     WHERE u.id = ${assigneeId}
       AND u.tenant_id = ${context.tenantId}
       AND u.status = 'active'
     LIMIT 1
  `);

  const found = (rows as unknown as Array<Array<{ id: string }>>)[0]?.[0]?.id;
  if (!found) {
    throw new ValidationError(
      'Esta pessoa nao pode receber o item: ela precisa estar ativa e ter acesso a unidade.',
    );
  }
}

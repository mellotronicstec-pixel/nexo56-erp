import 'server-only';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { BusinessRuleError } from '@/core/errors';
import {
  ADMINISTRATIVE_PERMISSIONS,
  HIGH_RISK_PERMISSIONS,
  type PermissionKey,
} from '@/modules/access-control/domain/permissions';
import {
  rolePermissions,
  userRoles,
  userUnitRoles,
} from '@/modules/access-control/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { effectivePermissions } from '@/modules/tenancy/domain/tenant-context';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * Duas politicas de seguranca que atravessam toda a gestao de acesso.
 *
 * 1. PROTECAO CONTRA LOCKOUT (item 53) — a empresa nunca pode ficar sem
 *    ninguem capaz de administrar acesso.
 * 2. ANTI-ESCALONAMENTO (itens 54 e 57) — ninguem concede o que nao tem.
 */

type Executor = Pick<ReturnType<typeof getDb>, 'select' | 'execute'>;

/**
 * Conta quantos usuarios ATIVOS do tenant ainda detem todas as permissoes
 * administrativas, ignorando opcionalmente um usuario (o que esta sendo
 * alterado) e uma atribuicao (a que esta sendo removida).
 *
 * Considera papeis de tenant E de unidade: administrar acesso e uma capacidade
 * de nivel tenant, mas concedida por qualquer caminho valido.
 */
export async function countRemainingAdmins(
  tx: Executor,
  tenantId: string,
  exclude: { userId?: string; roleId?: string } = {},
): Promise<number> {
  const required = [...ADMINISTRATIVE_PERMISSIONS];

  const tenantRows = await tx
    .select({ userId: userRoles.userId, permissionKey: rolePermissions.permissionKey })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(userRoles.tenantId, tenantId),
        eq(users.status, 'active'),
        inArray(rolePermissions.permissionKey, required),
        exclude.userId ? ne(userRoles.userId, exclude.userId) : undefined,
        exclude.roleId ? ne(userRoles.roleId, exclude.roleId) : undefined,
      ),
    );

  const unitRows = await tx
    .select({ userId: userUnitRoles.userId, permissionKey: rolePermissions.permissionKey })
    .from(userUnitRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userUnitRoles.roleId))
    .innerJoin(users, eq(users.id, userUnitRoles.userId))
    .where(
      and(
        eq(userUnitRoles.tenantId, tenantId),
        eq(users.status, 'active'),
        inArray(rolePermissions.permissionKey, required),
        exclude.userId ? ne(userUnitRoles.userId, exclude.userId) : undefined,
        exclude.roleId ? ne(userUnitRoles.roleId, exclude.roleId) : undefined,
      ),
    )
    .for('update');

  const byUser = new Map<string, Set<string>>();
  for (const row of [...tenantRows, ...unitRows]) {
    const bucket = byUser.get(row.userId) ?? new Set<string>();
    bucket.add(row.permissionKey);
    byUser.set(row.userId, bucket);
  }

  let remaining = 0;
  for (const permissions of byUser.values()) {
    if (required.every((permission) => permissions.has(permission))) remaining += 1;
  }
  return remaining;
}

/**
 * Garante que a operacao nao deixe o tenant sem administrador.
 *
 * SERIALIZACAO — por que o lock existe
 *
 * A primeira versao apenas contava dentro da transacao, e um teste de
 * concorrencia mostrou o furo: duas revogacoes simultaneas, cada uma removendo
 * UM administrador diferente, nao conflitam entre si no banco. Cada transacao
 * enxergava o outro administrador ainda presente, ambas aprovavam, e a empresa
 * terminava com ZERO administradores.
 *
 * A correcao tem duas partes:
 *
 *   1. `SELECT ... FOR UPDATE` na linha do tenant — serializa TODA operacao que
 *      mexe em administracao daquela empresa. A segunda transacao espera a
 *      primeira terminar;
 *   2. as contagens tambem sao leituras travadas (`FOR UPDATE`), entao a
 *      segunda transacao le o estado ja commitado pela primeira, e nao um
 *      snapshot antigo.
 *
 * O custo e desprezivel: serializa apenas operacoes de administracao de acesso,
 * que sao raras, e apenas dentro do mesmo tenant.
 */
export async function assertTenantKeepsAdmin(
  tx: Executor,
  tenantId: string,
  context: { operation: string },
): Promise<void> {
  // Ponto de serializacao por tenant. Liberado automaticamente no commit.
  await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`);

  const remaining = await countRemainingAdmins(tx, tenantId);

  if (remaining === 0) {
    throw new BusinessRuleError(
      'Esta operacao deixaria a empresa sem nenhum administrador capaz de gerenciar acessos. ' +
        'Conceda o perfil administrativo a outra pessoa antes de continuar.',
      { operation: context.operation },
    );
  }
}

/**
 * ANTI-ESCALONAMENTO (itens 54 e 57).
 *
 * Ninguem concede uma permissao de ALTO RISCO que nao possua. Sem esta regra,
 * quem tivesse `roles.manage_permissions` poderia se autopromover a
 * administrador total em dois cliques — o que tornaria a separacao de
 * permissoes decorativa.
 *
 * Permissoes de baixo risco (leitura, por exemplo) podem ser concedidas
 * livremente por quem administra perfis: negá-las nao aumenta a seguranca e
 * atrapalharia a operacao.
 */
export function assertCanGrantPermissions(
  context: TenantContext,
  permissionsBeingGranted: readonly PermissionKey[],
): void {
  const own = effectivePermissions(context);

  const notOwned = permissionsBeingGranted.filter(
    (permission) =>
      (HIGH_RISK_PERMISSIONS as readonly string[]).includes(permission) && !own.has(permission),
  );

  if (notOwned.length > 0) {
    throw new BusinessRuleError(
      'Voce nao pode conceder permissoes que nao possui: ' + notOwned.join(', ') + '.',
      { permissions: notOwned },
    );
  }
}

/**
 * Impede que a pessoa amplie o proprio acesso (item 54).
 *
 * Reduzir o proprio acesso continua permitido — e a protecao de lockout cuida
 * do caso em que isso deixaria a empresa sem administrador.
 */
export function assertNotSelfEscalation(
  context: TenantContext,
  targetUserId: string,
  permissionsBeingGranted: readonly PermissionKey[],
): void {
  if (targetUserId !== context.userId) return;

  const own = effectivePermissions(context);
  const gaining = permissionsBeingGranted.filter((permission) => !own.has(permission));

  if (gaining.length > 0) {
    throw new BusinessRuleError(
      'Voce nao pode ampliar o proprio acesso. Peca a outro administrador.',
      { permissions: gaining },
    );
  }
}

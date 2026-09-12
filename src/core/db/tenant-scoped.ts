import 'server-only';
import { and, eq, type SQL } from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';
import { AuthorizationError } from '@/core/errors';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Acesso a dados consciente de tenant (Prompt 01, item 21).
 *
 * Objetivo declarado do prompt: "tornar o caminho seguro o caminho padrao".
 *
 * Estrategia escolhida (combinacao, nao bala de prata):
 *  1. `TenantScope` — o contexto vira um objeto que carrega o tenantId e
 *     produz clausulas WHERE ja escopadas. Consultar sem escopo exige
 *     ignorar a API deliberadamente, nao apenas esquecer um filtro;
 *  2. `scoped()` — helper que compoe o filtro de tenant com qualquer condicao
 *     adicional, de modo que o tenant nunca dependa de quem escreveu a query;
 *  3. `assertSameTenant()` — barreira final para registros que chegaram por
 *     outro caminho (ex.: consulta por ID vinda de um formulario);
 *  4. testes de travessia entre tenants (tests/integration/tenant-isolation).
 *
 * Por que NAO usamos middleware global do ORM: o Drizzle nao oferece hook
 * universal confiavel de reescrita de query, e um filtro "magico" invisivel
 * dificultaria auditar exatamente onde o isolamento acontece. Preferimos um
 * escopo explicito e visivel, coberto por teste.
 */

export class TenantScope {
  constructor(readonly tenantId: string) {}

  static from(context: Pick<TenantContext, 'tenantId'>): TenantScope {
    return new TenantScope(context.tenantId);
  }

  /** Condicao `tenant_id = <tenant da sessao>` combinada com as demais. */
  where(tenantColumn: MySqlColumn, ...conditions: Array<SQL | undefined>): SQL {
    const filters = [eq(tenantColumn, this.tenantId), ...conditions.filter(Boolean)] as SQL[];
    return and(...filters) as SQL;
  }

  /** Valores a inserir, ja com o tenant correto e sem aceitar sobrescrita. */
  values<T extends Record<string, unknown>>(values: T): T & { tenantId: string } {
    return { ...values, tenantId: this.tenantId };
  }

  /**
   * Garante que um registro carregado pertence ao tenant da sessao.
   * Lanca AuthorizationError — nunca retorna false silenciosamente.
   */
  assertOwnership(record: { tenantId: string } | null | undefined, entity = 'registro'): void {
    if (!record || record.tenantId !== this.tenantId) {
      throw new AuthorizationError(`Acesso negado a este ${entity}.`);
    }
  }
}

export function scopedWhere(
  context: Pick<TenantContext, 'tenantId'>,
  tenantColumn: MySqlColumn,
  ...conditions: Array<SQL | undefined>
): SQL {
  return TenantScope.from(context).where(tenantColumn, ...conditions);
}

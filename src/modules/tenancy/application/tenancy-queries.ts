import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { scopedWhere } from '@/core/db/tenant-scoped';
import { units } from '@/modules/tenancy/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Consultas de tenancy, sempre escopadas pelo contexto autenticado.
 * Nenhuma funcao aqui aceita tenantId como parametro — ele vem do contexto.
 */

export interface UnitSummary {
  id: string;
  name: string;
  status: string;
  timezone: string | null;
}

export async function listUnits(context: TenantContext): Promise<UnitSummary[]> {
  return getDb()
    .select({ id: units.id, name: units.name, status: units.status, timezone: units.timezone })
    .from(units)
    .where(scopedWhere(context, units.tenantId))
    .orderBy(units.name);
}

/**
 * Busca uma unidade por ID DENTRO do tenant da sessao.
 *
 * Este e o ponto que torna a manipulacao de ID inofensiva: o ID informado
 * entra na consulta junto com o tenant da sessao, entao um ID valido de outro
 * tenant simplesmente nao retorna linha.
 */
export async function findUnitById(
  context: TenantContext,
  unitId: string,
): Promise<UnitSummary | null> {
  const rows = await getDb()
    .select({ id: units.id, name: units.name, status: units.status, timezone: units.timezone })
    .from(units)
    .where(scopedWhere(context, units.tenantId, eq(units.id, unitId)))
    .limit(1);

  return rows[0] ?? null;
}

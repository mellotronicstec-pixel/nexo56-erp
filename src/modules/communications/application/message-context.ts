import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { NotFoundError } from '@/core/errors';
import {
  formatServiceOrderNumber,
  statusLabel,
} from '@/modules/service-orders/domain/service-order';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { firstName, type TemplateValues, type VariableScope } from '../domain/template';

/**
 * DE ONDE VÊM OS VALORES DAS LACUNAS (itens 23 e 24).
 *
 * O renderizador não sabe consultar banco, e é bom que não saiba: assim ele é
 * uma função pura, testável sem MariaDB, e não existe caminho por onde uma
 * variável de template vire uma consulta arbitrária.
 *
 * Quem consulta é este arquivo, e ele consulta exatamente o que o catálogo
 * declara — nada além. Acrescentar variável exige mexer aqui E no catálogo, e
 * essa fricção é o que impede o template de virar linguagem de consulta.
 */

export interface MessageSubject {
  customerId: string;
  customerName: string;
  unitId: string;
  serviceOrderId: string | null;
}

export interface ResolvedTemplateContext {
  values: TemplateValues;
  scopes: VariableScope[];
  /** Número já formatado, para o resumo da tela e o rótulo da mensagem. */
  serviceOrderNumber: string | null;
}

export async function resolveTemplateContext(
  context: TenantContext,
  subject: MessageSubject,
): Promise<ResolvedTemplateContext> {
  const [unidade] = await getDb()
    .select({ name: sql<string>`u.name` })
    .from(sql`units u`)
    .where(sql`u.id = ${subject.unitId} AND u.tenant_id = ${context.tenantId}`)
    .limit(1);

  if (!unidade) throw new NotFoundError('Unidade nao encontrada.');

  const values: TemplateValues = {
    'cliente.nome': subject.customerName,
    'cliente.primeiro_nome': firstName(subject.customerName),
    'empresa.nome': context.tenantName,
    'unidade.nome': unidade.name,
  };

  const scopes: VariableScope[] = ['always'];
  let serviceOrderNumber: string | null = null;

  if (subject.serviceOrderId) {
    /**
     * Uma consulta só, com os três dados do aparelho vindos junto. Montar o
     * texto do equipamento aqui — e não no renderizador — é o que permite a
     * lacuna `os.equipamento` nunca chegar vazia: marca e modelo são opcionais
     * no cadastro, e o tipo do aparelho não é.
     */
    const linhas = await getDb().execute(sql`
      SELECT so.number, so.status, e.kind, e.brand, e.model
        FROM service_orders so
        JOIN equipment e ON e.id = so.equipment_id AND e.tenant_id = so.tenant_id
       WHERE so.id = ${subject.serviceOrderId}
         AND so.tenant_id = ${context.tenantId}
         AND so.unit_id = ${subject.unitId}
       LIMIT 1
    `);

    const ordem = (
      linhas as unknown as Array<
        Array<{
          number: number;
          status: string;
          kind: string;
          brand: string | null;
          model: string | null;
        }>
      >
    )[0]?.[0];

    if (!ordem) throw new NotFoundError('Ordem de servico nao encontrada.');

    serviceOrderNumber = formatServiceOrderNumber(ordem.number);
    values['os.numero'] = serviceOrderNumber;
    values['os.status'] = statusLabel(ordem.status);
    values['os.equipamento'] = [ordem.kind, ordem.brand, ordem.model]
      .map((parte) => parte?.trim())
      .filter((parte): parte is string => Boolean(parte))
      .join(' ');
    scopes.push('service_order');
  }

  return { values, scopes, serviceOrderNumber };
}

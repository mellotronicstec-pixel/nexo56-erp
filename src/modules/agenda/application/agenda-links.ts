import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/core/db/client';
import { NotFoundError, ValidationError } from '@/core/errors';
import { customers } from '@/modules/customers/infrastructure/schema';
import { equipment } from '@/modules/equipment/infrastructure/schema';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';
import { warranties } from '@/modules/warranties/infrastructure/schema';

/**
 * VINCULOS DE CONTEXTO DA AGENDA (itens 43 e 44).
 *
 * Uma tarefa ou um compromisso podem apontar para uma Ordem de Servico, uma
 * garantia, um aparelho ou um cliente. Esses identificadores chegam do
 * NAVEGADOR, e o navegador nao e fonte de verdade: um formulario adulterado
 * mandaria o id de uma OS de outra empresa e ganharia, de brinde, uma tela que
 * mostra o numero dessa OS ao lado da tarefa.
 *
 * Entao aqui cada id e reencontrado no banco dentro do tenant — e, quando a
 * entidade e da unidade (OS e garantia), dentro da unidade da propria tarefa.
 * Id que nao volta da consulta vira "nao encontrado", nunca "voce nao pode":
 * a diferenca entre as duas respostas contaria ao curioso que a OS existe.
 *
 * As chaves compostas do banco — `fk_agenda_task_order_unit` em
 * `(service_order_id, unit_id)` e as demais em `(id, tenant_id)` — ja recusam
 * a linha incoerente. Esta validacao nao substitui aquela rede: ela existe
 * porque um erro de integridade referencial chega ao usuario como falha do
 * sistema, e o que aconteceu de fato foi um dado invalido no formulario.
 *
 * NAO HA FILTRO POR SITUACAO. Vincular a uma OS cancelada e legitimo —
 * "devolver o aparelho da OS 412, que o cliente desistiu" e trabalho real.
 * Recusar aqui inventaria uma regra que a operacao nao tem.
 */

export interface ContextLinkInput {
  /** Unidade da tarefa ou do compromisso; ja resolvida pelo backend. */
  unitId: string;
  serviceOrderId: string | null;
  customerId: string | null;
  equipmentId: string | null;
  warrantyId: string | null;
}

export interface ContextLinks {
  serviceOrderId: string | null;
  customerId: string | null;
  equipmentId: string | null;
  warrantyId: string | null;
}

/**
 * Quando dois vinculos discordam, o erro e do formulario — e o formulario
 * precisa ouvir isso, em vez de ter um dos lados sobrescrito em silencio.
 * Sobrescrever esconderia o defeito e prenderia a tarefa a um cliente que a
 * pessoa nunca viu na tela.
 */
function conciliar(
  atual: string | null,
  vindoDaOrigem: string,
  campo: 'cliente' | 'aparelho' | 'ordem de servico',
): string {
  if (atual && atual !== vindoDaOrigem) {
    throw new ValidationError(
      `Os vinculos nao combinam: o ${campo} informado nao e o desta ordem de servico ou garantia.`,
    );
  }
  return vindoDaOrigem;
}

/**
 * Valida e normaliza os vinculos.
 *
 * A AUTORIDADE DESCE: Ordem de Servico manda em garantia, aparelho e cliente;
 * garantia manda em aparelho e cliente; aparelho manda em cliente. O elo mais
 * forte presente define os mais fracos, porque ele ja carrega esses fatos — e
 * deixar o navegador escolher um cliente diferente do dono do aparelho criaria
 * uma tarefa que aponta para duas realidades ao mesmo tempo.
 */
export async function assertContextLinks(
  context: Pick<TenantContext, 'tenantId'>,
  input: ContextLinkInput,
): Promise<ContextLinks> {
  const db = getDb();

  let serviceOrderId = input.serviceOrderId;
  let customerId = input.customerId;
  let equipmentId = input.equipmentId;
  const warrantyId = input.warrantyId;

  if (serviceOrderId) {
    const [ordem] = await db
      .select({
        id: serviceOrders.id,
        customerId: serviceOrders.customerId,
        equipmentId: serviceOrders.equipmentId,
      })
      .from(serviceOrders)
      .where(
        and(
          eq(serviceOrders.id, serviceOrderId),
          eq(serviceOrders.tenantId, context.tenantId),
          /** A OS precisa ser DESTA unidade: a chave composta exige isso. */
          eq(serviceOrders.unitId, input.unitId),
        ),
      )
      .limit(1);

    if (!ordem) {
      throw new NotFoundError('Ordem de servico nao encontrada nesta unidade.');
    }

    serviceOrderId = ordem.id;
    customerId = conciliar(customerId, ordem.customerId, 'cliente');
    equipmentId = conciliar(equipmentId, ordem.equipmentId, 'aparelho');
  }

  if (warrantyId) {
    const [garantia] = await db
      .select({
        id: warranties.id,
        serviceOrderId: warranties.serviceOrderId,
        customerId: warranties.customerId,
        equipmentId: warranties.equipmentId,
      })
      .from(warranties)
      .where(
        and(
          eq(warranties.id, warrantyId),
          eq(warranties.tenantId, context.tenantId),
          eq(warranties.unitId, input.unitId),
        ),
      )
      .limit(1);

    if (!garantia) {
      throw new NotFoundError('Garantia nao encontrada nesta unidade.');
    }

    /**
     * A garantia pode ter nascido sem OS (Prompt 13); nesse caso ela nao tem
     * o que dizer sobre a ordem, e o vinculo informado continua valendo.
     */
    if (garantia.serviceOrderId) {
      serviceOrderId = conciliar(serviceOrderId, garantia.serviceOrderId, 'ordem de servico');
    }
    customerId = conciliar(customerId, garantia.customerId, 'cliente');
    equipmentId = conciliar(equipmentId, garantia.equipmentId, 'aparelho');
  }

  if (equipmentId) {
    const [aparelho] = await db
      .select({ id: equipment.id, customerId: equipment.customerId })
      .from(equipment)
      .where(and(eq(equipment.id, equipmentId), eq(equipment.tenantId, context.tenantId)))
      .limit(1);

    if (!aparelho) {
      throw new NotFoundError('Aparelho nao encontrado.');
    }

    /** Aparelho sempre tem dono; o dono dele e o cliente da tarefa. */
    customerId = conciliar(customerId, aparelho.customerId, 'cliente');
  }

  if (customerId) {
    const [cliente] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, context.tenantId)))
      .limit(1);

    if (!cliente) {
      throw new NotFoundError('Cliente nao encontrado.');
    }
  }

  return { serviceOrderId, customerId, equipmentId, warrantyId };
}

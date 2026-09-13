import {
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  text,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { actorColumns, id, idRef, instant, tenantId, timestamps, unitId } from '@/core/db/columns';
import { customers } from '@/modules/customers/infrastructure/schema';
import { equipment, equipmentIntakes } from '@/modules/equipment/infrastructure/schema';
import { SERVICE_ORDER_INITIAL_STATUS } from '@/modules/service-orders/domain/service-order';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * Ordem de Servico (Prompt 07).
 *
 * OWNERSHIP: TENANT + UNIDADE (item 6).
 *
 * A OS e a operacao — o trabalho que uma loja especifica assumiu, com prazo,
 * bancada e responsavel. Por isso `unit_id` e obrigatorio, sai do contexto
 * autorizado e nao muda depois (itens 40 e 41).
 *
 * Compare com o que veio antes:
 *
 *   customers          -> TENANT  (a pessoa e da empresa)
 *   equipment          -> TENANT  (o aparelho atravessa as lojas)
 *   equipment_intakes  -> UNIDADE (a entrega aconteceu num lugar)
 *   service_orders     -> UNIDADE (o servico e executado num lugar)
 */

export const serviceOrders = mysqlTable(
  'service_orders',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    /** Unidade que assumiu o servico. Vem do contexto, nunca do formulario. */
    unitId: unitId().notNull(),

    /**
     * Numero humano, unico por tenant (itens 13, 15 e 106).
     *
     * Guarda SO o valor numerico. Prefixo e zeros a esquerda vivem em
     * `tenant_sequences` e sao aplicados na apresentacao, para que mudar a
     * sigla amanha nao exija reescrever linha historica (item 18).
     *
     * A sequencia e do TENANT, nao da unidade: a loja Centro abre a 1001 e a
     * proxima da loja Norte e a 1002. Numeracao por unidade produziria duas
     * "OS 1001" na mesma empresa, e quem atende o telefone nao teria como
     * saber de qual o cliente esta falando.
     */
    number: int('number', { unsigned: true }).notNull(),

    /** Dono do aparelho. FK COMPOSTA com o tenant. */
    customerId: idRef('customer_id').notNull(),
    /** Aparelho atendido. FK COMPOSTA com o tenant. */
    equipmentId: idRef('equipment_id').notNull(),

    /**
     * Recebimento que originou a OS (itens 10 e 33).
     *
     * Nulo quando a OS nasceu direto do cadastro do aparelho. Quando presente,
     * e vinculo historico — os acessorios, a inspecao e as fotos continuam
     * morando no recebimento, e a OS os LE de la em vez de copiar (item 10).
     */
    intakeId: idRef('intake_id'),

    /**
     * Estado.
     *
     * `varchar` e nao ENUM: o Prompt 08 vai acrescentar estados, e uma coluna
     * de texto os recebe sem `ALTER TABLE ... MODIFY` (item 157). Hoje existe
     * um unico valor, o inicial, e nenhuma transicao.
     */
    status: varchar('status', { length: 40 }).notNull().default(SERVICE_ORDER_INITIAL_STATUS),

    /**
     * O que o CLIENTE disse (item 21). Nao e diagnostico (item 22).
     */
    customerReport: text('customer_report').notNull(),

    /**
     * Recado interno da abertura (item 24).
     *
     * Separado do relato porque tem outro destinatario: isto e da equipe, e
     * nao pode vazar para o futuro Portal do cliente junto com o relato dele.
     */
    internalNotes: text('internal_notes'),

    /** Quando a OS foi aberta. Igual a `created_at` hoje, e ainda assim explicito:
     * a abertura e um fato de negocio, e um dia podera ser retroativa. */
    openedAt: instant('opened_at').notNull(),

    /**
     * Chave de idempotencia do comando de criacao (itens 32, 93 e 127).
     *
     * O navegador gera uma chave por formulario aberto. Reenviar o MESMO
     * comando — duplo clique, retentativa depois de queda de rede, botao
     * voltar — reencontra a OS ja criada em vez de abrir a segunda. Nula para
     * criacoes que nao trouxeram chave.
     */
    idempotencyKey: varchar('idempotency_key', { length: 80 }),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    /**
     * FKS COMPOSTAS (itens 7, 8, 9 e 105).
     *
     * Cada uma carrega `tenant_id` junto, de modo que o BANCO — nao a
     * aplicacao — recusa uma OS do tenant A apontando para cliente,
     * equipamento, recebimento ou unidade do tenant B.
     */
    foreignKey({
      name: 'fk_service_order_customer_tenant',
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_service_order_equipment_tenant',
      columns: [table.equipmentId, table.tenantId],
      foreignColumns: [equipment.id, equipment.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_service_order_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_service_order_intake_tenant',
      columns: [table.intakeId, table.tenantId],
      foreignColumns: [equipmentIntakes.id, equipmentIntakes.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /**
     * COERENCIA DE UNIDADE ENTRE RECEBIMENTO E OS (item 11).
     *
     * Esta FK e a razao de `uq_intake_id_unit` existir em `equipment_intakes`.
     * Ela impede, no banco, que um recebimento da Unidade A gere uma OS
     * carimbada na Unidade B — cenario que a manipulacao do request tentaria
     * produzir e que deixaria o aparelho fisicamente numa loja e o servico
     * registrado noutra.
     */
    foreignKey({
      name: 'fk_service_order_intake_unit',
      columns: [table.intakeId, table.unitId],
      foreignColumns: [equipmentIntakes.id, equipmentIntakes.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Autoria tenant-safe (item 108). */
    foreignKey({
      name: 'fk_service_order_created_by_tenant',
      columns: [table.createdBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Numero unico por empresa (item 106). */
    unique('uq_service_order_tenant_number').on(table.tenantId, table.number),

    /**
     * UM recebimento origina UMA OS principal (itens 33 e 107).
     *
     * Cada `NULL` conta como distinto no MySQL, entao OS sem recebimento
     * convivem sem limite — a restricao so morde quando o recebimento existe.
     */
    unique('uq_service_order_intake').on(table.tenantId, table.intakeId),

    /** Mesmo comando, mesma OS (itens 32 e 127). */
    unique('uq_service_order_idempotency').on(table.tenantId, table.idempotencyKey),

    /** Alvo das FKs compostas das tabelas filhas. */
    unique('uq_service_order_id_tenant').on(table.id, table.tenantId),

    /** Fila da unidade, da mais recente para a mais antiga (itens 48 e 49). */
    index('ix_service_order_tenant_unit_opened').on(table.tenantId, table.unitId, table.openedAt),
    /** Busca pelo numero exato (item 46) — a consulta mais frequente do balcao. */
    index('ix_service_order_tenant_number').on(table.tenantId, table.number),
    index('ix_service_order_tenant_customer').on(table.tenantId, table.customerId),
    index('ix_service_order_tenant_equipment').on(table.tenantId, table.equipmentId),
    index('ix_service_order_tenant_status').on(table.tenantId, table.status),
  ],
);

/**
 * Linha do tempo estrutural da OS (itens 37 e 38).
 *
 * APPEND-ONLY. Guarda os fatos que a operacao precisa ver em ordem — hoje a
 * abertura e as correcoes dos dados de abertura; amanha, sem migration nova,
 * as mudancas de estado, o orcamento enviado, a peca encomendada.
 *
 * Nao substitui o AuditLog nem e substituida por ele: o AuditLog responde a
 * pergunta de seguranca ("quem alterou o que"), esta tabela responde a de
 * negocio ("o que aconteceu com este aparelho"). Hoje os dois quase coincidem
 * porque so ha dois fatos; deixam de coincidir no primeiro orcamento.
 */
export const serviceOrderTimeline = mysqlTable(
  'service_order_timeline',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    serviceOrderId: idRef('service_order_id').notNull(),

    /** Texto e nao ENUM: o Prompt 08 acrescenta tipos sem tocar na coluna. */
    kind: varchar('kind', { length: 40 }).notNull(),
    /** Resumo curto ja legivel. Nunca carrega PII do relato do cliente. */
    summary: varchar('summary', { length: 300 }),
    /** Detalhe estruturado do fato. Tambem sem PII. */
    metadata: json('metadata'),

    /** Quem provocou o fato. Nulo quando foi o sistema. */
    actorId: idRef('actor_id'),
    occurredAt: instant('occurred_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_so_timeline_order_tenant',
      columns: [table.serviceOrderId, table.tenantId],
      foreignColumns: [serviceOrders.id, serviceOrders.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    index('ix_so_timeline_order_occurred').on(table.serviceOrderId, table.occurredAt),
  ],
);

export type ServiceOrderRow = typeof serviceOrders.$inferSelect;
export type ServiceOrderTimelineRow = typeof serviceOrderTimeline.$inferSelect;

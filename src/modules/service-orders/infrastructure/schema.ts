import {
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  text,
  tinyint,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import {
  actorColumns,
  civilDate,
  id,
  idRef,
  instant,
  tenantId,
  timestamps,
  unitId,
} from '@/core/db/columns';
import { customers } from '@/modules/customers/infrastructure/schema';
import { equipment, equipmentIntakes } from '@/modules/equipment/infrastructure/schema';
import { SERVICE_ORDER_INITIAL_STATUS } from '@/modules/service-orders/domain/workflow';
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
     * Quando a situacao mudou pela ultima vez (Prompt 08).
     *
     * Separado de `updated_at`, que tambem muda ao corrigir o relato. Responde
     * "ha quanto tempo esta ordem esta parada neste estado" sem varrer a linha
     * do tempo.
     */
    statusChangedAt: instant('status_changed_at'),

    /**
     * CONTROLE OTIMISTA DE CONCORRENCIA (Prompt 08, item 11).
     *
     * Duas pessoas abrem a mesma OS em Aguardando Conserto; uma marca falta de
     * peca, a outra conclui o reparo. Sem isto, a segunda gravacao sobrescreve
     * a primeira e a ordem termina num estado que ninguem escolheu — com a
     * linha do tempo contando duas historias incompativeis.
     *
     * Toda transicao faz `UPDATE ... WHERE id = ? AND version = ?` e exige uma
     * linha afetada. Quem perder a corrida recebe erro e recarrega.
     */
    version: int('version', { unsigned: true }).notNull().default(1),

    /**
     * Tecnico responsavel (itens 26 a 29).
     *
     * Diferente de `created_by`: quem abriu a ordem no balcao raramente e quem
     * conserta. FK COMPOSTA com o tenant.
     */
    assignedTechnicianId: idRef('assigned_technician_id'),

    /**
     * Proximo ponto de atencao (itens 33 a 36).
     *
     * DATA CIVIL, nao instante: "+2 dias" e um dia inteiro no fuso de quem
     * opera. Guardar como timestamp faria a data virar para o dia anterior
     * conforme o servidor, e uma ordem que vence hoje apareceria como vencida
     * ontem. `NULL` = sem follow-up (ordem terminal, ou prazo encerrado).
     */
    followUpAt: civilDate('follow_up_at'),

    /**
     * Ultimo prazo para o qual o alerta de vencimento ja foi emitido.
     *
     * E o que torna o job idempotente sem tabela de alertas (item 101): se
     * `follow_up_alerted_for` ja e igual a `follow_up_at`, nao ha o que emitir.
     * Reagendar o follow-up muda `follow_up_at` e, com isso, volta a permitir
     * um alerta novo — que e o comportamento desejado.
     */
    followUpAlertedFor: civilDate('follow_up_alerted_for'),

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

    /**
     * Tecnico responsavel, tenant-safe (Prompt 08, item 27).
     *
     * Impede no banco que a ordem de uma empresa aponte para um usuario de
     * outra. A checagem de UNIDADE e de usuario ativo fica no servico, porque
     * ambas dependem de vinculo e situacao, que mudam com o tempo.
     */
    foreignKey({
      name: 'fk_service_order_technician_tenant',
      columns: [table.assignedTechnicianId, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
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

    /**
     * Alvo da FK composta `(service_order_id, unit_id)` do Prompt 09.
     *
     * Acrescentada de forma ADITIVA para que o orcamento so possa existir na
     * mesma unidade da sua OS — a mesma tecnica que `uq_intake_id_unit` usou
     * no Prompt 07 para amarrar recebimento e OS.
     */
    unique('uq_service_order_id_unit').on(table.id, table.unitId),

    /** Fila da unidade, da mais recente para a mais antiga (itens 48 e 49). */
    index('ix_service_order_tenant_unit_opened').on(table.tenantId, table.unitId, table.openedAt),
    /** Busca pelo numero exato (item 46) — a consulta mais frequente do balcao. */
    index('ix_service_order_tenant_number').on(table.tenantId, table.number),
    index('ix_service_order_tenant_customer').on(table.tenantId, table.customerId),
    index('ix_service_order_tenant_equipment').on(table.tenantId, table.equipmentId),
    index('ix_service_order_tenant_status').on(table.tenantId, table.status),
    /** Fila por situacao dentro da unidade — o filtro operacional do dia a dia. */
    index('ix_service_order_unit_status').on(table.tenantId, table.unitId, table.status),
    /** Pendencias: quem venceu, quem vence hoje (itens 40, 41 e 92). */
    index('ix_service_order_follow_up').on(table.tenantId, table.followUpAt),
    /** "Minhas OS" do futuro Modo Tecnico. */
    index('ix_service_order_technician').on(table.tenantId, table.assignedTechnicianId),
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

    /**
     * Justificativa escrita, quando a transicao exige (Prompt 08, itens 52 e
     * 108).
     *
     * Coluna propria, e nao dentro de `metadata`, justamente porque e TEXTO
     * LIVRE de pessoa: pode conter dado sensivel incidental, tem limite de
     * tamanho e precisa ser tratada como tal. `metadata` permanece livre de
     * PII e continua seguro para log e diagnostico.
     */
    reason: varchar('reason', { length: 300 }),

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

/**
 * Tarefas de workflow da Ordem de Servico (Prompt 08, itens 30 a 32).
 *
 * MINIMO NECESSARIO AO WORKFLOW, e nada de Agenda: nao ha recorrencia,
 * prioridade, etiqueta, comentario nem quadro. A entidade generica de Tarefas
 * e do Prompt 14, e esta tabela foi desenhada para ser absorvida por ela sem
 * reescrita — tenant, unidade, responsavel, titulo, descricao, prazo e
 * situacao ja estao aqui.
 */
export const serviceOrderTasks = mysqlTable(
  'service_order_tasks',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    /** Herdada da ordem: a tarefa acontece onde o trabalho acontece. */
    unitId: unitId().notNull(),
    serviceOrderId: idRef('service_order_id').notNull(),

    /** `delivery_preparation`, `part_pickup`. Texto, para o Prompt 14 crescer. */
    kind: varchar('kind', { length: 40 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    description: varchar('description', { length: 500 }),

    /** Responsavel. Nulo quando ainda nao ha a quem atribuir. */
    assigneeId: idRef('assignee_id'),
    /** Prazo como DATA CIVIL, pelo mesmo motivo do follow-up. */
    dueDate: civilDate('due_date'),

    status: varchar('status', { length: 20 }).notNull().default('open'),

    /**
     * Marcador de tarefa ABERTA (itens 101 e 130).
     *
     * Vale `1` enquanto a tarefa esta aberta e `NULL` depois. Como o MySQL
     * trata cada `NULL` como distinto num indice unico, a UNIQUE abaixo deixa
     * existir UMA tarefa aberta de cada tipo por ordem, e quantas concluidas
     * ou canceladas forem necessarias. E isso que impede o reprocessamento de
     * um evento de criar cinco tarefas iguais na bancada.
     */
    openMarker: tinyint('open_marker'),

    /** Nulo = criada pelo proprio workflow, nao por uma pessoa. */
    createdBy: idRef('created_by'),
    completedAt: instant('completed_at'),
    completedBy: idRef('completed_by'),

    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_so_task_order_tenant',
      columns: [table.serviceOrderId, table.tenantId],
      foreignColumns: [serviceOrders.id, serviceOrders.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_so_task_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_so_task_assignee_tenant',
      columns: [table.assigneeId, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Uma tarefa ABERTA de cada tipo por ordem. Ver `openMarker`. */
    unique('uq_so_task_open').on(table.serviceOrderId, table.kind, table.openMarker),

    index('ix_so_task_order').on(table.serviceOrderId, table.status),
    /** Pendencias da unidade: o que venceu e o que vence hoje. */
    index('ix_so_task_unit_due').on(table.tenantId, table.unitId, table.status, table.dueDate),
    index('ix_so_task_assignee').on(table.tenantId, table.assigneeId, table.status),
  ],
);

export type ServiceOrderRow = typeof serviceOrders.$inferSelect;
export type ServiceOrderTimelineRow = typeof serviceOrderTimeline.$inferSelect;
export type ServiceOrderTaskRow = typeof serviceOrderTasks.$inferSelect;

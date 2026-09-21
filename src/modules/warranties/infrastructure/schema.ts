import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  int,
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
  money,
  quantity,
  tenantId,
  timestamps,
  unitId,
} from '@/core/db/columns';
import { customers } from '@/modules/customers/infrastructure/schema';
import { equipment } from '@/modules/equipment/infrastructure/schema';
import { parts, stockMovements } from '@/modules/inventory/infrastructure/schema';
import { suppliers } from '@/modules/purchasing/infrastructure/schema';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * SCHEMA DE GARANTIAS (Prompt 13).
 *
 * Sete tabelas, e a separacao entre elas e o produto principal deste prompt:
 *
 *   warranty_policies       o MOLDE: "reparo de placa = 90 dias"
 *   warranties              a EMISSAO concreta, com snapshot dos termos
 *   warranty_coverage_items o QUE especificamente esta coberto
 *   warranty_certificates   o DOCUMENTO daquela garantia
 *   warranty_returns        o aparelho VOLTOU
 *   warranty_costs          o que a garantia CUSTOU a loja
 *   warranty_timeline       a historia, em portugues
 *
 * POR QUE POLITICA E GARANTIA SAO TABELAS DIFERENTES (ADR-062).
 *
 * Em marco a loja decide reduzir a garantia de placa de 90 para 30 dias. O
 * certificado que ela entregou em janeiro promete 90, esta impresso, assinado
 * e na mao do cliente. Se a garantia lesse a duracao da politica, essa unica
 * edicao reescreveria retroativamente todos os certificados ja entregues — e
 * o cliente que voltasse no dia 60 seria recusado por um sistema que mudou de
 * ideia depois de prometer.
 *
 * Por isso a garantia emitida guarda SNAPSHOT: duracao, cobertura, exclusoes e
 * termos sao copiados no ato da emissao e nunca mais lidos da politica.
 */

// ---------------------------------------------------------------------------
// Politicas (item 8)
// ---------------------------------------------------------------------------

export const warrantyPolicies = mysqlTable(
  'warranty_policies',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),

    name: varchar('name', { length: 120 }).notNull(),
    nameSearch: varchar('name_search', { length: 120 }).notNull(),

    /** `internal` | `factory` | `part` | `extended`. */
    type: varchar('type', { length: 20 }).notNull(),

    /** Duracao PADRAO. A garantia emitida copia; mudar aqui nao retroage. */
    durationAmount: int('duration_amount', { unsigned: true }).notNull(),
    /** `days` | `months`. Mes NAO e 30 dias (item 9). */
    durationUnit: varchar('duration_unit', { length: 10 }).notNull(),

    /** Texto que descreve o que a politica cobre, em portugues de contrato. */
    coverageSummary: text('coverage_summary'),
    /** Condicoes que excluem a cobertura. Autoridade e do TENANT (item 17). */
    exclusions: text('exclusions'),
    /** Termos gerais impressos no certificado. */
    terms: text('terms'),

    status: varchar('status', { length: 20 }).notNull().default('active'),

    version: int('version', { unsigned: true }).notNull().default(1),
    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_warranty_policy_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_warranty_policy_tenant_name').on(table.tenantId, table.nameSearch),
    /** Alvo das FKs compostas: politica so se liga a garantia do MESMO tenant. */
    unique('uq_warranty_policy_id_tenant').on(table.id, table.tenantId),

    index('ix_warranty_policy_tenant_type').on(table.tenantId, table.type, table.status),

    check(
      'ck_warranty_policy_duration_positive',
      sql`${table.durationAmount} >= 1 AND ${table.durationAmount} <= 120`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Garantias emitidas (item 12)
// ---------------------------------------------------------------------------

export const warranties = mysqlTable(
  'warranties',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),

    /**
     * A unidade que CONCEDEU a garantia.
     *
     * A garantia pertence ao TENANT — o cliente comprou da empresa, nao da
     * loja (item 38) — mas a origem historica importa para custo e indicador,
     * e por isso fica registrada. O retorno pode acontecer em outra unidade
     * sem falsificar esta.
     */
    unitId: unitId().notNull(),

    /** Numero humano, unico por tenant. De `tenant_sequences` (item 13). */
    number: int('number', { unsigned: true }).notNull(),

    type: varchar('type', { length: 20 }).notNull(),

    /** A politica que ORIGINOU. Nula quando a garantia foi montada a mao. */
    policyId: idRef('policy_id'),

    customerId: idRef('customer_id').notNull(),
    equipmentId: idRef('equipment_id').notNull(),

    /**
     * A OS que originou. Nula em garantia de fabrica registrada avulsa.
     *
     * FK COMPOSTA com a unidade: a garantia de uma OS da loja Norte nao pode
     * apontar para a unidade Centro.
     */
    serviceOrderId: idRef('service_order_id'),

    // --- snapshot dos termos (item 8 e ADR-062) -----------------------------
    /** Copiados no ato da emissao. NUNCA lidos da politica depois. */
    durationAmount: int('duration_amount', { unsigned: true }).notNull(),
    durationUnit: varchar('duration_unit', { length: 10 }).notNull(),
    coverageSummary: text('coverage_summary'),
    exclusions: text('exclusions'),
    terms: text('terms'),

    /**
     * A cobertura abrange o atendimento inteiro?
     *
     * `0` = PARCIAL (item 16). Declarado por quem concede, nunca deduzido: so
     * a loja sabe o que prometeu ao cliente.
     */
    coversWholeService: tinyint('covers_whole_service').notNull().default(1),

    // --- vigencia (itens 9, 10 e 35) ----------------------------------------
    startsOn: civilDate('starts_on').notNull(),
    /** ULTIMO dia coberto, inclusivo. */
    endsOn: civilDate('ends_on').notNull(),

    /**
     * `draft` | `active` | `cancelled` | `revoked`.
     *
     * NAO existe `expired`: vencer nao e algo que a garantia FAZ, e o que o
     * calendario faz com ela. A classificacao temporal e derivada (item 14).
     */
    status: varchar('status', { length: 20 }).notNull().default('draft'),

    // --- garantia de fabrica (item 5) ---------------------------------------
    manufacturer: varchar('manufacturer', { length: 160 }),
    externalReference: varchar('external_reference', { length: 120 }),

    // --- garantia de peca (itens 6, 40 e 41) --------------------------------
    partId: idRef('part_id'),
    /** SNAPSHOT: renomear a peca amanha nao reescreve a garantia de ontem. */
    partDescription: varchar('part_description', { length: 200 }),
    partCode: varchar('part_code', { length: 60 }),
    partQuantity: quantity('part_quantity'),
    installedOn: civilDate('installed_on'),
    /** O consumo que instalou a peca. Rastreabilidade, nunca dependencia. */
    stockMovementId: idRef('stock_movement_id'),
    /** Fornecedor da peca. Garantia de fornecedor NAO e a do cliente (item 43). */
    supplierId: idRef('supplier_id'),

    notes: text('notes'),

    /**
     * Chave do comando de EMISSAO (itens 56 e 60).
     *
     * NAO e `UNIQUE(service_order_id)`: a mesma OS pode legitimamente ter
     * garantia de mao de obra E garantia da peca instalada, com prazos
     * diferentes. O que nao pode e o mesmo comando criar duas.
     */
    idempotencyKey: varchar('idempotency_key', { length: 120 }),

    activatedAt: instant('activated_at'),
    activatedBy: idRef('activated_by'),
    cancelledAt: instant('cancelled_at'),
    cancelReason: text('cancel_reason'),

    version: int('version', { unsigned: true }).notNull().default(1),
    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_warranty_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_customer_tenant',
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** O equipamento tem de ser do MESMO tenant (item 36). */
    foreignKey({
      name: 'fk_warranty_equipment_tenant',
      columns: [table.equipmentId, table.tenantId],
      foreignColumns: [equipment.id, equipment.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** A OS de origem tem de ser da MESMA unidade que concedeu. */
    foreignKey({
      name: 'fk_warranty_service_order_unit',
      columns: [table.serviceOrderId, table.unitId],
      foreignColumns: [serviceOrders.id, serviceOrders.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_uses_policy_tenant',
      columns: [table.policyId, table.tenantId],
      foreignColumns: [warrantyPolicies.id, warrantyPolicies.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_part_tenant',
      columns: [table.partId, table.tenantId],
      foreignColumns: [parts.id, parts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_movement_tenant',
      columns: [table.stockMovementId, table.tenantId],
      foreignColumns: [stockMovements.id, stockMovements.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_supplier_tenant',
      columns: [table.supplierId, table.tenantId],
      foreignColumns: [suppliers.id, suppliers.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_warranty_tenant_number').on(table.tenantId, table.number),
    unique('uq_warranty_idempotency').on(table.tenantId, table.idempotencyKey),
    unique('uq_warranty_id_tenant').on(table.id, table.tenantId),

    index('ix_warranty_tenant_equipment').on(table.tenantId, table.equipmentId),
    index('ix_warranty_tenant_customer').on(table.tenantId, table.customerId),
    index('ix_warranty_tenant_service_order').on(table.tenantId, table.serviceOrderId),
    /** Sustenta "vigentes" e "proximas de vencer" sem varrer a tabela (item 114). */
    index('ix_warranty_tenant_status_ends').on(table.tenantId, table.status, table.endsOn),
    index('ix_warranty_tenant_type').on(table.tenantId, table.type),

    /**
     * A vigencia nao pode ser invertida.
     *
     * Compara duas colunas SIMPLES, nenhuma delas citada em FK com
     * `ON UPDATE CASCADE` — o MariaDB 10.11 responde erro 1901 nesse caso, e a
     * migration 0007 ja morreu uma vez por isso.
     */
    check('ck_warranty_period_ordered', sql`${table.startsOn} <= ${table.endsOn}`),
    check(
      'ck_warranty_duration_positive',
      sql`${table.durationAmount} >= 1 AND ${table.durationAmount} <= 120`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Itens de cobertura (itens 15 e 16)
// ---------------------------------------------------------------------------

export const warrantyCoverageItems = mysqlTable(
  'warranty_coverage_items',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    warrantyId: idRef('warranty_id').notNull(),

    /** `labor` | `service` | `part` | `component` | `other`. */
    kind: varchar('kind', { length: 20 }).notNull(),
    /** SNAPSHOT em portugues: "reparo da fonte", "placa principal". */
    description: varchar('description', { length: 200 }).notNull(),

    /** Quando a cobertura e de peca do catalogo. Opcional por construcao. */
    partId: idRef('part_id'),

    position: int('position', { unsigned: true }).notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_warranty_coverage_warranty_tenant',
      columns: [table.warrantyId, table.tenantId],
      foreignColumns: [warranties.id, warranties.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_coverage_part_tenant',
      columns: [table.partId, table.tenantId],
      foreignColumns: [parts.id, parts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    index('ix_warranty_coverage_warranty').on(table.warrantyId, table.position),
  ],
);

// ---------------------------------------------------------------------------
// Certificados (itens 18 a 21 e 55)
// ---------------------------------------------------------------------------

export const warrantyCertificates = mysqlTable(
  'warranty_certificates',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    warrantyId: idRef('warranty_id').notNull(),

    /**
     * REFERENCIA OPACA do certificado (item 21).
     *
     * E isto que o QR carrega — nunca CPF, telefone, e-mail, endereco nem o id
     * do cliente. Um QR impresso e uma imagem que qualquer pessoa na fila
     * fotografa, e o que estiver dentro dele vazou na hora da impressao. O
     * token tambem nao e sequencial: uma referencia enumeravel convida a
     * varrer a faixa inteira.
     */
    token: varchar('token', { length: 64 }).notNull(),

    /** `html` na V1. O formato e declarado, nao presumido (item 19). */
    format: varchar('format', { length: 10 }).notNull().default('html'),

    /**
     * O documento reconstruivel: snapshot do que estava valendo na emissao.
     *
     * Regerar o certificado le ISTO, nunca a politica atual (item 20).
     */
    snapshot: text('snapshot').notNull(),
    /** Impressao digital do snapshot; prova que o documento nao mudou. */
    checksum: varchar('checksum', { length: 64 }).notNull(),

    issuedAt: instant('issued_at').notNull(),
    issuedBy: idRef('issued_by'),

    /**
     * O ARQUIVO PDF (Prompt 13.1, itens 22, 25, 26 e 39).
     *
     * Tudo anulavel: o certificado existe sem PDF desde o Prompt 13, e os
     * historicos continuam validos sem reemissao (item 41). O PDF e artefato
     * DERIVADO do snapshot — pode ser gerado sob demanda e regerado se sumir.
     */
    pdfStorageKey: varchar('pdf_storage_key', { length: 255 }),
    pdfMimeType: varchar('pdf_mime_type', { length: 100 }),
    pdfByteSize: int('pdf_byte_size', { unsigned: true }),
    /**
     * SHA-256 dos BYTES do arquivo. Nao se confunde com `checksum`, que e o do
     * snapshot: um prova que o documento nao mudou, o outro prova que o
     * arquivo nao foi trocado (item 22).
     */
    pdfChecksum: varchar('pdf_checksum', { length: 64 }),
    /**
     * De QUAL snapshot este PDF saiu. E o que permite saber que o arquivo
     * guardado envelheceu quando o certificado e regerado (item 25) — sem
     * isso, o download entregaria os termos antigos em silencio.
     */
    pdfSnapshotChecksum: varchar('pdf_snapshot_checksum', { length: 64 }),
    pdfPageCount: int('pdf_page_count', { unsigned: true }),
    pdfGeneratedAt: instant('pdf_generated_at'),
    /** Renderizador e versao, para diagnosticar diferenca entre documentos. */
    pdfRenderer: varchar('pdf_renderer', { length: 60 }),

    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_warranty_certificate_warranty_tenant',
      columns: [table.warrantyId, table.tenantId],
      foreignColumns: [warranties.id, warranties.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_certificate_issued_by',
      columns: [table.issuedBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Um certificado por garantia: regerar substitui o conteudo, nao acumula. */
    unique('uq_warranty_certificate_warranty').on(table.warrantyId),
    /** O token e a chave de busca publica-restrita; tem de ser unico global. */
    unique('uq_warranty_certificate_token').on(table.token),
  ],
);

// ---------------------------------------------------------------------------
// Retornos (itens 22 a 26)
// ---------------------------------------------------------------------------

export const warrantyReturns = mysqlTable(
  'warranty_returns',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    warrantyId: idRef('warranty_id').notNull(),

    /**
     * A unidade que ATENDEU o retorno (item 38).
     *
     * Pode ser diferente da que concedeu: o cliente comprou da empresa e volta
     * na loja que lhe for conveniente. A unidade de origem continua gravada na
     * garantia, intocada — mudar a historia para caber no presente e o que
     * este par de colunas existe para impedir.
     */
    unitId: unitId().notNull(),

    equipmentId: idRef('equipment_id').notNull(),
    customerId: idRef('customer_id').notNull(),

    /** A OS que a garantia cobre. Historica: nunca reaberta (item 24). */
    originalServiceOrderId: idRef('original_service_order_id'),

    /**
     * A NOVA Ordem de Servico criada por este retorno (item 25).
     *
     * Nula quando o retorno foi registrado mas nao gerou OS de garantia — por
     * estar fora da cobertura, por garantia vencida, ou por ainda depender de
     * parecer. Registrar o retorno e um fato; criar a OS e outro.
     */
    returnServiceOrderId: idRef('return_service_order_id'),

    /**
     * O RELATO DE AGORA (item 82).
     *
     * Campo proprio, e nunca uma copia do relato da OS original. "Nao liga" e
     * "voltou a desligar depois de 20 minutos" sao queixas diferentes, e
     * sobrescrever a primeira com a segunda apagaria a unica evidencia de que
     * o defeito mudou.
     */
    customerReport: text('customer_report').notNull(),

    /** A data que DECIDE a vigencia. Do servidor, no fuso da empresa (item 34). */
    referenceDate: civilDate('reference_date').notNull(),

    /** `covered` | `not_covered` | `undetermined`. Decidido por pessoa (item 22). */
    coverageAssessment: varchar('coverage_assessment', { length: 20 }).notNull(),
    assessmentNotes: text('assessment_notes'),

    /** A garantia estava acionavel NO MOMENTO do retorno. Congelado. */
    wasEnforceable: tinyint('was_enforceable').notNull(),

    idempotencyKey: varchar('idempotency_key', { length: 120 }),

    registeredAt: instant('registered_at').notNull(),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_warranty_return_warranty_tenant',
      columns: [table.warrantyId, table.tenantId],
      foreignColumns: [warranties.id, warranties.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_return_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_return_equipment_tenant',
      columns: [table.equipmentId, table.tenantId],
      foreignColumns: [equipment.id, equipment.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_return_customer_tenant',
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** As duas OS sao tenant-safe pelo banco, nao por confianca (item 93). */
    foreignKey({
      name: 'fk_warranty_return_original_order_tenant',
      columns: [table.originalServiceOrderId, table.tenantId],
      foreignColumns: [serviceOrders.id, serviceOrders.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_return_new_order_tenant',
      columns: [table.returnServiceOrderId, table.tenantId],
      foreignColumns: [serviceOrders.id, serviceOrders.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /**
     * IDEMPOTENCIA DO RETORNO (item 57).
     *
     * A chave identifica o COMANDO, nao a garantia (item 59): a mesma garantia
     * pode ter varios retornos legitimos em datas diferentes, e transformar
     * isso em "so pode voltar uma vez" seria inventar uma regra comercial que
     * ninguem pediu. O que a chave impede e o duplo clique criar duas OS.
     */
    unique('uq_warranty_return_idempotency').on(table.tenantId, table.idempotencyKey),
    /** Uma OS de retorno pertence a UM retorno. */
    unique('uq_warranty_return_new_order').on(table.returnServiceOrderId),
    /** Alvo da FK composta de `warranty_costs`: mesmo tenant, sempre. */
    unique('uq_warranty_return_id_tenant').on(table.id, table.tenantId),

    index('ix_warranty_return_warranty').on(table.warrantyId, table.registeredAt),
    index('ix_warranty_return_tenant_unit').on(table.tenantId, table.unitId, table.registeredAt),
  ],
);

// ---------------------------------------------------------------------------
// Custos (itens 44 a 46 e 70)
// ---------------------------------------------------------------------------

export const warrantyCosts = mysqlTable(
  'warranty_costs',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    warrantyId: idRef('warranty_id').notNull(),
    /** O retorno que gerou o custo. Nulo para custo lancado direto na garantia. */
    warrantyReturnId: idRef('warranty_return_id'),
    /** A OS em que o trabalho aconteceu. */
    serviceOrderId: idRef('service_order_id'),

    /** `labor` | `part` | `outsourced` | `freight` | `other`. */
    kind: varchar('kind', { length: 20 }).notNull(),
    description: varchar('description', { length: 200 }).notNull(),

    /**
     * QUANTO CUSTOU — e isto NAO e pagamento (item 44).
     *
     * Nenhuma linha aqui cria titulo, movimenta caixa ou toca o razao. O
     * Financeiro nao sabe que este registro existe, porque nada financeiro
     * aconteceu: e a medida do que a garantia custou a loja.
     */
    amount: money('amount').notNull(),

    /** Quando derivado de consumo real do estoque, a origem fica rastreada. */
    stockMovementId: idRef('stock_movement_id'),
    partId: idRef('part_id'),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_warranty_cost_warranty_tenant',
      columns: [table.warrantyId, table.tenantId],
      foreignColumns: [warranties.id, warranties.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_cost_return_tenant',
      columns: [table.warrantyReturnId, table.tenantId],
      foreignColumns: [warrantyReturns.id, warrantyReturns.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_cost_order_tenant',
      columns: [table.serviceOrderId, table.tenantId],
      foreignColumns: [serviceOrders.id, serviceOrders.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_cost_movement_tenant',
      columns: [table.stockMovementId, table.tenantId],
      foreignColumns: [stockMovements.id, stockMovements.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_warranty_cost_part_tenant',
      columns: [table.partId, table.tenantId],
      foreignColumns: [parts.id, parts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    index('ix_warranty_cost_warranty').on(table.warrantyId),
    index('ix_warranty_cost_tenant_kind').on(table.tenantId, table.kind),

    check('ck_warranty_cost_non_negative', sql`${table.amount} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Linha do tempo (item 65)
// ---------------------------------------------------------------------------

export const warrantyTimeline = mysqlTable(
  'warranty_timeline',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    warrantyId: idRef('warranty_id').notNull(),

    kind: varchar('kind', { length: 40 }).notNull(),
    /** Em portugues, para quem abrir daqui a seis meses. */
    summary: varchar('summary', { length: 300 }).notNull(),
    /** Motivo escrito por pessoa, quando a acao exige justificativa. */
    reason: text('reason'),

    actorId: idRef('actor_id'),
    occurredAt: instant('occurred_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_warranty_timeline_warranty_tenant',
      columns: [table.warrantyId, table.tenantId],
      foreignColumns: [warranties.id, warranties.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    index('ix_warranty_timeline_warranty').on(table.warrantyId, table.occurredAt),
  ],
);

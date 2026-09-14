import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  text,
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
import { parts, stockLocations, stockMovements } from '@/modules/inventory/infrastructure/schema';
import { PURCHASE_ORDER_INITIAL_STATUS } from '@/modules/purchasing/domain/purchasing';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * Fornecedores e Compras (Prompt 11).
 *
 * OWNERSHIP (item 3):
 *
 *   suppliers                TENANT   de quem a empresa compra
 *   supplier_contacts        TENANT   via fornecedor
 *   supplier_parts           TENANT   o que cada fornecedor vende
 *   purchase_needs           UNIDADE  o que falta AQUI
 *   purchase_orders          UNIDADE  a compra para ESTA loja
 *   purchase_order_items     via pedido
 *   purchase_receipts        UNIDADE  o que chegou AQUI
 *   purchase_receipt_items   via recebimento
 *   purchase_price_history   TENANT   quanto se pagou, e quando
 *   purchase_order_timeline  via pedido
 *
 * O fornecedor e do TENANT porque a empresa negocia com ele, nao a loja:
 * duplica-lo por unidade criaria tres cadastros do mesmo distribuidor que
 * nenhum relatorio consegue somar. O PEDIDO e da unidade porque a mercadoria
 * chega em um endereco — e receber na loja errada e o erro que o modelo existe
 * para impedir (item 3.3).
 *
 * A DIRECAO DA DEPENDENCIA (item 49)
 *
 * Este arquivo importa `parts`, `stockLocations` e `stockMovements` do
 * Inventory. O Inventory NAO importa nada daqui, e nao pode: ele precisa
 * continuar funcionando com Compras desligado, mostrando "Origem: Compra
 * PC 000037" a partir do proprio `reference` do movimento (item 50).
 */

// ---------------------------------------------------------------------------
// Fornecedor (TENANT)
// ---------------------------------------------------------------------------

export const suppliers = mysqlTable(
  'suppliers',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    /** `company` ou `individual`. Fornecedor informal e pessoa fisica. */
    kind: varchar('kind', { length: 20 }).notNull().default('company'),

    /** Razao social, ou o nome de quem fornece quando nao ha empresa. */
    name: varchar('name', { length: 200 }).notNull(),
    nameSearch: varchar('name_search', { length: 200 }).notNull(),

    /** Nome fantasia. E por ele que a equipe chama o fornecedor. */
    tradeName: varchar('trade_name', { length: 200 }),
    tradeNameSearch: varchar('trade_name_search', { length: 200 }),

    /**
     * CPF ou CNPJ, OPCIONAL (item 4).
     *
     * So digitos, como em `customers`. Unico DENTRO DO TENANT quando informado
     * — nunca globalmente: duas empresas compram do mesmo distribuidor, e cada
     * uma tem o proprio cadastro dele.
     */
    documentType: varchar('document_type', { length: 8 }),
    documentDigits: varchar('document_digits', { length: 14 }),
    stateRegistration: varchar('state_registration', { length: 32 }),

    email: varchar('email', { length: 190 }),
    phone: varchar('phone', { length: 40 }),
    /** Digitos do telefone, para a busca do balcao encontrar como se digita. */
    phoneDigits: varchar('phone_digits', { length: 20 }),
    /**
     * O telefone tambem e WhatsApp. E DADO DE CONTATO, nao integracao: nao ha
     * envio de mensagem em lugar nenhum do sistema (item 4; Prompt 16).
     */
    phoneIsWhatsapp: int('phone_is_whatsapp', { unsigned: true }).notNull().default(0),

    website: varchar('website', { length: 200 }),

    // --- endereco, inline: o fornecedor tem um (item 4) ----------------------
    zipCode: varchar('zip_code', { length: 8 }),
    street: varchar('street', { length: 200 }),
    addressNumber: varchar('address_number', { length: 20 }),
    complement: varchar('complement', { length: 120 }),
    district: varchar('district', { length: 120 }),
    city: varchar('city', { length: 120 }),
    state: varchar('state', { length: 2 }),

    /**
     * Prazo medio INFORMADO pelo fornecedor, em dias.
     *
     * E o que ele promete. O prazo OBSERVADO sai de `purchase_price_history`,
     * comparando o pedido com o recebimento — e por isso os dois nao dividem
     * a mesma coluna.
     */
    leadTimeDays: int('lead_time_days', { unsigned: true }),

    /** Condicoes comerciais em TEXTO. Nao gera titulo nem vencimento (item 42). */
    commercialTerms: varchar('commercial_terms', { length: 400 }),

    notes: text('notes'),

    status: varchar('status', { length: 20 }).notNull().default('active'),

    version: int('version', { unsigned: true }).notNull().default(1),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_supplier_created_by_tenant',
      columns: [table.createdBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Documento unico na empresa quando informado; NULL nao colide. */
    unique('uq_supplier_tenant_document').on(table.tenantId, table.documentDigits),
    /** Alvo das FKs compostas das tabelas filhas. */
    unique('uq_supplier_id_tenant').on(table.id, table.tenantId),

    index('ix_supplier_tenant_name').on(table.tenantId, table.nameSearch),
    index('ix_supplier_tenant_status').on(table.tenantId, table.status, table.nameSearch),
    index('ix_supplier_tenant_trade_name').on(table.tenantId, table.tradeNameSearch),
    index('ix_supplier_tenant_phone').on(table.tenantId, table.phoneDigits),
  ],
);

/**
 * Contatos do fornecedor (item 4).
 *
 * Tabela propria, e nao colunas `commercial_contact` / `financial_contact`:
 * distribuidor tem vendedor, gerente e financeiro, e o vendedor muda. Duas
 * colunas fixas obrigariam a apagar um contato para registrar outro.
 */
export const supplierContacts = mysqlTable(
  'supplier_contacts',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    supplierId: idRef('supplier_id').notNull(),

    /** `commercial`, `financial`, `other`. Texto, para crescer sem migration. */
    role: varchar('role', { length: 20 }).notNull().default('commercial'),

    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 190 }),
    phone: varchar('phone', { length: 40 }),
    phoneDigits: varchar('phone_digits', { length: 20 }),
    notes: varchar('notes', { length: 300 }),

    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_supplier_contact_supplier_tenant',
      columns: [table.supplierId, table.tenantId],
      foreignColumns: [suppliers.id, suppliers.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    index('ix_supplier_contact_supplier').on(table.supplierId, table.role),
  ],
);

// ---------------------------------------------------------------------------
// Fornecedor x Peca (itens 6 e 7)
// ---------------------------------------------------------------------------

/**
 * O que cada fornecedor vende, e por quanto vendeu POR ULTIMO.
 *
 * ISTO NAO E TABELA DE PRECO (item 6). `last_unit_cost` e uma CONVENIENCIA de
 * tela — o preco de uma compra concluida e o do item do pedido, e o historico
 * inteiro vive em `purchase_price_history`. Tratar esta coluna como verdade
 * faria o sistema orcar com um preco que o fornecedor nao pratica mais.
 */
export const supplierParts = mysqlTable(
  'supplier_parts',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    supplierId: idRef('supplier_id').notNull(),
    partId: idRef('part_id').notNull(),

    /** Como o fornecedor chama a peca no catalogo dele. */
    supplierCode: varchar('supplier_code', { length: 60 }),
    supplierCodeNormalized: varchar('supplier_code_normalized', { length: 60 }),
    supplierDescription: varchar('supplier_description', { length: 200 }),

    /** Ultimo custo conhecido. Referencia, nunca autoridade. */
    lastUnitCost: money('last_unit_cost'),
    currency: varchar('currency', { length: 3 }).notNull().default('BRL'),
    lastPurchasedAt: instant('last_purchased_at'),

    leadTimeDays: int('lead_time_days', { unsigned: true }),
    minimumQuantity: quantity('minimum_quantity'),
    referenceUrl: varchar('reference_url', { length: 300 }),

    status: varchar('status', { length: 20 }).notNull().default('active'),

    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_supplier_part_supplier_tenant',
      columns: [table.supplierId, table.tenantId],
      foreignColumns: [suppliers.id, suppliers.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_supplier_part_part_tenant',
      columns: [table.partId, table.tenantId],
      foreignColumns: [parts.id, parts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Uma linha por par fornecedor/peca. */
    unique('uq_supplier_part').on(table.supplierId, table.partId),

    index('ix_supplier_part_part').on(table.tenantId, table.partId),
    index('ix_supplier_part_code').on(table.tenantId, table.supplierCodeNormalized),
  ],
);

/**
 * HISTORICO DE PRECO PAGO (itens 7 e 28).
 *
 * APPEND-ONLY, e uma linha por recebimento. Um recebimento novo NAO apaga o
 * preco anterior — e essa e a diferenca entre "historico de precos" e
 * "ultimo preco", que o item 96 proibe confundir.
 *
 * `observed_lead_time_days` e o prazo REAL: dias entre o pedido ser realizado
 * e a mercadoria chegar. E o dado que permitira, um dia, comparar o que o
 * fornecedor promete com o que ele cumpre — sem nenhuma inteligencia agora.
 */
export const purchasePriceHistory = mysqlTable(
  'purchase_price_history',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    supplierId: idRef('supplier_id').notNull(),
    partId: idRef('part_id').notNull(),
    unitId: unitId().notNull(),

    purchaseOrderId: idRef('purchase_order_id').notNull(),
    purchaseReceiptId: idRef('purchase_receipt_id').notNull(),

    quantity: quantity('quantity').notNull(),
    unitCost: money('unit_cost').notNull(),
    totalCost: money('total_cost').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('BRL'),

    /** Dias entre o pedido realizado e a chegada. Nulo se o pedido nao foi datado. */
    observedLeadTimeDays: int('observed_lead_time_days', { unsigned: true }),

    occurredAt: instant('occurred_at').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_price_history_supplier_tenant',
      columns: [table.supplierId, table.tenantId],
      foreignColumns: [suppliers.id, suppliers.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_price_history_part_tenant',
      columns: [table.partId, table.tenantId],
      foreignColumns: [parts.id, parts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** "Quanto pagamos nesta peca, e de quem?" — a consulta do comprador. */
    index('ix_price_history_part').on(table.tenantId, table.partId, table.occurredAt),
    index('ix_price_history_supplier').on(table.tenantId, table.supplierId, table.occurredAt),
  ],
);

// ---------------------------------------------------------------------------
// Necessidade de compra (UNIDADE)
// ---------------------------------------------------------------------------

/**
 * O QUE FALTA — e nao o que foi comprado (itens 8 e 10; ADR-048).
 *
 * Uma necessidade pode ser resolvida sem compra nenhuma: por transferencia
 * entre unidades, por uma reserva liberada, ou simplesmente esperando. Por
 * isso ela e uma entidade propria, com ciclo proprio, e nao um campo do pedido.
 */
export const purchaseNeeds = mysqlTable(
  'purchase_needs',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    /** Quem precisa. Necessidade tem lugar, como saldo tem lugar. */
    unitId: unitId().notNull(),
    partId: idRef('part_id').notNull(),

    quantity: quantity('quantity').notNull(),
    /** Quanto ja entrou em algum pedido. */
    orderedQuantity: quantity('ordered_quantity').notNull().default('0'),
    /** Quanto ja CHEGOU. E so isto que fecha a necessidade (item 30). */
    receivedQuantity: quantity('received_quantity').notNull().default('0'),

    /** `manual`, `service_order` ou `low_stock`. Texto, extensivel. */
    origin: varchar('origin', { length: 20 }).notNull().default('manual'),

    /** A OS que motivou. FK COMPOSTA com tenant E unidade. */
    serviceOrderId: idRef('service_order_id'),

    justification: varchar('justification', { length: 400 }),

    status: varchar('status', { length: 20 }).notNull().default('open'),

    version: int('version', { unsigned: true }).notNull().default(1),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_need_part_tenant',
      columns: [table.partId, table.tenantId],
      foreignColumns: [parts.id, parts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_need_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** A OS e da MESMA unidade da necessidade (item 79). Fato do banco. */
    foreignKey({
      name: 'fk_need_order_unit',
      columns: [table.serviceOrderId, table.unitId],
      foreignColumns: [serviceOrders.id, serviceOrders.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_need_id_tenant').on(table.id, table.tenantId),

    check('ck_need_quantity_positive', sql`\`quantity\` > 0`),
    check('ck_need_ordered_non_negative', sql`\`ordered_quantity\` >= 0`),
    check('ck_need_received_non_negative', sql`\`received_quantity\` >= 0`),

    index('ix_need_unit_status').on(table.tenantId, table.unitId, table.status),
    index('ix_need_part').on(table.tenantId, table.partId, table.status),
    index('ix_need_order').on(table.tenantId, table.serviceOrderId),
  ],
);

// ---------------------------------------------------------------------------
// Pedido de compra (TENANT + UNIDADE)
// ---------------------------------------------------------------------------

export const purchaseOrders = mysqlTable(
  'purchase_orders',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    /** Unidade de DESTINO. Obrigatoria: a mercadoria chega em algum lugar. */
    unitId: unitId().notNull(),
    supplierId: idRef('supplier_id').notNull(),

    /** Numero humano, unico por tenant. Vem de `tenant_sequences`. */
    number: int('number', { unsigned: true }).notNull(),

    status: varchar('status', { length: 30 }).notNull().default(PURCHASE_ORDER_INITIAL_STATUS),

    approvedAt: instant('approved_at'),
    approvedBy: idRef('approved_by'),
    /** Quando o pedido foi efetivamente feito ao fornecedor, fora do sistema. */
    placedAt: instant('placed_at'),
    placedBy: idRef('placed_by'),

    /** Previsao de entrega: DATA CIVIL no fuso da empresa (ADR-017). */
    expectedAt: civilDate('expected_at'),

    cancelledAt: instant('cancelled_at'),
    cancelReason: varchar('cancel_reason', { length: 300 }),

    // --- valores (item 15: nunca float) --------------------------------------
    subtotal: money('subtotal').notNull(),
    discount: money('discount').notNull(),
    freight: money('freight').notNull(),
    otherCosts: money('other_costs').notNull(),
    /** subtotal - desconto + frete + outras. Recalculado no backend. */
    total: money('total').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('BRL'),

    /**
     * DOCUMENTO DA COMPRA (item 40).
     *
     * Numero e data digitados por quem recebeu. NAO ha integracao fiscal:
     * nenhum XML, nenhuma SEFAZ, nenhuma validacao de NF-e. Chamar isto de
     * "nota fiscal eletronica integrada" seria mentira.
     */
    documentNumber: varchar('document_number', { length: 60 }),
    documentDate: civilDate('document_date'),

    /** Recado da equipe. Nao sai para o fornecedor. */
    internalNotes: text('internal_notes'),
    /** Texto destinado ao fornecedor. NAO e enviado por ninguem (item 85). */
    supplierNotes: text('supplier_notes'),

    version: int('version', { unsigned: true }).notNull().default(1),
    idempotencyKey: varchar('idempotency_key', { length: 80 }),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_purchase_order_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_purchase_order_supplier_tenant',
      columns: [table.supplierId, table.tenantId],
      foreignColumns: [suppliers.id, suppliers.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_purchase_order_created_by_tenant',
      columns: [table.createdBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_purchase_order_tenant_number').on(table.tenantId, table.number),
    unique('uq_purchase_order_idempotency').on(table.tenantId, table.idempotencyKey),
    unique('uq_purchase_order_id_tenant').on(table.id, table.tenantId),
    /**
     * Alvo da FK que impede receber um pedido da unidade A no estoque da B
     * (item 3.3). E a mesma tecnica de `uq_service_order_id_unit`.
     */
    unique('uq_purchase_order_id_unit').on(table.id, table.unitId),

    index('ix_purchase_order_unit_status').on(table.tenantId, table.unitId, table.status),
    index('ix_purchase_order_supplier').on(table.tenantId, table.supplierId, table.createdAt),
    index('ix_purchase_order_tenant_number').on(table.tenantId, table.number),
    index('ix_purchase_order_tenant_created').on(table.tenantId, table.createdAt),
  ],
);

/**
 * Item do pedido (itens 13 e 14).
 *
 * SNAPSHOT COMERCIAL, como no orcamento. Se a peca for renomeada, o codigo do
 * fornecedor mudar ou o preco de tabela for reajustado, o pedido antigo
 * continua historicamente correto — porque guarda os proprios numeros.
 *
 * `part_id` e OBRIGATORIO: o V1 e orientado ao catalogo (item 13). Item livre
 * nao entra, porque "entrada de estoque sem peca identificada" nao tem onde
 * virar saldo.
 */
export const purchaseOrderItems = mysqlTable(
  'purchase_order_items',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    purchaseOrderId: idRef('purchase_order_id').notNull(),
    partId: idRef('part_id').notNull(),

    // --- snapshot no momento do pedido ---------------------------------------
    description: varchar('description', { length: 200 }).notNull(),
    supplierCode: varchar('supplier_code', { length: 60 }),
    unitOfMeasure: varchar('unit_of_measure', { length: 20 }).notNull(),

    /** Quanto foi pedido. */
    quantity: quantity('quantity').notNull(),
    /** Quanto ja chegou. Nunca maior que `quantity` — CHECK no banco. */
    receivedQuantity: quantity('received_quantity').notNull().default('0'),

    unitCost: money('unit_cost').notNull(),
    total: money('total').notNull(),

    /** Necessidade que originou esta linha. Opcional e flexivel (item 29). */
    purchaseNeedId: idRef('purchase_need_id'),

    notes: varchar('notes', { length: 300 }),
    position: int('position', { unsigned: true }).notNull(),

    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_purchase_item_order_tenant',
      columns: [table.purchaseOrderId, table.tenantId],
      foreignColumns: [purchaseOrders.id, purchaseOrders.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_purchase_item_part_tenant',
      columns: [table.partId, table.tenantId],
      foreignColumns: [parts.id, parts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_purchase_item_need_tenant',
      columns: [table.purchaseNeedId, table.tenantId],
      foreignColumns: [purchaseNeeds.id, purchaseNeeds.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_purchase_item_id_tenant').on(table.id, table.tenantId),

    /**
     * A TRAVA DE OVER-RECEIPT, NO BANCO (itens 22 e 57).
     *
     * A aplicacao tambem verifica, e a condicao vai no `WHERE` do `UPDATE` que
     * incrementa — mas e esta CHECK que continua valendo no dia em que alguem
     * escrever um segundo caminho de gravacao.
     */
    check('ck_purchase_item_quantity_positive', sql`\`quantity\` > 0`),
    check('ck_purchase_item_received_non_negative', sql`\`received_quantity\` >= 0`),
    check('ck_purchase_item_no_over_receipt', sql`\`received_quantity\` <= \`quantity\``),
    check('ck_purchase_item_cost_non_negative', sql`\`unit_cost\` >= 0`),

    index('ix_purchase_item_order').on(table.purchaseOrderId, table.position),
    index('ix_purchase_item_part').on(table.tenantId, table.partId),
    index('ix_purchase_item_need').on(table.tenantId, table.purchaseNeedId),
  ],
);

// ---------------------------------------------------------------------------
// Recebimento (itens 19 a 23)
// ---------------------------------------------------------------------------

/**
 * O QUE CHEGOU, e quando.
 *
 * Um pedido tem N recebimentos — e por isso o recebimento parcial e natural e
 * nao uma excecao. Cada recebimento vira entrada de estoque pelo servico
 * oficial do Inventory, na MESMA transacao (item 54).
 */
export const purchaseReceipts = mysqlTable(
  'purchase_receipts',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    /** Redundante em relacao ao pedido, DE PROPOSITO: sustenta a FK composta. */
    unitId: unitId().notNull(),
    purchaseOrderId: idRef('purchase_order_id').notNull(),

    receivedAt: instant('received_at').notNull(),

    /** Nota/documento digitado por quem recebeu. Sem integracao fiscal. */
    documentNumber: varchar('document_number', { length: 60 }),
    documentDate: civilDate('document_date'),

    notes: varchar('notes', { length: 300 }),

    /**
     * A CHAVE QUE IMPEDE O DUPLO CLIQUE DE INFLAR O ESTOQUE (item 23).
     *
     * UNIQUE por tenant. A consulta previa transforma a colisao numa resposta
     * util; esta UNIQUE e a garantia final, inclusive no caso simultaneo, em
     * que as duas transacoes leem "nao existe" e a segunda quebra no INSERT —
     * fazendo rollback inteira, entrada de estoque incluida.
     */
    idempotencyKey: varchar('idempotency_key', { length: 80 }),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_receipt_order_tenant',
      columns: [table.purchaseOrderId, table.tenantId],
      foreignColumns: [purchaseOrders.id, purchaseOrders.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /**
     * O RECEBIMENTO E DA MESMA UNIDADE DO PEDIDO (item 3.3).
     *
     * Esta FK e o que torna "nao se recebe o pedido da loja A no estoque da
     * loja B" um fato do banco. Quem quiser mover depois usa transferencia,
     * que e o processo explicito do Prompt 10.
     */
    foreignKey({
      name: 'fk_receipt_order_unit',
      columns: [table.purchaseOrderId, table.unitId],
      foreignColumns: [purchaseOrders.id, purchaseOrders.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_receipt_created_by_tenant',
      columns: [table.createdBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_receipt_idempotency').on(table.tenantId, table.idempotencyKey),
    unique('uq_receipt_id_tenant').on(table.id, table.tenantId),

    index('ix_receipt_order').on(table.purchaseOrderId, table.receivedAt),
    index('ix_receipt_unit').on(table.tenantId, table.unitId, table.receivedAt),
  ],
);

/**
 * Linha do recebimento.
 *
 * `stock_movement_id` E A PONTE COM O ESTOQUE, e ela aponta DAQUI PARA LA
 * (item 48). A direcao importa: se `stock_movements` apontasse para o
 * recebimento, o Estoque passaria a depender de Compras — e o item 49 proibe
 * exatamente isso. Assim, desligar Compras nao quebra nenhuma FK do Estoque.
 */
export const purchaseReceiptItems = mysqlTable(
  'purchase_receipt_items',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    purchaseReceiptId: idRef('purchase_receipt_id').notNull(),
    purchaseOrderItemId: idRef('purchase_order_item_id').notNull(),
    partId: idRef('part_id').notNull(),

    quantity: quantity('quantity').notNull(),
    /** Custo do item do pedido, congelado no recebimento. */
    unitCost: money('unit_cost').notNull(),
    totalCost: money('total_cost').notNull(),

    /** Onde a mercadoria foi guardada. FK composta com a unidade. */
    locationId: idRef('location_id'),
    /** Redundante, para sustentar a FK composta da localizacao. */
    unitId: unitId().notNull(),

    /** A movimentacao de estoque que ESTA linha produziu. */
    stockMovementId: idRef('stock_movement_id').notNull(),

    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_receipt_item_receipt_tenant',
      columns: [table.purchaseReceiptId, table.tenantId],
      foreignColumns: [purchaseReceipts.id, purchaseReceipts.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_receipt_item_order_item_tenant',
      columns: [table.purchaseOrderItemId, table.tenantId],
      foreignColumns: [purchaseOrderItems.id, purchaseOrderItems.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_receipt_item_part_tenant',
      columns: [table.partId, table.tenantId],
      foreignColumns: [parts.id, parts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** A prateleira e da mesma unidade do recebimento (item 79). */
    foreignKey({
      name: 'fk_receipt_item_location_unit',
      columns: [table.locationId, table.unitId],
      foreignColumns: [stockLocations.id, stockLocations.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** A entrada de estoque que esta linha produziu, na mesma empresa. */
    foreignKey({
      name: 'fk_receipt_item_movement_tenant',
      columns: [table.stockMovementId, table.tenantId],
      foreignColumns: [stockMovements.id, stockMovements.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Uma linha de recebimento produz UMA movimentacao, e vice-versa. */
    unique('uq_receipt_item_movement').on(table.stockMovementId),

    check('ck_receipt_item_quantity_positive', sql`\`quantity\` > 0`),

    index('ix_receipt_item_receipt').on(table.purchaseReceiptId),
    index('ix_receipt_item_order_item').on(table.purchaseOrderItemId),
  ],
);

// ---------------------------------------------------------------------------
// Linha do tempo do pedido (item 45)
// ---------------------------------------------------------------------------

/**
 * APPEND-ONLY, e separada do AuditLog de propósito (item 44).
 *
 * Esta e a historia OPERACIONAL que quem acompanha a compra le: "recebimento
 * parcial 6/10". O AuditLog responde "quem autorizou e de onde", que e outra
 * pergunta, feita por outra pessoa, em outro momento.
 */
export const purchaseOrderTimeline = mysqlTable(
  'purchase_order_timeline',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    purchaseOrderId: idRef('purchase_order_id').notNull(),

    kind: varchar('kind', { length: 40 }).notNull(),
    summary: varchar('summary', { length: 300 }),
    /** Chaves tecnicas do fato. Sem dado pessoal. */
    metadata: json('metadata'),
    reason: varchar('reason', { length: 300 }),

    actorId: idRef('actor_id'),
    occurredAt: instant('occurred_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_purchase_timeline_order_tenant',
      columns: [table.purchaseOrderId, table.tenantId],
      foreignColumns: [purchaseOrders.id, purchaseOrders.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    index('ix_purchase_timeline_order').on(table.purchaseOrderId, table.occurredAt),
  ],
);

export type SupplierRow = typeof suppliers.$inferSelect;
export type SupplierContactRow = typeof supplierContacts.$inferSelect;
export type SupplierPartRow = typeof supplierParts.$inferSelect;
export type PurchaseNeedRow = typeof purchaseNeeds.$inferSelect;
export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderItemRow = typeof purchaseOrderItems.$inferSelect;
export type PurchaseReceiptRow = typeof purchaseReceipts.$inferSelect;
export type PurchaseReceiptItemRow = typeof purchaseReceiptItems.$inferSelect;
export type PurchasePriceHistoryRow = typeof purchasePriceHistory.$inferSelect;

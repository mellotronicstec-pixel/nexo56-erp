import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  int,
  mysqlTable,
  text,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import {
  actorColumns,
  id,
  idRef,
  instant,
  money,
  quantity,
  tenantId,
  timestamps,
  unitId,
} from '@/core/db/columns';
import { DEFAULT_UNIT_OF_MEASURE, TRANSFER_STATUSES } from '@/modules/inventory/domain/inventory';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * Estoque e Pecas (Prompt 10).
 *
 * OWNERSHIP — a matriz do item 162, escrita onde o modelo mora:
 *
 *   parts               TENANT   o que a peca E. Vale para todas as lojas.
 *   stock_locations     UNIDADE  prateleira e gaveta sao de um endereco.
 *   stock_balances      UNIDADE  quanto existe AQUI.
 *   stock_movements     UNIDADE  o que entrou e saiu AQUI.
 *   stock_reservations  UNIDADE  o que ja tem dono AQUI.
 *   stock_transfers     TENANT   com origem e destino UNIDADE.
 *
 * A peca e do tenant porque o catalogo e um vocabulario da empresa: cadastrar
 * "Tela LCD iPhone 11" tres vezes, uma por loja, criaria tres pecas que o
 * relatorio nao consegue somar e que a busca mostra em duplicata (itens 6
 * e 81). O SALDO e da unidade porque quantidade tem lugar: dizer que a empresa
 * tem 4 telas nao ajuda quem esta na loja que tem zero (item 7).
 */

// ---------------------------------------------------------------------------
// Catalogo (TENANT)
// ---------------------------------------------------------------------------

export const parts = mysqlTable(
  'parts',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    /** Codigo interno como a pessoa digitou. E o que aparece na etiqueta. */
    code: varchar('code', { length: 40 }).notNull(),
    /**
     * Forma compacta e maiuscula do codigo. E ELA que carrega a unicidade
     * por tenant (item 12): "tela 01" e "TELA-01" sao o mesmo codigo, e
     * deixar os dois entrarem criaria exatamente a duplicidade que a UNIQUE
     * deveria impedir.
     */
    codeNormalized: varchar('code_normalized', { length: 40 }).notNull(),

    name: varchar('name', { length: 120 }).notNull(),
    /** Chave de busca do nome: sem acento, minusculo, espacos colapsados. */
    nameSearch: varchar('name_search', { length: 160 }).notNull(),

    description: varchar('description', { length: 500 }),

    /** Fabricante/marca. Texto livre: nao ha catalogo de marcas (item 11). */
    brand: varchar('brand', { length: 80 }),
    brandSearch: varchar('brand_search', { length: 120 }),

    /**
     * Referencia do fabricante. SEM UNICIDADE (item 13): fabricantes
     * diferentes reutilizam o mesmo numero, e travar isso obrigaria a
     * inventar sufixos que nao existem na caixa.
     */
    partNumber: varchar('part_number', { length: 60 }),
    partNumberNormalized: varchar('part_number_normalized', { length: 60 }),

    /**
     * Codigo de barras. Opcional e SEM presumir EAN (item 14): fornecedor
     * pequeno imprime Code-128 com letras. Tambem sem unicidade — o mesmo
     * codigo de fabrica aparece em lotes distintos.
     *
     * NAO HA LEITOR (item 114). A coluna existe, a busca a alcanca, e o
     * scanner e de outro prompt.
     */
    barcode: varchar('barcode', { length: 64 }),
    barcodeNormalized: varchar('barcode_normalized', { length: 64 }),

    /** `unit`, `meter`, `gram`... Texto, para crescer sem migration (item 15). */
    unitOfMeasure: varchar('unit_of_measure', { length: 20 })
      .notNull()
      .default(DEFAULT_UNIT_OF_MEASURE),

    /**
     * Preco sugerido de venda (item 19). INFORMACAO COMERCIAL, e nada mais:
     * o preco que vale e o que foi aprovado no orcamento. Mudar isto nao mexe
     * em proposta nenhuma (item 42).
     */
    suggestedPrice: money('suggested_price'),

    /** Observacoes tecnicas. Texto de bancada, nao dado de cliente. */
    notes: text('notes'),

    status: varchar('status', { length: 20 }).notNull().default('active'),

    /** Concorrencia otimista, mesmo padrao da OS e do orcamento. */
    version: int('version', { unsigned: true }).notNull().default(1),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_part_created_by_tenant',
      columns: [table.createdBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Codigo interno unico na empresa (item 12). */
    unique('uq_part_tenant_code').on(table.tenantId, table.codeNormalized),
    /** Alvo das FKs compostas das tabelas de estoque. */
    unique('uq_part_id_tenant').on(table.id, table.tenantId),

    index('ix_part_tenant_name').on(table.tenantId, table.nameSearch),
    index('ix_part_tenant_status').on(table.tenantId, table.status, table.nameSearch),
    index('ix_part_tenant_part_number').on(table.tenantId, table.partNumberNormalized),
    index('ix_part_tenant_barcode').on(table.tenantId, table.barcodeNormalized),
    index('ix_part_tenant_brand').on(table.tenantId, table.brandSearch),
  ],
);

// ---------------------------------------------------------------------------
// Localizacoes (UNIDADE)
// ---------------------------------------------------------------------------

/**
 * LOCALIZACAO NAO E UNIDADE (item 10).
 *
 * Unidade e o estabelecimento; localizacao e onde, dentro dele, a peca esta.
 * Sao configuraveis porque cada loja organiza o proprio espaco — nao ha enum de
 * "prateleira/gaveta/bancada" (item 8), so nomes que a equipe escolheu.
 */
export const stockLocations = mysqlTable(
  'stock_locations',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    unitId: unitId().notNull(),

    name: varchar('name', { length: 80 }).notNull(),
    /** Codigo curto opcional, para etiquetar a prateleira. */
    code: varchar('code', { length: 30 }),
    codeNormalized: varchar('code_normalized', { length: 30 }),
    description: varchar('description', { length: 300 }),

    status: varchar('status', { length: 20 }).notNull().default('active'),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_stock_location_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Codigo unico DENTRO DA UNIDADE: "A1" da loja 1 nao e o da loja 2. */
    unique('uq_stock_location_unit_code').on(table.unitId, table.codeNormalized),
    unique('uq_stock_location_id_tenant').on(table.id, table.tenantId),
    /**
     * Alvo da FK composta que impede uma movimentacao da unidade A apontar
     * para a prateleira da unidade B (item 125).
     */
    unique('uq_stock_location_id_unit').on(table.id, table.unitId),

    index('ix_stock_location_unit').on(table.tenantId, table.unitId, table.status, table.name),
  ],
);

// ---------------------------------------------------------------------------
// Saldo (UNIDADE x PECA)
// ---------------------------------------------------------------------------

/**
 * SALDO MATERIALIZADO + LEDGER COMO HISTORIA (item 25; ADR-043).
 *
 * A alternativa — somar o ledger a cada leitura — e correta e inviavel: a lista
 * de pecas mostra saldo de 300 itens por pagina, e cada linha viraria um
 * `SUM()` sobre uma tabela que so cresce. Aqui o saldo e uma linha, atualizada
 * DENTRO da mesma transacao da movimentacao, e reconciliavel a qualquer momento
 * contra o ledger (`resulting_on_hand` guarda o saldo apos cada movimento).
 *
 * A materializacao so e segura porque a atualizacao e um UPDATE condicional
 * unico — ver ADR-044 e `stock-service.ts`. Ler, decidir em TypeScript e
 * gravar depois abriria a janela em que duas saidas simultaneas passam.
 */
export const stockBalances = mysqlTable(
  'stock_balances',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    unitId: unitId().notNull(),
    partId: idRef('part_id').notNull(),

    /** O que esta fisicamente na unidade, INCLUINDO o que ja tem dono. */
    onHand: quantity('on_hand').notNull().default('0'),
    /** Comprometido com alguma OS e ainda nao consumido. */
    reserved: quantity('reserved').notNull().default('0'),

    /** Estoque minimo POR PECA E POR UNIDADE (item 59). Zero = nao acompanhar. */
    minimumQuantity: quantity('minimum_quantity').notNull().default('0'),

    /**
     * Custo medio ponderado do que ha aqui (item 70). Por UNIDADE, porque cada
     * loja compra pelo preco que conseguiu. Nulo enquanto nenhuma entrada
     * informou custo — nao saber quanto custou nao e custar zero.
     */
    averageCost: money('average_cost'),

    /** Onde costuma ficar. Resumo para a listagem (item 92); nao trava nada. */
    primaryLocationId: idRef('primary_location_id'),

    /**
     * Quando o alerta de estoque baixo saiu (itens 62 e 63).
     *
     * E o que impede o job de republicar o mesmo alerta de hora em hora: so
     * emite se estiver nulo, e volta a nulo quando o disponivel sobe acima do
     * minimo. A condicao vai no `WHERE` do proprio UPDATE, entao duas
     * execucoes simultaneas do job nao emitem dois eventos.
     */
    lowStockAlertedAt: instant('low_stock_alerted_at'),

    version: int('version', { unsigned: true }).notNull().default(1),

    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_stock_balance_part_tenant',
      columns: [table.partId, table.tenantId],
      foreignColumns: [parts.id, parts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_stock_balance_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /**
     * A localizacao preferida e da MESMA unidade do saldo.
     *
     * `restrict` e nao `set null`: a FK e composta e inclui `unit_id`, que e
     * NOT NULL — o InnoDB recusa `SET NULL` nesse caso. Na pratica nao muda
     * nada, porque localizacao se inativa, nao se apaga.
     */
    foreignKey({
      name: 'fk_stock_balance_location_unit',
      columns: [table.primaryLocationId, table.unitId],
      foreignColumns: [stockLocations.id, stockLocations.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Um saldo por peca por unidade. E esta UNIQUE que torna o UPSERT seguro. */
    unique('uq_stock_balance_unit_part').on(table.unitId, table.partId),

    /**
     * AS INVARIANTES, NO BANCO (item 123).
     *
     * O dominio tambem verifica, para dar mensagem em portugues. Estas CHECKs
     * sao o que continua valendo quando alguem escrever um segundo caminho de
     * gravacao, ou rodar um UPDATE a mao numa madrugada.
     */
    check('ck_stock_balance_on_hand_non_negative', sql`\`on_hand\` >= 0`),
    check('ck_stock_balance_reserved_non_negative', sql`\`reserved\` >= 0`),
    check('ck_stock_balance_reserved_within_on_hand', sql`\`reserved\` <= \`on_hand\``),
    check('ck_stock_balance_minimum_non_negative', sql`\`minimum_quantity\` >= 0`),

    /** Listagem da unidade, ordenada e sem N+1 (item 99). */
    index('ix_stock_balance_unit').on(table.tenantId, table.unitId, table.partId),
    /** Varredura do job de estoque baixo (item 60). */
    index('ix_stock_balance_low_stock').on(table.tenantId, table.unitId, table.minimumQuantity),
  ],
);

// ---------------------------------------------------------------------------
// Ledger (UNIDADE) — APPEND-ONLY
// ---------------------------------------------------------------------------

/**
 * O LEDGER E APPEND-ONLY (itens 23 e 24).
 *
 * Nao ha `updated_at` e nao ha `version` nesta tabela, e isso e proposital: a
 * ausencia das colunas e a primeira barreira contra alguem "corrigir" um
 * lancamento. Correcao se faz com movimentacao COMPENSATORIA — um ajuste, com
 * motivo, que qualquer um consegue ler depois.
 *
 * A aplicacao nunca executa UPDATE nem DELETE aqui; o teste de arquitetura
 * `inventory-ledger-boundary.test.ts` falha se algum arquivo passar a executar.
 */
export const stockMovements = mysqlTable(
  'stock_movements',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    unitId: unitId().notNull(),
    partId: idRef('part_id').notNull(),
    /** Onde estava/onde foi parar. Opcional: nem toda loja usa localizacao. */
    locationId: idRef('location_id'),

    /** `receipt`, `issue`, `adjustment_in`, `adjustment_out`, `transfer_*`. */
    type: varchar('type', { length: 20 }).notNull(),

    /**
     * Quantidade COM SINAL (item 21): +5 entrou, -2 saiu. Guardar o sinal, e
     * nao so o modulo, faz a reconciliacao ser uma soma — e nao um `CASE` que
     * precisa conhecer cada tipo de movimento que vier a existir.
     */
    quantity: quantity('quantity').notNull(),

    /**
     * Saldo fisico da peca na unidade DEPOIS deste movimento.
     *
     * E o que torna o saldo materializado RECONCILIAVEL sem recalcular a
     * tabela inteira: basta comparar o ultimo movimento com `stock_balances`.
     */
    resultingOnHand: quantity('resulting_on_hand').notNull(),

    /** Custo daquela movimentacao. Congelado: mudar o custo da peca nao o altera. */
    unitCost: money('unit_cost'),
    totalCost: money('total_cost'),

    /** `manual`, `service_order` ou `transfer` (item 77). */
    originKind: varchar('origin_kind', { length: 20 }).notNull(),
    /** Texto livre de nota, pedido do fornecedor, nome de quem trouxe. */
    reference: varchar('reference', { length: 120 }),
    /** Obrigatorio em ajuste (item 55). Texto de pessoa. */
    reason: varchar('reason', { length: 300 }),

    /** A OS que consumiu a peca (item 43). FK COMPOSTA com tenant E unidade. */
    serviceOrderId: idRef('service_order_id'),
    /** A transferencia que produziu este par de movimentos (item 51). */
    transferId: idRef('transfer_id'),
    /** A reserva consumida, quando a saida veio de uma (item 105). */
    reservationId: idRef('reservation_id'),

    /** Mesmo comando nao lanca duas vezes (itens 119 a 121). */
    idempotencyKey: varchar('idempotency_key', { length: 80 }),

    actorId: idRef('actor_id'),
    occurredAt: instant('occurred_at').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_stock_movement_part_tenant',
      columns: [table.partId, table.tenantId],
      foreignColumns: [parts.id, parts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_stock_movement_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** A prateleira e da mesma unidade do movimento (item 125). */
    foreignKey({
      name: 'fk_stock_movement_location_unit',
      columns: [table.locationId, table.unitId],
      foreignColumns: [stockLocations.id, stockLocations.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /**
     * A OS e da MESMA UNIDADE do movimento (itens 34, 35 e 127).
     *
     * Esta FK e o que torna "a OS da unidade A nao consome o estoque da
     * unidade B" um fato do banco, e nao uma promessa da aplicacao.
     */
    foreignKey({
      name: 'fk_stock_movement_order_unit',
      columns: [table.serviceOrderId, table.unitId],
      foreignColumns: [serviceOrders.id, serviceOrders.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_stock_movement_actor_tenant',
      columns: [table.actorId, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Retry nao lanca o mesmo movimento duas vezes (item 121). */
    unique('uq_stock_movement_idempotency').on(table.tenantId, table.idempotencyKey),

    /** Ficha da peca: movimentos daquela peca naquela unidade (item 68). */
    index('ix_stock_movement_part').on(
      table.tenantId,
      table.unitId,
      table.partId,
      table.occurredAt,
    ),
    /** O que esta OS consumiu (item 69). */
    index('ix_stock_movement_order').on(table.tenantId, table.serviceOrderId),
    index('ix_stock_movement_transfer').on(table.transferId),
    index('ix_stock_movement_unit_occurred').on(table.tenantId, table.unitId, table.occurredAt),
  ],
);

// ---------------------------------------------------------------------------
// Reservas (UNIDADE)
// ---------------------------------------------------------------------------

/**
 * Reserva de peca para uma Ordem de Servico (itens 33 a 35).
 *
 * Entidade propria, e nao um tipo de movimentacao: reservar nao tira nada da
 * prateleira, so declara que aquilo ja tem dono. Quem soma `reserved` e o
 * saldo; esta tabela diz DE QUEM e a reserva.
 */
export const stockReservations = mysqlTable(
  'stock_reservations',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    unitId: unitId().notNull(),
    partId: idRef('part_id').notNull(),

    /** Toda reserva tem dono, e o dono e uma OS da mesma unidade (item 34). */
    serviceOrderId: idRef('service_order_id').notNull(),

    /** Total reservado ao longo da vida da reserva. */
    quantity: quantity('quantity').notNull(),
    /** Quanto virou consumo fisico (item 105). */
    consumedQuantity: quantity('consumed_quantity').notNull().default('0'),
    /** Quanto voltou ao disponivel sem ser usado (item 104). */
    releasedQuantity: quantity('released_quantity').notNull().default('0'),

    status: varchar('status', { length: 20 }).notNull().default('open'),

    notes: varchar('notes', { length: 300 }),

    version: int('version', { unsigned: true }).notNull().default(1),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_stock_reservation_part_tenant',
      columns: [table.partId, table.tenantId],
      foreignColumns: [parts.id, parts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_stock_reservation_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** A OS e da mesma unidade da reserva (item 35). Fato do banco. */
    foreignKey({
      name: 'fk_stock_reservation_order_unit',
      columns: [table.serviceOrderId, table.unitId],
      foreignColumns: [serviceOrders.id, serviceOrders.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_stock_reservation_id_tenant').on(table.id, table.tenantId),

    /** Nao se consome nem se libera mais do que se reservou. */
    check(
      'ck_stock_reservation_within_quantity',
      sql`\`consumed_quantity\` + \`released_quantity\` <= \`quantity\``,
    ),
    check('ck_stock_reservation_quantity_positive', sql`\`quantity\` > 0`),
    check('ck_stock_reservation_consumed_non_negative', sql`\`consumed_quantity\` >= 0`),
    check('ck_stock_reservation_released_non_negative', sql`\`released_quantity\` >= 0`),

    /** Reservas abertas de uma OS (ficha da OS) e de uma peca (ficha da peca). */
    index('ix_stock_reservation_order').on(table.tenantId, table.serviceOrderId, table.status),
    index('ix_stock_reservation_part').on(table.tenantId, table.unitId, table.partId, table.status),
  ],
);

// ---------------------------------------------------------------------------
// Transferencias (TENANT, com origem e destino UNIDADE)
// ---------------------------------------------------------------------------

/**
 * A transferencia tem IDENTIDADE PROPRIA (item 51).
 *
 * Sem esta linha, transferir seria "uma saida aqui e uma entrada ali" — duas
 * movimentacoes que ninguem consegue correlacionar depois, e que um retry
 * duplicaria pela metade. Com ela, os dois movimentos apontam para o mesmo
 * `transfer_id`, e a chave de idempotencia protege o par inteiro.
 *
 * A tabela e do TENANT porque a transferencia nao pertence a nenhuma das duas
 * lojas — ela atravessa as duas. Cross-tenant e impossivel: as FKs compostas
 * amarram origem e destino ao mesmo `tenant_id` (item 54).
 */
export const stockTransfers = mysqlTable(
  'stock_transfers',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    /** Numero humano, unico por tenant. Vem de `tenant_sequences`. */
    number: int('number', { unsigned: true }).notNull(),

    fromUnitId: idRef('from_unit_id').notNull(),
    toUnitId: idRef('to_unit_id').notNull(),

    partId: idRef('part_id').notNull(),
    quantity: quantity('quantity').notNull(),

    /**
     * Sempre `completed` na V1 (item 53). A coluna existe para o dia em que
     * houver conferencia no destino; acrescentar `in_transit` sera aditivo.
     */
    status: varchar('status', { length: 20 }).notNull().default(TRANSFER_STATUSES[0]),

    notes: varchar('notes', { length: 300 }),

    idempotencyKey: varchar('idempotency_key', { length: 80 }),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_stock_transfer_from_unit_tenant',
      columns: [table.fromUnitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_stock_transfer_to_unit_tenant',
      columns: [table.toUnitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_stock_transfer_part_tenant',
      columns: [table.partId, table.tenantId],
      foreignColumns: [parts.id, parts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_stock_transfer_created_by_tenant',
      columns: [table.createdBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_stock_transfer_tenant_number').on(table.tenantId, table.number),
    /** Retry nao transfere duas vezes (item 121). */
    unique('uq_stock_transfer_idempotency').on(table.tenantId, table.idempotencyKey),

    /**
     * Origem != destino NAO E UMA CHECK, e a razao e do MariaDB.
     *
     * O 10.11 recusa (erro 1901) criar uma FOREIGN KEY com `ON UPDATE CASCADE`
     * sobre uma coluna citada em CHECK que compara duas colunas: um cascade
     * nao consegue reavaliar a expressao. Entre manter a CHECK e manter as FKs
     * compostas que tornam o cruzamento de empresas impossivel (item 54), as
     * FKs valem mais — elas protegem o isolamento, que e o invariante grave.
     *
     * Origem diferente de destino fica com `assertTransferUnits` no dominio,
     * testada em `inventory-domain.test.ts` e em `inventory.test.ts`. E uma
     * regra de digitacao, nao um risco de vazamento entre empresas.
     */
    check('ck_stock_transfer_quantity_positive', sql`\`quantity\` > 0`),

    index('ix_stock_transfer_from').on(table.tenantId, table.fromUnitId, table.createdAt),
    index('ix_stock_transfer_to').on(table.tenantId, table.toUnitId, table.createdAt),
    index('ix_stock_transfer_part').on(table.tenantId, table.partId),
  ],
);

export type PartRow = typeof parts.$inferSelect;
export type StockLocationRow = typeof stockLocations.$inferSelect;
export type StockBalanceRow = typeof stockBalances.$inferSelect;
export type StockMovementRow = typeof stockMovements.$inferSelect;
export type StockReservationRow = typeof stockReservations.$inferSelect;
export type StockTransferRow = typeof stockTransfers.$inferSelect;

import { sql } from 'drizzle-orm';
import {
  check,
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
  money,
  tenantId,
  timestamps,
  unitId,
} from '@/core/db/columns';
import { customers } from '@/modules/customers/infrastructure/schema';
import {
  purchaseOrders,
  purchaseReceipts,
  suppliers,
} from '@/modules/purchasing/infrastructure/schema';
import { quotes } from '@/modules/quotes/infrastructure/schema';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * SCHEMA DO FINANCEIRO (Prompt 12).
 *
 * Nove tabelas, e a separacao entre elas e o produto principal deste prompt:
 *
 *   financial_accounts      ONDE o dinheiro fica
 *   payment_methods         COMO o dinheiro se moveu
 *   financial_categories    POR QUE o dinheiro se moveu
 *   financial_titles        a OBRIGACAO (direito ou dever)
 *   financial_installments  QUANDO cada pedaco vence
 *   financial_settlements   o FATO de ter recebido ou pago
 *   financial_movements     o LEDGER append-only
 *   cash_sessions           a gaveta do balcao, aberta e fechada
 *   financial_title_timeline a historia do titulo, em portugues
 *
 * FORMA DE PAGAMENTO NAO E CONTA FINANCEIRA, e sao duas tabelas por isso: "PIX
 * recebido no Itau" e uma forma e uma conta, e uma tabela so nao responderia
 * nem "quanto entrou por PIX" nem "quanto tem no banco".
 *
 * NADA AQUI E CONTABILIDADE. Nao ha partida dobrada, plano de contas nem
 * competencia: o ledger responde "quanto entrou e saiu de cada conta, e por
 * causa de que", e so.
 */

// ---------------------------------------------------------------------------
// Contas financeiras (itens 16 a 18)
// ---------------------------------------------------------------------------

export const financialAccounts = mysqlTable(
  'financial_accounts',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),

    /**
     * UNIDADE OPCIONAL, e a ausencia e uma decisao (item 4).
     *
     * `NULL` = conta da EMPRESA, compartilhada por todas as unidades: e o caso
     * normal de conta bancaria. Preenchido = conta operada por UMA loja, e e o
     * caso normal do caixa do balcao — a gaveta da loja Centro nao e a gaveta
     * da loja Norte, e somar as duas num numero so nao responderia pergunta
     * nenhuma.
     */
    unitId: unitId(),

    name: varchar('name', { length: 120 }).notNull(),
    nameSearch: varchar('name_search', { length: 120 }).notNull(),

    /** `cash` `bank` `digital_wallet` `clearing` `other`. Organiza, nao decide. */
    kind: varchar('kind', { length: 20 }).notNull().default('cash'),

    /**
     * SALDO MATERIALIZADO, e reconciliavel (item 18).
     *
     * Atualizado na MESMA transacao de cada movimento. A verdade historica
     * continua sendo `financial_movements`; esta coluna e uma projecao, e
     * `reconcileAccountBalance()` recalcula a partir do ledger para provar que
     * as duas batem. Nunca ha `UPDATE ... SET balance = X` sem movimento.
     */
    currentBalance: money('current_balance').notNull().default('0'),

    description: varchar('description', { length: 300 }),
    status: varchar('status', { length: 20 }).notNull().default('active'),

    version: int('version', { unsigned: true }).notNull().default(1),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_fin_account_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Quando a conta e de uma unidade, ela e da MESMA empresa. */
    foreignKey({
      name: 'fk_fin_account_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_fin_account_tenant_name').on(table.tenantId, table.nameSearch),
    /** Alvo das FKs compostas: conta de outra empresa nao entra em liquidacao. */
    unique('uq_fin_account_id_tenant').on(table.id, table.tenantId),

    index('ix_fin_account_tenant_status').on(table.tenantId, table.status, table.kind),
  ],
);

// ---------------------------------------------------------------------------
// Formas de pagamento (item 19)
// ---------------------------------------------------------------------------

export const paymentMethods = mysqlTable(
  'payment_methods',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),

    /** Do catalogo do dominio: `cash`, `pix`, `credit_card`... */
    kind: varchar('kind', { length: 20 }).notNull(),
    /** O nome que a loja usa. "Cartao Cielo" continua sendo `credit_card`. */
    name: varchar('name', { length: 80 }).notNull(),
    nameSearch: varchar('name_search', { length: 80 }).notNull(),

    status: varchar('status', { length: 20 }).notNull().default('active'),
    position: int('position', { unsigned: true }).notNull().default(0),

    version: int('version', { unsigned: true }).notNull().default(1),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_payment_method_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_payment_method_tenant_name').on(table.tenantId, table.nameSearch),
    unique('uq_payment_method_id_tenant').on(table.id, table.tenantId),

    index('ix_payment_method_tenant_status').on(table.tenantId, table.status, table.position),
  ],
);

// ---------------------------------------------------------------------------
// Categorias financeiras (item 28)
// ---------------------------------------------------------------------------

export const financialCategories = mysqlTable(
  'financial_categories',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),

    /** `revenue` ou `expense`. Categoria de receita nao entra em conta a pagar. */
    kind: varchar('kind', { length: 20 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    nameSearch: varchar('name_search', { length: 120 }).notNull(),

    status: varchar('status', { length: 20 }).notNull().default('active'),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_fin_category_tenant',
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_fin_category_tenant_kind_name').on(table.tenantId, table.kind, table.nameSearch),
    unique('uq_fin_category_id_tenant').on(table.id, table.tenantId),
  ],
);

// ---------------------------------------------------------------------------
// Titulos (itens 6, 7, 8 e 10)
// ---------------------------------------------------------------------------

export const financialTitles = mysqlTable(
  'financial_titles',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),

    /**
     * A UNIDADE E OBRIGATORIA, e nao e detalhe (item 4).
     *
     * A obrigacao nasceu da operacao de UMA loja: a cobranca daquele
     * atendimento, a mercadoria que chegou naquele endereco, a conta de luz
     * daquele ponto. Titulo sem lugar impediria o corte por unidade que o
     * resto do sistema mantem desde o Prompt 07.
     */
    unitId: unitId().notNull(),

    /**
     * `receivable` ou `payable` — a unica palavra que decide se dinheiro entra
     * ou sai (ADR-053).
     */
    direction: varchar('direction', { length: 12 }).notNull(),

    /** `CR 000123` / `CP 000045`. Sequencia por tenant e por direcao. */
    number: int('number', { unsigned: true }).notNull(),

    /** `customer`, `supplier` ou `other`. A CHECK abaixo cola isto na direcao. */
    counterpartyKind: varchar('counterparty_kind', { length: 12 }).notNull(),
    customerId: idRef('customer_id'),
    supplierId: idRef('supplier_id'),
    /** Beneficiario sem cadastro: a conta de luz, o motoboy avulso (item 7). */
    payeeName: varchar('payee_name', { length: 200 }),

    description: varchar('description', { length: 200 }).notNull(),
    categoryId: idRef('category_id'),

    /** `manual`, `service_order` ou `purchase_receipt`. */
    origin: varchar('origin', { length: 24 }).notNull().default('manual'),
    /**
     * A CHAVE QUE IMPEDE DUPLICAR (item 38).
     *
     * `service_order:<id>` ou `purchase_receipt:<id>`, UNIQUE por tenant.
     * Repetir a acao — duplo clique, retry, duas pessoas juntas — REENCONTRA o
     * titulo. Titulo manual tem `NULL` aqui de proposito: duas contas de luz
     * no mesmo mes sao dois fatos legitimos.
     */
    originKey: varchar('origin_key', { length: 96 }),

    serviceOrderId: idRef('service_order_id'),
    quoteId: idRef('quote_id'),
    purchaseOrderId: idRef('purchase_order_id'),
    purchaseReceiptId: idRef('purchase_receipt_id'),

    /** O valor da obrigacao. Congelado depois da primeira liquidacao (item 73). */
    amount: money('amount').notNull(),
    /**
     * PROJECAO do que ja foi liquidado (item 6).
     *
     * Reconciliavel: `reconcileTitle()` recalcula somando as liquidacoes
     * confirmadas. O saldo em aberto e `amount - settled_amount`, e nao existe
     * como coluna — uma diferenca calculada nao tem como divergir de si mesma.
     */
    settledAmount: money('settled_amount').notNull().default('0'),

    issuedAt: civilDate('issued_at').notNull(),
    /** Vencimento da PRIMEIRA parcela. O que vale por parcela esta na parcela. */
    dueDate: civilDate('due_date').notNull(),
    installmentCount: int('installment_count', { unsigned: true }).notNull().default(1),

    /** `open` `partially_settled` `settled` `cancelled`. "Vencido" e derivado. */
    status: varchar('status', { length: 24 }).notNull().default('open'),
    cancelReason: varchar('cancel_reason', { length: 300 }),
    cancelledAt: instant('cancelled_at'),

    notes: text('notes'),

    version: int('version', { unsigned: true }).notNull().default(1),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_fin_title_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_fin_title_customer_tenant',
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_fin_title_supplier_tenant',
      columns: [table.supplierId, table.tenantId],
      foreignColumns: [suppliers.id, suppliers.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_fin_title_category_tenant',
      columns: [table.categoryId, table.tenantId],
      foreignColumns: [financialCategories.id, financialCategories.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /**
     * A OS e da MESMA unidade do titulo. Fato do banco, e nao checagem de
     * aplicacao: cobrar na loja Norte um atendimento da loja Centro quebraria
     * o fechamento das duas.
     */
    foreignKey({
      name: 'fk_fin_title_service_order_unit',
      columns: [table.serviceOrderId, table.unitId],
      foreignColumns: [serviceOrders.id, serviceOrders.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_fin_title_quote_tenant',
      columns: [table.quoteId, table.tenantId],
      foreignColumns: [quotes.id, quotes.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_fin_title_purchase_order_unit',
      columns: [table.purchaseOrderId, table.unitId],
      foreignColumns: [purchaseOrders.id, purchaseOrders.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_fin_title_purchase_receipt_tenant',
      columns: [table.purchaseReceiptId, table.tenantId],
      foreignColumns: [purchaseReceipts.id, purchaseReceipts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_fin_title_tenant_direction_number').on(
      table.tenantId,
      table.direction,
      table.number,
    ),
    /** A trava de duplicacao por origem (item 38). */
    unique('uq_fin_title_origin_key').on(table.tenantId, table.originKey),
    unique('uq_fin_title_id_tenant').on(table.id, table.tenantId),
    unique('uq_fin_title_id_unit').on(table.id, table.unitId),

    /**
     * A CONTRAPARTE COMBINA COM A DIRECAO (item 8).
     *
     * Conta a receber tem cliente; conta a pagar tem fornecedor ou beneficiario
     * textual. A CHECK compara duas colunas comuns — e nao colunas de FK — de
     * proposito: o MariaDB 10.11 recusa `ON UPDATE CASCADE` em coluna citada
     * numa CHECK que compara colunas (erro 1901), e foi assim que o Prompt 10
     * perdeu meia migration. Aqui a invariante fica no banco sem custar as FKs.
     */
    check(
      'ck_fin_title_counterparty_direction',
      sql`(\`direction\` = 'receivable' AND \`counterparty_kind\` = 'customer')
          OR (\`direction\` = 'payable' AND \`counterparty_kind\` IN ('supplier', 'other'))`,
    ),
    check('ck_fin_title_amount_positive', sql`\`amount\` > 0`),
    check('ck_fin_title_settled_non_negative', sql`\`settled_amount\` >= 0`),
    /** SEM OVER-SETTLEMENT, no banco (item 12). */
    check('ck_fin_title_no_over_settlement', sql`\`settled_amount\` <= \`amount\``),
    check('ck_fin_title_installments_positive', sql`\`installment_count\` > 0`),

    index('ix_fin_title_unit_direction_status').on(
      table.tenantId,
      table.unitId,
      table.direction,
      table.status,
    ),
    index('ix_fin_title_due').on(table.tenantId, table.direction, table.status, table.dueDate),
    index('ix_fin_title_customer').on(table.tenantId, table.customerId, table.status),
    index('ix_fin_title_supplier').on(table.tenantId, table.supplierId, table.status),
    index('ix_fin_title_service_order').on(table.tenantId, table.serviceOrderId),
    index('ix_fin_title_purchase_order').on(table.tenantId, table.purchaseOrderId),
  ],
);

// ---------------------------------------------------------------------------
// Parcelas (item 9)
// ---------------------------------------------------------------------------

/**
 * TODO TITULO TEM PELO MENOS UMA PARCELA.
 *
 * Nao existe "titulo sem parcelamento": a vista e uma parcela de 1/1. Isso
 * elimina o ramo "as vezes parcelado, as vezes nao" de toda consulta, de todo
 * calculo de vencimento e de toda tela — e ramos que so existem as vezes sao
 * exatamente onde o erro se esconde.
 */
export const financialInstallments = mysqlTable(
  'financial_installments',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    unitId: unitId().notNull(),
    titleId: idRef('title_id').notNull(),

    /** 1..n. `1/3` e o que a pessoa le. */
    number: int('number', { unsigned: true }).notNull(),

    amount: money('amount').notNull(),
    settledAmount: money('settled_amount').notNull().default('0'),

    /** DATA CIVIL: vencimento e dia de calendario, nao instante (item 46). */
    dueDate: civilDate('due_date').notNull(),

    status: varchar('status', { length: 24 }).notNull().default('open'),

    version: int('version', { unsigned: true }).notNull().default(1),

    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_fin_installment_title_tenant',
      columns: [table.titleId, table.tenantId],
      foreignColumns: [financialTitles.id, financialTitles.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_fin_installment_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_fin_installment_title_number').on(table.titleId, table.number),
    unique('uq_fin_installment_id_tenant').on(table.id, table.tenantId),

    check('ck_fin_installment_amount_positive', sql`\`amount\` > 0`),
    check('ck_fin_installment_settled_non_negative', sql`\`settled_amount\` >= 0`),
    /** A trava de over-settlement por PARCELA, no banco (item 12). */
    check('ck_fin_installment_no_over_settlement', sql`\`settled_amount\` <= \`amount\``),

    index('ix_fin_installment_due').on(table.tenantId, table.status, table.dueDate),
    index('ix_fin_installment_unit_due').on(table.tenantId, table.unitId, table.dueDate),
  ],
);

// ---------------------------------------------------------------------------
// Liquidacoes (item 13)
// ---------------------------------------------------------------------------

/**
 * O FATO DE TER RECEBIDO OU PAGO.
 *
 * Uma liquidacao nunca e apagada (item 74). Estornar marca `status` como
 * `reversed` e cria o CONTRAMOVIMENTO no ledger — o valor, a data e a conta
 * originais continuam legiveis para sempre, porque foram verdade um dia.
 */
export const financialSettlements = mysqlTable(
  'financial_settlements',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    unitId: unitId().notNull(),

    titleId: idRef('title_id').notNull(),
    installmentId: idRef('installment_id').notNull(),
    /** Redundante com o titulo, e util: evita join so para saber o sentido. */
    direction: varchar('direction', { length: 12 }).notNull(),

    amount: money('amount').notNull(),
    /** DATA CIVIL: o dia em que o dinheiro se moveu, no fuso da empresa. */
    effectiveDate: civilDate('effective_date').notNull(),

    financialAccountId: idRef('financial_account_id').notNull(),
    paymentMethodId: idRef('payment_method_id').notNull(),
    /** So cartao de credito (item 20). Informativo; nao gera agenda de recebiveis. */
    cardInstallments: int('card_installments', { unsigned: true }),

    /**
     * REFERENCIA TEXTUAL, e nada alem disso (item 109).
     *
     * Numero de autorizacao, identificador do PIX, numero do comprovante. E
     * PROIBIDO guardar numero completo de cartao, CVV, senha ou token de
     * adquirente: nao ha infraestrutura PCI neste sistema, e guardar esses
     * dados sem ela seria assumir um risco que o produto nao cobre.
     */
    reference: varchar('reference', { length: 120 }),
    notes: varchar('notes', { length: 300 }),

    /** A sessao de caixa aberta quando o dinheiro passou pela gaveta. */
    cashSessionId: idRef('cash_session_id'),

    /** `confirmed` ou `reversed`. Nunca some, nunca e editada. */
    status: varchar('status', { length: 20 }).notNull().default('confirmed'),
    reversedAt: instant('reversed_at'),
    reversedBy: idRef('reversed_by'),
    reversalReason: varchar('reversal_reason', { length: 300 }),

    /** Duplo clique e retry reencontram a liquidacao (itens 42 e 94). */
    idempotencyKey: varchar('idempotency_key', { length: 80 }),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_fin_settlement_title_tenant',
      columns: [table.titleId, table.tenantId],
      foreignColumns: [financialTitles.id, financialTitles.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_fin_settlement_installment_tenant',
      columns: [table.installmentId, table.tenantId],
      foreignColumns: [financialInstallments.id, financialInstallments.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** A conta financeira e da MESMA empresa. */
    foreignKey({
      name: 'fk_fin_settlement_account_tenant',
      columns: [table.financialAccountId, table.tenantId],
      foreignColumns: [financialAccounts.id, financialAccounts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_fin_settlement_method_tenant',
      columns: [table.paymentMethodId, table.tenantId],
      foreignColumns: [paymentMethods.id, paymentMethods.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_fin_settlement_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_fin_settlement_idempotency').on(table.tenantId, table.idempotencyKey),
    unique('uq_fin_settlement_id_tenant').on(table.id, table.tenantId),

    check('ck_fin_settlement_amount_positive', sql`\`amount\` > 0`),

    index('ix_fin_settlement_title').on(table.tenantId, table.titleId, table.status),
    index('ix_fin_settlement_date').on(
      table.tenantId,
      table.unitId,
      table.effectiveDate,
      table.status,
    ),
    index('ix_fin_settlement_account').on(
      table.tenantId,
      table.financialAccountId,
      table.effectiveDate,
    ),
    index('ix_fin_settlement_cash_session').on(table.cashSessionId),
  ],
);

// ---------------------------------------------------------------------------
// Sessao de caixa (itens 23 a 26)
// ---------------------------------------------------------------------------

export const cashSessions = mysqlTable(
  'cash_sessions',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    unitId: unitId().notNull(),
    financialAccountId: idRef('financial_account_id').notNull(),

    openedBy: idRef('opened_by').notNull(),
    openedAt: instant('opened_at').notNull(),
    openingAmount: money('opening_amount').notNull().default('0'),

    closedBy: idRef('closed_by'),
    closedAt: instant('closed_at'),
    /** O que a pessoa CONTOU na gaveta. */
    countedAmount: money('counted_amount'),
    /** O que o sistema esperava encontrar. */
    expectedAmount: money('expected_amount'),
    /**
     * A DIFERENCA NAO DESAPARECE (item 25).
     *
     * Positiva = sobrou; negativa = faltou. Nenhum movimento automatico e
     * criado para "zerar" isto: a diferenca e gravada como o fato que e.
     */
    differenceAmount: money('difference_amount'),

    status: varchar('status', { length: 20 }).notNull().default('open'),
    notes: varchar('notes', { length: 300 }),

    /**
     * UMA SESSAO ABERTA POR CAIXA (itens 24 e 45).
     *
     * `1` enquanto aberta, `NULL` depois de fechada. No MySQL cada `NULL` e
     * distinto num indice UNIQUE, entao a restricao vale exatamente enquanto
     * precisa valer — e duas aberturas simultaneas viram erro de chave
     * duplicada, decidido pelo banco. E o mesmo truque do Prompt 08.
     */
    openMarker: tinyint('open_marker'),

    version: int('version', { unsigned: true }).notNull().default(1),

    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_cash_session_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_cash_session_account_tenant',
      columns: [table.financialAccountId, table.tenantId],
      foreignColumns: [financialAccounts.id, financialAccounts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_cash_session_opened_by',
      columns: [table.openedBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_cash_session_open').on(table.financialAccountId, table.openMarker),
    unique('uq_cash_session_id_tenant').on(table.id, table.tenantId),

    check('ck_cash_session_opening_non_negative', sql`\`opening_amount\` >= 0`),

    index('ix_cash_session_unit').on(table.tenantId, table.unitId, table.status),
  ],
);

// ---------------------------------------------------------------------------
// Ledger financeiro (itens 14 e 15)
// ---------------------------------------------------------------------------

/**
 * O LEDGER. APPEND-ONLY, como o do Estoque e pela mesma razao.
 *
 * NAO TEM `updated_at` NEM `version`, e a ausencia e a primeira barreira: nao
 * ha onde gravar uma alteracao. A segunda e o teste de arquitetura, que falha
 * se qualquer arquivo do projeto passar a executar `UPDATE` ou `DELETE` aqui.
 *
 * `amount` e SEMPRE POSITIVO. Quem carrega o sinal e `direction` — um
 * `-150.00` perdido numa coluna e a origem classica de somas que ninguem
 * consegue explicar.
 *
 * Correcao se faz por CONTRAMOVIMENTO, nunca editando o passado.
 */
export const financialMovements = mysqlTable(
  'financial_movements',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    unitId: unitId().notNull(),
    financialAccountId: idRef('financial_account_id').notNull(),

    /** `inflow` = entrou na conta. `outflow` = saiu. Uma convencao, so. */
    direction: varchar('direction', { length: 12 }).notNull(),
    amount: money('amount').notNull(),
    /**
     * Saldo da conta DEPOIS deste movimento.
     *
     * E o que torna a reconciliacao uma comparacao em vez de um recalculo da
     * tabela inteira — mesma escolha do `resulting_on_hand` do Prompt 10.
     */
    resultingBalance: money('resulting_balance').notNull(),

    /** `settlement` `reversal` `cash_opening` `cash_supply` `cash_withdrawal`. */
    originKind: varchar('origin_kind', { length: 24 }).notNull(),
    settlementId: idRef('settlement_id'),
    /** O movimento que este estorna. Rastro do contramovimento (item 41). */
    reversalOfMovementId: idRef('reversal_of_movement_id'),
    cashSessionId: idRef('cash_session_id'),

    /** Texto de pessoa: motivo da sangria, referencia do comprovante. */
    reference: varchar('reference', { length: 200 }),

    effectiveDate: civilDate('effective_date').notNull(),
    occurredAt: instant('occurred_at').notNull(),
    actorId: idRef('actor_id'),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_fin_movement_account_tenant',
      columns: [table.financialAccountId, table.tenantId],
      foreignColumns: [financialAccounts.id, financialAccounts.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_fin_movement_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_fin_movement_settlement_tenant',
      columns: [table.settlementId, table.tenantId],
      foreignColumns: [financialSettlements.id, financialSettlements.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_fin_movement_session_tenant',
      columns: [table.cashSessionId, table.tenantId],
      foreignColumns: [cashSessions.id, cashSessions.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_fin_movement_id_tenant').on(table.id, table.tenantId),
    /** UM contramovimento por movimento estornado (itens 41 e 44). */
    unique('uq_fin_movement_reversal_of').on(table.reversalOfMovementId),

    check('ck_fin_movement_amount_positive', sql`\`amount\` > 0`),

    index('ix_fin_movement_account_date').on(
      table.tenantId,
      table.financialAccountId,
      table.effectiveDate,
    ),
    index('ix_fin_movement_unit_date').on(table.tenantId, table.unitId, table.effectiveDate),
    index('ix_fin_movement_session').on(table.cashSessionId),
  ],
);

// ---------------------------------------------------------------------------
// Linha do tempo do titulo (item 49)
// ---------------------------------------------------------------------------

export const financialTitleTimeline = mysqlTable(
  'financial_title_timeline',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    titleId: idRef('title_id').notNull(),

    kind: varchar('kind', { length: 32 }).notNull(),
    summary: varchar('summary', { length: 300 }),
    reason: varchar('reason', { length: 300 }),
    metadata: json('metadata'),

    actorId: idRef('actor_id'),
    occurredAt: instant('occurred_at').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_fin_timeline_title_tenant',
      columns: [table.titleId, table.tenantId],
      foreignColumns: [financialTitles.id, financialTitles.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    index('ix_fin_timeline_title').on(table.tenantId, table.titleId, table.occurredAt),
  ],
);

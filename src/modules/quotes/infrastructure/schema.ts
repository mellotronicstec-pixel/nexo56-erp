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
  money,
  quantity,
  tenantId,
  timestamps,
  unitId,
} from '@/core/db/columns';
import { QUOTE_INITIAL_STATUS } from '@/modules/quotes/domain/quote';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * Orcamento (Prompt 09).
 *
 * OWNERSHIP: TENANT + UNIDADE, VIA ORDEM DE SERVICO (itens 4, 5 e 8).
 *
 *   customers       -> TENANT   (a pessoa e da empresa)
 *   equipment       -> TENANT   (o aparelho atravessa as lojas)
 *   service_orders  -> UNIDADE  (o trabalho assumido por uma loja)
 *   quotes          -> UNIDADE  (a proposta daquele trabalho)
 *
 * `unit_id` e redundante em relacao a OS DE PROPOSITO: ele existe para que a
 * FK composta `(service_order_id, unit_id)` torne impossivel, NO BANCO, um
 * orcamento da unidade A pendurado numa OS da unidade B. Sem a coluna, a
 * coerencia dependeria so da aplicacao — e checagem de aplicacao some no dia
 * em que alguem escreve um segundo caminho de criacao.
 *
 * Cliente e equipamento NAO se repetem aqui (item 6): sao lidos da OS. Copiar
 * criaria duas verdades sobre o mesmo atendimento.
 */
export const quotes = mysqlTable(
  'quotes',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    /** Unidade da OS. Derivada dela, nunca do formulario (item 8). */
    unitId: unitId().notNull(),

    /** A OS a que esta proposta pertence. FK COMPOSTA com tenant E com unidade. */
    serviceOrderId: idRef('service_order_id').notNull(),

    /**
     * Numero humano, unico por TENANT (itens 10 a 12).
     *
     * Mesma sequencia compartilhada entre unidades que a OS usa, pelo mesmo
     * motivo: dois "ORC 45" na mesma empresa tornariam o numero inutil ao
     * telefone. Vem de `tenant_sequences`, tipo `quote`.
     */
    number: int('number', { unsigned: true }).notNull(),

    /**
     * REVISAO (itens 25 a 28).
     *
     * A revisao e uma LINHA NOVA com o MESMO numero e revisao seguinte, e nao
     * uma sobrescrita da anterior. O cliente continua falando do "orcamento
     * 45", e o historico de quanto ja foi proposto permanece inteiro.
     */
    revision: int('revision', { unsigned: true }).notNull().default(1),

    /** Orcamento que esta revisao substitui. Nulo na primeira versao. */
    supersedesQuoteId: idRef('supersedes_quote_id'),

    status: varchar('status', { length: 20 }).notNull().default(QUOTE_INITIAL_STATUS),

    /**
     * MARCADOR DE PROPOSTA VIVA (itens 65 e 66).
     *
     * Vale 1 enquanto o orcamento e rascunho ou esta enviado, e NULL depois.
     * Com a UNIQUE `(service_order_id, active_marker)` e o fato de o MySQL
     * tratar cada NULL como distinto, uma OS tem no maximo UM orcamento vivo
     * por vez — e quantos encerrados forem precisos.
     *
     * Mesmo padrao do contato principal do cliente (Prompt 05) e da tarefa
     * aberta do workflow (Prompt 08).
     */
    activeMarker: tinyint('active_marker'),

    /** Mesma ideia: no maximo UMA versao aprovada por OS (item 66). */
    approvedMarker: tinyint('approved_marker'),

    // --- valores (item 35: nunca float) --------------------------------------
    /** Soma das linhas, ja com o desconto de cada uma. */
    subtotal: money('subtotal').notNull(),
    /** Desconto aplicado sobre o subtotal, em VALOR. */
    discount: money('discount').notNull(),
    /** subtotal - discount. Recalculado no backend a cada gravacao. */
    total: money('total').notNull(),
    /** BRL por enquanto (item 45). Coluna existe para o dia em que nao for. */
    currency: varchar('currency', { length: 3 }).notNull().default('BRL'),

    /**
     * Validade (item 22).
     *
     * DATA CIVIL no fuso da empresa, nao instante: "vale ate dia 20" e o dia
     * inteiro de quem opera (ADR-017). NULA por padrao — nao existe prazo
     * oficial, e inventar um seria criar regra que ninguem pediu (item 22).
     */
    validUntil: civilDate('valid_until'),

    /**
     * Texto que o cliente vera (itens 46 e 47). Separado das notas internas
     * porque tem outro destinatario: isto sai no futuro PDF e no futuro Portal.
     */
    customerNotes: text('customer_notes'),
    /** Recado da equipe. Nao vai ao cliente. */
    internalNotes: text('internal_notes'),

    // --- decisao ------------------------------------------------------------
    sentAt: instant('sent_at'),
    sentBy: idRef('sent_by'),
    decidedAt: instant('decided_at'),
    /** Quem registrou a decisao no sistema. */
    decidedBy: idRef('decided_by'),
    /**
     * De onde veio a decisao. Hoje sempre `internal` — nao ha Portal nem canal
     * externo, e declarar outra origem faria a trilha mentir (itens 51 e 52).
     */
    decisionSource: varchar('decision_source', { length: 40 }),
    /** Motivo da recusa ou do cancelamento. Texto livre de pessoa. */
    decisionReason: varchar('decision_reason', { length: 300 }),

    /** Concorrencia otimista, mesmo padrao da OS (itens 96 a 98). */
    version: int('version', { unsigned: true }).notNull().default(1),

    /** Mesmo comando, mesmo orcamento (itens 94 e 95). */
    idempotencyKey: varchar('idempotency_key', { length: 80 }),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    /** O orcamento e da mesma empresa da OS (item 7). */
    foreignKey({
      name: 'fk_quote_order_tenant',
      columns: [table.serviceOrderId, table.tenantId],
      foreignColumns: [serviceOrders.id, serviceOrders.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /**
     * E DA MESMA UNIDADE DA OS (item 8).
     *
     * Esta e a FK que torna a coerencia de unidade um fato do banco, e nao uma
     * promessa da aplicacao. Ela e a razao de `uq_service_order_id_unit`
     * existir em `service_orders` — acrescentada de forma aditiva na 0007.
     */
    foreignKey({
      name: 'fk_quote_order_unit',
      columns: [table.serviceOrderId, table.unitId],
      foreignColumns: [serviceOrders.id, serviceOrders.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_quote_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** A revisao aponta para a versao anterior, dentro da mesma empresa. */
    foreignKey({
      name: 'fk_quote_supersedes_tenant',
      columns: [table.supersedesQuoteId, table.tenantId],
      foreignColumns: [table.id, table.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_quote_created_by_tenant',
      columns: [table.createdBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_quote_sent_by_tenant',
      columns: [table.sentBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_quote_decided_by_tenant',
      columns: [table.decidedBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Numero + revisao sao unicos na empresa (itens 12 e 26). */
    unique('uq_quote_tenant_number_revision').on(table.tenantId, table.number, table.revision),

    /** No maximo UMA proposta viva por OS (item 65). */
    unique('uq_quote_active').on(table.serviceOrderId, table.activeMarker),
    /** No maximo UMA versao aprovada por OS (item 66). */
    unique('uq_quote_approved').on(table.serviceOrderId, table.approvedMarker),
    /** Mesmo comando de criacao nao cria dois orcamentos (item 94). */
    unique('uq_quote_idempotency').on(table.tenantId, table.idempotencyKey),
    /** Alvo das FKs compostas das tabelas filhas. */
    unique('uq_quote_id_tenant').on(table.id, table.tenantId),

    /** Orcamentos de uma OS, do mais recente para o mais antigo (item 113). */
    index('ix_quote_order').on(table.serviceOrderId, table.number, table.revision),
    /** Fila comercial da unidade por situacao. */
    index('ix_quote_unit_status').on(table.tenantId, table.unitId, table.status),
    /** Busca pelo numero exato. */
    index('ix_quote_tenant_number').on(table.tenantId, table.number),
    /** Varredura de validade vencida (item 24). */
    index('ix_quote_valid_until').on(table.tenantId, table.status, table.validUntil),
    index('ix_quote_tenant_created').on(table.tenantId, table.createdAt),
  ],
);

/**
 * Linha comercial do orcamento (item 29).
 *
 * PECA AQUI NAO E ESTOQUE (itens 31, 104 e 105). Esta tabela nao tem
 * `product_id`, nao reserva nada e nao movimenta nada: ela guarda o que foi
 * PROPOSTO ao cliente, em texto escrito por quem orcou. O catalogo real chega
 * no Prompt 10, e entrara como coluna aditiva opcional — o que ja foi proposto
 * continua valendo como esta.
 */
export const quoteItems = mysqlTable(
  'quote_items',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    quoteId: idRef('quote_id').notNull(),

    /** `service`, `part` ou `other`. Texto, para crescer sem migration. */
    kind: varchar('kind', { length: 20 }).notNull(),
    /** Obrigatoria: a linha precisa dizer o que e, sem depender de cadastro (item 33). */
    description: varchar('description', { length: 200 }).notNull(),

    /** `DECIMAL(14,4)`: meia hora de bancada e 0,5 (item 34). */
    quantity: quantity('quantity').notNull(),
    unitPrice: money('unit_price').notNull(),
    /** Desconto da linha, em VALOR. */
    discount: money('discount').notNull(),
    /** quantidade x unitario - desconto. Calculado no backend (item 36). */
    total: money('total').notNull(),

    /** Ordem de exibicao (item 86). Inteiro simples: a lista e curta. */
    position: int('position', { unsigned: true }).notNull(),

    ...timestamps(),
  },
  (table) => [
    /**
     * A linha pertence ao orcamento e some com ele. `cascade` aqui e correto
     * porque a linha nao tem vida propria: sem o orcamento, ela nao significa
     * nada. O orcamento em si nunca e apagado pela aplicacao.
     */
    foreignKey({
      name: 'fk_quote_item_quote_tenant',
      columns: [table.quoteId, table.tenantId],
      foreignColumns: [quotes.id, quotes.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    /** Itens de um orcamento, na ordem de exibicao. Evita N+1 na listagem. */
    index('ix_quote_item_quote').on(table.quoteId, table.position),
  ],
);

/**
 * Linha do tempo do orcamento (item 58).
 *
 * APPEND-ONLY, e separada da linha do tempo da OS de proposito: a ficha da OS
 * mostra o fato resumido ("Orcamento ORC #45 enviado"), e quem quer o detalhe
 * abre o orcamento. Copiar cada alteracao de item para a timeline da OS
 * transformaria o historico do atendimento num extrato de digitacao (item 59).
 */
export const quoteTimeline = mysqlTable(
  'quote_timeline',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    quoteId: idRef('quote_id').notNull(),

    kind: varchar('kind', { length: 40 }).notNull(),
    /** Resumo legivel. Nunca carrega o relato do cliente. */
    summary: varchar('summary', { length: 300 }),
    /** Chaves tecnicas do fato. Sem PII. */
    metadata: json('metadata'),
    /** Texto livre de pessoa (motivo da recusa), em coluna propria. */
    reason: varchar('reason', { length: 300 }),

    actorId: idRef('actor_id'),
    occurredAt: instant('occurred_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_quote_timeline_quote_tenant',
      columns: [table.quoteId, table.tenantId],
      foreignColumns: [quotes.id, quotes.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    index('ix_quote_timeline_quote').on(table.quoteId, table.occurredAt),
  ],
);

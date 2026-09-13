import {
  boolean,
  foreignKey,
  index,
  mysqlEnum,
  mysqlTable,
  text,
  tinyint,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { actorColumns, civilDate, id, idRef, tenantId, timestamps } from '@/core/db/columns';
import {
  CONTACT_TYPES,
  CUSTOMER_KINDS,
  CUSTOMER_STATUSES,
} from '@/modules/customers/domain/customer';
import { DOCUMENT_TYPES } from '@/modules/customers/domain/document';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';

/**
 * Clientes (Prompt 05).
 *
 * OWNERSHIP: TENANT — e nao unidade (item 2).
 *
 * Esta e a decisao estrutural do modulo. Uma assistencia com tres lojas
 * cadastra o cliente uma vez e o atende em qualquer uma delas. A unidade
 * pertencera a ORDEM DE SERVICO, que e o que realmente acontece num lugar.
 *
 * `origin_unit_id` guarda onde o cadastro nasceu — informacao de procedencia,
 * util para relatorio e auditoria. Ele NUNCA entra em clausula de filtro: usar
 * a unidade de origem para restringir acesso recriaria, por acidente, o
 * isolamento por unidade que este modelo recusa.
 */

export const customers = mysqlTable(
  'customers',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    /** PF ou PJ. Explicito no modelo, nunca deduzido pelo documento (item 7). */
    kind: mysqlEnum('kind', CUSTOMER_KINDS).notNull(),

    /** PF: nome da pessoa. PJ: razao social. */
    name: varchar('name', { length: 200 }).notNull(),
    /**
     * Minusculas e sem acento, gravado junto com o cadastro.
     *
     * A busca compara texto ja normalizado dos DOIS lados. Aplicar LOWER() na
     * coluna a cada consulta descartaria qualquer indice — com dezenas de
     * milhares de clientes, isso e a diferenca entre uma busca util no balcao
     * e uma tela que trava.
     */
    nameNormalized: varchar('name_normalized', { length: 200 }).notNull(),

    /** PJ: nome fantasia — como a empresa e conhecida no balcao. */
    tradeName: varchar('trade_name', { length: 200 }),
    tradeNameNormalized: varchar('trade_name_normalized', { length: 200 }),

    /**
     * Documento OPCIONAL (itens 6 e 9).
     *
     * Nulo e um estado legitimo e frequente: muita gente nao informa CPF no
     * primeiro contato. O par (tipo, digitos) e sempre preenchido junto ou
     * deixado junto em nulo.
     */
    documentType: mysqlEnum('document_type', DOCUMENT_TYPES),
    /** Somente digitos. E a forma canonica para unicidade e busca. */
    documentDigits: varchar('document_digits', { length: 14 }),

    /** PJ: inscricao estadual. Texto livre — ha formatos por estado e "ISENTO". */
    stateRegistration: varchar('state_registration', { length: 32 }),

    /** PF: data de nascimento. Data civil, sem fuso (ver columns.ts). */
    birthDate: civilDate('birth_date'),

    /**
     * Observacoes INTERNAS (item 17).
     *
     * Nunca sao mostradas ao cliente. Guardadas como texto puro e renderizadas
     * como texto puro — nao ha caminho que interprete HTML aqui.
     */
    notes: text('notes'),

    status: mysqlEnum('status', CUSTOMER_STATUSES).notNull().default('active'),

    /**
     * Unidade onde o cadastro nasceu. PROCEDENCIA, nao propriedade (item 2).
     * `set null`: perder a unidade nao pode apagar o cliente.
     */
    originUnitId: idRef('origin_unit_id').references(() => units.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    /**
     * Documento unico POR TENANT (item 8).
     *
     * No MySQL/MariaDB, indice UNIQUE trata cada NULL como distinto — entao
     * esta mesma restricao permite quantos clientes sem documento existirem
     * (item 9), e ao mesmo tempo barra o segundo CPF igual dentro da empresa.
     * Nao e unicidade global: a mesma pessoa pode ser cliente de duas empresas
     * diferentes, que e o caso normal num SaaS.
     *
     * Sendo restricao de BANCO, ela tambem resolve a corrida entre dois
     * cadastros simultaneos (item 53) — coisa que "consultar antes de inserir"
     * nao resolve.
     */
    uniqueIndex('uq_customers_tenant_document').on(table.tenantId, table.documentDigits),

    /** Alvo das FKs compostas das tabelas filhas — ver units.uq_units_id_tenant. */
    unique('uq_customers_id_tenant').on(table.id, table.tenantId),

    /**
     * Busca por nome dentro do tenant.
     *
     * A consulta usa LIKE com curinga a esquerda, que nao faz busca por
     * prefixo no indice; ainda assim o indice COMPOSTO ajuda de verdade,
     * porque a igualdade em `tenant_id` restringe a varredura as entradas
     * daquele tenant, num indice estreito, em vez de varrer a tabela inteira.
     */
    index('ix_customers_tenant_name').on(table.tenantId, table.nameNormalized),
    index('ix_customers_tenant_trade_name').on(table.tenantId, table.tradeNameNormalized),
    /** Filtros da listagem: situacao e tipo, sempre dentro do tenant. */
    index('ix_customers_tenant_status').on(table.tenantId, table.status),
    index('ix_customers_tenant_kind').on(table.tenantId, table.kind),
    /** Ordenacao padrao "atualizados primeiro". */
    index('ix_customers_tenant_updated').on(table.tenantId, table.updatedAt),
  ],
);

/**
 * Contatos do cliente (itens 10, 11, 13 e 14).
 *
 * Entidade propria em vez de `telefone1`, `telefone2`, `telefone3`: a terceira
 * coluna sempre acaba faltando, e o quarto telefone nunca cabe. Aqui um cliente
 * tem quantos contatos precisar, cada um com rotulo proprio ("Telefone da
 * esposa", "E-mail financeiro").
 *
 * WHATSAPP NAO E UM SEGUNDO NUMERO (item 13): e uma CARACTERISTICA do telefone.
 * Duplicar a linha so porque o mesmo numero tem WhatsApp criaria dois contatos
 * que precisam ser mantidos em sincronia para sempre.
 */
export const customerContacts = mysqlTable(
  'customer_contacts',
  {
    id: id().primaryKey(),
    customerId: idRef('customer_id').notNull(),
    tenantId: tenantId().notNull(),

    type: mysqlEnum('type', CONTACT_TYPES).notNull(),

    /** Como a pessoa digitou. Preservado para exibicao. */
    value: varchar('value', { length: 190 }).notNull(),
    /** Telefone: so digitos. E-mail: minusculas. E por aqui que se busca. */
    valueNormalized: varchar('value_normalized', { length: 190 }).notNull(),

    /** Caracteristica do telefone, nao um contato separado (item 13). */
    isWhatsapp: boolean('is_whatsapp').notNull().default(false),

    /** "Celular", "Comercial", "Financeiro"... Livre, curto e opcional. */
    label: varchar('label', { length: 80 }),

    /**
     * Contato principal — UM por cliente (item 11).
     *
     * A coluna existe em duas formas de proposito. `is_primary` e o booleano
     * que a aplicacao le. `primary_marker` vale 1 no principal e NULL nos
     * demais, e participa de um indice unico: como o MySQL considera cada NULL
     * distinto, o indice permite N contatos comuns e no maximo UM principal.
     *
     * E o mesmo truque do documento opcional, aplicado a outra regra: a
     * garantia fica no banco, e nao numa sequencia "apaga os outros, marca
     * este" que duas requisicoes simultaneas conseguem furar.
     */
    isPrimary: boolean('is_primary').notNull().default(false),
    primaryMarker: tinyint('primary_marker'),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_customer_contacts_primary').on(table.customerId, table.primaryMarker),
    index('ix_customer_contacts_customer').on(table.customerId),
    /** Busca por telefone/e-mail no balcao, sempre dentro do tenant. */
    index('ix_customer_contacts_tenant_value').on(table.tenantId, table.valueNormalized),
    /**
     * FK COMPOSTA: cliente e contato obrigatoriamente do mesmo tenant.
     * Cascade porque contato nao existe sem o cliente dono.
     */
    foreignKey({
      name: 'fk_customer_contacts_customer_tenant',
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
  ],
);

/**
 * Enderecos do cliente (item 15).
 *
 * Tabela propria desde o inicio, ainda que a interface trate de um endereco
 * so: retirada, entrega, cobranca e visita tecnica sao enderecos diferentes da
 * mesma pessoa, e essas funcoes chegarao nos proximos modulos. Migrar coluna
 * embutida para tabela depois de existir volume e caro; comecar assim nao
 * custa nada.
 *
 * NENHUM campo e obrigatorio alem do vinculo: endereco incompleto e melhor do
 * que endereco nao cadastrado.
 */
export const customerAddresses = mysqlTable(
  'customer_addresses',
  {
    id: id().primaryKey(),
    customerId: idRef('customer_id').notNull(),
    tenantId: tenantId().notNull(),

    label: varchar('label', { length: 80 }),
    /** Somente digitos, sem hifen. */
    zipCode: varchar('zip_code', { length: 8 }),
    street: varchar('street', { length: 200 }),
    number: varchar('number', { length: 20 }),
    complement: varchar('complement', { length: 120 }),
    district: varchar('district', { length: 120 }),
    city: varchar('city', { length: 120 }),
    /** UF em duas letras. */
    state: varchar('state', { length: 2 }),
    country: varchar('country', { length: 2 }).notNull().default('BR'),

    isPrimary: boolean('is_primary').notNull().default(false),
    primaryMarker: tinyint('primary_marker'),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_customer_addresses_primary').on(table.customerId, table.primaryMarker),
    index('ix_customer_addresses_customer').on(table.customerId),
    foreignKey({
      name: 'fk_customer_addresses_customer_tenant',
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
  ],
);

export type CustomerRow = typeof customers.$inferSelect;
export type CustomerContactRow = typeof customerContacts.$inferSelect;
export type CustomerAddressRow = typeof customerAddresses.$inferSelect;

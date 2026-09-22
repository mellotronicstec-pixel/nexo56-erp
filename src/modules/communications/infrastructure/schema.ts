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
import { correlationId, id, idRef, instant, tenantId, timestamps, unitId } from '@/core/db/columns';
import { customers } from '@/modules/customers/infrastructure/schema';
import { serviceOrders } from '@/modules/service-orders/infrastructure/schema';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';
import { warranties } from '@/modules/warranties/infrastructure/schema';

/**
 * SCHEMA DE COMUNICAÇÃO (Prompt 16).
 *
 * Quatro tabelas, e a fronteira entre elas é o que este prompt realmente
 * entrega:
 *
 *   communication_templates    o MOLDE reutilizável, com lacunas
 *   communication_messages     a INTENÇÃO concreta: este texto, para este
 *                              destino, por este canal
 *   communication_attempts     o que ACONTECEU em cada tentativa — append-only
 *   communication_attachments  o que foi ANEXADO, por referência
 *
 * POR QUE `messages` E `attempts` SÃO TABELAS SEPARADAS.
 *
 * Uma mensagem tem um texto e um destino; uma tentativa tem um provedor, um
 * horário, uma duração e um erro. Guardar as duas coisas na mesma linha
 * obrigaria a escolher entre perder o histórico (a segunda tentativa
 * sobrescreve a primeira) ou multiplicar a mensagem (duas linhas dizendo o
 * mesmo texto para o mesmo cliente). A primeira opção apaga a evidência de que
 * o WhatsApp do cliente recusou três vezes; a segunda faz a tela mostrar a
 * mesma mensagem três vezes para quem só queria saber se avisaram o cliente.
 *
 * A REGRA QUE ATRAVESSA AS QUATRO TABELAS: nada aqui é fonte de verdade de
 * fato operacional. Não existe coluna que a Ordem de Serviço leia para decidir
 * qualquer coisa. Se todas as quatro tabelas fossem apagadas, o trabalho da
 * oficina continuaria exatamente onde estava — perderíamos o registro do que
 * foi dito ao cliente, e nada mais (ADR-078).
 */

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Modelos de texto do tenant.
 *
 * TENANT, NÃO UNIDADE: o jeito de falar com o cliente é da empresa. Duas lojas
 * da mesma rede escrevendo textos diferentes para "seu aparelho está pronto"
 * é exatamente o problema que um modelo existe para resolver.
 *
 * O TEMPLATE NÃO É A MENSAGEM (item 22). Aplicar um modelo COPIA o texto já
 * renderizado para dentro da mensagem. Editar o modelo amanhã não reescreve o
 * que foi enviado ontem — se reescrevesse, o histórico passaria a mentir sobre
 * o que o cliente leu, e é justamente para não mentir que este módulo existe.
 */
export const communicationTemplates = mysqlTable(
  'communication_templates',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    name: varchar('name', { length: 120 }).notNull(),
    /** Minúsculas e sem acento, para a unicidade não depender de digitação. */
    nameNormalized: varchar('name_normalized', { length: 120 }).notNull(),

    channel: varchar('channel', { length: 20 }).notNull(),
    purpose: varchar('purpose', { length: 30 }).notNull().default('generic'),

    /** Só para e-mail. O CHECK impede assunto em canal que não envia assunto. */
    subject: varchar('subject', { length: 200 }),
    body: text('body').notNull(),

    status: varchar('status', { length: 20 }).notNull().default('active'),

    /**
     * ARQUIVAR, NÃO APAGAR.
     *
     * Um modelo arquivado continua existindo porque mensagens antigas apontam
     * para ele. `active_marker` vale 1 enquanto ativo e NULL depois — com a
     * UNIQUE abaixo, isso libera o nome para reuso sem permitir dois modelos
     * ativos com o mesmo nome. É o mesmo truque de `customer_contacts`.
     */
    activeMarker: tinyint('active_marker'),
    archivedAt: instant('archived_at'),
    archivedBy: idRef('archived_by'),

    createdBy: idRef('created_by'),
    updatedBy: idRef('updated_by'),
    version: int('version', { unsigned: true }).notNull().default(1),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_comm_template_created_by_tenant',
      columns: [table.createdBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /**
     * Alvo da foreign key composta vinda de `communication_messages`.
     *
     * Sem esta chave o InnoDB nem aceitaria criar aquela FK — e com ela, uma
     * mensagem do tenant A não consegue apontar para um modelo do tenant B
     * nem por erro de código.
     */
    unique('uq_comm_template_id_tenant').on(table.id, table.tenantId),

    unique('uq_comm_template_active_name').on(
      table.tenantId,
      table.nameNormalized,
      table.activeMarker,
    ),

    index('ix_comm_template_tenant_channel').on(table.tenantId, table.channel, table.status),

    check('ck_comm_template_channel', sql`channel IN ('whatsapp','email','sms')`),
    check('ck_comm_template_status', sql`status IN ('active','archived')`),
    check(
      'ck_comm_template_purpose',
      sql`purpose IN ('generic','service_update','ready_for_pickup','quote_available','warranty_document')`,
    ),
    /** Assunto existe para e-mail e não existe para o resto. Sem meio-termo. */
    check(
      'ck_comm_template_subject_channel',
      sql`(channel = 'email' AND subject IS NOT NULL) OR (channel <> 'email' AND subject IS NULL)`,
    ),
    check(
      'ck_comm_template_active_marker',
      sql`(status = 'active' AND active_marker = 1) OR (status = 'archived' AND active_marker IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

/**
 * A mensagem: um texto, um destino, um canal, um estado.
 *
 * UNIDADE É OBRIGATÓRIA. Falar com o cliente é ato de atendimento, e
 * atendimento acontece em algum lugar. Sem unidade, a caixa de comunicação de
 * uma rede com seis lojas viraria uma lista única em que ninguém encontra o
 * que é seu — e a checagem de acesso por unidade não teria em que se apoiar.
 *
 * O TEXTO É CÓPIA, NÃO REFERÊNCIA (item 22). `subject` e `body` guardam o
 * conteúdo JÁ RENDERIZADO, com as lacunas preenchidas. É o que o cliente leu.
 *
 * NÃO EXISTE `delivered` NEM `read` NESTA TABELA, e a ausência é deliberada:
 * ver o docblock de `MESSAGE_STATUSES` no domínio. `sent` significa que um
 * provedor ACEITOU a mensagem, não que ela chegou.
 */
export const communicationMessages = mysqlTable(
  'communication_messages',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    unitId: unitId().notNull(),

    channel: varchar('channel', { length: 20 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    origin: varchar('origin', { length: 20 }).notNull(),
    purpose: varchar('purpose', { length: 30 }).notNull().default('generic'),

    /**
     * O RETRATO DO DESTINATÁRIO (itens 15 e 16).
     *
     * `recipient_value` é o normalizado (dígitos, ou e-mail em minúsculas) e
     * serve para buscar; `recipient_display` é o que se mostra a uma pessoa.
     *
     * Não há coluna apontando para `customer_contacts`: aquela tabela é
     * apagada e reinserida a cada edição do cliente, então o ponteiro estaria
     * quebrado na primeira correção de telefone. Ver `domain/recipient.ts`.
     */
    recipientValue: varchar('recipient_value', { length: 190 }).notNull(),
    recipientDisplay: varchar('recipient_display', { length: 190 }).notNull(),

    customerId: idRef('customer_id'),

    subject: varchar('subject', { length: 200 }),
    body: text('body').notNull(),

    /**
     * De qual modelo saiu o texto, quando saiu de um.
     *
     * É PROCEDÊNCIA, NÃO DEPENDÊNCIA: o texto já está copiado acima. A coluna
     * responde "este modelo anda produzindo mensagem recusada?", e é por isso
     * que modelo se arquiva em vez de apagar.
     */
    templateId: idRef('template_id'),

    /** Contexto opcional. A OS dá assunto à conversa; ela não é comandada por ela. */
    serviceOrderId: idRef('service_order_id'),

    /** Quantas tentativas já foram feitas. Espelho de `communication_attempts`. */
    attemptCount: int('attempt_count', { unsigned: true }).notNull().default(0),
    lastAttemptAt: instant('last_attempt_at'),

    /**
     * Resultado da última tentativa, desnormalizado de propósito.
     *
     * A lista de mensagens precisa mostrar o motivo da falha sem um JOIN com
     * uma tabela que cresce a cada retentativa. O histórico completo continua
     * em `communication_attempts`; aqui fica só o último, para a tela.
     */
    lastErrorCode: varchar('last_error_code', { length: 30 }),
    lastErrorDetail: varchar('last_error_detail', { length: 500 }),

    /** Quando um provedor aceitou. Não é "quando o cliente recebeu". */
    sentAt: instant('sent_at'),
    /** Qual provedor aceitou — retrato, para o histórico sobreviver à troca. */
    sentProvider: varchar('sent_provider', { length: 40 }),
    /** Protocolo devolvido pelo provedor, quando houver. Não é segredo. */
    providerMessageId: varchar('provider_message_id', { length: 190 }),

    cancelledAt: instant('cancelled_at'),
    cancelledBy: idRef('cancelled_by'),
    cancelReason: varchar('cancel_reason', { length: 300 }),

    /**
     * Quem pediu. Nulo quando quem pediu foi o sistema, reagindo a um evento —
     * e nulo aqui significa exatamente isso, nunca "não sabemos".
     */
    requestedBy: idRef('requested_by'),

    /**
     * O evento de domínio que originou a mensagem, quando `origin` é
     * `domain_event`.
     *
     * Guardado como id solto, SEM foreign key: `domain_events` é o log do
     * outbox e tem política de retenção própria: uma FK daqui impediria
     * limpar evento antigo, e transformaria a comunicação em âncora de uma
     * tabela que precisa poder encolher.
     */
    sourceEventId: idRef('source_event_id'),

    /**
     * A TRAVA DE EXATAMENTE-UMA-MENSAGEM (itens 48 e 49).
     *
     * Para origem `domain_event`, a chave é derivada do evento. O mesmo evento
     * entregue duas vezes — e o outbox pode entregar duas vezes — encontra a
     * UNIQUE e a segunda inserção é recusada pelo InnoDB, não por um `SELECT`
     * anterior que outra conexão já invalidou.
     */
    idempotencyKey: varchar('idempotency_key', { length: 190 }),
    correlationId: correlationId(),

    version: int('version', { unsigned: true }).notNull().default(1),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: 'fk_comm_message_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_comm_message_customer_tenant',
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_comm_message_template_tenant',
      columns: [table.templateId, table.tenantId],
      foreignColumns: [communicationTemplates.id, communicationTemplates.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /**
     * A OS é referenciada por (id, unit_id), não por (id, tenant_id).
     *
     * Assim o InnoDB recusa uma mensagem da unidade A anexada a uma OS da
     * unidade B dentro do mesmo tenant — a proteção de unidade deixa de
     * depender de o código lembrar de conferir.
     */
    foreignKey({
      name: 'fk_comm_message_order_unit',
      columns: [table.serviceOrderId, table.unitId],
      foreignColumns: [serviceOrders.id, serviceOrders.unitId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_comm_message_requested_by_tenant',
      columns: [table.requestedBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    foreignKey({
      name: 'fk_comm_message_cancelled_by_tenant',
      columns: [table.cancelledBy, table.tenantId],
      foreignColumns: [users.id, users.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Alvo das FKs compostas das filhas: anexo e tentativa nunca trocam de tenant. */
    unique('uq_comm_message_id_tenant').on(table.id, table.tenantId),

    unique('uq_comm_message_idempotency').on(table.tenantId, table.idempotencyKey),

    /** A tela principal: fila da unidade, mais recentes primeiro. */
    index('ix_comm_message_unit_created').on(table.tenantId, table.unitId, table.createdAt),
    /** O filtro por situação dentro da unidade. */
    index('ix_comm_message_unit_status').on(table.tenantId, table.unitId, table.status),
    /** A retomada do worker: o que ficou parado, mais antigo primeiro. */
    index('ix_comm_message_pending').on(table.status, table.createdAt),
    /** A seção de comunicação dentro da ficha da OS. */
    index('ix_comm_message_order').on(table.tenantId, table.serviceOrderId),
    /** "O que já falamos com este cliente". */
    index('ix_comm_message_customer').on(table.tenantId, table.customerId, table.createdAt),

    check('ck_comm_message_channel', sql`channel IN ('whatsapp','email','sms')`),
    check(
      'ck_comm_message_status',
      sql`status IN ('queued','sending','sent','failed','cancelled')`,
    ),
    check('ck_comm_message_origin', sql`origin IN ('manual','domain_event')`),
    check(
      'ck_comm_message_purpose',
      sql`purpose IN ('generic','service_update','ready_for_pickup','quote_available','warranty_document')`,
    ),
    check(
      'ck_comm_message_subject_channel',
      sql`(channel = 'email' AND subject IS NOT NULL) OR (channel <> 'email' AND subject IS NULL)`,
    ),
    /**
     * `sent` sem `sent_at` seria um estado que afirma um fato sem registrar
     * quando ele aconteceu — e é a partir desse horário que se responde "a
     * gente avisou antes ou depois de ele ligar reclamando?".
     */
    check(
      'ck_comm_message_sent_at',
      sql`(status = 'sent' AND sent_at IS NOT NULL) OR (status <> 'sent' AND sent_at IS NULL)`,
    ),
    check(
      'ck_comm_message_cancelled_at',
      sql`(status = 'cancelled' AND cancelled_at IS NOT NULL) OR (status <> 'cancelled' AND cancelled_at IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Tentativas
// ---------------------------------------------------------------------------

/**
 * O QUE ACONTECEU DE FATO, UMA LINHA POR TENTATIVA (itens 40 a 43).
 *
 * APPEND-ONLY, e isso não é estilo: é a única forma de a pergunta "quantas
 * vezes tentamos falar com esse cliente e por quê não conseguimos?" ter
 * resposta. Por isso a tabela NÃO tem `updated_at` — não há atualização a
 * carimbar — e não tem coluna de exclusão.
 *
 * Nenhuma tentativa é sobrescrita pela seguinte. Uma mensagem que falhou três
 * vezes e foi aceita na quarta tem quatro linhas aqui, e a terceira continua
 * dizendo que o provedor estava fora do ar às 14h03.
 */
export const communicationAttempts = mysqlTable(
  'communication_attempts',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    messageId: idRef('message_id').notNull(),

    /** 1, 2, 3… A UNIQUE com `message_id` impede duas tentativas nº 2. */
    attemptNumber: int('attempt_number', { unsigned: true }).notNull(),

    /**
     * Qual provedor foi usado, como texto.
     *
     * RETRATO, NÃO CHAVE ESTRANGEIRA: se amanhã a empresa trocar de
     * fornecedor e a linha de configuração antiga sumir, esta tentativa
     * continua dizendo por onde a mensagem passou em 2026.
     */
    provider: varchar('provider', { length: 40 }).notNull(),

    startedAt: instant('started_at').notNull(),
    finishedAt: instant('finished_at'),
    durationMs: int('duration_ms', { unsigned: true }),

    /** `accepted` = o provedor recebeu. Continua não sendo "o cliente leu". */
    outcome: varchar('outcome', { length: 20 }).notNull(),

    /** Erro NORMALIZADO pelo adaptador. Nunca o texto cru do fornecedor. */
    errorCode: varchar('error_code', { length: 30 }),
    /**
     * Detalhe legível do erro, já higienizado pelo adaptador.
     *
     * NUNCA credencial, token ou cabeçalho de autenticação. O adaptador é
     * quem conhece o formato do fornecedor e, portanto, é quem tem como
     * garantir isso — não este schema, que só guarda o que recebe.
     */
    errorDetail: varchar('error_detail', { length: 500 }),

    providerMessageId: varchar('provider_message_id', { length: 190 }),
    correlationId: correlationId(),

    /** Sem `updated_at`: linha de histórico não se atualiza. */
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_comm_attempt_message_tenant',
      columns: [table.messageId, table.tenantId],
      foreignColumns: [communicationMessages.id, communicationMessages.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    unique('uq_comm_attempt_number').on(table.messageId, table.attemptNumber),

    index('ix_comm_attempt_message').on(table.messageId, table.startedAt),

    check('ck_comm_attempt_outcome', sql`outcome IN ('accepted','failed')`),
    check(
      'ck_comm_attempt_error',
      sql`(outcome = 'failed' AND error_code IS NOT NULL) OR (outcome = 'accepted' AND error_code IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Anexos
// ---------------------------------------------------------------------------

/**
 * ANEXO É REFERÊNCIA, NÃO CÓPIA (itens 52 a 55).
 *
 * O certificado de garantia em PDF já existe, já é gerado por um serviço
 * autorizado e já tem checksum. Copiar os bytes para cá produziria duas
 * verdades sobre o mesmo documento e, na primeira reemissão, a mensagem
 * passaria a carregar uma versão que não existe mais em lugar nenhum.
 *
 * O que fica aqui é o RETRATO DOS METADADOS — nome, tipo, tamanho, checksum —
 * suficiente para a tela mostrar o anexo e para provar depois QUAL versão do
 * documento foi enviada, comparando o checksum.
 *
 * NÃO HÁ `storage_key` AQUI, E ISSO É PROPOSITAL (item 55). Guardar a chave de
 * armazenamento daria a este módulo um caminho para ler o arquivo direto,
 * pulando a checagem de permissão do módulo de Garantias. O anexo carrega o id
 * da garantia, e quem quiser os bytes passa por `readCertificatePdf`, que
 * confere tenant, unidade e permissão — como qualquer outro leitor.
 */
export const communicationAttachments = mysqlTable(
  'communication_attachments',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    messageId: idRef('message_id').notNull(),

    /** Hoje só existe um tipo. O CHECK cresce quando existir outro. */
    kind: varchar('kind', { length: 30 }).notNull(),

    /** A garantia cujo certificado foi anexado. É por aqui que se lê o arquivo. */
    warrantyId: idRef('warranty_id'),

    filename: varchar('filename', { length: 200 }).notNull(),
    mimeType: varchar('mime_type', { length: 60 }).notNull(),
    byteSize: int('byte_size', { unsigned: true }).notNull(),
    /** SHA-256 do arquivo no instante do anexo. É a prova de QUAL versão foi. */
    checksum: varchar('checksum', { length: 64 }).notNull(),

    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_comm_attachment_message_tenant',
      columns: [table.messageId, table.tenantId],
      foreignColumns: [communicationMessages.id, communicationMessages.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    /**
     * ÚNICA FK DO PROJETO SEM `ON UPDATE cascade`, e o motivo é do MariaDB.
     *
     * O MariaDB 10.11 recusa um CHECK sobre uma coluna que participa de uma
     * foreign key com ação em cascata — verificado, não suposto: a tentativa
     * devolve `ERROR 1901 (HY000): Function or expression 'warranty_id'
     * cannot be used in the CHECK clause of 'ck_comm_attachment_warranty'`.
     *
     * Entre perder o CHECK e perder a cascata, perder a cascata custa nada: os
     * ids são UUIDv7, gerados uma vez e nunca reescritos, então `ON UPDATE`
     * jamais dispararia. Já o CHECK trabalha o tempo todo, impedindo um anexo
     * de certificado que não diz de qual garantia é.
     */
    foreignKey({
      name: 'fk_comm_attachment_warranty_tenant',
      columns: [table.warrantyId, table.tenantId],
      foreignColumns: [warranties.id, warranties.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),

    index('ix_comm_attachment_message').on(table.messageId),

    check('ck_comm_attachment_kind', sql`kind IN ('warranty_certificate')`),
    check(
      'ck_comm_attachment_warranty',
      sql`kind <> 'warranty_certificate' OR warranty_id IS NOT NULL`,
    ),
    check('ck_comm_attachment_size', sql`byte_size > 0`),
  ],
);

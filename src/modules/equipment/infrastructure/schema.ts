import {
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';
import { actorColumns, id, idRef, instant, tenantId, timestamps, unitId } from '@/core/db/columns';
import { customers } from '@/modules/customers/infrastructure/schema';
import {
  EQUIPMENT_STATUSES,
  MEDIA_KINDS,
  POWER_CABLE_ANSWERS,
  VOLTAGES,
} from '@/modules/equipment/domain/equipment';
import { tenants, units } from '@/modules/tenancy/infrastructure/schema';
import { users } from '@/modules/users/infrastructure/schema';

/**
 * Equipamentos e recebimentos (Prompt 06).
 *
 * A DIVISAO DE OWNERSHIP E A DECISAO CENTRAL DO MODULO (itens 5, 6 e 67):
 *
 *   equipment        -> TENANT  (o aparelho atravessa unidades e atendimentos)
 *   equipment_intakes -> UNIT   (o recebimento acontece num lugar e numa hora)
 *
 * Um cliente pode deixar o mesmo televisor na loja Centro hoje e na loja Norte
 * no ano que vem. Amarrar o equipamento a uma unidade obrigaria a recadastrar
 * — e o historico do aparelho, que e justamente o que a assistencia consulta,
 * nasceria partido.
 */

export const equipment = mysqlTable(
  'equipment',
  {
    id: id().primaryKey(),
    tenantId: tenantId()
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict', onUpdate: 'cascade' }),

    /** Dono do aparelho. A FK e COMPOSTA — ver o bloco de constraints. */
    customerId: idRef('customer_id').notNull(),

    /** Tipo (TV, amplificador...). Texto livre com sugestoes, nao taxonomia fechada. */
    kind: varchar('kind', { length: 80 }).notNull(),
    kindNormalized: varchar('kind_normalized', { length: 80 }).notNull(),

    /** Marca preservada como digitada; a coluna normalizada e so para busca. */
    brand: varchar('brand', { length: 120 }),
    brandNormalized: varchar('brand_normalized', { length: 120 }),

    /**
     * Modelo. NAO sofre normalizacao destrutiva (item 12): "RX-V385" e
     * "RXV385" sao identificacoes tecnicas diferentes para quem procura peca.
     * A busca usa a coluna normalizada; a exibicao usa esta.
     */
    model: varchar('model', { length: 160 }),
    modelNormalized: varchar('model_normalized', { length: 160 }),

    /**
     * Numero de serie: OPCIONAL (item 56). Etiqueta ilegivel, arrancada ou
     * ausente e rotina numa assistencia, e recusar o cadastro por isso
     * impediria o atendimento. Nunca e chave, e nao ha unicidade imposta
     * (item 13) — fabricantes reutilizam formatos.
     */
    serial: varchar('serial', { length: 120 }),
    serialNormalized: varchar('serial_normalized', { length: 120 }),

    voltage: mysqlEnum('voltage', VOLTAGES).notNull().default('unknown'),

    /** Observacoes de IDENTIFICACAO. Nao e diagnostico (item 20). */
    notes: text('notes'),

    status: mysqlEnum('status', EQUIPMENT_STATUSES).notNull().default('active'),

    /** Unidade onde o cadastro nasceu. Procedencia, nunca filtro (item 5). */
    originUnitId: idRef('origin_unit_id').references(() => units.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    /**
     * FK COMPOSTA para o cliente (item 103).
     *
     * Garante no BANCO que equipamento e cliente sao do mesmo tenant. Uma FK
     * simples `customer_id -> customers.id` diria apenas que o cliente existe
     * — nao que ele pertence a esta empresa. Ha teste que tenta a associacao
     * por SQL direto e espera ERROR 1452.
     */
    foreignKey({
      name: 'fk_equipment_customer_tenant',
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Alvo das FKs compostas das tabelas filhas. */
    unique('uq_equipment_id_tenant').on(table.id, table.tenantId),

    index('ix_equipment_tenant_customer').on(table.tenantId, table.customerId),
    index('ix_equipment_tenant_serial').on(table.tenantId, table.serialNormalized),
    index('ix_equipment_tenant_brand_model').on(
      table.tenantId,
      table.brandNormalized,
      table.modelNormalized,
    ),
    index('ix_equipment_tenant_kind').on(table.tenantId, table.kindNormalized),
    index('ix_equipment_tenant_created').on(table.tenantId, table.createdAt),
  ],
);

/**
 * Recebimento — a entrada de um equipamento na assistencia (itens 6 e 57).
 *
 * `unit_id` e OBRIGATORIO: o recebimento aconteceu em algum lugar, e esse lugar
 * define quem pode ve-lo (item 108). O historico guarda a unidade de origem
 * para sempre — trocar de unidade ativa depois nao reescreve onde o aparelho
 * foi entregue.
 */
export const equipmentIntakes = mysqlTable(
  'equipment_intakes',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    unitId: unitId().notNull(),
    equipmentId: idRef('equipment_id').notNull(),

    receivedAt: instant('received_at').notNull(),
    /** Quem atendeu. Complementa a auditoria, nao a substitui (item 58). */
    receivedBy: idRef('received_by').references(() => users.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),

    powerCable: mysqlEnum('power_cable', POWER_CABLE_ANSWERS).notNull().default('not_applicable'),

    /** Relato livre do estado fisico, para o que o checklist nao previu (item 19). */
    inspectionNotes: text('inspection_notes'),
    /** Observacoes gerais do atendimento. */
    notes: text('notes'),

    ...actorColumns(),
    ...timestamps(),
  },
  (table) => [
    /** Equipamento e recebimento no mesmo tenant. */
    foreignKey({
      name: 'fk_intake_equipment_tenant',
      columns: [table.equipmentId, table.tenantId],
      foreignColumns: [equipment.id, equipment.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    /** Unidade e recebimento no mesmo tenant (item 104). */
    foreignKey({
      name: 'fk_intake_unit_tenant',
      columns: [table.unitId, table.tenantId],
      foreignColumns: [units.id, units.tenantId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),

    unique('uq_intake_id_tenant').on(table.id, table.tenantId),

    index('ix_intake_tenant_unit_received').on(table.tenantId, table.unitId, table.receivedAt),
    index('ix_intake_equipment').on(table.equipmentId),
  ],
);

/** Acessorios entregues junto com o aparelho (itens 16 e 17). */
export const equipmentIntakeAccessories = mysqlTable(
  'equipment_intake_accessories',
  {
    id: id().primaryKey(),
    intakeId: idRef('intake_id').notNull(),
    tenantId: tenantId().notNull(),

    /** Texto livre: a lista sugerida acelera, mas nao limita. */
    label: varchar('label', { length: 120 }).notNull(),
    /**
     * Quantidade INTEIRA: acessorio se conta por unidade ("2 baterias"), nunca
     * em fracao. Usar o decimal de estoque aqui abriria "1,5 controle remoto".
     */
    quantity: int('quantity').notNull().default(1),

    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_intake_accessories_intake_tenant',
      columns: [table.intakeId, table.tenantId],
      foreignColumns: [equipmentIntakes.id, equipmentIntakes.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    index('ix_intake_accessories_intake').on(table.intakeId),
  ],
);

/** Condicoes fisicas marcadas no checklist de entrada (item 18). */
export const equipmentIntakeConditions = mysqlTable(
  'equipment_intake_conditions',
  {
    id: id().primaryKey(),
    intakeId: idRef('intake_id').notNull(),
    tenantId: tenantId().notNull(),

    /** Chave do catalogo (`scratches`, `dents`...). */
    conditionKey: varchar('condition_key', { length: 40 }).notNull(),
    /** Detalhe opcional: "risco de 3 cm na tampa". */
    note: varchar('note', { length: 300 }),

    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_intake_conditions_intake_tenant',
      columns: [table.intakeId, table.tenantId],
      foreignColumns: [equipmentIntakes.id, equipmentIntakes.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    unique('uq_intake_condition').on(table.intakeId, table.conditionKey),
  ],
);

/**
 * Fotos (itens 21, 22, 28 e 63).
 *
 * O banco guarda METADADOS e a CHAVE do arquivo; os bytes ficam no storage.
 *
 * A midia aponta para o equipamento e, quando nasceu num atendimento, tambem
 * para o recebimento. Ela nao muda quando o cadastro do equipamento e
 * corrigido depois (item 63): a foto e prova de como o aparelho estava naquele
 * dia, e prova que se altera sozinha nao e prova.
 */
export const equipmentMedia = mysqlTable(
  'equipment_media',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    equipmentId: idRef('equipment_id').notNull(),
    /** Nulo quando a foto pertence ao cadastro, nao a um recebimento. */
    intakeId: idRef('intake_id'),

    kind: mysqlEnum('kind', MEDIA_KINDS).notNull().default('general'),

    /** Chave opaca no storage. Nunca e caminho absoluto nem nome enviado. */
    storageKey: varchar('storage_key', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 40 }).notNull(),
    byteSize: int('byte_size').notNull(),
    width: int('width'),
    height: int('height'),
    /** SHA-256: integridade e deteccao de reenvio do mesmo arquivo. */
    checksum: varchar('checksum', { length: 64 }).notNull(),
    /** Descricao curta digitada pelo atendente. */
    caption: varchar('caption', { length: 200 }),

    createdBy: idRef('created_by'),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_media_equipment_tenant',
      columns: [table.equipmentId, table.tenantId],
      foreignColumns: [equipment.id, equipment.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({
      name: 'fk_media_intake_tenant',
      columns: [table.intakeId, table.tenantId],
      foreignColumns: [equipmentIntakes.id, equipmentIntakes.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    unique('uq_media_id_tenant').on(table.id, table.tenantId),
    index('ix_media_equipment').on(table.equipmentId),
    index('ix_media_intake').on(table.intakeId),
  ],
);

/**
 * Leituras de etiqueta (itens 33 a 39, 48 e 49).
 *
 * Guarda a TENTATIVA de leitura automatica, separada do cadastro: os campos do
 * equipamento continuam sendo o que o humano confirmou (item 39), e esta tabela
 * responde "de onde veio a sugestao" sem poluir `equipment` com uma coluna de
 * procedencia por campo (item 48).
 *
 * `fields` guarda valor e confianca por campo, como o provider devolveu. Se o
 * atendente corrigir, o equipamento fica com o valor corrigido e a leitura
 * preserva o que fora sugerido — o que permite, um dia, medir a qualidade do
 * provider sem adivinhar (item 50).
 */
export const equipmentLabelReadings = mysqlTable(
  'equipment_label_readings',
  {
    id: id().primaryKey(),
    tenantId: tenantId().notNull(),
    equipmentId: idRef('equipment_id'),
    mediaId: idRef('media_id'),

    /** Nome do provider que produziu o resultado. `none` quando indisponivel. */
    provider: varchar('provider', { length: 60 }).notNull(),
    status: mysqlEnum('status', ['succeeded', 'partial', 'failed', 'unavailable']).notNull(),
    /** Campos sugeridos, com confianca. Nunca sobrescreve o confirmado. */
    fields: json('fields'),

    confirmedAt: instant('confirmed_at'),
    confirmedBy: idRef('confirmed_by'),

    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'fk_label_reading_equipment_tenant',
      columns: [table.equipmentId, table.tenantId],
      foreignColumns: [equipment.id, equipment.tenantId],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    index('ix_label_reading_equipment').on(table.equipmentId),
  ],
);

export type EquipmentRow = typeof equipment.$inferSelect;
export type EquipmentIntakeRow = typeof equipmentIntakes.$inferSelect;
export type EquipmentMediaRow = typeof equipmentMedia.$inferSelect;

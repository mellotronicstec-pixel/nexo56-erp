import { datetime, varchar, decimal } from 'drizzle-orm/mysql-core';

/**
 * Convenções de colunas do Nexo56 (Prompt 02, itens 19 a 27).
 *
 * Este módulo é a fonte única das convenções físicas do modelo. Todo módulo
 * novo monta suas tabelas com estes helpers, em vez de redeclarar tipos à mão —
 * é o que impede que `created_at` vire `datetime` em uma tabela e `timestamp`
 * em outra, ou que dinheiro apareça como `float` em algum canto.
 *
 * Ver docs/database/conventions.md.
 */

// ---------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------

/** ID técnico: UUIDv7 em CHAR(36). Nunca é o número humano de um documento. */
export const id = () => varchar('id', { length: 36 });

/** Referência a um ID técnico de outra entidade. */
export const idRef = (name: string) => varchar(name, { length: 36 });

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * Ownership de tenant. Obrigatório em toda entidade de negócio.
 * A FK correspondente é declarada na tabela (com `references`), porque a
 * política de exclusão varia conforme a entidade.
 */
export const tenantId = () => varchar('tenant_id', { length: 36 });

/**
 * Ownership de unidade.
 *
 * Obrigatório nas entidades cuja operação pertence necessariamente a uma
 * unidade (OS, estoque físico, movimentação, caixa) — ver a matriz em
 * docs/database/ownership-matrix.md. Opcional quando a unidade é apenas
 * procedência informativa.
 */
export const unitId = () => varchar('unit_id', { length: 36 });

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

/**
 * Instante (ponto na linha do tempo), sempre gravado em UTC.
 *
 * `DATETIME(3)` e não `TIMESTAMP`: o TIMESTAMP do MariaDB converte pelo fuso
 * da sessão, o que faria o valor depender de como o servidor está configurado.
 * O pool fixa `timezone: 'Z'`, então o que entra e sai é UTC puro.
 */
export const instant = (name: string) => datetime(name, { mode: 'date', fsp: 3 });

/**
 * Data civil (sem hora): vencimento, competência, data de garantia.
 *
 * Semanticamente diferente de um instante: "vence em 10/03" é o dia inteiro no
 * fuso do tenant, não um ponto exato em UTC. Guardada como texto ISO
 * `YYYY-MM-DD` para não sofrer conversão de fuso nenhuma.
 */
export const civilDate = (name: string) => varchar(name, { length: 10 });

/** Carimbos de criação e atualização. Presentes em toda entidade persistente. */
export const timestamps = () => ({
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
});

// ---------------------------------------------------------------------------
// Autoria
// ---------------------------------------------------------------------------

/**
 * Quem criou e quem alterou por último.
 *
 * Nulo é significativo e legítimo: a linha foi criada pelo sistema (bootstrap,
 * job, migration), não por uma pessoa. Não confundir com "desconhecido".
 *
 * Não substitui a auditoria: responde "quem mexeu por último", enquanto o
 * AuditLog guarda a sequência completa de quem mexeu em quê e quando.
 */
export const actorColumns = () => ({
  createdBy: idRef('created_by'),
  updatedBy: idRef('updated_by'),
});

// ---------------------------------------------------------------------------
// Arquivamento / soft delete
// ---------------------------------------------------------------------------

/**
 * Soft delete com contexto temporal e autoria (Prompt 02, itens 26 e 27).
 *
 * Deliberadamente NÃO é um booleano `is_deleted`: perder "quando" e "por quem"
 * inviabiliza investigar um sumiço de registro depois.
 *
 * Use apenas onde a política de docs/database/conventions.md manda. Entidade
 * com ciclo de vida real prefere `status`; histórico e auditoria não se apagam.
 */
export const softDelete = () => ({
  deletedAt: instant('deleted_at'),
  deletedBy: idRef('deleted_by'),
  deletedReason: varchar('deleted_reason', { length: 400 }),
});

// ---------------------------------------------------------------------------
// Dinheiro e quantidade
// ---------------------------------------------------------------------------

/**
 * Valor monetário final, em BRL (Prompt 02, item 19).
 *
 * `DECIMAL(14,2)` — exato, nunca `float`/`double`. O driver devolve string, e o
 * código a converte com a abstração Money (src/core/money), nunca com
 * `parseFloat`.
 *
 * Teto: 999.999.999.999,99 — folgado para o domínio de assistência técnica.
 */
export const money = (name: string) => decimal(name, { precision: 14, scale: 2 });

/**
 * Valor monetário que exige precisão intermediária maior: custo unitário,
 * rateio, quantidade × custo. `DECIMAL(14,4)`. O arredondamento para 2 casas
 * acontece uma única vez, no valor final apresentado ou cobrado.
 */
export const moneyPrecise = (name: string) => decimal(name, { precision: 14, scale: 4 });

/**
 * Quantidade — NÃO é dinheiro (Prompt 02, item 22).
 *
 * `DECIMAL(14,4)` porque estoque pode ser fracionário (metros de cabo, gramas
 * de pasta térmica, litros). Inteiro universal travaria isso para sempre.
 */
export const quantity = (name: string) => decimal(name, { precision: 14, scale: 4 });

/** Código de moeda ISO 4217. BRL é o padrão; a coluna evita retrabalho depois. */
export const currency = (name = 'currency') => varchar(name, { length: 3 });

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/**
 * Chave técnica estável (permission key, feature key, event type, sequence
 * type). Regras em docs/database/conventions.md: minúsculas, sem acento,
 * `[a-z0-9._-]`, normalizada na aplicação antes de gravar.
 */
export const techKey = (name: string, length = 96) => varchar(name, { length });

/** Correlation ID propagado entre request, auditoria, evento e job. */
export const correlationId = () => varchar('correlation_id', { length: 36 });

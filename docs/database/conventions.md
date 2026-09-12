# Convenções de modelagem — Nexo56

Regras que **todo módulo novo** segue. Implementadas como código reutilizável em
`src/core/db/columns.ts`, para que a convenção não dependa de memória.

---

## 1. Nomenclatura

| Elemento          | Convenção               | Exemplo                     |
| ----------------- | ----------------------- | --------------------------- |
| Tabela            | `snake_case`, plural    | `service_orders`            |
| Coluna            | `snake_case`, singular  | `tenant_id`                 |
| Chave primária    | `id`                    | `id`                        |
| Chave estrangeira | `<entidade>_id`         | `client_id`                 |
| Índice            | `ix_<tabela>_<colunas>` | `ix_users_tenant_status`    |
| Índice único      | `uq_<tabela>_<colunas>` | `uq_users_tenant_email`     |
| FK nomeada        | `fk_<tabela>_<relação>` | `fk_user_units_unit_tenant` |
| Propriedade TS    | `camelCase`             | `tenantId`                  |

Estruturas do Prompt 01 **não são renomeadas**: FKs geradas automaticamente
mantêm o nome do Drizzle (`users_tenant_id_tenants_id_fk`). Só as FKs novas
seguem o padrão `fk_`.

---

## 2. Identificadores

- **ID técnico:** UUIDv7 em `CHAR(36)`, gerado pela aplicação (`newId()`).
  Não enumerável externamente, mas ordenado por tempo — preserva a localidade
  de inserção no índice clusterizado do InnoDB.
- **Número humano:** coluna própria (`number`, `numero`), alimentada por
  `tenant_sequences`. **Nunca** é chave primária.
- **Nunca** usar CPF, CNPJ, e-mail ou código de negócio como chave primária.

---

## 3. Ownership

Toda tabela declara seu escopo em `docs/database/ownership-matrix.md`:

| Escopo               | Regra                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| **global**           | Sem `tenant_id`. Só catálogo do produto (`features`, `permissions`, `plans`). Nunca por conveniência. |
| **tenant**           | `tenant_id NOT NULL` + FK + índice iniciado por `tenant_id`.                                          |
| **tenant + unidade** | Também `unit_id NOT NULL`, com FK composta `(unit_id, tenant_id)`.                                    |
| **associação**       | Chave primária composta pelas duas pontas; FKs compostas quando cruzam tenant.                        |
| **histórico**        | Somente inserção. Nunca `UPDATE`, nunca `DELETE`.                                                     |

---

## 4. Tempo (itens 23 e 24)

Três conceitos, três tratamentos — misturá-los é origem clássica de bug:

| Conceito       | Tipo                           | Uso                                                        |
| -------------- | ------------------------------ | ---------------------------------------------------------- |
| **Instante**   | `DATETIME(3)` em **UTC**       | `created_at`, `expires_at` — ponto exato na linha do tempo |
| **Data civil** | `VARCHAR(10)` ISO `YYYY-MM-DD` | vencimento, competência, início/fim de garantia            |
| **Duração**    | `INT` de minutos/dias          | prazo de follow-up, validade de orçamento                  |

- Instante é sempre gravado em UTC. O pool fixa `timezone: 'Z'`, então nada
  depende do fuso do servidor.
- **`DATETIME` e não `TIMESTAMP`:** o `TIMESTAMP` converte pelo fuso da sessão,
  o que faria o valor depender de configuração de ambiente.
- **Data civil não é instante.** "Vence em 10/03" é o dia inteiro no fuso do
  tenant; guardar como instante criaria o bug de virar 09/03 em outro fuso.
- Conversão para horário local acontece na apresentação, com
  `Intl.DateTimeFormat` e o `timezone` do tenant (unidade pode sobrepor).

---

## 5. Dinheiro e quantidade (itens 19 a 22)

| Uso                                          | Tipo               | Helper           |
| -------------------------------------------- | ------------------ | ---------------- |
| Valor final (preço, pagamento, total)        | `DECIMAL(14,2)`    | `money()`        |
| Valor intermediário (custo unitário, rateio) | `DECIMAL(14,4)`    | `moneyPrecise()` |
| Quantidade                                   | `DECIMAL(14,4)`    | `quantity()`     |
| Moeda                                        | `CHAR(3)` ISO 4217 | `currency()`     |

- **Nunca** `FLOAT`/`DOUBLE`.
- No código, valor monetário passa por `Money` (`src/core/money`), que trabalha
  em centavos inteiros (`bigint`). **Nunca** `parseFloat` em coluna monetária.
- Quantidade **não é dinheiro**: é decimal porque estoque pode ser fracionário
  (metros de cabo, gramas de pasta térmica).
- Moeda inicial `BRL`. Símbolo e formatação pertencem à apresentação — `"R$"`
  não aparece em regra de negócio.

---

## 6. Status, enums e classificações (itens 30 a 32)

- Entidade com ciclo de vida usa **`status` explícito**, nunca combinação de
  booleanos (`is_active` + `is_cancelled` produz estados impossíveis).
- **Enum do banco** para conjuntos pequenos e estáveis (`active`/`inactive`).
  Acrescentar valor é `ALTER TABLE` — aceitável nessa frequência.
- **Tabela catálogo** quando o conjunto é configurável pelo tenant ou carrega
  atributos próprios (cor, ordem, regra).
- **Estado ≠ classificação.** `Aguardando Conserto` é estado da OS;
  `Garantia Interna` é classificação. Vivem em colunas diferentes.

---

## 7. Nulos e strings vazias (itens 37 e 38)

`NULL` tem significado e é escolhido, não herdado:

| Situação              | Representação                  |
| --------------------- | ------------------------------ |
| Obrigatório           | `NOT NULL`                     |
| Opcional, ausente     | `NULL`                         |
| Não aplicável         | `NULL` + comentário explicando |
| Texto informado vazio | `''` (distinto de `NULL`)      |

Regra de normalização: a aplicação converte string vazia para `NULL` em campos
opcionais **antes** de gravar, para não conviver com dois "vazios" diferentes.
Campo obrigatório rejeita string vazia na validação.

---

## 8. Soft delete e arquivamento (itens 26 e 27)

Não se aplica soft delete em tudo. A política por categoria:

| Categoria                                             | Política                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| Dado mestre (cliente, equipamento, fornecedor)        | `status` de inativação; soft delete só quando houver exigência legal de remoção |
| Documento de negócio (OS, orçamento, pagamento)       | **Nunca** apagar — cancelamento é estado                                        |
| Histórico e auditoria                                 | **Nunca** apagar, nunca alterar                                                 |
| Associação técnica (`user_units`, `role_permissions`) | Hard delete aceitável — não destrói histórico                                   |
| Configuração (`tenant_features`)                      | Desativação preserva a linha e os dados                                         |

Quando soft delete for necessário, use `softDelete()`: `deleted_at`,
`deleted_by`, `deleted_reason`. **Nunca** apenas `is_deleted` — perder "quando"
e "por quem" inviabiliza investigar o sumiço de um registro.

Toda consulta em tabela com soft delete filtra `deleted_at IS NULL` por padrão.

---

## 9. Foreign keys (itens 33 e 34)

| Política   | Quando                                                              |
| ---------- | ------------------------------------------------------------------- |
| `RESTRICT` | Padrão. Protege histórico e dado de negócio de destruição acidental |
| `CASCADE`  | Só em associação pura, cuja existência isolada não faz sentido      |
| `SET NULL` | Referência opcional cuja ausência é estado válido                   |

**FK composta para coerência de tenant.** Uma FK simples garante que o registro
existe, não que pertence ao mesmo tenant. Onde houver risco de associação
cruzada, a FK inclui `tenant_id`:

```sql
FOREIGN KEY (unit_id, tenant_id) REFERENCES units (id, tenant_id)
```

Isso exige a chave composta alvo (`UNIQUE (id, tenant_id)`) na tabela pai.
Ver `docs/database/schema.md`.

---

## 10. Índices (item 35)

- Em tabela tenant-aware, índice de consulta **começa por `tenant_id`**, e por
  `(tenant_id, unit_id)` quando a operação é por unidade.
- Indexar o que atende consulta previsível: status, responsável, datas,
  cliente, equipamento, número humano, follow-up.
- **Não** criar índice especulativo: cada índice custa em toda escrita.
- Verificar com `EXPLAIN` antes de acrescentar índice por suposição.

---

## 11. JSON (item 39)

Permitido para: metadata, snapshot, payload de evento, configuração flexível.

**Proibido** como substituto de modelagem: cliente, equipamento, item,
pagamento, fornecedor, relacionamento e estoque são tabelas com colunas e FKs.

---

## 12. Charset e collation (itens 78 a 80)

Tudo em `utf8mb4` / `utf8mb4_unicode_ci`, fixado por tabela — não herdado do
servidor.

`utf8mb4_unicode_ci` é **case-insensitive e accent-insensitive**. Consequências
tratadas conscientemente:

| Dado                                                             | Efeito                                    | Tratamento                                                                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| E-mail                                                           | `Joao@x.com` = `joao@x.com` na comparação | A aplicação normaliza para minúsculas antes de gravar. O índice único evita duplicata por diferença de caixa — comportamento desejado |
| Slug do tenant                                                   | `Empresa` = `empresa`                     | Gerado sempre em minúsculas pelo `slugify`                                                                                            |
| Chave técnica (`permission key`, `feature key`, `sequence type`) | `ADMIN.ACCESS` = `admin.access`           | A aplicação normaliza para minúsculas; o catálogo só declara minúsculas                                                               |
| Nome de cliente/equipamento                                      | Busca ignora acento e caixa               | **Desejável** — "José" encontra "jose"                                                                                                |

Regra das chaves técnicas: minúsculas, sem acento, `[a-z0-9._-]`, normalizadas
antes de gravar.

---

## 13. Paginação e ordenação (itens 57 e 58)

| Estratégia | Uso                                                                               |
| ---------- | --------------------------------------------------------------------------------- |
| **Offset** | Telas administrativas com "página 3 de 12" — listas curtas e estáveis             |
| **Cursor** | Timeline, movimentação, auditoria, eventos — listas longas que crescem pela ponta |

Ordenação **sempre determinística**: `<coluna> DESC, id DESC`. O desempate por
`id` não é opcional — com UUIDv7 duas linhas do mesmo milissegundo teriam ordem
indefinida e a paginação repetiria ou perderia registro.

Implementação em `src/core/db/pagination.ts`.

---

## 14. Campos padrão (item 25)

Entidade persistente de negócio:

```
id · tenant_id · [unit_id] · <colunas do domínio> · status
created_at · updated_at · created_by · updated_by · [soft delete]
```

Tabela de associação é diferente: chave primária composta, sem `id`, sem
`updated_at`, normalmente só `created_at`.

`created_by`/`updated_by` nulos são legítimos: a linha nasceu do sistema
(bootstrap, job, migration), não de uma pessoa.

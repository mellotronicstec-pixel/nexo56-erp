# Modelo de dados — Orçamento

Migration: `drizzle/0007_quotes.sql` — **puramente aditiva** (0 `DROP`, 0
`TRUNCATE`, 0 `MODIFY`; nenhuma migration publicada editada).

## Tabelas

| Tabela           | Dono                          | Papel                        |
| ---------------- | ----------------------------- | ---------------------------- |
| `quotes`         | **tenant + unidade (via OS)** | a proposta                   |
| `quote_items`    | via orçamento                 | as linhas comerciais         |
| `quote_timeline` | via orçamento                 | fatos, em ordem, append-only |

## `quotes`

| Coluna                            | Observação                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `service_order_id`                | a OS a que a proposta pertence. FK composta com `tenant_id` **e** com `unit_id` |
| `unit_id`                         | **redundante de propósito** — ver abaixo                                        |
| `number`                          | inteiro; sequência do **tenant**, compartilhada entre unidades                  |
| `revision`                        | 1 na primeira versão; a revisão é linha nova com o **mesmo** número             |
| `supersedes_quote_id`             | a versão que esta revisão substitui. Nulo na primeira                           |
| `status`                          | `varchar(20)`; as sete situações do [ciclo de vida](lifecycle.md)               |
| `active_marker`                   | `1` enquanto rascunho ou enviado, `NULL` depois — **uma proposta viva por OS**  |
| `approved_marker`                 | `1` só na versão aprovada — **uma aprovação por OS**                            |
| `subtotal` / `discount` / `total` | `DECIMAL(14,2)`; recalculados pelo backend a cada gravação                      |
| `currency`                        | `BRL`. A coluna existe para o dia em que não for                                |
| `valid_until`                     | **data civil** ISO no fuso da empresa. Nula: não há prazo padrão                |
| `customer_notes`                  | texto que o cliente verá                                                        |
| `internal_notes`                  | recado da equipe; não vai ao cliente                                            |
| `sent_at` / `sent_by`             | quando e por quem a proposta foi formalizada                                    |
| `decided_at` / `decided_by`       | quando e quem **registrou** a decisão do cliente                                |
| `decision_source`                 | hoje sempre `internal` — ver [permissions](permissions.md)                      |
| `decision_reason`                 | motivo da recusa ou do cancelamento. Texto livre de pessoa                      |
| `version`                         | concorrência otimista, mesmo padrão da OS                                       |
| `idempotency_key`                 | mesmo comando não cria dois orçamentos                                          |

### Por que `unit_id` é repetido, se a OS já tem

Para que a coerência de unidade seja um fato do **banco**, e não uma promessa da
aplicação:

```sql
FOREIGN KEY (service_order_id, unit_id) REFERENCES service_orders(id, unit_id)
```

Sem a coluna, um orçamento da Unidade A pendurado numa OS da Unidade B
dependeria só de o código lembrar de checar — e checagem de aplicação some no dia
em que alguém escreve um segundo caminho de criação. É a mesma técnica que
`uq_intake_id_unit` usou no Prompt 07 para amarrar recebimento e OS, e por isso a
0007 acrescenta, de forma aditiva, `uq_service_order_id_unit` em
`service_orders`.

### Os dois marcadores

```sql
UNIQUE uq_quote_active   (service_order_id, active_marker)
UNIQUE uq_quote_approved (service_order_id, approved_marker)
```

No MySQL cada `NULL` conta como distinto num índice UNIQUE. Com o marcador
valendo `1` só enquanto a condição é verdadeira:

- **uma proposta viva por OS** — rascunhos e propostas enviadas não se acumulam;
- **uma versão aprovada por OS** — o cenário de duas aprovações concorrentes
  (item 66) é impossível no banco, não apenas improvável no código.

Encerradas, elas liberam o lugar: uma revisão pode nascer. Mesmo padrão do
contato principal do cliente (Prompt 05) e da tarefa aberta (Prompt 08).

## Proteção cross-tenant e cross-unit

Toda FK é composta:

| Constraint                                            | Garante                                       |
| ----------------------------------------------------- | --------------------------------------------- |
| `fk_quote_order_tenant (service_order_id, tenant_id)` | OS da mesma empresa                           |
| **`fk_quote_order_unit (service_order_id, unit_id)`** | **orçamento na mesma unidade da OS**          |
| `fk_quote_unit_tenant (unit_id, tenant_id)`           | unidade da mesma empresa                      |
| `fk_quote_supersedes_tenant`                          | a revisão aponta para versão da mesma empresa |
| `fk_quote_created_by/sent_by/decided_by_tenant`       | autoria tenant-safe                           |
| `fk_quote_item_quote_tenant`                          | a linha presa ao seu orçamento e empresa      |

`ON DELETE`: `restrict` para a OS e a unidade — nada que tenha orçamento
desaparece por acidente; `cascade` de `quote_items` e `quote_timeline` para o
orçamento, porque a linha não tem vida própria sem ele.

## Restrições únicas

| Constraint                        | Efeito                                    |
| --------------------------------- | ----------------------------------------- |
| `uq_quote_tenant_number_revision` | **número + revisão** únicos por empresa   |
| `uq_quote_active`                 | uma proposta viva por OS                  |
| `uq_quote_approved`               | uma versão aprovada por OS                |
| `uq_quote_idempotency`            | o mesmo comando não cria dois orçamentos  |
| `uq_quote_id_tenant`              | alvo das FKs compostas das tabelas filhas |

## Índices

| Índice                    | Serve a                                       |
| ------------------------- | --------------------------------------------- |
| `ix_quote_order`          | orçamentos de uma OS, na ordem número/revisão |
| `ix_quote_unit_status`    | fila comercial da unidade por situação        |
| `ix_quote_tenant_number`  | busca pelo número exato                       |
| `ix_quote_valid_until`    | varredura de validade vencida (o job)         |
| `ix_quote_tenant_created` | listagem cronológica                          |
| `ix_quote_item_quote`     | itens de um orçamento, na ordem de exibição   |

## `quote_items`

`kind` (`service` \| `part` \| `other`), `description` **obrigatória**,
`quantity DECIMAL(14,4)`, `unit_price`, `discount` e `total DECIMAL(14,2)`, e
`position` para a ordem de exibição.

**`part` aqui continua não sendo estoque.** A linha guarda o que foi
**proposto** ao cliente: descrição, quantidade e valor escritos por quem orçou.
Salvar, enviar ou aprovar não reserva e não movimenta nada.

O Prompt 10 acrescentou `part_id` — **aditiva e anulável**, exatamente como este
documento previa. Nulo é o estado normal e permanente de uma linha escrita à
mão, e todas as linhas anteriores continuam válidas assim. Escolher a peça
preenche descrição e valor **como conveniência, no momento da escolha**; dali em
diante o orçamento guarda os próprios números, e renomear ou reprecificar a peça
não muda proposta nenhuma (ADR-047).

Continua não havendo referência a fornecedor nem a SKU. O teste arquitetural
mudou de alvo: agora garante que a **camada de aplicação** do orçamento não
conhece estoque, e que nenhum arquivo do módulo chama caso de uso de estoque.

## Upgrade

`tests/integration/migration-upgrade.test.ts` leva um banco no estado do Prompt
08 — **com Ordens de Serviço em vários estados, versões, prazos de
acompanhamento e tarefas abertas** — até o Prompt 09. Nada é perdido nem
reescrito: situação, versão, prazo e relato seguem idênticos (item 118). O mesmo
teste verifica, no banco migrado, que a incoerência de unidade, a segunda
proposta viva, o número+revisão repetido e a OS de outra empresa são recusados
pelo banco, e que apagar o orçamento leva seus itens junto enquanto a OS
permanece protegida.

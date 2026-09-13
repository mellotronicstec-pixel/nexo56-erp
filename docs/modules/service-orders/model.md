# Modelo de dados — Ordem de Serviço

Migrations: `drizzle/0005_service_orders.sql` (Prompt 07) e
`drizzle/0006_service_order_workflow.sql` (Prompt 08) — ambas **puramente
aditivas** (0 `DROP`, 0 `TRUNCATE`, nenhuma migration publicada editada).

## Tabelas

| Tabela                   | Dono                 | Papel                        | Prompt |
| ------------------------ | -------------------- | ---------------------------- | ------ |
| `service_orders`         | **tenant + unidade** | o atendimento                | 07     |
| `service_order_timeline` | via ordem            | fatos, em ordem, append-only | 07     |
| `service_order_tasks`    | **tenant + unidade** | trabalho prático da ordem    | 08     |

## `service_orders`

| Coluna                      | Observação                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `unit_id`                   | **obrigatório**, vem de `context.activeUnitId`, nunca do formulário                |
| `number`                    | inteiro sem sinal; **só o valor**, sem prefixo (ver [numbering](numbering.md))     |
| `customer_id`               | dono do aparelho; derivado do equipamento, não aceito da entrada                   |
| `equipment_id`              | aparelho atendido                                                                  |
| `intake_id`                 | recebimento de origem; **nulo** quando a OS nasceu direto do cadastro              |
| `status`                    | `varchar(40)`; os nove estados do [workflow](workflow.md)                          |
| `customer_report`           | o que o cliente disse — **não é diagnóstico**                                      |
| `internal_notes`            | recado da equipe; não vai ao cliente                                               |
| `opened_at`                 | instante da abertura, UTC                                                          |
| `idempotency_key`           | chave do comando; nula quando não informada                                        |
| `created_by` / `updated_by` | autoria, com FK tenant-safe                                                        |
| `status_changed_at`         | **P08** — instante da última transição, UTC; nulo nas ordens anteriores à migração |
| `version`                   | **P08** — concorrência otimista; sobe a cada transição, começa em 1                |
| `assigned_technician_id`    | **P08** — responsável; FK composta com `tenant_id`                                 |
| `follow_up_at`              | **P08** — data civil ISO no fuso da empresa (ver [follow-ups](follow-ups.md))      |
| `follow_up_alerted_for`     | **P08** — prazo para o qual o evento de vencimento já saiu                         |

### Por que `status` é `varchar` e não `ENUM`

Porque o Prompt 08 acrescentou estados, e um `ENUM` obrigaria
`ALTER TABLE … MODIFY COLUMN` a cada novo. A decisão pagou: os **oito estados
restantes entraram sem tocar na estrutura da coluna**, e a 0006 não contém um
único `MODIFY`.

### Por que `version` e não `updated_at`

Comparar `updated_at` exigiria confiar na precisão do relógio e falharia quando
duas gravações caem no mesmo milissegundo. Um inteiro que só sobe é exato e não
depende de relógio nenhum. Ver [ADR-038](../../adr/ADR-038-concorrencia-otimista.md).

### Por que as datas de acompanhamento são texto, e não `DATE`/`DATETIME`

Porque "+2 dias" é um **dia civil** no fuso de quem opera, não um instante. Ver
[ADR-017](../../adr/ADR-017-datas-e-timezone.md) e [follow-ups](follow-ups.md).

## Proteção cross-tenant e cross-unit no banco

Toda FK é **composta**:

| Constraint                                                    | Garante                                       |
| ------------------------------------------------------------- | --------------------------------------------- |
| `fk_service_order_customer_tenant (customer_id, tenant_id)`   | cliente da mesma empresa                      |
| `fk_service_order_equipment_tenant (equipment_id, tenant_id)` | equipamento da mesma empresa                  |
| `fk_service_order_unit_tenant (unit_id, tenant_id)`           | unidade da mesma empresa                      |
| `fk_service_order_intake_tenant (intake_id, tenant_id)`       | recebimento da mesma empresa                  |
| **`fk_service_order_intake_unit (intake_id, unit_id)`**       | **a OS está na mesma unidade do recebimento** |
| `fk_service_order_created_by_tenant (created_by, tenant_id)`  | autor da mesma empresa                        |
| `fk_so_timeline_order_tenant`                                 | fato preso à sua ordem e empresa              |

A penúltima é a mais interessante: ela é o motivo de `uq_intake_id_unit` ter
sido acrescentado a `equipment_intakes` (de forma aditiva, na 0005). Sem ela, a
coerência de unidade entre recebimento e OS dependeria apenas da aplicação — e
checagem de aplicação some no dia em que alguém escreve um segundo caminho de
criação. Há teste que tenta a incoerência por SQL direto e espera
`ER_NO_REFERENCED_ROW` (1452).

`ON DELETE`: `restrict` para cliente, equipamento, unidade, recebimento e autor
— nada que tenha OS desaparece por acidente; `cascade` da linha do tempo para a
ordem.

## Restrições únicas

| Constraint                       | Efeito                                      |
| -------------------------------- | ------------------------------------------- |
| `uq_service_order_tenant_number` | **um número, uma OS** por empresa           |
| `uq_service_order_intake`        | um recebimento origina **uma** OS principal |
| `uq_service_order_idempotency`   | o mesmo comando não cria duas ordens        |
| `uq_service_order_id_tenant`     | alvo das FKs compostas das tabelas filhas   |

As duas do meio convivem com `NULL`: no MySQL cada `NULL` conta como distinto,
então ordens sem recebimento e sem chave de comando não colidem entre si.

## Índices

| Índice                                | Serve a                                            |
| ------------------------------------- | -------------------------------------------------- |
| `ix_service_order_tenant_unit_opened` | fila da unidade, mais recentes primeiro            |
| `ix_service_order_tenant_number`      | **busca pelo número exato** — a consulta do balcão |
| `ix_service_order_tenant_customer`    | ordens de um cliente                               |
| `ix_service_order_tenant_equipment`   | histórico de um aparelho                           |
| `ix_service_order_tenant_status`      | filtro por situação                                |
| `ix_so_timeline_order_occurred`       | linha do tempo de uma ordem                        |
| `ix_service_order_unit_status`        | **P08** — fila da unidade filtrada por situação    |
| `ix_service_order_follow_up`          | **P08** — varredura de follow-ups vencidos         |
| `ix_service_order_technician`         | **P08** — ordens de um responsável                 |
| `ix_so_task_order`                    | **P08** — tarefas de uma ordem                     |
| `ix_so_task_unit_due`                 | **P08** — tarefas atrasadas da unidade             |
| `ix_so_task_assignee`                 | **P08** — tarefas de uma pessoa                    |

Todo índice começa por `tenant_id`.

## `service_order_timeline`

`id`, `tenant_id`, `service_order_id`, `kind` (texto), `summary`, `metadata`
(JSON), `actor_id`, `occurred_at`. Append-only.

Ganhou `reason varchar(300)` no Prompt 08: a justificativa escrita de uma
transição é do fato, não do resumo.

`kind` é texto, e foi exatamente por isso que o Prompt 08 acrescentou
`status_changed`, `technician_assigned`, `follow_up_rescheduled`,
`part_pickup_requested`, `task_completed` e `customer_notification_requested`
**sem migration**.

Nem `summary`, nem `metadata`, nem `reason` carregam o relato do cliente — há
teste que falha se carregarem. `metadata` guarda só chaves técnicas
(`{ from, to, via }`).

## `service_order_tasks`

`id`, `tenant_id`, `unit_id`, `service_order_id`, `kind`, `title`,
`description`, `assignee_id`, `due_date` (data civil), `status`, `open_marker`,
`created_by`, `completed_at`, `completed_by`.

| Constraint                                                  | Garante                                   |
| ----------------------------------------------------------- | ----------------------------------------- |
| `fk_so_task_order_tenant` (`cascade`)                       | tarefa presa à sua ordem e empresa        |
| `fk_so_task_unit_tenant` (`restrict`)                       | unidade da mesma empresa                  |
| `fk_so_task_assignee_tenant` (`restrict`)                   | responsável da mesma empresa              |
| **`uq_so_task_open (service_order_id, kind, open_marker)`** | **uma tarefa aberta por tipo, por ordem** |

`open_marker` vale `1` enquanto a tarefa está aberta e `NULL` depois. Como o
MySQL trata cada `NULL` como distinto num UNIQUE, duas tarefas **abertas** do
mesmo tipo são impossíveis, e as encerradas se acumulam à vontade. É o mesmo
padrão do contato principal do cliente (Prompt 05). Ver [tasks](tasks.md).

## Upgrade

`tests/integration/migration-upgrade.test.ts` cobre cada degrau.

**06 → 07**: um banco com cliente, equipamento, recebimento e sequência já em
uso recebe o Prompt 07 sem perder nada, a sequência continua no valor em que
estava, e a incoerência de unidade e o número repetido passam a ser recusados.

**07 → 08**: um banco com **Ordens de Serviço abertas e linha do tempo escrita**
recebe o Prompt 08. Nada é perdido nem reescrito — relato, observação interna,
situação e número seguem idênticos. As ordens antigas entram no workflow com
`version = 1`, `follow_up_at` nulo e `status_changed_at` nulo: **nenhum
follow-up retroativo**, porque uma OS parada há meses não deve aparecer
"vencida" no dia do deploy só porque a coluna passou a existir. O mesmo teste
verifica, no banco migrado, que duas tarefas abertas do mesmo tipo são recusadas
pelo banco, que encerrar uma libera espaço para a próxima, que um técnico de
outra empresa é recusado pela FK composta, e que apagar a ordem leva suas
tarefas junto.

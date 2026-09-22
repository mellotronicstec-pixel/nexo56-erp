# Agenda — modelo de dados

Migration **0013**. Duas tabelas novas, **nenhuma alteração** em tabela
existente além de uma correção de redação (ver [ADR-075](../../adr/ADR-075-compatibilidade-com-o-follow-up-historico.md)).

## `agenda_tasks`

| Coluna                                                              | Tipo           | Observação                                                   |
| ------------------------------------------------------------------- | -------------- | ------------------------------------------------------------ |
| `id`                                                                | `varchar(36)`  | UUIDv7                                                       |
| `tenant_id` / `unit_id`                                             | `varchar(36)`  | **ambos NOT NULL**: tarefa acontece em algum lugar           |
| `title`                                                             | `varchar(160)` | texto livre, escrito por uma pessoa                          |
| `notes`                                                             | `text`         |                                                              |
| `status`                                                            | `varchar(20)`  | `open` \| `done` \| `cancelled` — o vocabulário do Prompt 08 |
| `priority`                                                          | `varchar(10)`  | `low` \| `normal` \| `high` \| `urgent`                      |
| `due_date`                                                          | `varchar(10)`  | **data civil**, não instante                                 |
| `assignee_id` / `created_by`                                        | `varchar(36)`  |                                                              |
| `idempotency_key`                                                   | `varchar(120)` | chave de intenção; `UNIQUE (tenant_id, idempotency_key)`     |
| `service_order_id` / `customer_id` / `equipment_id` / `warranty_id` | `varchar(36)`  | **todos anuláveis**                                          |
| `completed_at` / `completed_by`                                     |                |                                                              |
| `cancelled_at` / `cancelled_by` / `cancel_reason`                   |                | cancelar exige motivo                                        |
| `version`                                                           | `int unsigned` | CAS otimista                                                 |

`CHECK` em `status` e `priority`.

## `agenda_appointments`

Mesma espinha, com a diferença que importa:

| Coluna                    | Tipo          | Observação                                         |
| ------------------------- | ------------- | -------------------------------------------------- |
| `status`                  | `varchar(20)` | `scheduled` \| `cancelled` — **não existe `done`** |
| `all_day`                 | `tinyint`     |                                                    |
| `start_at` / `end_at`     | `datetime(3)` | instantes UTC, só quando `all_day = 0`             |
| `start_date` / `end_date` | `varchar(10)` | datas civis, só quando `all_day = 1`               |

`CHECK (end_at > start_at)` e `CHECK (end_date >= start_date)`.

O par que não vale vai a `NULL` **explicitamente** ao reagendar: deixar o
antigo guardaria duas versões do "quando".

## Proteção de tenant e unidade no próprio banco

Chaves compostas, como no resto do sistema:

| FK                                | Colunas                       | Garante                               |
| --------------------------------- | ----------------------------- | ------------------------------------- |
| `fk_agenda_task_unit_tenant`      | `(unit_id, tenant_id)`        | unidade é da empresa                  |
| `fk_agenda_task_order_unit`       | `(service_order_id, unit_id)` | **a OS é da mesma unidade da tarefa** |
| `fk_agenda_task_customer_tenant`  | `(customer_id, tenant_id)`    | cliente é da empresa                  |
| `fk_agenda_task_equipment_tenant` | `(equipment_id, tenant_id)`   |                                       |
| `fk_agenda_task_warranty_tenant`  | `(warranty_id, tenant_id)`    |                                       |
| `fk_agenda_task_assignee_tenant`  | `(assignee_id, tenant_id)`    | responsável é da empresa              |

As mesmas seis para `agenda_appointments`, com o prefixo `fk_agenda_appt_`.

A validação de aplicação (`assertContextLinks`) não substitui essa rede: ela
existe porque um erro de integridade referencial chega ao usuário como falha
do sistema, quando o que houve foi um dado inválido no formulário.

## Índices

| Índice                      | Responde                                          |
| --------------------------- | ------------------------------------------------- |
| `ix_agenda_task_unit_due`   | a fila da unidade: o que venceu, o que vence hoje |
| `ix_agenda_task_assignee`   | "Minhas tarefas"                                  |
| `ix_agenda_task_order`      | tarefas de uma OS                                 |
| `ix_agenda_appt_unit_start` | agenda por intervalo (com horário)                |
| `ix_agenda_appt_unit_day`   | agenda por intervalo (dia inteiro)                |
| `ix_agenda_appt_assignee`   | compromissos de uma pessoa                        |
| `ix_agenda_appt_order`      | compromissos de uma OS                            |

## O que NÃO existe

- Nenhuma coluna `overdue` — é derivado ([ADR-074](../../adr/ADR-074-atraso-e-derivado-e-prazo-e-dia.md)).
- Nenhuma tabela `service_order_follow_ups` — nunca existiu ([ADR-075](../../adr/ADR-075-compatibilidade-com-o-follow-up-historico.md)).
- Nenhuma coluna de recorrência ou de lembrete.

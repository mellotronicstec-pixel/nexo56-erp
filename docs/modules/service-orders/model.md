# Modelo de dados — Ordem de Serviço

Migration: `drizzle/0005_service_orders.sql` — puramente aditiva (0 `DROP`, 0
`TRUNCATE`, nenhuma migration publicada editada).

## Tabelas

| Tabela                   | Dono                 | Papel                        |
| ------------------------ | -------------------- | ---------------------------- |
| `service_orders`         | **tenant + unidade** | o atendimento                |
| `service_order_timeline` | via ordem            | fatos, em ordem, append-only |

## `service_orders`

| Coluna                      | Observação                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `unit_id`                   | **obrigatório**, vem de `context.activeUnitId`, nunca do formulário                |
| `number`                    | inteiro sem sinal; **só o valor**, sem prefixo (ver [numbering](numbering.md))     |
| `customer_id`               | dono do aparelho; derivado do equipamento, não aceito da entrada                   |
| `equipment_id`              | aparelho atendido                                                                  |
| `intake_id`                 | recebimento de origem; **nulo** quando a OS nasceu direto do cadastro              |
| `status`                    | `varchar(40)`, um único valor hoje (ver [workflow-boundary](workflow-boundary.md)) |
| `customer_report`           | o que o cliente disse — **não é diagnóstico**                                      |
| `internal_notes`            | recado da equipe; não vai ao cliente                                               |
| `opened_at`                 | instante da abertura, UTC                                                          |
| `idempotency_key`           | chave do comando; nula quando não informada                                        |
| `created_by` / `updated_by` | autoria, com FK tenant-safe                                                        |

### Por que `status` é `varchar` e não `ENUM`

Porque o Prompt 08 vai acrescentar estados, e um `ENUM` obrigaria
`ALTER TABLE … MODIFY COLUMN` a cada novo. Uma coluna de texto recebe os
próximos estados sem tocar na estrutura — que é exatamente o critério
arquitetural do item 157.

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
| `ix_service_order_tenant_status`      | preparado para os filtros do Prompt 08             |
| `ix_so_timeline_order_occurred`       | linha do tempo de uma ordem                        |

Todo índice começa por `tenant_id`.

## `service_order_timeline`

`id`, `tenant_id`, `service_order_id`, `kind` (texto), `summary`, `metadata`
(JSON), `actor_id`, `occurred_at`. Append-only.

`kind` é texto justamente para o Prompt 08 acrescentar `status_changed` e os
demais sem migration. Nem `summary` nem `metadata` carregam o relato do cliente
— há teste que falha se carregarem.

## Upgrade

`tests/integration/migration-upgrade.test.ts` leva um banco no estado do Prompt
06, **com cliente, equipamento, recebimento e sequência já em uso**, até o
Prompt 07: nada é perdido, a sequência continua no valor em que estava, e as
duas tabelas novas aparecem. O mesmo teste verifica, no banco migrado, que a
incoerência de unidade e o número repetido são recusados.

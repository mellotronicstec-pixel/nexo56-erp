# Comunicação — performance

`EXPLAIN` em MariaDB com 4.000 mensagens na mesma unidade, mistura realista
dos cinco estados.

| Consulta                                          | `type`  | Índice                         | Extra                            |
| ------------------------------------------------- | ------- | ------------------------------ | -------------------------------- |
| Contagem total da unidade                         | `ref`   | `fk_comm_message_unit_tenant`  | **Using index** (cobertura)      |
| Contagem filtrada por situação                    | `ref`   | `ix_comm_message_unit_status`  | **Using index** (cobertura)      |
| Lista paginada (`ORDER BY created_at DESC LIMIT`) | `range` | `ix_comm_message_unit_created` | `Using where` — **sem filesort** |
| Job de recuperação (`queued` antigas)             | `ref`   | `ix_comm_message_pending`      | `Using index condition`          |

Diferente da Central de Trabalho, a ordenação aqui não usa expressão `CASE` —
é `created_at` puro — então o próprio índice composto
`(tenant_id, unit_id, created_at)` cobre a ordenação sem `filesort`.

## Número fixo de consultas

`listMessages` faz sempre duas consultas (contagem + página), independente do
total de linhas. Não há N+1: a lista já traz nome do cliente e número da OS
via `LEFT JOIN`, numa única consulta.

## Por que `communication_attempts` não preocupa

O índice `ix_comm_attempt_message (message_id, started_at)` cobre o único
acesso real à tabela — "as tentativas desta mensagem" —, que nunca cresce além
de poucas dezenas de linhas por mensagem.

## O índice do job de recuperação é global, de propósito

`ix_comm_message_pending (status, created_at)` não começa por `tenant_id`,
diferente de todos os outros índices da tabela. O job varre TODOS os tenants
procurando mensagens paradas — que é exatamente o trabalho dele —, e um índice
por tenant obrigaria uma consulta por tenant. Como `status = 'queued'` filtra
para uma fração pequena do total, o índice continua seletivo.

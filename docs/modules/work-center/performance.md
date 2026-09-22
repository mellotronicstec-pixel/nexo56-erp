# Central — performance

A Central tende a ser uma das telas mais abertas do sistema, então performance
é requisito, não detalhe.

## Número fixo de consultas

A Central faz o **mesmo número de consultas** independentemente de quantas OS
existam: decisões de acesso, contagem de filas, contagem de atenção, lista e
total.

**Medido, não prometido:** um teste de integração conta as consultas com 5 OS e
com 45 OS e exige que o número não cresça. Um N+1 acrescentaria quarenta, e
nenhuma tolerância razoável esconde isso.

## Plano de execução real

`EXPLAIN` em MariaDB com 4.000 OS (2.000 na unidade consultada):

| Consulta          | `type`        | Índice                         | Extra                               |
| ----------------- | ------------- | ------------------------------ | ----------------------------------- |
| Contagem por fila | `range`       | `ix_service_order_unit_status` | **Using index**                     |
| Filtro por fila   | `ref`         | `ix_service_order_unit_status` | **Using index**                     |
| Minha visão       | `index_merge` | técnico ∩ unidade              | intersect                           |
| Lista priorizada  | `ref`         | —                              | **Using temporary; Using filesort** |

## O `filesort`, declarado

A lista ordena por uma expressão `CASE`, e expressão não usa índice. Esse é o
custo conhecido da priorização.

**Nenhum índice novo foi criado**, porque nenhum resolveria: não existe índice
sobre uma expressão condicional em MariaDB. Criar índices especulativos custaria
escrita em todas as OS sem pagar nenhuma leitura.

Na escala atual o custo é irrelevante — ordenar alguns milhares de linhas leva
milissegundos — e filtrar por fila reduz drasticamente o conjunto, aí com
índice de cobertura.

**Quando isso vira problema:** uma unidade com dezenas de milhares de OS
simultaneamente abertas. A evolução natural é materializar a projeção; o read
model já está desenhado para isso, porque nada nele depende de estar sendo
calculado agora.

## Paginação

Offset, o padrão do projeto. `ORDER BY` termina em `so.number`, único por
empresa — sem isso, itens se repetiriam ou sumiriam entre páginas. Um teste com
60 OS percorre três páginas e prova que nenhum item aparece duas vezes e que a
ordem é crescente.

Limite máximo herdado da fundação (`MAX_PAGE_SIZE = 100`): `limit=100000` não
existe.

## Sem cache, sem job, sem fila

Nenhum cache distribuído. Nenhum job "atualizar a Central". Nenhuma projeção
assíncrona. Correção e simplicidade antes de arquitetura distribuída
prematura — e compatibilidade preservada com a hospedagem compartilhada inicial
(sem Redis, sem worker obrigatório).

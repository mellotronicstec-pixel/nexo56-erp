# Fronteira entre Ordem de Serviço e Estoque

Prompt 10. Decisões:
[ADR-045](../../adr/ADR-045-reserva-e-entidade-propria.md) ·
[ADR-037](../../adr/ADR-037-maquina-de-estados-centralizada.md).

## A regra

**O Estoque nunca escreve `service_orders.status`.**

Não há, em nenhum arquivo de `src/modules/inventory`, um
`update(serviceOrders)` com `status`, nem SQL cru equivalente, nem chamada a
`planTransition`, `applyTransition` ou `transitionServiceOrder`.

Verificado por teste de arquitetura (`tests/unit/inventory-boundary.test.ts`),
que percorre `src/` inteiro, remove comentários e falha se qualquer um desses
padrões aparecer.

## Por que nem sequer pelo caminho "certo"

O Prompt 09 permite ao Orçamento mover a OS — pelo workflow, na mesma
transação — porque **enviar um orçamento é uma decisão comercial que move o
atendimento**. Aprovar formaliza que o cliente autorizou o conserto.

Pegar uma peça na prateleira não é isso. O técnico pode estar testando uma
hipótese, conferindo compatibilidade, ou trocando uma peça que depois volta.
Deduzir a transição do consumo faria a Ordem de Serviço andar sozinha, e a
equipe passaria a evitar registrar consumo para não mexer no estado — que é
exatamente o contrário do que o registro existe para conseguir.

**Disponibilidade também não declara instalação** (item 49 do Prompt 10): ter a
peça em estoque não significa que a peça correta foi instalada.

## O que o Estoque escreve na OS

Fatos **resumidos** na linha do tempo:

| Tipo                        | Quando                                                 |
| --------------------------- | ------------------------------------------------------ |
| `part_reserved`             | peça reservada para esta OS                            |
| `part_reservation_released` | reserva liberada                                       |
| `part_consumed`             | peça consumida (saída vinculada ou consumo de reserva) |

A ficha mostra "2 un. de Tela LCD"; o detalhe — custo, localização, ator — vive
no ledger, na ficha da peça. Espelhar o ledger inteiro aqui transformaria o
histórico do atendimento num extrato de almoxarifado.

## Isolamento de unidade

A reserva e a movimentação vinculadas a uma OS pertencem à **unidade da OS**,
lida da própria ordem — nunca do formulário. As FKs compostas
`(service_order_id, unit_id)` em `stock_reservations` e `stock_movements` tornam
isso um fato do banco.

Para usar peça de outra unidade existe **transferência**, que é processo
explícito com duas movimentações correlacionadas.

## "Buscar Peça" continua sendo tarefa

A tarefa `part_pickup` do Prompt 08 **não** virou movimentação de estoque. Ver
[tasks.md](tasks.md).

## Seção de Peças na ficha

Aparece apenas quando a feature `operations.inventory` está ativa **e** a pessoa
tem `inventory.view` naquela unidade. Com o módulo desligado, a seção não
existe e a Ordem de Serviço continua inteira.

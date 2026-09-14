# ADR-045 — Reserva é entidade própria, não movimentação

**Status:** Aceito
**Data:** Prompt 10 — Estoque e Peças
**Itens atendidos:** 22, 27, 28, 33, 34, 35, 36, 37, 38, 103, 104, 105

## Contexto

O item 22 do Prompt 10 permite que reserva seja materializada no ledger, se a
modelagem escolhida for consistente. Duas leituras eram possíveis:

- reserva como **movimento** — uma linha no ledger com tipo `reserve`;
- reserva como **compromisso** — entidade própria, que não move nada.

## Decisão

**Reserva é entidade própria (`stock_reservations`) e não entra no ledger.**

Reservar não muda quanto existe fisicamente na prateleira — muda quanto já tem
dono. Colocá-la no ledger obrigaria o saldo físico a ser "soma dos movimentos
menos os de reserva", e a primeira consulta que esquecesse esse filtro mostraria
um estoque que não corresponde ao que se vê na prateleira.

O ledger responde a uma pergunta só: **quanto entrou e quanto saiu
fisicamente.**

### Os três números, definidos uma vez

| Campo       | Significa                                                          |
| ----------- | ------------------------------------------------------------------ |
| `on_hand`   | o que está fisicamente na unidade, **incluindo o que já tem dono** |
| `reserved`  | o que já foi comprometido com alguma OS e ainda não saiu           |
| `available` | `on_hand − reserved`: o que alguém novo ainda pode pegar           |

### A reserva pertence a uma OS da mesma unidade

`stock_reservations.service_order_id` é obrigatório, e a FK composta
`(service_order_id, unit_id) → service_orders(id, unit_id)` torna "a OS da
unidade A não reserva a prateleira da unidade B" um fato do banco. Para isso
existe transferência, que é processo explícito.

### Consumo é uma instrução só

Liberar-e-retirar seriam duas operações, e entre elas a peça volta ao
disponível: outra pessoa pode levá-la, e o consumo legítimo falha com o estoque
"certo" na tela. `on_hand` e `reserved` caem juntos, sob a mesma trava de linha
— ver [ADR-044](ADR-044-concorrencia-de-saldo.md).

### Não há reserva automática

Aprovar orçamento **não** reserva (itens 36 a 38). Aprovar três orçamentos do
mesmo modelo de tela esvaziaria o disponível sem ninguém ter pegado nada, e o
quarto cliente ouviria "não temos" com a peça na prateleira.

Um orçamento aprovado com linha PART vinculada a uma peça real **habilita o
botão** de reservar. Quem reserva é uma pessoa.

## Alternativas consideradas

| Alternativa                                       | Por que não                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Reserva como movimento de saída                   | O saldo físico passaria a mentir sobre a prateleira.                         |
| Reserva como tipo no ledger, sem afetar `on_hand` | Duas semânticas na mesma tabela; toda consulta precisaria lembrar do filtro. |
| Reserva automática ao aprovar orçamento           | Esvazia o disponível sem ninguém ter pegado nada (item 36).                  |
| Subtrair a reserva de `on_hand`                   | O inventário físico nunca bateria com o sistema.                             |

## Consequências

- A situação da reserva (`open`/`closed`) deriva do que sobrou, e é calculada
  no `CASE` do próprio `UPDATE`.
- Reserva parcialmente consumida e parcialmente liberada encerra pelos dois
  caminhos.
- O ledger registra o **consumo** (movimento `issue` com `reservation_id`), não
  a reserva.

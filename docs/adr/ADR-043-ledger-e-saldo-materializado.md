# ADR-043 — Ledger de estoque com saldo materializado

**Status:** Aceito
**Data:** Prompt 10 — Estoque e Peças
**Itens atendidos:** 20, 21, 23, 24, 25

## Contexto

O estoque precisa responder duas perguntas diferentes:

1. **Quanto existe agora?** — perguntada o tempo todo, em lista de 300 peças,
   no seletor do orçamento, na ficha da OS.
2. **Por que mudou?** — perguntada raramente, mas com urgência: quando o
   inventário não bate, quando um cliente reclama, quando o contador pergunta.

Um campo `quantity` mutável responde bem à primeira e não responde à segunda.
Um ledger puro responde bem à segunda e transforma a primeira em um `SUM()`
sobre uma tabela que só cresce.

## Decisão

**Ledger append-only (`stock_movements`) como verdade histórica, mais saldo
materializado (`stock_balances`) atualizado na mesma transação.**

- Toda alteração física gera **uma linha no ledger**, com quantidade **com
  sinal** e com `resulting_on_hand` — o saldo da peça naquela unidade logo
  depois do movimento.
- `stock_balances` guarda `on_hand`, `reserved`, `minimum_quantity` e
  `average_cost`, e é atualizado **na mesma transação** do movimento.
- A tabela do ledger **não tem `updated_at` nem `version`**. A ausência das
  colunas é a primeira barreira contra "corrigir" um lançamento; a segunda é o
  teste de arquitetura `inventory-boundary.test.ts`, que falha se qualquer
  arquivo passar a executar `UPDATE`/`DELETE` nela.
- Correção se faz com **movimentação compensatória** (ajuste, com motivo
  obrigatório), nunca editando o passado.

## Reconciliação

A materialização só é aceitável porque é **verificável**:
`reconcileBalance()` recalcula `on_hand` e o custo médio **a partir do ledger**,
na ordem cronológica, e compara com o materializado. O teste de integração
exercita isso depois de duas entradas com custos diferentes e uma saída.

Sem essa função, "o saldo está certo" seria uma crença, e a primeira
divergência apareceria como reclamação de cliente.

## Alternativas consideradas

| Alternativa                                | Por que não                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| Só o campo `quantity`                      | Perde a história. "Por que mudou ontem à noite?" fica sem resposta.     |
| Só o ledger, saldo calculado               | `SUM()` por linha em listagem de 300 peças; o custo cresce para sempre. |
| Saldo materializado atualizado por trigger | Regra de negócio dentro do banco, invisível ao código e ao teste.       |
| Saldo materializado atualizado por job     | Janela em que a tela mostra um número e a prateleira tem outro.         |

## Consequências

- Toda escrita de saldo passa por `stock-service.ts` — e só por ele. Um teste
  de arquitetura garante isso.
- `resulting_on_hand` é redundante em relação à soma do ledger, **de
  propósito**: torna a reconciliação uma comparação, não um recálculo.
- A materialização depende de a atualização ser atômica — ver
  [ADR-044](ADR-044-concorrencia-de-saldo.md).

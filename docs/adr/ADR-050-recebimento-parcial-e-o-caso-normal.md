# ADR-050 — Recebimento parcial é o caso normal, não a exceção

**Status:** Aceito
**Data:** Prompt 11 — Fornecedores e Compras
**Itens atendidos:** 16, 20, 21, 22, 24, 26, 56

## Contexto

O fornecedor mandou 4 das 10 telas e prometeu o resto na semana que vem. Isso
não é um erro a ser tratado: é o que acontece na maior parte das compras de
assistência técnica.

Modelar "recebido" como um booleano do pedido obrigaria o balcão a escolher
entre duas mentiras — marcar recebido com 6 peças faltando, ou não registrar as
4 que já estão na prateleira e usar peça que o sistema não sabe que existe.

## Decisão

**A situação do pedido é CONSEQUÊNCIA aritmética do que chegou, e não um botão.**

- Cada linha do pedido guarda `quantity` e `received_quantity`, com a CHECK
  `received_quantity <= quantity` no banco.
- Cada chegada de mercadoria cria um `purchase_receipt` com suas linhas. Um
  pedido tem **N recebimentos**.
- Depois de cada recebimento, `nextPurchaseOrderStatus()` compara pedido com
  recebido e produz `partially_received` ou `received`.
- **`received` e `partially_received` não estão na matriz de transições
  manuais** (`PURCHASE_ORDER_TRANSITIONS`). Não existe "marcar como recebido"
  que possa contrariar o que entrou no estoque.

## Sem over-receipt, sob concorrência

A trava é uma só, e ela está no banco:

```sql
UPDATE purchase_order_items
   SET received_quantity = received_quantity + :q
 WHERE id = :id AND tenant_id = :t
   AND received_quantity + :q <= quantity
```

Quem decide é o InnoDB, sob a trava de linha que ele já segura para gravar
(ADR-044). Com 4 pendentes e duas pessoas recebendo 4 ao mesmo tempo, a segunda
recebe `affectedRows() === 0` e **a transação inteira dela volta atrás** —
entrada de estoque incluída.

Duas travas complementam a condição, e as duas existem por um motivo medido em
teste:

1. **O pedido é travado primeiro** (`SELECT ... FOR UPDATE` em
   `purchase_orders`). Sem isso, duas pessoas recebendo **linhas diferentes** do
   mesmo pedido travam os itens em ordens opostas e o InnoDB mata uma das duas
   por impasse — uma entrega legítima seria recusada.
2. **O recálculo da situação lê com trava.** O InnoDB roda em REPEATABLE READ:
   uma leitura comum enxergaria a fotografia de quando a transação começou a
   ler. Com duas entregas simultâneas em linhas diferentes, a segunda concluiria
   "ainda falta chegar coisa" olhando para uma linha desatualizada, e o pedido
   terminaria **parcialmente recebido com tudo na prateleira**.

`purchasing-concurrency.test.ts` cobre os três casos do item 56 com transações
paralelas de verdade contra o MariaDB.

## Correção não apaga recebimento

Recebeu errado? **A correção é um ajuste de estoque, com motivo** — o mesmo
caminho do ADR-043. Não existe "apagar recebimento": o recebimento é um fato
datado, e o saldo se corrige com um lançamento compensatório que também é um
fato. O teste de fronteira falha se aparecer qualquer `delete`/`undo` sobre
recebimento.

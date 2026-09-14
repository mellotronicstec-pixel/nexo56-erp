# ADR-051 — Frete e desconto ficam no pedido, não no custo da peça

**Status:** Aceito
**Data:** Prompt 11 — Fornecedores e Compras
**Itens atendidos:** 7, 15, 27, 28

## Contexto

Um pedido de compra tem valores que não são "o preço da peça":

- desconto comercial do fornecedor;
- frete;
- outros custos (embalagem, taxa de boleto).

Ratear essas parcelas no custo unitário de cada item é a prática contábil mais
precisa. Também é a que torna o sistema inexplicável para quem o opera.

## Decisão

**O custo que entra no estoque é o custo unitário da linha. Desconto, frete e
outros custos entram no total do PEDIDO e param ali.**

`total = subtotal − desconto + frete + outros custos`, calculado pelo servidor
em `calculatePurchaseOrderTotals()`; o que o formulário mandar como total é
ignorado.

O motivo é o custo médio ponderado do estoque (ADR-043). Se o frete fosse
diluído, comprar as **mesmas** 10 telas pelo **mesmo** preço, uma vez com frete
e outra sem, produziria dois custos médios diferentes — e ninguém no balcão
conseguiria explicar por que a peça "ficou mais cara" sem o fornecedor ter
mudado o preço.

## Dois custos, e eles são diferentes de propósito

| Pergunta                                  | Quem responde                                  |
| ----------------------------------------- | ---------------------------------------------- |
| Quanto pagamos nesta peça, e quando?      | `purchase_price_history` (append-only)         |
| Quanto vale o que está na prateleira?     | `stock_balances.average_cost` (custo médio)    |
| Quanto este fornecedor cobrou por último? | `supplier_parts.last_unit_cost` (conveniência) |

`purchase_price_history` ganha **uma linha por recebimento** e nunca é
reescrita: é ela que responde "como o custo evoluiu", e é ela que guarda o
`observed_lead_time_days` — o prazo **real** entre o pedido realizado e a
chegada, para um dia comparar com o que o fornecedor promete.

`supplier_parts.last_unit_cost` é **conveniência de tela**, não autoridade de
preço: serve para acelerar o próximo pedido. O comentário está no schema, e o
teste de integração verifica que as duas compras (R$ 25,00 e R$ 40,00)
continuam no histórico depois que o `last_unit_cost` virou R$ 40,00.

## Consequências

- O custo de estoque fica ligeiramente **subestimado** em compras com frete
  alto. É uma imprecisão conhecida, documentada e visível: o frete está na
  ficha do pedido, escrito.
- Quando o Nexo56 tiver rateio (se tiver), ele será uma decisão explícita por
  pedido — não um comportamento silencioso que muda o custo médio.

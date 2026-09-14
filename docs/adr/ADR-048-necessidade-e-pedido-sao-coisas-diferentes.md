# ADR-048 — Necessidade de compra e pedido de compra são coisas diferentes

**Status:** Aceito
**Data:** Prompt 11 — Fornecedores e Compras
**Itens atendidos:** 8, 9, 29, 30, 32

## Contexto

Na assistência técnica, duas frases parecidas descrevem fatos muito diferentes:

1. **"Precisamos comprar isto."** — o técnico abriu o aparelho, a fonte está
   queimada e não há peça na prateleira. Ninguém gastou nada ainda.
2. **"Compramos isto."** — alguém autorizou a despesa, ligou para o
   distribuidor e o pedido está feito.

A tentação é modelar as duas com uma entidade só — um "pedido" que nasce como
rascunho quando a peça falta. Isso quebra em três lugares:

- **Uma necessidade pode virar zero, um ou vários pedidos.** Cinco fontes
  faltando podem sair em dois pedidos de fornecedores diferentes; ou em nenhum,
  porque o cliente desistiu do conserto.
- **Um pedido atende várias necessidades de uma vez.** É o caso normal: o
  comprador junta o que faltou na semana e faz um pedido só.
- **Quem registra não é quem autoriza.** O técnico sabe que a peça falta; ele
  não necessariamente pode comprometer dinheiro da empresa.

## Decisão

**Duas entidades, com ciclos de vida próprios: `purchase_needs` e
`purchase_orders`, ligadas por um vínculo OPCIONAL na linha do pedido
(`purchase_order_items.purchase_need_id`).**

- A necessidade guarda três quantidades: **quanto precisa**, **quanto já entrou
  em pedido** (`ordered_quantity`) e **quanto já chegou**
  (`received_quantity`). São três perguntas diferentes e a tela mostra as três.
- **`ordered` não significa atendida.** Aprovar o pedido soma em
  `ordered_quantity`; só o **recebimento** soma em `received_quantity`, e só ele
  fecha a necessidade (`fulfilled`).
- Cancelar um pedido **devolve à necessidade apenas o que ainda não chegou**. O
  que já foi recebido continua atendido, porque está fisicamente na prateleira.
- O vínculo é opcional nos dois sentidos: há necessidade sem pedido (ainda não
  se comprou) e pedido sem necessidade (compra direta de oportunidade).

## Nada aqui compra sozinho

`LOW_STOCK_DETECTED` **não cria necessidade**, e nenhuma necessidade vira pedido
automaticamente (item 32). A tela de necessidades _mostra_ o que está abaixo do
mínimo — `listLowStockSuggestions()` é uma consulta e escreve nada — e uma
pessoa decide.

A alternativa (criar a necessidade automaticamente) foi recusada por um motivo
prático: um alerta de estoque mínimo mal configurado viraria dezenas de linhas
que ninguém pediu, e a lista de necessidades deixaria de ser confiável
exatamente quando mais importa.

## Consequências

- Uma consulta a mais para responder "o que falta comprar": a lista de
  necessidades não sai da tabela de pedidos.
- Em compensação, "por que compramos isto?" tem resposta, e "o que pedimos e
  ainda não chegou?" não depende de interpretar situação de pedido.
- O teste `purchasing-boundary.test.ts` falha se algum arquivo passar a criar
  necessidade ou pedido a partir de um evento de estoque.

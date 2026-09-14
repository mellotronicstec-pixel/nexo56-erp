# Necessidade de compra

> Decisão de arquitetura: [ADR-048](../../adr/ADR-048-necessidade-e-pedido-sao-coisas-diferentes.md)

## "Precisamos comprar isto"

A necessidade é o registro de que **falta peça**, não de que se comprou. Ela
pertence à **unidade**: o que falta na loja do centro não é o que falta na loja
norte.

## Três quantidades, e elas respondem três perguntas

| Coluna              | Pergunta                     |
| ------------------- | ---------------------------- |
| `quantity`          | Quanto precisa?              |
| `ordered_quantity`  | Quanto já entrou em pedido?  |
| `received_quantity` | Quanto já chegou de verdade? |

A tela mostra as três. Uma barra de progresso única esconderia qual é qual, e a
diferença entre "pedido" e "chegou" é exatamente a informação que o balcão
precisa para responder ao cliente.

## Situações

| Situação    | Rótulo       | O que significa                                   |
| ----------- | ------------ | ------------------------------------------------- |
| `open`      | Em aberto    | falta peça e ninguém pediu ainda (ou pediu menos) |
| `ordered`   | Pedido feito | tudo que falta já está em algum pedido            |
| `fulfilled` | Atendida     | a mercadoria **chegou**                           |
| `cancelled` | Cancelada    | não precisa mais                                  |

**`ordered` não é atendida.** Aprovar o pedido soma em `ordered_quantity`; só o
recebimento soma em `received_quantity` e fecha a necessidade. A recomputação
acontece no `CASE` do próprio `UPDATE` (`addOrderedQuantity`,
`addReceivedQuantity`, `releaseOrderedQuantity`), dentro da transação de quem
chamou — ler, decidir em TypeScript e gravar deixaria uma janela.

## Cancelar o pedido devolve só o pendente

Pedido de 10, chegaram 4, o resto não vem mais. Cancelar:

- **devolve 6** para a necessidade, que volta a `open`;
- **mantém as 4** como recebidas, porque estão fisicamente na prateleira.

Uma necessidade que já recebeu mercadoria **não pode ser cancelada**: cancelar
apagaria o registro de que aquilo chegou.

## Vínculo com a Ordem de Serviço

Opcional (item 29). Quando existe, a FK é **composta**
`(service_order_id, unit_id)` — a OS precisa ser da **mesma unidade** da
necessidade. O banco já recusaria; o serviço confere antes para a pessoa
receber uma frase em português em vez de um erro de constraint.

**A OS não muda de situação por causa disso.** A ficha da OS oferece o atalho
"Registrar necessidade de compra", e o teste E2E compara a situação da OS antes
e depois para provar que ela ficou parada.

## Nada aqui compra sozinho

`LOW_STOCK_DETECTED` **não cria necessidade**. A tela de necessidades chama
`listLowStockSuggestions()` — uma consulta, que não escreve nada — e mostra as
peças abaixo do mínimo com um link "Registrar". Quem clica é uma pessoa.

Foi a mais simples das duas opções que o item 32 aceita, e a mais segura: um
alerta de mínimo mal configurado viraria dezenas de linhas que ninguém pediu, e
a lista deixaria de ser confiável exatamente quando mais importa.

`purchasing-boundary.test.ts` falha se o job de estoque baixo, ou qualquer
arquivo que consuma `LOW_STOCK_DETECTED`, passar a criar necessidade ou pedido.

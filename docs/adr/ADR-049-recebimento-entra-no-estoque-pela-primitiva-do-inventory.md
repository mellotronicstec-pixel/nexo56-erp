# ADR-049 — Recebimento entra no estoque pela primitiva do Inventory

**Status:** Aceito
**Data:** Prompt 11 — Fornecedores e Compras
**Itens atendidos:** 19, 20, 21, 48, 49, 50

## Contexto

Receber mercadoria **é dar entrada no estoque**. O módulo de Compras precisa,
na mesma transação em que grava o recebimento:

- somar `received_quantity` na linha do pedido, sem ultrapassar o pedido;
- criar o movimento de entrada no ledger;
- atualizar `on_hand` e o **custo médio ponderado** do saldo;
- fechar a necessidade vinculada;
- gravar o preço pago no histórico.

Havia três caminhos possíveis:

1. **Compras escreve direto em `stock_balances` e `stock_movements`.** Recusado:
   duplicaria a aritmética do custo médio em dois lugares, e um dia os dois
   divergiriam. O item 46 proíbe explicitamente
   `UPDATE stock_balances SET on_hand = ...` dentro de Compras.
2. **Compras chama `receiveStock()` do Inventory.** Recusado por um detalhe de
   infraestrutura que é decisivo: `runInTransaction` **não aninha**. Chamar um
   caso de uso que abre a própria transação deixaria a entrada de estoque fora
   da transação do recebimento — e uma falha depois dela deixaria mercadoria no
   saldo sem recebimento correspondente.
3. **O Inventory expõe a operação em duas metades.** Escolhida.

## Decisão

**`planStockEntry(context, command)` + `applyStockEntry(tx, emit, context,
plan)`, exportadas pelo `stock-service` do Inventory.**

- `planStockEntry` faz **fora da transação** tudo que é leitura e validação:
  encontra a peça, resolve a localização, interpreta a quantidade, confere
  idempotência. **Não autoriza** — quem chama já autorizou, na unidade certa.
- `applyStockEntry` faz **dentro da transação de quem chamou** tudo que grava:
  movimento, saldo, custo médio, evento.
- `receiveStock()` continua existindo e passou a ser exatamente
  `authorize + planStockEntry + runInTransaction(applyStockEntry)` — o que
  garante que o caminho do balcão e o caminho da compra usam a mesma aritmética.

É o mesmo contrato que `planTransition`/`applyTransition` (ADR-042) estabeleceu
entre Orçamentos e o workflow da OS, pela mesma razão.

## A dependência é de mão única

**Compras conhece Estoque. Estoque não conhece Compras** (item 49).

- A FK de rastreabilidade vai de `purchase_receipt_items.stock_movement_id`
  para `stock_movements(id, tenant_id)` — nunca o contrário. Por isso
  `stock_movements` ganhou a UNIQUE `(id, tenant_id)`: é o alvo composto que
  mantém a ligação tenant-safe no banco.
- O Estoque mostra **"Compra PC 000037"** lendo `stock_movements.reference`,
  que é texto gravado no próprio movimento. Nenhuma consulta a tabela de
  Compras, nenhuma FK de volta — e é o que faz a origem continuar legível com o
  módulo de Compras desligado (item 50).
- `purchasing-boundary.test.ts` falha se o Inventory importar qualquer coisa de
  `modules/purchasing`, e se qualquer arquivo de Compras escrever em
  `stockBalances`, `stockMovements` ou `stockReservations`.

## Consequências

- O custo médio ponderado tem **uma** implementação. Uma compra a R$ 25,00
  seguida de outra a R$ 40,00 produz o mesmo custo médio que duas entradas
  manuais equivalentes, porque é literalmente o mesmo código.
- Quem chamar `applyStockEntry` precisa lembrar de autorizar antes. O contrato
  está escrito na assinatura e no comentário da função, e os testes de
  autorização de Compras cobrem o caso.

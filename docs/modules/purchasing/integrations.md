# Integrações

## Estoque — a única escrita, e ela é emprestada

Compras **não escreve** em `stock_balances`, `stock_movements` nem
`stock_reservations`. A entrada acontece pela primitiva oficial do Inventory:

```ts
const plan = await planStockEntry(context, { unitId, partId, quantity, ... });
// ... dentro da transação do recebimento:
const entry = await applyStockEntry(tx, emit, context, plan, { now });
```

Ver [ADR-049](../../adr/ADR-049-recebimento-entra-no-estoque-pela-primitiva-do-inventory.md).

### A dependência é de mão única

**Compras conhece Estoque. Estoque não conhece Compras.**

- A FK de rastreabilidade vai de `purchase_receipt_items.stock_movement_id` para
  `stock_movements(id, tenant_id)`. Foi por isso que `stock_movements` ganhou a
  UNIQUE `(id, tenant_id)` — é o alvo composto que mantém a ligação tenant-safe.
- No sentido inverso, o Estoque mostra "Compra PC 000037" a partir de
  `stock_movements.reference`, texto gravado no próprio movimento. Sem FK, sem
  consulta.
- `MOVEMENT_ORIGINS` ganhou `'purchase_order'` com o rótulo "Compra". É uma
  string no Inventory, não um acoplamento.
- A ficha da peça mostra o **histórico de preços de compra**, mas só quando
  `operations.purchasing` está ativo **e** a pessoa tem `purchases.view`. Com o
  módulo desligado, a seção some e a ficha continua inteira.

`purchasing-boundary.test.ts` falha se o Inventory importar qualquer coisa de
`modules/purchasing`, ou se o schema do Inventory citar tabela de Compras.

## Ordem de Serviço — só um atalho

A ficha da OS oferece **"Registrar necessidade de compra"**, e é só isso.

- Compras **não executa** `UPDATE service_orders`.
- Compras **não chama** `planTransition`, `applyTransition` nem
  `transitionServiceOrder`.
- A necessidade vinculada guarda `service_order_id` com FK composta
  `(service_order_id, unit_id)` — mesma unidade, obrigatoriamente.
- **A situação da OS não muda por causa de compra.** O teste E2E compara a
  situação antes e depois de registrar a necessidade.

## Reservas — nada automático

Receber mercadoria **não reserva peça** para OS nenhuma (item 44). Compras não
chama `reservePart`, `consumeReservation` nem `releaseReservation`. Reservar
continua sendo decisão de quem atende a OS, depois de ver o saldo.

## Orçamentos — nenhum contato

`modules/quotes` não importa `modules/purchasing`. Comprar peça não altera
orçamento aprovado, e aprovar orçamento não compra nada.

## Financeiro — o gancho, e só o gancho

O recebimento emite `PURCHASE_RECEIPT_CREATED` com `receiptId`,
`purchaseOrderId`, `number`, `unitId`, `supplierId`, `lines` e `status`.

**Esse evento não tem consumidor.** Nenhum título financeiro nasce, nenhuma
conta a pagar é aberta, nenhum pagamento é registrado. Não existe tabela
`accounts_payable`, `payments`, `financial_entries` ou `invoices` no banco — e
um teste de integração verifica isso lendo o `information_schema`.

O que ficou **preparado** para o Prompt 12, e nada além disso:

| Preparado                                    | Onde                                                  |
| -------------------------------------------- | ----------------------------------------------------- |
| O evento com o identificador do recebimento  | `EVENT_TYPES.PURCHASE_RECEIPT_CREATED`                |
| Fornecedor com dados de pagamento comerciais | `suppliers.commercial_terms`                          |
| Contato de papel `financial`                 | `supplier_contacts.role`                              |
| Número e data do documento fiscal            | `purchase_receipts.document_number` / `document_date` |
| Valor total do pedido, congelado             | `purchase_orders.total`                               |

## Eventos emitidos

| Evento                                  | Quando                                    |
| --------------------------------------- | ----------------------------------------- |
| `SUPPLIER_CREATED` / `SUPPLIER_UPDATED` | cadastro de fornecedor                    |
| `PURCHASE_NEED_CREATED`                 | necessidade registrada                    |
| `PURCHASE_ORDER_CREATED`                | rascunho aberto                           |
| `PURCHASE_ORDER_APPROVED`               | despesa autorizada                        |
| `PURCHASE_ORDER_PLACED`                 | pedido registrado como realizado          |
| `PURCHASE_ORDER_PARTIALLY_RECEIVED`     | chegou parte                              |
| `PURCHASE_ORDER_RECEIVED`               | chegou tudo                               |
| `PURCHASE_ORDER_CANCELLED`              | cancelado                                 |
| `PURCHASE_RECEIPT_CREATED`              | recebimento gravado — gancho do Prompt 12 |

Todos pelo outbox (`runInTransaction`'s `emit`), na mesma transação do fato.

## Ações de auditoria

`supplier.created`, `supplier.updated`, `supplier.status_changed`,
`purchase_order.created`, `purchase_order.updated`, `purchase_order.approved`,
`purchase_order.placed`, `purchase_order.cancelled`,
`purchase_receipt.created` — gravadas com `recordAudit` **dentro** da transação.

# Recebimento

> Decisões de arquitetura:
> [ADR-049](../../adr/ADR-049-recebimento-entra-no-estoque-pela-primitiva-do-inventory.md) ·
> [ADR-050](../../adr/ADR-050-recebimento-parcial-e-o-caso-normal.md)

## Este é o único ponto em que o estoque muda

Criar rascunho não muda. Aprovar não muda. Registrar o pedido realizado não
muda. Cancelar não desfaz. **A mercadoria chegou → o saldo sobe.**

O painel de recebimento só existe enquanto o pedido está `placed` ou
`partially_received` — e some assim que o pedido conclui.

## O que acontece, na ordem

Fora da transação (leitura e validação):

1. autoriza `purchases.receive` **na unidade do pedido** (item 47);
2. se há chave de comando, procura o recebimento — se achar, devolve
   `reused: true` e para;
3. para cada linha, `planStockEntry()` resolve peça, localização e quantidade.

Dentro de **uma** transação:

4. **trava o pedido** (`SELECT ... FOR UPDATE`) e reconfere a situação;
5. grava o `purchase_receipt` **primeiro** — a UNIQUE da chave quebra aqui, o
   mais cedo possível, e leva a transação inteira embora;
6. por linha: `UPDATE purchase_order_items` com a condição de over-receipt no
   `WHERE` → `applyStockEntry()` → linha do recebimento → fecha a necessidade →
   histórico de preço → atualiza o `last_unit_cost` do fornecedor;
7. recalcula a situação do pedido a partir das linhas **já atualizadas**, com
   leitura travada;
8. linha do tempo, auditoria e eventos.

## Recebimento parcial é o normal

O campo já vem preenchido com **o que falta** — o caso comum é "chegou tudo o
que faltava" — e a pessoa corrige para o que efetivamente veio na caixa. A tela
mostra pedido, já recebido e pendente, lado a lado.

## Sem over-receipt

```sql
UPDATE purchase_order_items
   SET received_quantity = received_quantity + :q
 WHERE id = :id AND tenant_id = :t
   AND received_quantity + :q <= quantity
```

`affectedRows() !== 1` ⇒ recusa, e **a transação inteira volta atrás**, entrada
de estoque incluída. A CHECK `received_quantity <= quantity` é a segunda
barreira, no banco.

A checagem em TypeScript que roda antes existe só para a pessoa ver uma frase em
português; ela **não** é a trava.

## Correção não apaga recebimento

Não existe "apagar recebimento". O recebimento é um fato datado; o saldo se
corrige com um **ajuste de estoque, com motivo** — o mesmo caminho do ADR-043,
que deixa o próprio rastro.

`purchasing-boundary.test.ts` falha se aparecer qualquer
`delete`/`undo`/`estorno` sobre recebimento, e o teste de integração verifica
que o módulo não exporta nada com esses nomes.

## Idempotência

`idempotencyKey` no comando; UNIQUE `(tenant_id, idempotency_key)` em
`purchase_receipts`; e a chave por linha (`${key}:${itemId}`) desce para o
movimento de estoque.

A mesma chave dez vezes produz **um** recebimento, **um** movimento e **uma**
linha de histórico — e as outras nove respondem `reused: true`. Cinco chamadas
simultâneas com a mesma chave produzem o mesmo resultado, com a diferença de
que algumas batem na UNIQUE e voltam atrás.

A chave **muda a cada recebimento registrado com sucesso**: a segunda entrega
legítima do mesmo pedido precisa de chave nova, senão seria confundida com um
reenvio da primeira.

## Rastreabilidade

`purchase_receipt_items.stock_movement_id` aponta para
`stock_movements(id, tenant_id)` — FK composta, tenant-safe, e **na direção
Compras → Estoque**. De um recebimento se chega ao movimento que ele gerou.

No sentido inverso, o Estoque mostra **"Compra PC 000037"** lendo
`stock_movements.reference`, que é texto gravado no próprio movimento. Sem FK de
volta, sem consulta a tabela de Compras — e por isso a origem continua legível
com o módulo desligado.

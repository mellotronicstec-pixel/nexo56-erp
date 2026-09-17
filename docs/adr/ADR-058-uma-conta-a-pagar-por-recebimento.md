# ADR-058 — Uma conta a pagar por RECEBIMENTO, não por pedido

**Status:** Aceito
**Data:** Prompt 12 — Financeiro
**Itens atendidos:** 33, 34, 37, 69, 74, 75

## Contexto

O pedido de compra tem R$ 1.000. O fornecedor manda R$ 600 em mercadoria hoje e
promete R$ 400 na semana que vem — e **cobra as duas entregas separadamente**,
com notas diferentes e vencimentos diferentes.

Amarrar a conta a pagar ao PEDIDO dá duas saídas, ambas ruins:

1. **Criar a conta quando o pedido é feito.** A loja passa a dever R$ 1.000 por
   mercadoria que ainda está no caminhão. Se o fornecedor cancelar o restante,
   existe um título de R$ 1.000 para uma entrega de R$ 600 — e corrigi-lo pode
   ser impossível, porque já houve pagamento parcial.

2. **Editar o valor do título a cada entrega.** É o que o ADR-054 proíbe: um
   título que já recebeu pagamento não muda de valor.

## Decisão

**A obrigação nasce no RECEBIMENTO. Um `purchase_receipt`, um título.**

```
Pedido R$ 1.000
├── Recebimento 02/04 (R$ 600)  ──►  CP 000010, vence 02/05
└── Recebimento 09/04 (R$ 400)  ──►  CP 000011, vence 09/05
                                     ─────────────────────
                                     soma exata: R$ 1.000
```

O valor de cada título é a **soma de `purchase_receipt_items.total_cost`** —
o que efetivamente chegou, calculado pelo servidor, nunca digitado.

Vantagens que caem de graça:

- entregas parciais somam exatamente, sem R$ 1.600 fantasma;
- o cancelamento do resto do pedido não invalida nada: o que chegou é devido;
- cada nota fiscal do fornecedor tem seu título, com seu vencimento;
- se nada chegou, não se deve nada — e não há título.

## Idempotência por recebimento

`origin_key = 'purchase_receipt:<id>'`, sob o mesmo índice único de ADR-057.
Gerar duas vezes devolve o mesmo título com `reused: true`.

## A fronteira com Compras e com Estoque

| Quem       | Faz                                                           | Não faz                                              |
| ---------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| Compras    | muda `purchase_orders.status`, chama a primitiva do Inventory | não cria título                                      |
| Financeiro | cria e liquida o título                                       | **não** toca `purchase_orders`, **não** toca estoque |

Pagar não recebe mercadoria. Receber mercadoria não paga ninguém. São dois fatos
diferentes, e o único vínculo é `purchase_receipt_id` no título — uma referência
de leitura, nunca uma escrita de volta.

O Prompt 12 **não** alterou nenhuma migration de Compras e não adicionou coluna
alguma em `purchase_orders` ou `purchase_receipts`.

## Consequências

**Ganhamos:** aritmética que fecha, e um financeiro que sobrevive ao pedido
cancelado pela metade.

**Pagamos:** um pedido com quatro entregas tem quatro contas a pagar. É o que o
fornecedor emitiu, então é o que a loja deve pagar — a tela do pedido mostra as
quatro juntas, com o total.

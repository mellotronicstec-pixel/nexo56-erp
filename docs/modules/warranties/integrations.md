# Integrações

Garantias conversa com quatro módulos. Em **nenhum** deles escreve diretamente.

## Ordens de Serviço

**O que Garantias faz:** cria uma OS nova, através da primitiva
`planServiceOrderCreation` / `applyServiceOrderCreation`, dentro da própria
transação; e move a OS de garantia pela máquina de estados através de
`planTransition` / `applyTransition`.

**O que Garantias NÃO faz:** escrever em `service_orders.status`. Nenhum
`UPDATE` de status sai deste módulo — nem na criação, nem na reclassificação.

**Na ficha da OS:** três blocos — de onde esta OS veio (quando é de garantia),
o que foi emitido a partir dela, e quais retornos ela originou. Mais o
formulário de emissão, quando a OS está `completed` e a pessoa tem
`warranties.issue`.

## Equipamentos

**Leitura apenas.** A ficha do aparelho ganha a seção "Garantias", com todas as
garantias daquele equipamento nas unidades autorizadas — **incluindo as
vencidas**, marcadas como tal.

Esconder as expiradas deixaria a ficha limpa e o atendente sem resposta:
"existiu uma garantia e ela terminou semana passada" é informação útil; "não
encontrei nada" não é.

## Estoque

**Leitura opcional.** `part_id` e `stock_movement_id` apontam o registro real
quando o módulo está ativo. Garantias **não escreve** em `stock_balances`,
`stock_movements` nem `stock_reservations`, e **não compra peça**.

Quando o Estoque está desligado, `part_description` e `part_code` sustentam a
garantia de peça sozinhos.

## Compras

**Leitura opcional.** `supplier_id` registra de quem veio a peça garantida, para
que a loja saiba a quem recorrer. Garantias não abre pedido, não aciona
fornecedor e não cria conta a pagar.

## Financeiro

**Nenhuma escrita.** Ver [costs.md](costs.md) e
[ADR-071](../../adr/ADR-071-custo-de-garantia-nao-toca-o-financeiro.md).

`SERVICE_ORDER_FINANCIAL_SETTLED` existe e **não é consumido**: pagar não é
retirar o aparelho (ADR-063).

## Eventos publicados

Todos pelo outbox, dentro da transação:

| Evento                                  | Quando                               |
| --------------------------------------- | ------------------------------------ |
| `WARRANTY_CREATED`                      | garantia criada                      |
| `WARRANTY_ACTIVATED`                    | garantia passa a valer               |
| `WARRANTY_CERTIFICATE_ISSUED`           | certificado gerado pela primeira vez |
| `WARRANTY_RETURN_REGISTERED`            | retorno gravado (coberto ou não)     |
| `WARRANTY_RETURN_SERVICE_ORDER_CREATED` | OS de garantia criada                |
| `WARRANTY_RETURN_RECLASSIFIED_TO_QUOTE` | reclassificada para orçamento        |
| `WARRANTY_CANCELLED`                    | cancelada                            |
| `WARRANTY_REVOKED`                      | revogada                             |

Nenhum consumidor envia mensagem ao cliente. Os eventos existem para auditoria e
para integrações futuras explícitas.

## Auditoria

Nove ações registradas dentro da transação: `warranty_policy.changed`,
`warranty.created`, `warranty.activated`, `warranty.cancelled`,
`warranty.revoked`, `warranty_certificate.issued`,
`warranty_return.registered`, `warranty_return.reclassified`,
`warranty_cost.recorded`.

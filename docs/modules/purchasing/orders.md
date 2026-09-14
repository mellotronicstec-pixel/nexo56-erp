# Pedido de compra

## O pedido pertence à UNIDADE

A mercadoria chega em um endereço. `purchase_orders` tem `tenant_id` **e**
`unit_id`, com as duas FKs compostas que o projeto usa desde o Prompt 02.

A unidade **não é escolhida num `select`** na tela: é a unidade ativa da
sessão. Deixar a pessoa escolher "para qual loja" no meio do formulário é como
ela erra o destino da carga.

## Numeração

`PC 000037`, por **empresa**, alocada por `allocateSequenceNumber` sobre
`tenant_sequences` (ADR-034): o idioma atômico do `LAST_INSERT_ID`, nunca
`MAX + 1`.

Duas empresas começam do 1. Dentro da mesma empresa não há buraco nem
repetição — nem com cinco pedidos nascendo ao mesmo tempo, que é o que o teste
de concorrência verifica.

## Situações e a matriz

| Situação             | Rótulo                |
| -------------------- | --------------------- |
| `draft`              | Rascunho              |
| `approved`           | Aprovado              |
| `placed`             | Pedido realizado      |
| `partially_received` | Parcialmente recebido |
| `received`           | Recebido              |
| `cancelled`          | Cancelado             |

```
draft ──→ approved ──→ placed ──→ (recebimento) ──→ partially_received ──→ received
  │           │           │                                │
  └───────────┴───────────┴────────────────────────────────┴──→ cancelled
```

**`PURCHASE_ORDER_TRANSITIONS` é a matriz. Tudo que não está nela é proibido.**
`partially_received` e `received` **não aparecem como destino manual**: não são
decisão de ninguém, são a consequência aritmética do que chegou.

### Por que `approved` existe

Porque quem monta o pedido não é, necessariamente, quem autoriza a despesa
(item 17). Numa assistência pequena a mesma pessoa tem as duas permissões e
passa pelos dois passos em dois cliques; numa maior, o corte é real — e ele
precisa existir no modelo para poder existir na empresa.

### "Registrar pedido realizado" não envia nada

O Nexo56 **não manda e-mail, mensagem ou integração** ao fornecedor. A pessoa
confirma que já fez o pedido por telefone, WhatsApp ou balcão, e o sistema
anota o fato. A tela diz isso, e o teste de componente trava a frase.

## Rascunho: o que é editável

`isPurchaseOrderEditable(status)` é verdadeiro **só em `draft`**. A partir de
`approved`, itens e valores estão congelados — eles registram o que foi
combinado com o fornecedor.

A tela mostra, nesse ponto, uma **tabela em leitura** e não um formulário
desabilitado: campo cinza convida a tentar.

### Snapshot comercial

Ao salvar o rascunho, cada linha congela `description`, `unit_of_measure` e
`supplier_code`. Renomear a peça no catálogo depois **não reescreve pedido
nenhum** — é a mesma decisão do ADR-047 para orçamentos.

## Totais

```
total = subtotal − desconto + frete + outros custos
```

Calculado **no servidor**, em `calculatePurchaseOrderTotals()`. O que o
formulário mandar como total é ignorado. A prévia na tela usa o mesmo `Money`
do backend — nunca aritmética de ponto flutuante — e diz, escrito, que o valor
que vale é o que o servidor grava.

**Frete e desconto não entram no custo da peça** — ver
[ADR-051](../../adr/ADR-051-custo-comercial-e-custo-de-estoque.md).

## Cancelamento

- De `draft`: "Descartar rascunho", sem motivo. Nenhuma necessidade é alterada.
- De `approved`, `placed` ou `partially_received`: **exige motivo**
  (mínimo 5 caracteres), porque é a única transição que alguém vai precisar
  explicar depois.

Cancelar **não desfaz recebimento**: o que já chegou continua no estoque.
Cancelar devolve à necessidade **apenas o pendente**.

## Idempotência

Abrir pedido aceita `idempotencyKey`. Duplo clique — e o retry depois de uma
queda de rede — **reencontra o pedido** em vez de abrir um segundo com outro
número. A chave nasce no cliente, uma vez, quando o formulário monta; a UNIQUE
`(tenant_id, idempotency_key)` é a garantia final.

# Títulos financeiros

Um título é uma obrigação: alguém deve alguma coisa, para alguém, até uma data.
A coluna `direction` diz de que lado: `receivable` (o cliente deve para a loja)
ou `payable` (a loja deve para alguém).

## Numeração

`CR 000042` e `CP 000010`. Os prefixos são distintos de propósito: ler
"título 42" numa conversa não pode deixar dúvida sobre qual dos dois.

A numeração sai de `tenant_sequences` via `allocateSequenceNumber()`, com
sequências separadas por direção — nunca `MAX(number) + 1`, que sob concorrência
entrega o mesmo número para dois títulos.

## Situações

| Situação            | A receber         | A pagar       |
| ------------------- | ----------------- | ------------- |
| `open`              | Em aberto         | Em aberto     |
| `partially_settled` | Recebido em parte | Pago em parte |
| `settled`           | Recebido          | Pago          |
| `cancelled`         | Cancelado         | Cancelado     |

**Não existe `overdue`.** Vencido é um recorte calculado na hora, no fuso da
empresa, e um título pode estar `partially_settled` **e** vencido ao mesmo tempo
— que é o caso de cobrança mais comum.

## Contraparte

| Direção      | Contraparte válida                              |
| ------------ | ----------------------------------------------- |
| `receivable` | `customer` — sempre um cliente cadastrado       |
| `payable`    | `supplier` (cadastrado) ou `other` (nome solto) |

`other` existe porque a conta de luz não tem fornecedor no cadastro. Obrigar a
criar um só para lançar a despesa é o tipo de exigência que devolve o financeiro
para a planilha.

A regra é garantida por CHECK no banco, sobre colunas simples — ver
[ADR-053](../../adr/ADR-053-titulo-unico-com-direcao.md) e a armadilha do erro
1901 do MariaDB.

## Origem

| `origin`           | `origin_key`            | Nasce em                      |
| ------------------ | ----------------------- | ----------------------------- |
| `manual`           | `NULL`                  | `/financeiro/novo-lancamento` |
| `service_order`    | `service_order:<id>`    | ficha da OS                   |
| `purchase_receipt` | `purchase_receipt:<id>` | ficha do pedido de compra     |

`UNIQUE (tenant_id, origin_key)` faz a idempotência: gerar duas vezes devolve o
mesmo título, com `reused: true`.

## Parcelamento

Todo título tem **ao menos uma** parcela. À vista é `1 de 1`. Isso elimina o
`if` "se tem parcela..." de toda consulta e toda tela.

A divisão é feita em centavos (`bigint`), e a sobra vai para as **primeiras**
parcelas:

```
R$ 100,00 em 3x  →  33,34 + 33,33 + 33,33  =  100,00
R$  10,00 em 7x  →  1,43 ×6 + 1,42          =   10,00
```

Vencimentos mensais preservam o dia de referência: dia 31 encolhe para o último
dia de fevereiro e **volta para 31** em março.

## O que se edita, e o que não

**Editável a qualquer momento:** descrição, categoria, observação.

**Nunca editável:** valor, vencimento, número de parcelas, direção, contraparte.

Um título que já tem liquidação registrada é um fato contábil. Mudar o valor
depois transformaria o extrato numa ficção. Quando o valor está errado, o
caminho é estornar e cancelar — ou lançar a diferença.

## Cancelamento

Só enquanto **nada foi liquidado**:

```sql
UPDATE financial_titles SET status = 'cancelled', ...
 WHERE id = :id AND tenant_id = :t
   AND status IN ('open','partially_settled')
   AND settled_amount = '0.00'
   AND version = :v
```

A condição está no `WHERE`, não num `SELECT` anterior. Motivo obrigatório entre
5 e 300 caracteres, gravado no histórico e na auditoria.

Um título com dinheiro recebido não se cancela: estorna-se o recebimento
primeiro.

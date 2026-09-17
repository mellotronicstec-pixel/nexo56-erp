# ADR-061 — Liquidação: chave de comando, ordem única de lock e a armadilha do `SET`

**Status:** Aceito
**Data:** Prompt 12 — Financeiro
**Itens atendidos:** 38, 39, 40, 41, 42, 43, 44, 95, 96, 97

## Contexto

Liquidar é a operação mais perigosa deste módulo. Ela toca cinco tabelas numa
transação, move dinheiro de verdade, e sofre três acidentes distintos:

1. **duplo clique / retry** — a mesma liquidação lançada duas vezes;
2. **over-settlement concorrente** — duas pessoas recebendo R$ 600 cada num
   saldo de R$ 1.000;
3. **leitura velha** — REPEATABLE READ devolvendo o saldo de antes.

## Decisão 1 — Chave de comando com índice único

```sql
CONSTRAINT uq_fin_settlement_idempotency UNIQUE (tenant_id, idempotency_key)
```

A chave nasce **no cliente**, quando o painel monta, e **muda a cada liquidação
registrada com sucesso**. Duplo clique e retry depois de queda de rede
reencontram a liquidação (`reused: true`, com a mensagem "Esta liquidação já
havia sido registrada. Nada foi lançado em duplicidade."). Já o segundo
pagamento legítimo da mesma parcela recebe chave nova — senão seria confundido
com um reenvio.

## Decisão 2 — A conta é travada PRIMEIRO, sempre

Toda transação que mexe em dinheiro começa pela mesma linha:

```ts
await tx.select().from(financialAccounts).where(...).for('update');
```

Duas razões:

- **ordem única de lock** — sem ela, uma transação travando parcela→conta e
  outra travando conta→parcela resultam em deadlock. O Prompt 11 já viveu isso
  no recebimento de compra;
- **leitura fresca** — em REPEATABLE READ, um `SELECT` simples dentro da
  transação lê a partir do read view do primeiro `SELECT`. `FOR UPDATE` obriga a
  ler a versão atual.

## Decisão 3 — A condição de negócio vai no `WHERE` (ADR-044)

```sql
UPDATE financial_installments
   SET settled_amount = settled_amount + :q, status = CASE ... END
 WHERE id = :id AND tenant_id = :t
   AND status IN ('open','partially_settled')
   AND settled_amount + :q <= amount
```

`affectedRows() === 0` significa recusa: outra transação já consumiu o saldo. Não
há `SELECT` antes decidindo — e por isso não há janela entre a decisão e a
escrita.

## A armadilha que custou caro: `SET` avalia da esquerda para a direita

**Este é o bug real que este ADR existe para não voltar.**

A primeira versão escrevia:

```sql
SET settled_amount = settled_amount + :q,
    status = CASE WHEN settled_amount + :q >= amount THEN 'settled' ELSE ... END
```

Parece correto. Está errado. **O MySQL/MariaDB avalia as atribuições de `SET`
da esquerda para a direita, e cada uma enxerga o valor NOVO das anteriores.**
Quando o `CASE` roda, `settled_amount` **já foi atualizado** — então
`settled_amount + :q` conta o pagamento duas vezes.

Sintoma: um título de R$ 1.000 recebendo R$ 600 era marcado `settled`. E o dano
cascateava — a liquidação concorrente de outra parcela falhava com
`ConflictError`, porque `status IN ('open','partially_settled')` já não casava.

A correção é comparar a coluna **já atualizada**:

```sql
SET settled_amount = settled_amount + :q,
    status = CASE WHEN settled_amount >= amount THEN 'settled' ELSE 'partially_settled' END
```

O `WHERE`, por outro lado, é avaliado contra a **pré-imagem** da linha — lá a
soma explícita continua necessária. As duas cláusulas seguem regras diferentes,
e essa assimetria está comentada nos quatro `UPDATE`s afetados (liquidar parcela,
liquidar título, estornar parcela, estornar título).

Três testes de regressão em `tests/integration/finance.test.ts` e os casos
concorrentes em `finance-concurrency.test.ts` cobrem exatamente isso.

## A autorização é na unidade DO TÍTULO

Não na unidade ativa da sessão. Quem acessa duas lojas pode abrir um título da
loja B enquanto navega na loja A; a permissão conferida é
`settlementPermission(direction)` **na unidade do título**, e a conta usada
precisa servir aquela unidade.

## Consequências

**Ganhamos:** nenhuma liquidação duplicada, nenhum over-settlement sob
concorrência real de MariaDB, nenhum deadlock por ordem de lock.

**Pagamos:** a transação é mais longa e mantém um lock de linha na conta. Como
o lock é sempre na mesma ordem e a transação não faz I/O externo, a contenção
fica limitada a liquidações **da mesma conta**.

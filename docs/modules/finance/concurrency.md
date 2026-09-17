# Concorrência no Financeiro

Duas pessoas, dois navegadores, o mesmo título. Esta página lista cada trava e
diz **onde ela mora** — porque uma trava que mora no JavaScript não é trava.

## Ordem única de lock

Toda transação que mexe em dinheiro **trava a linha da conta financeira
primeiro**:

```ts
await tx.select().from(financialAccounts).where(...).for('update');
```

Sem isso, uma transação travando parcela→conta e outra travando conta→parcela
resultam em deadlock. O Prompt 11 já viveu exatamente esse acidente no
recebimento de compra, e a correção foi a mesma: fixar a ordem.

O `FOR UPDATE` resolve também a leitura velha: em REPEATABLE READ, um `SELECT`
simples dentro da transação lê a partir do read view estabelecido pelo primeiro
`SELECT`.

## As travas, uma a uma

| Risco                                  | Trava                                          | Onde mora   |
| -------------------------------------- | ---------------------------------------------- | ----------- |
| Liquidar mais que o saldo              | `AND settled_amount + :q <= amount` no `WHERE` | SQL         |
| Idem, rede de segurança                | `CHECK (settled_amount <= amount)`             | schema      |
| Lançar a mesma liquidação 2×           | `UNIQUE (tenant_id, idempotency_key)`          | schema      |
| Estornar o mesmo movimento 2×          | `UNIQUE (reversal_of_movement_id)`             | schema      |
| Estornar liquidação já estornada       | `AND status = 'confirmed'` no `WHERE`          | SQL         |
| Cancelar título já liquidado           | `AND settled_amount = '0.00'` no `WHERE`       | SQL         |
| Dois caixas abertos na mesma conta     | `UNIQUE (financial_account_id, open_marker)`   | schema      |
| Fechar caixa já fechado                | `AND status = 'open'` no `WHERE`               | SQL         |
| Duas edições simultâneas do título     | `AND version = :v` (CAS)                       | SQL         |
| Título duplicado da mesma origem       | `UNIQUE (tenant_id, origin_key)`               | schema      |
| Número de título repetido              | `allocateSequenceNumber()` (`LAST_INSERT_ID`)  | SQL atômico |
| Contraparte incompatível com a direção | `CHECK` sobre colunas simples                  | schema      |
| Escrever/apagar no razão               | teste de boundary sobre o código-fonte         | build       |

**Nenhuma linha desta tabela diz "JavaScript".** `affectedRows() === 0` é a
forma de a aplicação descobrir que o banco recusou.

## A armadilha do `SET`

`SET` avalia da esquerda para a direita; cada atribuição vê o valor **novo** das
anteriores. O `WHERE` vê a **pré-imagem**.

Isso significa que o `CASE` do `status` compara a coluna já somada
(`WHEN settled_amount >= amount`), enquanto o `WHERE` precisa da soma explícita
(`AND settled_amount + :q <= amount`). As duas cláusulas seguem regras
diferentes, e os quatro `UPDATE`s afetados carregam o comentário explicando.

Detalhe completo em
[ADR-061](../../adr/ADR-061-liquidacao-idempotente-e-sem-over-settlement.md).

## Os testes

`tests/integration/finance-concurrency.test.ts` — 15 testes contra **MariaDB de
verdade**, com transações paralelas reais, não simuladas:

- duas liquidações concorrentes da mesma parcela: uma passa, a outra é recusada;
- duas liquidações de **parcelas diferentes** do mesmo título: as duas passam, e
  a soma fecha;
- dois estornos do mesmo lançamento: um passa;
- duas aberturas de caixa na mesma conta: uma passa;
- saldo da conta reconciliável depois de tudo isso.

O teste de reconciliação recalcula o saldo a partir do razão e compara com
`current_balance`. Sem ele, "saldo reconciliável" seria só uma frase.

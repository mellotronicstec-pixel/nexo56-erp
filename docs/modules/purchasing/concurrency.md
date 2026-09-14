# Concorrência e idempotência

> Estratégia geral: [ADR-044](../../adr/ADR-044-concorrencia-de-saldo.md) —
> a condição de negócio vai no `WHERE` do `UPDATE`.

## As três travas, e por que cada uma existe

### 1. A condição de over-receipt, no `WHERE`

```sql
WHERE id = :id AND tenant_id = :t
  AND received_quantity + :q <= quantity
```

Quem decide é o InnoDB, sob a trava de linha que ele já segura para gravar. Não
há janela entre ler e decidir, porque não há leitura separada.

### 2. O pedido é travado primeiro

`SELECT ... FROM purchase_orders ... FOR UPDATE`, como **primeira** instrução da
transação de recebimento. Duas razões, as duas medidas em teste:

- **Ordem de trava única.** Sem isso, duas pessoas recebendo _linhas diferentes_
  do mesmo pedido travam os itens em ordens opostas, e o InnoDB mata uma das
  duas por impasse. Uma entrega legítima seria recusada com uma mensagem que
  ninguém entende.
- **Leitura fresca.** Quem espera na trava só segue depois que a outra transação
  confirmou, e passa a enxergar o que ela gravou.

### 3. O recálculo da situação lê com trava

O InnoDB roda em **REPEATABLE READ**. Uma leitura comum enxergaria a fotografia
do banco de quando a transação começou a ler — não o que outra pessoa acabou de
gravar. Com duas entregas simultâneas em linhas diferentes, a segunda concluiria
"ainda falta chegar coisa" olhando para uma linha desatualizada, e o pedido
terminaria **parcialmente recebido com tudo na prateleira**.

Por isso o `SELECT` que recalcula a situação é `FOR UPDATE`.

### 4. Compare-and-swap de versão nas transições

`transitionPurchaseOrder` grava com `WHERE version = :v AND status = :s`.
`affectedRows() === 0` ⇒ `ConflictError`. É o mesmo mecanismo do ADR-038.

## Os casos que os testes provam

`tests/integration/purchasing-concurrency.test.ts` roda transações paralelas de
verdade contra o MariaDB. Sem mock, sem relógio falso, sem simulação.

| Caso       | Cenário                                                    | Resultado exigido                                                                       |
| ---------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **A**      | pedido com 4 pendentes, duas transações recebem 4          | uma vence; saldo 4, um movimento, um recebimento                                        |
| **A′**     | cinco tentativas simultâneas de receber o pedido inteiro   | uma vence, quatro recusadas                                                             |
| **B**      | 10 pendentes, dois operadores recebem 6 ao mesmo tempo     | **não termina com 12**: saldo 6, pedido parcial, uma linha de histórico                 |
| **B′**     | quatro parciais de 3 num pedido de 10                      | no máximo três passam; saldo = vencedoras × 3, nunca > 10                               |
| **C**      | cancelar × receber simultâneos                             | determinístico: ou cancelou e **nada** entrou, ou recebeu e o cancelamento foi recusado |
| **C′**     | nunca coexistem pedido cancelado **e** recebimento gravado | verificado nos dois sentidos                                                            |
| **Idem.**  | mesma chave 10× sequenciais                                | um recebimento, um movimento, uma linha; nove respondem `reused`                        |
| **Idem.**  | mesma chave 5× simultâneas                                 | um único efeito                                                                         |
| **Idem.**  | chaves diferentes                                          | dois recebimentos, ambos entram                                                         |
| **Linhas** | duas pessoas recebendo linhas diferentes                   | **as duas entram**, e o pedido termina `received` — não `partially_received`            |
| **Nº**     | cinco pedidos nascendo ao mesmo tempo                      | numeração `[1,2,3,4,5]`, sem buraco nem repetição                                       |
| **Abrir**  | cinco cliques simultâneos com a mesma chave                | **um** pedido                                                                           |

## O que a honestidade permite afirmar

- **"Sem over-receipt"** — sim: caso A e caso B, com transações paralelas reais.
- **"Idempotente"** — sim: há teste de repetição (10×) e de concorrência (5×).
- **"Seguro contra concorrência"** — sim, para os caminhos testados acima.
- **"Recebimento atômico"** — sim **dentro de uma transação**: registro do
  recebimento, entrada de estoque, fechamento da necessidade e histórico de
  preço estão na mesma transação, e uma falha em qualquer ponto derruba tudo.
  Não há janela entre gravar o recebimento e dar entrada no estoque.

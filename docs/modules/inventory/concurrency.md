# Concorrência e idempotência

Decisão estrutural: [ADR-044](../../adr/ADR-044-concorrencia-de-saldo.md).

## A regra, em uma frase

**A condição de negócio vai no `WHERE` do próprio `UPDATE`.**

Ler o saldo, decidir em TypeScript e gravar depois deixa uma janela entre a
leitura e a escrita. Com saldo 1 e duas saídas simultâneas, as duas leem 1, as
duas concluem "cabe", e as duas gravam.

```sql
UPDATE stock_balances SET on_hand = on_hand - :q
WHERE tenant_id = :t AND unit_id = :u AND part_id = :p
  AND on_hand - reserved >= :q;
```

`affectedRows() === 0` ⇒ não cabia ⇒ erro de negócio em português. Não há
retry, não há lock explícito, não há `SELECT … FOR UPDATE`.

## As cinco mutações de saldo

| Operação                                             | Condição no `WHERE`                                    |
| ---------------------------------------------------- | ------------------------------------------------------ |
| aumentar (`receipt`, `adjustment_in`, `transfer_in`) | nenhuma — nada impede receber peça                     |
| diminuir (`issue`, `adjustment_out`, `transfer_out`) | `on_hand - reserved >= :q`                             |
| reservar                                             | `on_hand - reserved >= :q`                             |
| liberar reserva                                      | `reserved >= :q`                                       |
| **consumir reserva**                                 | `reserved >= :q AND on_hand >= :q` — **uma instrução** |

A baixa na reserva (`stock_reservations`) segue o mesmo formato, com a situação
final calculada no `CASE` do próprio `UPDATE`.

## Retaguarda no banco

CHECK constraints em `stock_balances`: `on_hand >= 0`, `reserved >= 0`,
`reserved <= on_hand`, `minimum_quantity >= 0`. Em `stock_reservations`:
`consumed + released <= quantity` e quantidades não negativas.

**Exceção documentada:** `stock_transfers` não tem CHECK de
`from_unit_id <> to_unit_id` — o MariaDB 10.11 recusa (erro 1901) uma FK com
`ON UPDATE CASCADE` sobre coluna citada em CHECK que compara duas colunas.
Entre a CHECK e as FKs que impedem o cruzamento de empresas, as FKs valem mais.
Origem ≠ destino fica no domínio, testada.

## Idempotência

Operações com chave de comando (`idempotency_key`, UNIQUE por tenant):

| Operação           | Chave                           |
| ------------------ | ------------------------------- |
| entrada            | `uq_stock_movement_idempotency` |
| saída              | idem                            |
| consumo de reserva | idem                            |
| transferência      | `uq_stock_transfer_idempotency` |

A **consulta prévia** transforma a colisão numa resposta útil (`reused: true`);
a **UNIQUE** é a garantia final, inclusive no caso simultâneo, em que as duas
transações leem "não existe" e a segunda quebra no `INSERT` — fazendo rollback
inteira, saldo incluído.

Na interface, a chave nasce no clique que **abre o diálogo**, e não durante a
renderização (que precisa ser pura). Abrir de novo produz outra chave: é isso
que separa "a segunda entrada legítima do dia" de "o mesmo comando reenviado".

## Prova

`tests/integration/inventory-concurrency.test.ts` — 11 casos disputando o mesmo
saldo no mesmo banco, em paralelo, sem mock:

- 1 disponível, 2 saídas → 1 vence;
- 3 disponíveis, 5 saídas → 3 vencem;
- 2 reservas → 1 vence;
- reserva × saída → 1 vence, disponível nunca negativo;
- 2 consumos da mesma reserva → 1 vence;
- **consumo × saída avulsa → o consumo vence e a saída é recusada** — prova de
  que a peça não volta ao disponível durante o consumo;
- 2 transferências da última unidade → 1 vence;
- retry de entrada, de transferência e de consumo → um lançamento só.

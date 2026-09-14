# Ledger, saldos, ajustes e custo

Decisão estrutural: [ADR-043](../../adr/ADR-043-ledger-e-saldo-materializado.md).

## Os três números

| Campo       | Significa                                                          |
| ----------- | ------------------------------------------------------------------ |
| `on_hand`   | o que está fisicamente na unidade, **incluindo o que já tem dono** |
| `reserved`  | o que já foi comprometido com alguma OS e ainda não saiu           |
| `available` | `on_hand − reserved`: o que alguém novo ainda pode pegar           |

`reserved` **não** é subtraído de `on_hand` quando a reserva é criada: a peça
continua na prateleira. Quem confunde os dois acaba com um inventário físico que
nunca bate com o sistema.

O **backend é a autoridade**: `available` é calculado no servidor, nunca no
navegador.

## Tipos de movimentação

| Tipo             | Direção | Origem típica                            |
| ---------------- | ------- | ---------------------------------------- |
| `receipt`        | +1      | entrada manual                           |
| `issue`          | −1      | saída, com ou sem OS; consumo de reserva |
| `adjustment_in`  | +1      | ajuste positivo (motivo obrigatório)     |
| `adjustment_out` | −1      | ajuste negativo (motivo obrigatório)     |
| `transfer_out`   | −1      | transferência, ponta de origem           |
| `transfer_in`    | +1      | transferência, ponta de destino          |

**Reserva não está aqui** — ver
[ADR-045](../../adr/ADR-045-reserva-e-entidade-propria.md).

A quantidade é gravada **com sinal** (`+5` entrou, `−2` saiu). Guardar o sinal,
e não só o módulo, faz a reconciliação ser uma soma — e não um `CASE` que
precisa conhecer cada tipo de movimento que vier a existir.

## Origem e referência

`origin_kind` ∈ `manual` | `service_order` | `transfer`.

`manual` é honesto: entrada digitada por uma pessoa, sem nota e sem pedido de
compra. **Fingir** um `purchase_order` aqui seria antecipar o Prompt 11 na
estrutura de dados — e o dia em que Compras chegar encontraria linhas apontando
para pedidos que nunca existiram. Quem quiser registrar a nota fiscal usa
`reference`, que é texto.

## Append-only

A tabela `stock_movements` **não tem `updated_at` nem `version`**, e isso é
proposital: a ausência das colunas é a primeira barreira contra "corrigir" um
lançamento. A segunda é o teste de arquitetura, que falha se qualquer arquivo
passar a executar `UPDATE` ou `DELETE` nela.

**Correção se faz com movimentação compensatória** — um ajuste, com motivo, que
qualquer um consegue ler depois.

## Reconciliação

`reconcileBalance()` recalcula `on_hand` e o custo médio **a partir do ledger**,
na ordem cronológica, e compara com o materializado. É o que torna a
materialização honesta: sem essa função, "o saldo está certo" seria uma crença.

`resulting_on_hand` guarda o saldo logo depois de cada movimento — a
reconciliação vira comparação, não recálculo da tabela inteira.

## Ajuste

Ação sensível, e a única que reescreve o saldo sem que nada tenha entrado ou
saído pela porta. Por isso:

- permissão própria (`inventory.adjust`);
- **motivo obrigatório**, com mínimo de 5 caracteres;
- registro no **AuditLog** além da movimentação no ledger;
- passa pelo **mesmo caminho** de movimentação de qualquer entrada ou saída —
  não existe `UPDATE stock_balances` à parte.

## Inventário / contagem

**Não implementado.** O item 57 pede contagem "somente se necessário": o ajuste
com motivo obrigatório cobre a correção pós-contagem, e um módulo de inventário
cíclico seria arquitetura para um problema que ninguém apresentou. Por isso
**não existe** a permissão `inventory.count` — declará-la faria o catálogo
prometer capacidade inexistente.

## Custo

Três custos diferentes, e o item 18 pede que não se confundam:

| Custo               | Onde vive                                  | Muda quando              |
| ------------------- | ------------------------------------------ | ------------------------ |
| **da movimentação** | `stock_movements.unit_cost` / `total_cost` | nunca — congelado        |
| **unitário atual**  | `stock_balances.average_cost`              | a cada entrada com custo |
| **histórico**       | o ledger inteiro                           | nunca                    |

- **Média ponderada móvel**, calculada dentro do próprio `UPDATE` (atômica).
  Determinística: depende só das **entradas**, na ordem em que ocorreram.
- Entrada **sem custo informado não altera a média**: não saber quanto custou é
  diferente de ter custado zero.
- Saída não altera a média.
- **Não há FIFO nem LIFO** (item 71): valuation contábil sofisticado é
  requisito que ninguém pediu.
- O arredondamento é half-up, a convenção do `Money`, aplicado **uma vez** no
  produto — `3 × R$ 0,335` dá `R$ 1,02`.

## Estoque mínimo e alerta

- O mínimo é **por peça e por unidade** (item 59). A loja do centro gira tela
  de iPhone toda semana; a do bairro vende uma por mês.
- **Mínimo zero significa "não acompanhe"**, não "avise sempre".
- A comparação é contra o **disponível**, não contra o saldo físico: peça
  reservada já tem dono, e contar 5 na prateleira com 5 comprometidas como
  "estoque saudável" é o mesmo que não ter alerta.

### O que o job faz — e o que ele não faz

`inventory.low-stock-sweep` (de hora em hora) marca os saldos abaixo do mínimo e
publica `LOW_STOCK_DETECTED`.

Ele **não** notifica ninguém (não há canal de comunicação — Prompt 16), **não**
cria pedido de compra (Prompt 11) e **não** chama fornecedor (não existe o
módulo). O evento fica no outbox **sem consumidor**, que é exatamente o que o
item 62 pede.

**Idempotência (item 63):** o alerta sai **uma vez por queda**. A marca fica em
`stock_balances.low_stock_alerted_at`, e a condição `IS NULL` está no `WHERE` do
próprio `UPDATE` — duas execuções simultâneas não emitem dois eventos. A marca
volta a nulo sozinha quando o disponível sobe acima do mínimo, nas próprias
instruções de entrada e de liberação de reserva.

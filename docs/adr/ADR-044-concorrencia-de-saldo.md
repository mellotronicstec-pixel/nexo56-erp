# ADR-044 — A condição de negócio vai no `WHERE` do `UPDATE`

**Status:** Aceito
**Data:** Prompt 10 — Estoque e Peças
**Itens atendidos:** 29, 30, 31, 32, 105, 117, 122, 123

## Contexto

Saldo 1. Sábado de manhã, dois atendentes. Os dois abrem a peça, os dois veem
"disponível 1", os dois clicam em dar saída.

Com leitura-decisão-escrita em TypeScript, as duas transações leem 1, as duas
concluem "cabe", e as duas gravam. O estoque fica em −1 — ou fica em 0 tendo
entregado duas peças que não existiam. Não é um caso raro de laboratório: é a
operação normal de uma loja com duas pessoas.

## Decisão

**A condição de negócio é escrita no `WHERE` do próprio `UPDATE`.** Quem decide
é o InnoDB, sob a trava de linha que ele já segura para gravar.

```sql
-- saída e ajuste negativo
UPDATE stock_balances SET on_hand = on_hand - :q
WHERE tenant_id = :t AND unit_id = :u AND part_id = :p
  AND on_hand - reserved >= :q;

-- reserva
UPDATE stock_balances SET reserved = reserved + :q
WHERE ... AND on_hand - reserved >= :q;

-- consumo de reserva: UMA instrução, os dois campos juntos
UPDATE stock_balances SET on_hand = on_hand - :q, reserved = reserved - :q
WHERE ... AND reserved >= :q AND on_hand >= :q;
```

`affectedRows() === 0` significa "não cabia", e vira erro de negócio em
português. **Não há retry, não há lock explícito e não há `SELECT … FOR
UPDATE`.**

O custo médio é calculado dentro do mesmo `UPDATE`, pela mesma razão: duas
entradas simultâneas leriam a mesma média antiga e a segunda sobrescreveria a
primeira.

## Por que a saída avulsa olha o DISPONÍVEL, e não o físico

Retirar peça que está reservada para a OS de outra pessoa deixaria a reserva
dela apontando para algo que não existe mais. Consumir a **própria** reserva é
outra operação — atômica, e sem passar por essa condição.

## Retaguarda no banco

`stock_balances` carrega CHECK constraints: `on_hand >= 0`, `reserved >= 0`,
`reserved <= on_hand`, `minimum_quantity >= 0`. Elas continuam valendo no dia
em que alguém escrever um segundo caminho de gravação, ou rodar um `UPDATE` à
mão numa madrugada.

**Exceção documentada:** `stock_transfers` **não** tem CHECK de
`from_unit_id <> to_unit_id`. O MariaDB 10.11 recusa (erro 1901) criar uma
FOREIGN KEY com `ON UPDATE CASCADE` sobre coluna citada em CHECK que compara
duas colunas. Entre manter a CHECK e manter as FKs compostas que tornam o
cruzamento de empresas impossível, as FKs valem mais: elas protegem o
isolamento, que é o invariante grave. Origem ≠ destino fica no domínio
(`assertTransferUnits`), testada em unidade e em integração.

## Prova

`tests/integration/inventory-concurrency.test.ts` disputa o mesmo saldo no
mesmo banco, em paralelo, sem mock e sem relógio falso:

- disponível 1, duas saídas simultâneas → exatamente uma vence;
- disponível 3, cinco saídas simultâneas → exatamente três vencem;
- duas reservas simultâneas → uma vence;
- reserva × saída → uma vence, e o disponível nunca fica negativo;
- dois consumos da mesma reserva → um vence;
- consumo × saída avulsa → o consumo vence e a saída é recusada (prova de que
  a peça **não volta ao disponível** durante o consumo);
- duas transferências da última unidade → uma vence.

O item 175 do Prompt 10 proíbe declarar "saldo seguro" sem teste concorrente.
É este arquivo que autoriza a frase.

## Consequências

- Nenhuma operação de estoque lê-decide-grava. Quem precisar de uma nova
  operação segue o mesmo formato.
- Perdedor de corrida recebe mensagem de negócio, não erro de constraint.
- Deadlock entre transferências A→B e B→A é evitado por ordem fixa: a saída da
  origem vem sempre primeiro.

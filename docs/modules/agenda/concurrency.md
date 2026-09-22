# Agenda — concorrência e idempotência

## Duplo clique não cria duas tarefas

O formulário gera uma **chave de intenção** por montagem (`crypto.randomUUID()`).
O mesmo formulário reenviado carrega a mesma chave.

A trava é do **banco** — `UNIQUE (tenant_id, idempotency_key)` —, não um
`SELECT` antes do `INSERT`, que perderia a corrida entre dois pedidos
simultâneos. O `SELECT` existe como atalho; quem perde a corrida cai no
`isDuplicateKeyError` e **recebe a tarefa vencedora**, não um erro.

Recarregar a página gera chave nova de propósito: aí a pessoa realmente quis
criar outra.

Vale igual para compromissos: dois blocos idênticos no mesmo horário deixam
quem olha a agenda sem saber qual dos dois alguém já resolveu.

**Verificado:** 5 criações simultâneas com a mesma chave → 1 tarefa; a mesma
chave em outra empresa → 2 tarefas (a chave é por tenant).

## Concluir e cancelar disputando a mesma linha

A condição de negócio vai no `WHERE` do `UPDATE` (ADR-044):

```sql
UPDATE agenda_tasks
   SET status = 'done', ...
 WHERE id = ? AND tenant_id = ? AND status = 'open' AND version = ?
```

Se os dois chegarem juntos, um encontra `status = 'open'` e o outro não
encontra linha nenhuma — e recebe `ConflictError`, em vez de sobrescrever o
fato que acabou de ser gravado.

**Verificado:** concluir e cancelar em paralelo → exatamente um vencedor, o
outro recusado, e a linha termina em `done` **ou** `cancelled`, nunca num
estado misto.

## Versão otimista

`version` viaja no formulário. Se outra pessoa mexeu na tarefa enquanto a tela
estava aberta, a gravação é recusada com uma mensagem que diz o que fazer
("abra de novo para ver o estado atual") — não com um erro técnico.

## A tarefa de fluxo continua com a trava do Prompt 08

`UNIQUE (service_order_id, kind, open_marker)` garante **uma aberta por tipo
por ordem**. A identidade é estrutural: título e descrição não participam de
nenhuma comparação.

**Verificado:** 5 chamadas concorrentes de `createWorkflowTask` → 1 tarefa;
chamada com título e descrição completamente diferentes → nenhuma segunda
tarefa.

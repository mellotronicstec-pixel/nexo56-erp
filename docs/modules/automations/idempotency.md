# Idempotência

**A trava de não-duplicação é sempre um `UNIQUE` real no banco, nunca um
`SELECT`-then-`INSERT`** (itens 76 a 78, 126, 176). Cinco chamadas
concorrentes tentam o mesmo `INSERT`; só uma ganha a corrida no MySQL — as
outras recebem erro de chave duplicada e reagem de forma determinística
(retomam ou desistem), nunca criam uma segunda linha.

## As três camadas

### 1. Execução (`automation_executions`)

`UNIQUE (tenant_id, idempotency_key)` — `uq_automation_execution_idempotency`.

- Evento: `event:{eventId}:rule:{ruleId}:v{versionNumber}`
- Agendamento: `schedule:{ruleId}:v{versionNumber}:{occurrenceDate}:{unitId}`

Cinco processamentos concorrentes do **mesmo** evento/regra ou da **mesma**
ocorrência de agendamento produzem exatamente 1 `Execution` — medido, não só
alegado (ver `performance.md` e `tests/integration/automations-execution.test.ts`,
casos de concorrência).

### 1.5. Single-claim do processamento (`automation_executions.locked_by`/`locked_at`)

Ter uma `Execution` única (camada 1) não bastava para impedir que **múltiplos
processadores concorrentes da MESMA execução já criada** avançassem cada um
para um índice de tentativa diferente e chamassem o serviço oficial mais de
uma vez — medido no fechamento do Prompt 19: 5 chamadas concorrentes a
`runExecutionActions` produziam 2 a 3 `automation_action_attempts`
`succeeded`, mesmo com só 1 efeito real (a camada 3 absorvia a duplicidade,
mas o Motor não deveria nem tentar de novo). A correção (migration 0017) é um
`UPDATE` condicional — mesmo idioma de `jobs.locked_by`/`jobs.locked_at` — no
início de `runExecutionActions`:

```sql
UPDATE automation_executions
SET locked_by = ?, locked_at = NOW()
WHERE id = ? AND tenant_id = ? AND status = 'running'
  AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL 5 MINUTE)
```

`affectedRows = 1` é a única prova de vitória — o próprio MariaDB serializa a
decisão entre conexões concorrentes, nunca um mutex em memória, nunca
dependência de processo único. Quem perde (`affectedRows = 0`) nunca insere
tentativa nem chama o serviço oficial — reconhece o estado real (`succeeded`/
`failed` já terminal, ou `claim_not_acquired` se outro processo ainda está
dentro do prazo) sem registrar sucesso algum que não executou a ação (ver
`execution-model.md`).

### 2. Tentativa de ação (`automation_action_attempts`)

`UNIQUE (execution_id, action_index, attempt_number)` —
`uq_automation_action_attempt`. Com o single-claim acima, só o processo
vencedor do claim da execução chega a este ponto — esta trava vira defesa em
profundidade (caso um claim fique obsoleto enquanto o dono original ainda
processa genuinamente, sem renovar o lease), não a barreira principal.

### 3. Efeito de domínio (reaproveita o `UNIQUE` de cada módulo-alvo)

O Motor **não inventa** uma quarta trava para o efeito final — reaproveita a
que cada módulo já tinha:

- `communication_messages.idempotency_key` — `UNIQUE (tenant_id, idempotency_key)`
- `agenda_tasks.idempotency_key` — `UNIQUE (tenant_id, idempotency_key)`

A chave que o Motor passa para essas duas é
`automation:{executionId}:action:{actionIndex}` — estável por execução e
posição da ação, não por tentativa. Retomar a execução (camada 1) e a
tentativa (camada 2) depois de uma queda de worker chama a mesma função de
novo com a **mesma** chave; o módulo-alvo reconhece que já existe e devolve
`reused` em vez de criar uma segunda mensagem/tarefa. É isto que prova retry
seguro sem depender só do lock da camada 2.

## Por que nunca `SELECT`-then-`INSERT`

Entre o `SELECT` que checa "já existe?" e o `INSERT` que grava, outro
processo pode fazer exatamente a mesma coisa — a janela existe mesmo com
`SELECT ... FOR UPDATE` mal aplicado, e é fácil errar sob carga real. O
`UNIQUE` do banco não tem essa janela: o próprio MySQL serializa a decisão.
Todo `createExecutionRow`/`createScheduleExecution`/tentativa de ação deste
módulo segue `INSERT` direto, captura `isDuplicateKeyError`, e só então
decide se retoma ou desiste — nunca verifica antes de tentar.

## Recuperação de órfã

Se um worker morre com uma `Execution` em `running` (crashou entre criar a
execução e terminar as ações), a próxima tentativa do **mesmo** gatilho
encontra a chave duplicada, mas a linha existente ainda está `running` — o
código reconhece isso e retoma a mesma execução (chama
`runExecutionActions` de novo) em vez de tratar como "já terminou, nada a
fazer". Uma execução já `succeeded`/`failed`/`skipped` nunca é retomada.

Se o worker morre **depois de vencer o claim** (camada 1.5) — já rodou a ação
com sucesso, mas caiu antes de `finishExecution` liberar o lock — o
`locked_at` fica parado no passado. Um processamento seguinte só reclama o
claim depois de `LOCK_STALE_MS` (5 minutos); ao reclamar, encontra a
tentativa já `succeeded` (`hasSucceededAttempt`) e converge sem chamar o
serviço oficial de novo — e, mesmo que chamasse, a camada 3 ainda impediria
um segundo efeito real. As duas camadas nunca se substituem.

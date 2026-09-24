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

### 2. Tentativa de ação (`automation_action_attempts`)

`UNIQUE (execution_id, action_index, attempt_number)` —
`uq_automation_action_attempt`. Um processo perdedor na corrida do `INSERT`
captura o erro de chave duplicada e recua (a ação já está sendo — ou já foi —
tentada por outro processo), em vez de rodar a ação uma segunda vez.

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

# Performance: volume representativo e EXPLAIN

**Medido em `nexo56_dev` (MariaDB 10.11.14) em 2026-09-24**, não em produção
— este documento reporta o que foi efetivamente executado e observado, sem
extrapolar para "vai se comportar assim em produção" (item 187: nunca alegar
sem evidência).

## Volume seedado

| Origem                                                 | Tenants | `automation_rules` | `automation_executions` | `automation_action_attempts` |
| ------------------------------------------------------ | ------- | ------------------ | ----------------------- | ---------------------------- |
| 3 tenants reais (locais/E2E), 60 regras cada           | 3       | 182                | 1.800                   | 1.800                        |
| 200 tenants sintéticos, 8 regras cada (`domain_event`) | 200     | 1.600              | —                       | —                            |
| 30 tenants sintéticos, 1 regra `schedule` cada         | 30      | 30                 | —                       | —                            |
| **Total no banco no momento da medição**               | **203** | **1.812**          | **1.800**               | **1.800**                    |

Os tenants sintéticos existem **só localmente**, para que a fração de um
tenant real dentro da tabela inteira fique baixa (~3%), como aconteceria
numa base com muitos clientes — não como dado de negócio, e não sobem para
lugar nenhum além deste banco de desenvolvimento local. Script de seed
(`scripts/_perf_seed_automations.ts` + SQL auxiliar) foi **removido** antes
do commit, junto com o resto do material de trabalho, na convenção já usada
pelos prompts anteriores.

## Os três pontos quentes citados no Prompt 19 (itens 184–187)

### 1. Trigger dispatch (`event-processor.ts`, `processTriggerForEvent`)

```sql
EXPLAIN SELECT ar.id, ar.scope_kind, arv.id, arv.version_number, arv.definition
FROM automation_rules ar
INNER JOIN automation_rule_versions arv
  ON arv.id = ar.current_version_id AND arv.tenant_id = ar.tenant_id
WHERE ar.tenant_id = ? AND ar.enabled = 1 AND ar.archived_at IS NULL
  AND arv.trigger_key = ?;
```

```
+----+-------------+-------+--------+----------------------------------+----------------------------------+---------+--------------------------------------+------+-----------------------------+
| id | select_type | table | type   | possible_keys                    | key                               | key_len | ref                                    | rows | Extra                          |
+----+-------------+-------+--------+----------------------------------+----------------------------------+---------+--------------------------------------+------+-----------------------------+
|  1 | SIMPLE      | ar    | ref    | ix_automation_rule_tenant_enabled | ix_automation_rule_tenant_enabled | 147     | const,const                            |   41 | Using index condition; Using where |
|  1 | SIMPLE      | arv   | eq_ref | PRIMARY,...,ix_automation_rule_version_trigger | PRIMARY             | 146     | nexo56_dev.ar.current_version_id       |    1 | Using where                      |
+----+-------------+-------+--------+----------------------------------+----------------------------------+---------+--------------------------------------+------+-----------------------------+
```

**`ref` em `ix_automation_rule_tenant_enabled`, 41 linhas examinadas (o
tenant medido tem 62 regras no total) — sem full scan.** `arv` é `eq_ref` por
PK (join `1:1` a partir de `ar.current_version_id`), o acesso mais barato
que existe.

Honestidade sobre a medição: com **apenas 3 tenants** (antes de acrescentar
os 200 sintéticos), o otimizador escolhia `ALL` (full scan de 182 linhas)
para esta mesma consulta — não por bug, mas porque com ~33% de seletividade
por tenant um scan é genuinamente mais barato que usar o índice num MySQL
com estatísticas de custo. Isso só ficou visível — e só virou `ref` — depois
de simular um volume com muitos tenants pequenos, que é o cenário real que o
item 184 pede. Documentado aqui porque o Prompt 19 proíbe alegar
"sem full scan" sem mostrar a medição que sustenta a alegação.

### 2. Schedule due (`schedule-coordinator.ts`, `runScheduleTick`)

```sql
EXPLAIN SELECT ar.id, ar.tenant_id, arv.id, arv.version_number, arv.definition, t.timezone, t.plan_id
FROM automation_rules ar
INNER JOIN automation_rule_versions arv
  ON arv.id = ar.current_version_id AND arv.tenant_id = ar.tenant_id
INNER JOIN tenants t ON t.id = ar.tenant_id
WHERE ar.enabled = 1 AND ar.archived_at IS NULL AND arv.trigger_kind = 'schedule';
```

```
+----+-------------+-------+--------+------------------------------------+------------------------------------+---------+------------------+------+-------------+
| id | select_type | table | type   | possible_keys                       | key                                  | key_len | ref               | rows | Extra         |
+----+-------------+-------+--------+------------------------------------+------------------------------------+---------+------------------+------+-------------+
|  1 | SIMPLE      | t     | ALL    | PRIMARY                              | NULL                                  | NULL    | NULL              |  203 |               |
|  1 | SIMPLE      | ar    | ref    | ix_automation_rule_tenant_enabled    | ix_automation_rule_tenant_enabled    | 147     | t.id,const        |    2 | Using where   |
|  1 | SIMPLE      | arv   | eq_ref | PRIMARY,uq_automation_rule_version_id_tenant | PRIMARY                | 146     | ar.current_version_id |    1 | Using where |
+----+-------------+-------+--------+------------------------------------+------------------------------------+---------+------------------+------+-------------+
```

**Limitação conhecida, reportada sem maquiagem:** este plano dirige a partir
de `tenants`, com `type=ALL` — um full scan, mas da tabela `tenants` (203
linhas no teste), não de `automation_rules`/`automation_rule_versions` (as
tabelas que crescem com o volume de automação). O otimizador escolheu isto
porque é o menor dos dois candidatos plausíveis: filtrar
`automation_rule_versions.trigger_kind = 'schedule'` primeiro exigiria um
full scan de 1.814 linhas (maior, e sem índice em `trigger_kind` hoje), ou um
novo índice em `automation_rules.current_version_id` para permitir o join no
sentido inverso — nenhum dos dois existe nesta V1.

Consequência prática: o custo do tick de agendamento cresce com o **número
de tenants**, não com o número de regras/execuções — que é a dimensão que
mais cresce num ERP multi-tenant. Continua _bounded_ e o tick roda a cada 5
minutos, não a cada requisição — mas se o número de tenants entrar na casa
das dezenas de milhares, este é o primeiro ponto a otimizar (índice
dedicado em `trigger_kind`, ou manter um conjunto materializado "tenants com
alguma regra de agendamento habilitada"). Registrado aqui como trabalho
futuro explícito, não escondido.

### 3. Job claim (`jobs` — infraestrutura reaproveitada, não nova)

```sql
EXPLAIN SELECT id FROM jobs WHERE status='pending' AND run_after <= NOW() ORDER BY run_after LIMIT 1;
```

```
+----+-------------+-------+-------+---------------------------+---------------------------+---------+------+------+---------------------------+
| id | select_type | table | type  | possible_keys              | key                        | key_len | ref  | rows | Extra                       |
+----+-------------+-------+-------+---------------------------+---------------------------+---------+------+------+---------------------------+
|  1 | SIMPLE      | jobs  | range | ix_jobs_status_run_after   | ix_jobs_status_run_after   | 8       | NULL |    1 | Using where; Using index    |
+----+-------------+-------+-------+---------------------------+---------------------------+---------+------+------+---------------------------+
```

`range` sobre `ix_jobs_status_run_after`, **1 linha examinada, `Using
index`** (covering — nem toca a tabela). `automation.dispatch-event` e
`automation.schedule-tick` são `JobHandler`s comuns nessa mesma fila,
criada em prompts anteriores — nenhum código novo do Prompt 19 altera este
caminho.

## Consultas de apoio (não citadas por nome no item 184, medidas por

completude)

- **Filtro de unidade** (`automation_rule_units`, dado um `rule_id`): `ref`
  em `PRIMARY (rule_id, unit_id)`, 1 linha. Sem full scan.
- **Histórico de execuções de uma regra** (`listExecutions`): `ref` em
  `fk_automation_execution_rule_tenant (tenant_id, rule_id)` +
  `Using filesort` para o `ORDER BY created_at DESC LIMIT 200` — o índice
  `ix_automation_execution_rule (tenant_id, rule_id, created_at)` já cobre a
  ordenação; o `filesort` reportado aqui é sobre o pequeno conjunto já
  filtrado (uma regra), não sobre a tabela inteira, e é esperado para este
  padrão de acesso.

## Concorrência (evidência, não alegação — ver `idempotency.md`)

Medido em `tests/integration/automations-execution.test.ts`:

- **5 chamadas simultâneas de `processAutomationEvent`** para o mesmo
  evento/regra → exatamente **1** `Execution` e **1** mensagem/tarefa
  criada (teste passando).
- **5 chamadas simultâneas de `runScheduleTick`** para a mesma ocorrência
  devida → exatamente **1** `Execution` e **1** tarefa criada (teste
  passando).
- **`runExecutionActions` chamado duas vezes** na mesma execução (simulando
  retomada após queda) → contagem de mensagens/tarefas permanece em 1.

## O que este relatório NÃO afirma

Não afirma comportamento em produção real, com tenants e volume que este
ambiente local não reproduz. Não afirma que o full scan de `tenants` no
schedule-tick é aceitável em qualquer escala — afirma que é _bounded_ pelo
número de tenants e documenta o ponto de otimização futura. "Medido" aqui
significa exatamente isto: os planos e números acima, nesta base, nesta
data — nem mais, nem menos.

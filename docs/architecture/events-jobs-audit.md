# Eventos, jobs e auditoria

## Auditoria

Tabela `audit_logs`, **somente inserção** — nenhuma rotina da aplicação atualiza
ou apaga linhas.

Campos: `tenant_id`, `unit_id`, `user_id`, `action`, `entity_type`,
`entity_id`, `before`, `after`, `metadata`, `correlation_id`, `origin`,
`created_at`.

`before`, `after` e `metadata` passam pela **mesma função de redação** usada nos
logs (`redact`), então senha, hash, token, segredo e CPF não chegam a ser
gravados nem por engano — verificado em teste.

Ações auditadas na fundação:

`user.login.succeeded` · `user.login.failed` · `user.logged_out` ·
`tenant.created` · `unit.created` · `user.created` · `feature.enabled` ·
`feature.disabled`

Reservadas para a Central de Módulos completa: `module.enabled`,
`module.disabled`, `plan.entitlement_changed`.

## Eventos

```
runInTransaction(async (tx, emit) => {
  await tx.insert(...)                    ─┐
  await emit({ type, tenantId, payload }) ─┤ mesma transação
})                                         ─┘
              ↓ COMMIT
       dispatch(eventos)  ← handlers só agora
```

- Transação revertida → nenhum evento gravado, nenhum handler chamado.
- Handler que falha → operação **permanece confirmada**, o erro é registrado e o
  evento fica com `published_at` nulo para reprocessamento (formato outbox).

Tipos emitidos hoje: `USER_LOGGED_IN`, `TENANT_CREATED`, `UNIT_CREATED`,
`USER_CREATED`, `FEATURE_ENABLED`, `FEATURE_DISABLED`.

## Jobs

```
enqueue() → tabela `jobs` → JobExecutor → handler
                              ↑
                  cron do hPanel (hoje) · worker/fila (depois)
```

### Idempotência

A garantia é do **banco**: índice `uq_jobs_idempotency_key`. Três chamadas
concorrentes com a mesma chave produzem **uma** linha; as demais recebem o job
existente com `deduplicated: true` — verificado em teste.

Os jobs recorrentes usam chave derivada da janela de tempo
(`<nome>:<índice da janela>`), então o cron disparando mais de uma vez na mesma
janela não duplica execução.

### Concorrência e recuperação

- Reivindicação por `UPDATE ... WHERE id = ? AND status = 'pending'`: dois
  executores simultâneos, apenas um leva o job.
- Retentativa com backoff exponencial (30s × 2^tentativa, teto de 10 min).
- `jobs.requeue-stale` devolve à fila o que ficou preso em `running`.
- Limite por rodada: 25 jobs ou 50 segundos.

### Handlers registrados

| Job                     | O que faz                          | Periodicidade |
| ----------------------- | ---------------------------------- | ------------- |
| `session.prune-expired` | remove sessões expiradas/revogadas | 60 min        |
| `jobs.requeue-stale`    | devolve à fila jobs travados       | 15 min        |

A expressão cron **não** vive na regra de negócio: o hPanel chama um comando só
(`npm run jobs:run`) e a periodicidade lógica fica em `RECURRING_JOBS`.

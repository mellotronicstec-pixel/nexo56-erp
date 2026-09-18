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

Ações de Garantias (Prompt 13), todas registradas **dentro da transação** que
as causou: `warranty_policy.changed` · `warranty.created` ·
`warranty.activated` · `warranty.cancelled` · `warranty.revoked` ·
`warranty_certificate.issued` · `warranty_return.registered` ·
`warranty_return.reclassified` · `warranty_cost.recorded`

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

Tipos emitidos hoje: os da fundação (`USER_LOGGED_IN`, `TENANT_CREATED`,
`UNIT_CREATED`, `USER_CREATED`, `FEATURE_ENABLED`, `FEATURE_DISABLED`) mais os
dos módulos de negócio — Clientes, Equipamentos, Ordem de Serviço, workflow,
Orçamentos e, no Prompt 10, `PART_CREATED`, `PART_UPDATED`, `STOCK_RECEIVED`,
`STOCK_ISSUED`, `STOCK_ADJUSTED`, `STOCK_TRANSFERRED`, `STOCK_RESERVED`,
`STOCK_RESERVATION_RELEASED`, `STOCK_RESERVATION_CONSUMED` e
`LOW_STOCK_DETECTED`; os de Compras e Financeiro; e, no Prompt 13,
`WARRANTY_CREATED`, `WARRANTY_ACTIVATED`, `WARRANTY_CERTIFICATE_ISSUED`,
`WARRANTY_RETURN_REGISTERED`, `WARRANTY_RETURN_SERVICE_ORDER_CREATED`,
`WARRANTY_RETURN_RECLASSIFIED_TO_QUOTE`, `WARRANTY_CANCELLED` e
`WARRANTY_REVOKED`.

Os eventos de Garantias levam identificadores (`warrantyId`, `returnId`,
`serviceOrderId`, `unitId`) e o tipo — **nunca** os termos do que foi
prometido, o relato do cliente nem o custo do conserto.

**Nenhum evento é consumido.** Não há handler de negócio, automação nem Rule
Engine (Prompt 19). O outbox existe para que esses módulos encontrem o gancho
pronto — e é por isso que "estoque baixo" **não notifica ninguém** e **não cria
pedido de compra**.

Pelo mesmo motivo, `SERVICE_ORDER_FINANCIAL_SETTLED` (Prompt 12) **não é
consumido** por Garantias: pagar não é retirar o aparelho, e a garantia interna
começa na entrega
([ADR-063](../adr/ADR-063-garantia-interna-comeca-na-entrega.md)). O comentário
do evento registra que a omissão é deliberada, para que ninguém a "conserte"
depois achando que é esquecimento.

E `WARRANTY_RETURN_REGISTERED` **não envia** WhatsApp, e-mail nem SMS: avisar o
cliente continua sendo ato humano.

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

| Job                             | O que faz                                | Periodicidade |
| ------------------------------- | ---------------------------------------- | ------------- |
| `session.prune-expired`         | remove sessões expiradas/revogadas       | 60 min        |
| `jobs.requeue-stale`            | devolve à fila jobs travados             | 15 min        |
| `service-order.follow-up-sweep` | marca acompanhamento vencido (Prompt 08) | 60 min        |
| `quote.expire-overdue`          | expira orçamentos vencidos (Prompt 09)   | 60 min        |
| `inventory.low-stock-sweep`     | marca saldo abaixo do mínimo (Prompt 10) | 60 min        |

Os três últimos são idempotentes **por construção**: a condição vai no `WHERE`
do próprio `UPDATE` e a marca fica na linha (`follow_up_alerted_for`,
`status = 'sent'`, `low_stock_alerted_at`). Duas execuções simultâneas não
emitem dois eventos, e rodar de hora em hora não enche o outbox.

De hora em hora, e não uma vez por dia: empresas em fusos diferentes viram a
data em horas diferentes, e o job precisa alcançar cada uma logo depois da
virada dela.

A expressão cron **não** vive na regra de negócio: o hPanel chama um comando só
(`npm run jobs:run`) e a periodicidade lógica fica em `RECURRING_JOBS`.

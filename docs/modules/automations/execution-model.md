# Modelo de execução

```
Evento de dominio                    Tick do Schedule Coordinator
      |                                        |
      v                                        v
 processAutomationEvent           runScheduleTick (a cada 5 min)
      | (feature automation.core?)             | (feature automation.core? por tenant)
      v                                        v
 processTriggerForEvent           avalia timeOfDay x agora, por regra
      | (unidade da regra bate com a do fato?)
      v
 evaluateConditions(condicoes, fact)
      |
      +-- nao bate --> Execution(status='skipped')  [auditavel, nao dispara nada]
      |
      +-- bate ------> Execution(status='running') --> runExecutionActions
                                                              |
                                                              v
                                                   ActionAttempt por acao, em ordem
                                                              |
                                                    createMessageFromAutomation /
                                                    createTaskFromAutomation
                                                              |
                                                   Execution(status='succeeded'|'failed')
```

## Rule / RuleVersion: editar nunca sobrescreve

`automation_rules` é um **ponteiro mutável** (nome, habilitada, escopo,
`current_version_id`). `automation_rule_versions` é **imutável**: salvar uma
edição sempre cria uma linha nova com `version_number` incrementado e só
então move o ponteiro. Uma execução grava `rule_version_id`, não `rule_id`
sozinho — o histórico sempre aponta para a definição que **realmente rodou**,
mesmo que a regra tenha sido editada depois (item 51 e 121).
Desabilitar/arquivar muda `enabled`/`archived_at` na Rule; nunca apaga
Version nem Execution (item 55, 165).

## O handler é consumidor, nunca parte do produtor (item 74)

Quem publica `SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED` ou
`LOW_STOCK_DETECTED` não sabe que `event-processor.ts` existe.
`registerAutomationSubscriptions` (`subscriptions.ts`) se inscreve nesses
eventos e, ao ocorrerem, apenas enfileira um job
(`automation.dispatch-event`) — nunca processa inline, mantendo o Motor fora
do caminho crítico do pedido original (o mesmo princípio de outbox que o
resto do event-bus já seguia).

## Reaproveitamento da fila de jobs existente

`automation.dispatch-event` e `automation.schedule-tick` são
`JobHandler`s comuns, registrados em `job-registry.ts` ao lado dos handlers
de Comunicação — reaproveitam a mesma máquina de claim/retry/backoff/
recuperação de órfã que já existe (`claimNextJob`), sem segunda fila. O tick
recorrente (`RECURRING_JOBS`) chama `automation.schedule-tick` a cada 5
minutos.

## Retomada segura (crash recovery)

`runExecutionActions` itera os índices de ação da versão, pula os que já
estão `succeeded`, e é seguro chamar duas vezes para a mesma execução: a
chave de idempotência da chamada ao módulo-alvo é estável por
`(execution, actionIndex)`, não por tentativa. Se o worker cair entre a ação
0 e a ação 1, retomar a execução não reenvia a ação 0 (ver `idempotency.md`).

Antes de iterar qualquer ação, `runExecutionActions` disputa o **claim** da
execução (`automation_executions.locked_by`/`locked_at`, item 1.5 de
`idempotency.md`) — só o vencedor entra no laço. Isto é o que garante, sob
concorrência genuína, que **exatamente um** processo chega a chamar o
serviço oficial de cada ação, não só que o efeito final não duplica.

## Status de execução

`skipped` (condição não bateu) · `running` (em andamento ou retomável) ·
`succeeded` (toda ação convergiu com efeito real aceito pelo módulo-alvo) ·
`failed` (alguma ação com erro permanente — ver `error-codes.ts`,
`PERMANENT_ERROR_CODES`). `succeeded` nunca significa apenas "uma linha foi
criada": para `communication.send_template`, o critério é o resultado real
de `processMessage` — se o provedor recusa, não responde, ou não existe
(`provider_not_configured`/`provider_unavailable`), a ação e a execução ficam
`failed`, nunca `succeeded` com uma mensagem `failed` por baixo (ver
`action-catalog.md`).

`runExecutionActions` também devolve, só para quem chama (nunca persistido
como status de execução), um terceiro valor de retorno —
`claim_not_acquired` — quando este processo não venceu a disputa pelo claim
e por isso não rodou nenhuma ação nem registrou tentativa nenhuma. Nunca
confundir com `failed`, que sempre significa "uma ação rodou e falhou de
verdade".

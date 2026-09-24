# Agendamento (Schedule Coordinator)

Fonte de verdade: `src/modules/automations/application/schedule-coordinator.ts`.

```
Cron / CLI / futuro Worker -> automation.schedule-tick (job) -> runScheduleTick -> Motor
```

A lógica de negócio não mora no arquivo de cron: `scripts/run-jobs.ts` só
aciona o job registrado; quem decide o que é "devido agora" é
`runScheduleTick`. Trocar cron por um worker permanente no futuro não exige
reescrever regra nenhuma (item 190) — o worker só precisaria chamar
`runScheduleTick` com mais frequência.

## Janela do tick, não o segundo exato

`TICK_INTERVAL_MINUTES = 5`. Uma regra configurada para `"09:00"` dispara em
algum minuto dentro de `[09:00, 09:00 + 5min)`, nunca exatamente no segundo
zero — `isDueNow` compara minutos do dia. Isto é um limite conhecido e
deliberado da V1 (item 18: "não prometer frequência que o ambiente inicial
não suporta"), não um bug de arredondamento.

## Identidade da ocorrência

`schedule:{ruleId}:v{versionNumber}:{occurrenceDate}:{unitId}` — a data (dia
civil, no fuso do tenant) e a unidade entram na própria chave de
idempotência, porque `schedule.daily` é `UNIT_SET`-only: cada unidade da
regra gera sua própria ocorrência no mesmo dia. Isso é o que garante que o
tick rodando de novo dentro da mesma janela de 5 minutos — ou dois workers
concorrentes — não crie uma segunda execução para o mesmo dia/unidade (ver
`idempotency.md`).

## Fuso horário é do tenant, nunca do navegador

`nowTimeIn(timezone, now)` e `todayIn(timezone, now)`
(`src/core/time/civil-date.ts`) resolvem "que horas são" e "que dia é" no
fuso do **tenant** (`tenants.timezone`), nunca em UTC cru nem no fuso de
quem está rodando o processo — o mesmo princípio já estabelecido pelo
Prompt 14 (`ADR-076`, "o navegador não é autoridade temporal").

## O portão do `automation.core` também vale aqui

`runScheduleTick` verifica `checkFeatureEnabledForTenant(...,
FEATURES.AUTOMATION_CORE)` **por tenant, dentro do próprio loop** — um
tenant com a feature desligada nunca gera ocorrência nova, mesmo que outros
tenants no mesmo tick tenham a feature ligada (ver `permissions.md`).

## Consulta e volume

A consulta que localiza regras `schedule` habilitadas junta
`automation_rules` + `automation_rule_versions` + `tenants`, sem filtro de
tenant (o coordenador precisa considerar todos os tenants a cada tick). O
plano medido dirige a partir de `tenants` (tabela pequena, cresce com o
número de clientes, não com o volume de regras/execuções) e usa
`ix_automation_rule_tenant_enabled` para o salto até `automation_rules` — ver
`performance.md` para os números e para a limitação conhecida desse desenho
em escala muito grande de tenants.

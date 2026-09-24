# Condições

Fonte de verdade: `src/modules/automations/domain/condition.ts`. Um avaliador
**puro** — recebe uma lista de condições e um `fact` (o payload do evento, ou
`{}` para agendamento) e devolve `boolean`. Sem I/O, sem banco, sem chamada a
outro módulo.

## Operadores fechados

```
equals · not_equals · in · not_in · exists · not_exists ·
greater_than · greater_or_equal · less_than · less_or_equal
```

`OPERATORS_BY_FIELD_TYPE` restringe quais operadores fazem sentido por tipo
de campo (ex.: `greater_than` só em campo `number`) — validado em
`parseRuleDefinition`, não em runtime: uma regra com operador incompatível
com o tipo do campo **nunca chega a ser salva**.

## Semântica: ALL-only, lista vazia é sempre verdadeira

`evaluateConditions(conditions, fact)` exige que **todas** as condições da
lista sejam verdadeiras (E lógico, sem OR na V1 — item 24). Uma regra sem
nenhuma condição (`{ all: [] }`) sempre dispara quando o gatilho ocorre: é o
caso "toda vez que X acontecer, faça Y", sem filtro nenhum.

## Campo fechado, nunca path arbitrário

Uma condição referencia um `field` que precisa existir no `fields` do
gatilho (ver `trigger-catalog.md`) — nunca um caminho livre tipo
`payload.algo.aninhado`. Isso é o que impede uma condição de tentar ler um
dado que o evento nunca prometeu carregar, e o que permite ao editor (UI)
oferecer só os campos que realmente existem para aquele gatilho.

## Limites

`MAX_CONDITIONS_PER_RULE = 10`, `MAX_ACTIONS_PER_RULE = 5`
(`rule-definition.ts`) — uma regra não cresce sem limite; a UI e o validador
compartilham a mesma constante.

## Onde o avaliador é chamado

Só em `event-processor.ts` (`processTriggerForEvent`), depois que a regra já
passou pelo filtro de unidade e antes de criar a execução. Quando as
condições não batem, a execução é criada mesmo assim, com
`status = 'skipped'` — auditável ("a regra viu o evento e decidiu não agir"),
nunca invisível. Ver `execution-model.md`.

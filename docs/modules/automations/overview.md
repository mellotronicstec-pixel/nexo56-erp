# Motor de Automações — visão geral

**Prompt 19.** Camada que reage a fatos de domínio (eventos) ou ao relógio
(agenda diária) e dispara ações controladas, através dos serviços oficiais
dos módulos-alvo — nunca escrevendo tabela de outro módulo, nunca chamando
provider concreto diretamente.

## Princípio central

```
GATILHO (evento de dominio OU horario)
  → catalogo fechado                  (AutomationTriggerCatalog / AutomationActionCatalog)
  → regra configurada (RuleVersion)   (condicoes + acoes, tudo validado por Zod)
  → execucao idempotente              (UNIQUE no banco, nunca SELECT-then-INSERT)
  → acao via servico oficial          (createMessageFromAutomation / createTaskFromAutomation)
```

"O Motor decide QUANDO agir; o módulo-alvo decide COMO agir." Nenhum código
deste módulo executa `eval`, `Function`, `child_process`, SQL livre ou
`fetch` para URL arbitrária — provado por
`tests/unit/automations-boundary.test.ts`, não apenas afirmado aqui.

## Rota e navegação

`/configuracoes/automacoes`, atrás da feature `automation.core` (OPTIONAL) e
da permissão `automations.view` (leitura) / `automations.manage` (escrita).
Item de menu "Automações" dentro da nova seção "Configurações", antes de
"Administração".

## Estrutura do módulo

```
src/modules/automations/
  domain/
    trigger-catalog.ts      — AUTOMATION_TRIGGERS: 3 gatilhos fechados
    action-catalog.ts       — AUTOMATION_ACTION_CATALOG: 2 ações fechadas
    condition.ts            — evaluateConditions (avaliador puro, ALL-only)
    rule-definition.ts      — parseRuleDefinition (gate único de leitura/escrita)
    error-codes.ts          — códigos estáveis de erro de ação
  application/
    rule-service.ts         — CRUD de regra + versionamento + autorização
    event-processor.ts      — evento -> execução (consumidor, nunca produtor)
    schedule-coordinator.ts — tick de agenda diária -> ocorrência -> execução
    execution-runner.ts     — execução -> ações, retomável, idempotente
    automation-jobs.ts      — JobHandlers reaproveitando a fila de jobs existente
    subscriptions.ts        — inscreve o Motor nos eventos que ele conhece
  infrastructure/
    schema.ts               — 5 tabelas (migration 0016)

src/app/(app)/configuracoes/automacoes/
  page.tsx                  — lista de regras
  nova/page.tsx              — criação
  [id]/page.tsx              — detalhe, edição (nova versão), habilitar/desabilitar/arquivar
  [id]/execucoes/page.tsx    — histórico de execuções
  actions.ts, action-state.ts, automation-forms.tsx, trigger-client-info.ts
```

## Os cinco conceitos (ver `ADR-082`)

| Conceito      | Tabela                       | Natureza                                                 |
| ------------- | ---------------------------- | -------------------------------------------------------- |
| Rule          | `automation_rules`           | ponteiro mutável: nome, habilitada, escopo, versão atual |
| RuleVersion   | `automation_rule_versions`   | definição **imutável**: gatilho, condições, ações        |
| Execution     | `automation_executions`      | um disparo real de uma regra contra um evento/ocorrência |
| ActionAttempt | `automation_action_attempts` | append-only, uma linha por tentativa de uma ação         |
| RuleUnit      | `automation_rule_units`      | escopo de unidade **persistido**, nunca derivado         |

## O que o Motor NUNCA faz (item 4 do Prompt 19)

- Não executa código, SQL ou HTTP arbitrário.
- Não age como superusuário mágico — toda ação passa pela autorização e pelas
  invariantes do módulo-alvo.
- Não compra peça, não escreve Financeiro, não escreve
  `service_orders.status`.
- Não implementa webhook de saída nem ação de IA — isso é prompt futuro (ver
  `future.md`).

## Documentos deste módulo

- `trigger-catalog.md` — os 3 gatilhos e por que o catálogo é fechado.
- `action-catalog.md` — as 2 ações V1 e por que sempre via serviço oficial.
- `conditions.md` — o avaliador de condições.
- `execution-model.md` — regra → execução → tentativa de ação.
- `idempotency.md` — as três camadas de trava por `UNIQUE`.
- `scheduling.md` — o Schedule Coordinator e o modelo de tick.
- `permissions.md` — feature, permissões, escopo de unidade/tenant.
- `security.md` — autoridade de configuração vs. autoridade de runtime.
- `performance.md` — EXPLAIN e volume representativo.
- `future.md` — o que fica deliberadamente fora da V1.

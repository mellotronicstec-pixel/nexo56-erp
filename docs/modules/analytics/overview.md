# Painel (Dashboards e BI) — visão geral

**Prompt 18.** Camada de leitura e interpretação controlada sobre os
domínios oficiais do Nexo56. O Painel **nunca cria, altera ou substitui**
fato nenhum — cada número é uma consulta agregada às tabelas oficiais,
executada no momento da requisição.

## Princípio central

```
DADO OPERACIONAL
  → definição semântica explícita   (Metric Catalog)
  → consulta/agregação segura       (adaptador de domínio)
  → indicador/gráfico                (cartão no Painel)
  → drill-down para os registros     (quando fizer sentido — ver metric-catalog.md)
```

"Dashboard lê; domínio decide." Nenhum código deste módulo executa `INSERT`,
`UPDATE` ou `DELETE` — provado por
`tests/unit/analytics-boundary.test.ts`, não apenas afirmado aqui.

## Rota e navegação

`/painel`, atrás da feature `analytics.dashboard` e da permissão
`analytics.view`. Item de menu "Painel" logo após "Central de Trabalho" —
a Central responde "o que fazer agora?"; o Painel responde "como estamos
indo?" (ver `ADR-081` sobre por que os dois nunca se fundem).

A página inicial (`/`) **não foi tocada**: continua sendo a tela de
identidade/acesso do Prompt 01, deliberadamente sem KPI. O Painel é uma
experiência nova e distinta, não uma substituição — evita o "segundo
dashboard sem inspeção" que o Prompt 18 proíbe (item 7), porque a home
nunca prometeu métricas de negócio.

## Estrutura do módulo

```
src/modules/analytics/
  domain/
    analytics-scope.ts            — período + escopo de unidade
    metric-catalog.ts             — definição de cada métrica (fonte de verdade)
    service-order-analytics.ts    — regras puras (aging, ciclo, aprovação)
  application/
    dashboard-query-service.ts    — orquestrador: acesso + agregação
    service-order-metrics.ts
    quote-metrics.ts
    finance-metrics.ts            — reaproveita loadFinanceOverview
    inventory-metrics.ts
    purchasing-metrics.ts
    warranty-metrics.ts
    agenda-metrics.ts
    communication-metrics.ts
```

Nenhuma pasta `infrastructure/` — o módulo nunca teve tabela própria, e a
migration final do repositório continua sendo `0015_portal.sql`.

## Métricas implementadas no V1

23 métricas em 8 domínios: Ordens de Serviço (7), Orçamentos (4),
Financeiro (3), Estoque (1), Compras (2), Garantias (2), Agenda (2),
Comunicação (2). Lista completa com fórmula, fonte e permissão em
`metric-catalog.md`.

## O que este V1 explicitamente não faz

- Não materializa nada (ver ADR-081): toda consulta é ao vivo.
- Não compara períodos automaticamente, não mostra `% ↑/↓`.
- Não exporta CSV/XLSX nem gera PDF do Painel.
- Não oferece seleção livre de N unidades — só "todas as autorizadas" ou
  "uma específica" (ver `future.md`).
- Não usa IA, previsão nem detecção de anomalia.
- Não inclui custo de garantia (`warranties.costs.view`) nem ranking de
  técnico/cliente/fornecedor.

Cada omissão é deliberada e documentada, não esquecida.

# Metric Catalog — todas as métricas do Painel

Fonte de verdade em código: `src/modules/analytics/domain/metric-catalog.ts`.
Este documento é a projeção legível dela — se os dois divergirem, o código
manda (e `tests/unit/analytics-metric-catalog.test.ts` falha nesse caso,
porque compara contra os catálogos reais de Feature e Permission).

Convenções da tabela: **Unit scope** é sempre "unidades selecionadas do
escopo" (`AnalyticsScope.selectedUnitIds`, nunca o tenant inteiro); "Instant"
= retrato de agora, independente do período; "Period" = depende do filtro de
período selecionado.

## Ordens de Serviço

| Key                      | Rótulo                        | Fórmula                                                                                | Fonte                              | Granularidade | Permission            | Feature               | Drill-down                                   |
| ------------------------ | ----------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------- | ------------- | --------------------- | --------------------- | -------------------------------------------- |
| `os.status_distribution` | OS por situação               | `COUNT(*) GROUP BY status`, todas as 9 situações oficiais                              | `service_orders`                   | Instant       | `service_orders.view` | `core.service_orders` | Sim → `/ordens-de-servico?situacao=<status>` |
| `os.open_total`          | OS em aberto                  | soma das situações não terminais de `os.status_distribution`                           | idem                               | Instant       | idem                  | idem                  | Não (soma multi-situação)                    |
| `os.created_in_period`   | Entradas no período           | `COUNT(*) WHERE opened_at` no período                                                  | `service_orders.opened_at`         | Period        | idem                  | idem                  | Sim → `/ordens-de-servico?de=&ate=`          |
| `os.completed_in_period` | Finalizações no período       | `COUNT(*) WHERE status='completed' AND status_changed_at` no período                   | `service_orders.status_changed_at` | Period        | idem                  | idem                  | Não (ver nota abaixo)                        |
| `os.cancelled_in_period` | Cancelamentos no período      | `COUNT(*) WHERE status='cancelled' AND status_changed_at` no período                   | idem                               | Period        | idem                  | idem                  | Não                                          |
| `os.backlog_aging`       | Antiguidade do backlog aberto | buckets de `(hoje - opened_at)` para não terminais                                     | `service_orders.opened_at`         | Instant       | idem                  | idem                  | Não                                          |
| `os.cycle_time`          | Tempo de ciclo                | mediana e média de `DATEDIFF(status_changed_at, opened_at)`, só `completed` no período | idem                               | Period        | idem                  | idem                  | Não                                          |

**Nota sobre drill-down ausente em finalizações/cancelamentos:** a lista
oficial de OS (`/ordens-de-servico`) filtra `de`/`ate` por `opened_at`, não
por `status_changed_at`. Um link que reaproveitasse esses parâmetros para
"finalizações no período" mostraria uma lista que **não reconcilia** com o
cartão (reconciliação exata é mandatória — item 46). Em vez de forçar um
link que mentiria, o V1 deixa esses dois cartões informativos, sem link.
Documentado como melhoria futura em `future.md`.

## Orçamentos

| Key                        | Rótulo                   | Fórmula                                                                                            | Fonte               | Granularidade | Permission    | Feature       |
| -------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------- | ------------------- | ------------- | ------------- | ------------- |
| `quote.sent_in_period`     | Orçamentos enviados      | `COUNT(*) WHERE sent_at` no período                                                                | `quotes.sent_at`    | Period        | `quotes.view` | `core.quotes` |
| `quote.approved_in_period` | Orçamentos aprovados     | `COUNT(*) WHERE status='approved' AND decided_at` no período                                       | `quotes.decided_at` | Period        | idem          | idem          |
| `quote.rejected_in_period` | Orçamentos rejeitados    | `COUNT(*) WHERE status='rejected' AND decided_at` no período                                       | idem                | Period        | idem          | idem          |
| `quote.approval_rate`      | Taxa de decisão aprovada | `approved / (approved + rejected)`; pendentes fora do denominador; `null` ("—") se denominador = 0 | derivado            | Period        | idem          | idem          |

## Financeiro

| Key                             | Rótulo                     | Fórmula                                                                                                  | Fonte                                             | Granularidade | Permission     | Feature        |
| ------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------- | -------------- | -------------- |
| `finance.settlements_in_period` | Recebimentos liquidados    | `SUM(amount)` de liquidações `direction='receivable'`, `status='confirmed'`, `effective_date` no período | `financial_settlements` via `loadFinanceOverview` | Period        | `finance.view` | `finance.core` |
| `finance.receivable_open`       | Contas a receber em aberto | `SUM(amount - settled_amount)` de títulos `receivable` em `open`/`partially_settled`                     | `financial_titles` via `loadFinanceOverview`      | Instant       | idem           | idem           |
| `finance.receivable_overdue`    | Contas a receber vencidas  | subconjunto do anterior com `due_date < hoje`                                                            | idem                                              | Instant       | idem           | idem           |

Todos os três reaproveitam `loadFinanceOverview` (o mesmo serviço da tela
`/financeiro`) — ver ADR-081 para por que Financeiro é a única exceção sem
SQL própria no Painel.

## Estoque

| Key                         | Rótulo                 | Fórmula                                                                                                               | Fonte            | Granularidade | Permission       | Feature                |
| --------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------- | ---------------- | ---------------------- |
| `inventory.low_stock_count` | Itens abaixo do mínimo | `COUNT(*) WHERE minimum_quantity > 0 AND (on_hand - reserved) < minimum_quantity` — mesma regra de `low-stock-job.ts` | `stock_balances` | Instant       | `inventory.view` | `operations.inventory` |

## Compras

| Key                      | Rótulo                 | Fórmula                                                    | Fonte             | Granularidade | Permission       | Feature                 |
| ------------------------ | ---------------------- | ---------------------------------------------------------- | ----------------- | ------------- | ---------------- | ----------------------- |
| `purchasing.open_needs`  | Necessidades em aberto | `COUNT(*) WHERE status='open'`                             | `purchase_needs`  | Instant       | `purchases.view` | `operations.purchasing` |
| `purchasing.open_orders` | Pedidos em aberto      | `COUNT(*) WHERE status IN ('placed','partially_received')` | `purchase_orders` | Instant       | idem             | idem                    |

## Garantias

| Key                          | Rótulo               | Fórmula                                                           | Fonte              | Granularidade | Permission        | Feature                 |
| ---------------------------- | -------------------- | ----------------------------------------------------------------- | ------------------ | ------------- | ----------------- | ----------------------- |
| `warranty.active_count`      | Garantias vigentes   | `COUNT(*) WHERE status='active' AND starts_on <= hoje <= ends_on` | `warranties`       | Instant       | `warranties.view` | `operations.warranties` |
| `warranty.returns_in_period` | Retornos em garantia | `COUNT(*) WHERE registered_at` no período                         | `warranty_returns` | Period        | idem              | idem                    |

Custo de garantia (`warranties.costs.view`) **não está no V1** — ver
`future.md`.

## Agenda

| Key                    | Rótulo            | Fórmula                                            | Fonte          | Granularidade | Permission    | Feature             |
| ---------------------- | ----------------- | -------------------------------------------------- | -------------- | ------------- | ------------- | ------------------- |
| `agenda.overdue_tasks` | Tarefas vencidas  | `COUNT(*) WHERE status='open' AND due_date < hoje` | `agenda_tasks` | Instant       | `agenda.view` | `operations.agenda` |
| `agenda.today_tasks`   | Tarefas para hoje | `COUNT(*) WHERE status='open' AND due_date = hoje` | idem           | Instant       | idem          | idem                |

## Comunicação

| Key                                  | Rótulo                | Fórmula                                                    | Fonte                    | Granularidade | Permission            | Feature               |
| ------------------------------------ | --------------------- | ---------------------------------------------------------- | ------------------------ | ------------- | --------------------- | --------------------- |
| `communication.registered_in_period` | Mensagens registradas | `COUNT(*) WHERE created_at` no período, qualquer status    | `communication_messages` | Period        | `communications.view` | `communications.core` |
| `communication.failed_in_period`     | Mensagens com falha   | `COUNT(*) WHERE status='failed' AND created_at` no período | idem                     | Period        | idem                  | idem                  |

**Nunca existe** "taxa de entrega" nem "taxa de leitura": o modelo de
Comunicação não tem `delivered`/`read` (ADR-078), e nenhum provider real
está integrado em produção (Prompt 17). Inventar essas métricas sugeriria
tráfego real de mensagens que o sistema não pode confirmar.

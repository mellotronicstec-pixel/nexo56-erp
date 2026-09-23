# ADR-081 — O Painel é live query sobre os módulos oficiais, sem Data Warehouse

**Status:** Aceito
**Data:** Prompt 18 — Dashboards e BI
**Itens atendidos:** 5, 9 a 11, 20 a 26, 97 a 100, 116 a 122, 175 a 181, 237

## Contexto

O Prompt 18 pede indicadores agregados sobre praticamente todos os domínios
do Nexo56 — Ordens de Serviço, Orçamentos, Financeiro, Estoque, Compras,
Garantias, Agenda, Comunicação — sem que o Painel se torne um segundo lugar
onde esses fatos são decididos ou guardados. A tentação óbvia seria copiar
dados operacionais para tabelas `analytics_*`, ou materializar um snapshot
diário: um Data Warehouse pequeno, dentro do próprio MariaDB.

Esta ADR decide que o V1 **não faz isso**, e formaliza a estrutura que
substitui um Data Warehouse: um catálogo de definições (Metric Catalog) mais
adaptadores de leitura por domínio, todos executando contra as tabelas
oficiais no momento da requisição.

## Alternativas consideradas

**Cópia de dados para tabelas `analytics_*`.** Rejeitada. Duas verdades sobre
o mesmo fato — a original em `service_orders` e a copiada em
`analytics_service_orders` — é exatamente o problema que toda a arquitetura
do Nexo56 até aqui evita (a Central de Trabalho, ADR-077, tomou a mesma
decisão pelo mesmo motivo). A cópia atrasa, pode divergir sob falha parcial
de sincronização, e duplica a superfície de tenant/unit-safety que precisa
ser mantida correta.

**Snapshot diário materializado.** Rejeitado por falta de evidência de
necessidade (item 97: "antes de criar tabela de snapshot diário, meça").
Nenhuma consulta deste prompt, medida com `EXPLAIN` contra a fixture usada
(ver `docs/modules/analytics/performance.md`), justificou pré-computação: os
índices que a Central de Trabalho e o núcleo de Ordens de Serviço já criaram
(`ix_service_order_unit_status`, `ix_service_order_tenant_unit_opened`)
cobrem as contagens do Painel sem full scan.

**Data Warehouse externo (ClickHouse, BigQuery, OLAP dedicado).**
Explicitamente fora de escopo (item 5). A infraestrutura do Nexo56 V1 é
Next.js + MariaDB; introduzir um segundo banco para um punhado de contagens
agregadas seria a "infraestrutura de amanhã" chegando sem que o volume de
hoje a peça.

## Decisão: três camadas, cada uma com uma responsabilidade

1. **Metric Catalog** (`src/modules/analytics/domain/metric-catalog.ts`) —
   dado estático. Cada métrica declara chave, rótulo, descrição, domínio
   fonte, fórmula em prosa, unidade, granularidade, feature e permissão
   exigidas, e o que a UI mostra sem amostra. Nenhum número chega à tela sem
   uma entrada aqui — é o que torna a exigência "todo número precisa de
   definição e origem demonstráveis" verificável por teste
   (`tests/unit/analytics-metric-catalog.test.ts`), não apenas prometida em
   comentário.

2. **AnalyticsScope** (`src/modules/analytics/domain/analytics-scope.ts`) —
   resolve, uma única vez por requisição, o período (com clamps e padrões
   seguros para entrada de URL não confiável) e o subconjunto de unidades
   autorizadas efetivamente consultado. Nenhum adaptador de domínio aceita
   `unitId` de fora deste objeto.

3. **Adaptadores por domínio** (`src/modules/analytics/application/*-metrics.ts`)
   — um arquivo por domínio fonte, cada um só-leitura contra as tabelas
   oficiais (ou reaproveitando um serviço de leitura oficial já existente,
   caso do Financeiro — ver abaixo). `DashboardQueryService`
   (`dashboard-query-service.ts`) orquestra: resolve o escopo, decide POR
   DOMÍNIO se a feature e a permissão liberam a unidade, e só então chama o
   adaptador correspondente — nunca ao contrário.

## Por que Financeiro não tem SQL própria, e os demais têm

`finance-metrics.ts` é a única exceção estrutural: ele reaproveita
`loadFinanceOverview`, a MESMA função que a tela `/financeiro` usa, chamada
uma vez por unidade selecionada e somada com `Money` (nunca `Number`). A
razão é que aquela função já resolve, corretamente, uma regra sutil —
liquidação estornada nunca conta como recebida — e reescrever essa regra em
uma segunda consulta SQL criaria exatamente o risco que este documento
existe para evitar: duas implementações da mesma verdade financeira
divergindo silenciosamente. Os demais domínios (Ordens de Serviço, Orçamentos,
Estoque, Compras, Garantias, Agenda, Comunicação) não tinham uma função de
agregação tenant/unit+período pronta para reaproveitar, então o Painel
escreve sua própria consulta — sempre com `drizzle-orm` parametrizado, nunca
interpolação de string, e sempre re-derivando a mesma regra de negócio já
formalizada no domínio de origem (ex.: "abaixo do mínimo" repete
literalmente a desigualdade de `low-stock-job.ts`, nunca uma segunda
definição).

## Por que não há personalização nem multi-seleção arbitrária de unidade no V1

O escopo de unidade (`AnalyticsScope.selectedUnitIds`) já suporta
internamente qualquer subconjunto das unidades autorizadas — é assim que
"todas as unidades" e "uma unidade específica" funcionam, e é assim que os
testes de isolamento (`tests/integration/analytics-dashboard.test.ts`)
provam a regra com um tenant de 3 unidades e um usuário autorizado a 2. A
interface V1, porém, só oferece "todas" ou "uma específica" — não uma
seleção livre de N unidades (ex.: 2 de 3) — pelo mesmo motivo que a Central
de Trabalho não aceita unidade pela URL: um seletor a mais é um caminho a
mais para errar, e nenhuma necessidade comprovada pediu essa granularidade
ainda. Fica documentado como extensão natural em
`docs/modules/analytics/future.md`.

## Consequência

Desligar `analytics.dashboard` (Effective Access) impede o acesso à tela e
a QUALQUER consulta dos adaptadores — nenhum dado operacional é tocado,
porque o módulo nunca escreve. Desligar um domínio individual (ex.:
`finance.core`) faz o cartão correspondente desaparecer e sua consulta
nunca rodar, sem exigir que o Painel "saiba" que o Financeiro está
desligado além de perguntar ao Effective Access. Nenhuma migration foi
necessária neste prompt — a última migration do repositório continua sendo
`0015_portal.sql`.

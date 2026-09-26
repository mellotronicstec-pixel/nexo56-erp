# Independência do Nexo56 AI (correção de modularidade pós-CI #33)

## O que mudou

O CI #33 (commit `74b6c87`) mergeou o Prompt 21 com a feature da Busca de
Peças declarada como `ai.part_search`, **dependente de `ai.core`**
(`dependsOn: [FEATURES.AI_CORE]`). Uma revisão pós-merge identificou que
isso violava o Prompt 03 (item 12: "Nexo56 AI não é dependência necessária
para o ERP funcionar") e o próprio desenho do Prompt 21: desligar o Nexo56
AI inteiro desligaria, junto, a busca interna determinística, o
Compatibility Assessor e o Ranking — nenhum dos quais chama IA nenhuma.

## Investigação (antes da correção)

| Pergunta                                                             | Resposta, com evidência                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Com `ai.core = OFF`, a ação "Buscar peça" desaparecia?               | **Sim** — `evaluateAccess` (Effective Access) nega `ai.part_search` inteira por `DEPENDENCY_UNSATISFIED` quando `ai.core` não está ligado, e `canSearchPartsDecision.allowed` vira `false` na página da OS.                                             |
| Com `ai.core = OFF`, o backend rejeitava a busca?                    | **Sim** — `performPartSearch` chamava `authorizePartSearch`, que exigia a feature `ai.part_search` (e, por dependência, `ai.core`) **antes** de qualquer busca interna.                                                                                 |
| A busca interna de Inventory deixava de funcionar?                   | **Sim, por efeito colateral** — o gate composto bloqueava a função inteira, inclusive a parte 100% determinística.                                                                                                                                      |
| `PartSearchProvider` deixava de funcionar?                           | **Sim, pelo mesmo motivo** — nunca chegava a ser chamado.                                                                                                                                                                                               |
| Existe algum uso real de `AiGateway` no Prompt 21?                   | **Não.** Busca no módulo inteiro por `AiGateway`/`AiProvider`/`modules/ai/application`/`modules/ai/infrastructure`: zero ocorrências.                                                                                                                   |
| Existe AI enrichment implementado hoje, ou só arquitetura preparada? | **Nem arquitetura preparada.** A única importação era `extractTechnicalAnchors`, uma função **pura** de normalização de texto, sem chamada de rede nem inferência — desde a correção de código abaixo, nem essa importação de `modules/ai` existe mais. |

## A regra corrigida

```
PART SEARCH CORE (nunca depende de ai.core)
├── busca interna (Estoque + histórico de compra)
├── Compatibility Assessor (puro, determinístico)
├── Ranking (puro, lexicográfico)
├── PartSearchProvider (estruturado, != AiGateway)
├── ofertas externas
└── seleção humana

AI ENRICHMENT (hipotético, não implementado nesta V1)
└── SE existir no futuro, pode depender de ai.core — mas sua
    falha/desativação degrada graciosamente para a busca determinística,
    nunca desliga a busca inteira.
```

Como nenhum AI enrichment real existe hoje (YAGNI — item 7 da correção),
não há nenhuma subcapacidade para gatear com `ai.core` nesta V1. Se um
enriquecimento real for adicionado no futuro, ele ganhará seu próprio
`can()` opcional, verificado **depois** de a busca determinística já ter
resultado — nunca antes, e nunca bloqueando o resultado principal.

## Feature Catalog final

| Antes (CI #33)                                         | Depois (correção)                                              |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `ai.part_search`, `dependsOn: ['ai.core']`             | `operations.part_search`, `dependsOn: []`                      |
| Nome: "Nexo56 AI — Busca de Peças"                     | Nome: "Busca de Peças"                                         |
| Permissão `parts.search.featureKey = 'ai.part_search'` | Permissão `parts.search.featureKey = 'operations.part_search'` |
| Grupo de permissão: `nexo56-ai` (junto com `ai.use`)   | Grupo de permissão dedicado: `busca-de-pecas`                  |
| Label da UI: "Buscar peça (IA)"                        | Label da UI: "Buscar peça"                                     |

O prefixo `operations.` segue a mesma convenção de `operations.inventory`,
`operations.purchasing`, `operations.warranties`, `operations.agenda`:
nomeia a ÁREA do produto (uma capacidade operacional de negócio), não a
tecnologia por trás. `dependsOn: []` segue o mesmo raciocínio já usado em
`automation.core` e `analytics.dashboard` — capacidades que tocam módulos
opcionais de forma **oportunista** (Estoque, Compras) sem exigir
formalmente nenhum deles.

## Efeito prático

| Cenário                                                   | Resultado                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `operations.part_search` ON, `ai.core` OFF, permissão ON  | Busca funciona por inteiro: interna, Assessor, Ranking, `PartSearchProvider`. |
| `operations.part_search` OFF, `ai.core` ON, permissão ON  | Negado — ligar `ai.core` nunca supre `operations.part_search`.                |
| `operations.part_search` ON, `ai.core` ON, permissão OFF  | Negado — permissão continua obrigatória, `ai.core` é irrelevante aqui.        |
| `operations.part_search` ON, `ai.core` OFF, permissão OFF | Negado — mesma regra, com ou sem `ai.core`.                                   |

Provado com banco real em
`tests/integration/part-search.test.ts` (`describe('effective access: operations.part_search x ai.core ...')`
e `describe('independente de ai.core: busca interna, provedor e producao ...')`)
e estaticamente em `tests/unit/feature-catalog.test.ts` e
`tests/unit/part-search-boundary.test.ts`.

## Fechamento arquitetural: dependência de CÓDIGO também removida (pós-CI #34)

A correção acima resolveu a dependência de **feature** (`ai.core`). Restava
uma dependência de **código**: `query-normalization.ts` ainda importava
`extractTechnicalAnchors` de `@/modules/ai/domain/technical-anchors` — nunca
uma dependência de execução (a função é pura, sem I/O), mas ainda um edge no
grafo de módulos que uma primitive genérica usada por dois módulos não deveria
ter. Ver `docs/modules/part-search/architecture.md` (seção "Independência do
Nexo56 AI") para o desenho final: a extração de âncoras técnicas mora em
`src/core/text/technical-anchors.ts`, e tanto o Nexo56 AI quanto a Busca de
Peças a importam do core, simetricamente — nenhum dos dois importa do outro.

## Migração de dados

Nenhuma migration SQL nova foi necessária — o Feature/Permission Catalog
vive em tabelas de aplicação (`features`, `plan_entitlements`,
`tenant_features`, `permissions`) sincronizadas de forma idempotente por
`syncCatalog()` a partir do código (nunca por `drizzle/*.sql`). Como o
Prompt 21 mergeou no CI #33 minutos antes desta correção, nenhum tenant
real havia configurado `ai.part_search` — a troca de chave é, na prática,
a inserção de uma feature nova (`operations.part_search`) pelo próximo
`syncCatalog()`, sem perda de configuração de nenhum tenant existente. A
linha antiga `ai.part_search`, se já tiver sido sincronizada em algum
ambiente, permanece no catálogo (política do projeto: "nunca apaga
feature do catálogo") — órfã e inofensiva, nunca mais referenciada pelo
código.

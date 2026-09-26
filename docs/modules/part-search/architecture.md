# Arquitetura

## Separação conceitual (nunca confundida)

```
Part Search Session   -> a BUSCA em si (quando, quem, sobre o que)
Part Search Candidate -> IDENTIDADE TECNICA observada (nao e Inventory Item)
Compatibility Evidence -> POR QUE um candidate tem aquele rotulo
Part Search Offer     -> CONDICAO COMERCIAL de UMA fonte, num instante
Provider Call         -> observabilidade operacional da chamada externa
Selection             -> a ESCOLHA HUMANA (nunca criada pela busca sozinha)
```

Um `Candidate` pode ter vários `Offer`s (estoque interno, histórico de
compra, uma ou mais fontes externas) — a mesma peça, várias condições
comerciais observadas. Nenhum dos dois é a linha de `parts` (Estoque,
Prompt 10): quando um candidato corresponde a uma peça real do catálogo,
guarda-se `part_id` como referência de leitura, nunca uma cópia.

## Camadas

```
domain/          tipos, normalizacao, assessor de compatibilidade, ranking,
                  validacao de URL, schema do resultado do provedor —
                  tudo PURO, sem I/O, testavel isoladamente.
application/      orquestracao: performPartSearch, selectCandidate,
                  createPurchaseNeedFromSelection, fontes internas/externas.
infrastructure/   schema Drizzle, repositorio, provedor de captura,
                  registry do provedor externo.
```

`src/app/(app)/pecas/actions.ts` expõe três Server Actions finas (mesmo
padrão de `src/app/(app)/ai/actions.ts`); a UI vive em
`src/app/(app)/ordens-de-servico/[serviceOrderId]/part-search-panel.tsx`.

## Fluxo de uma busca

1. Valida entrada (termo obrigatório, contexto de OS opcional).
2. Se veio de uma OS: carrega a OS (leitura tenant-scoped via
   `findServiceOrderDetail`), autoriza `service_orders.view` **na unidade
   real da OS** — nunca aceita `unitId` solto do cliente quando há OS.
3. Autorização composta: `parts.search` + feature `operations.part_search`,
   na mesma unidade — **sem depender de `ai.core`** (correção de
   modularidade pós-CI #33; ver `ai-independence.md`).
4. Normaliza a consulta (reaproveita `extractTechnicalAnchors`, uma
   função **pura** de texto do Nexo56 AI — nenhuma chamada de rede/IA;
   nunca altera parte técnica do termo).
5. Busca interna: só roda se o usuário tiver `inventory.view` na unidade
   — senão, a seção some silenciosamente (Estoque continua opcional).
6. Busca externa opcional: provedor ausente ou indisponível nunca derruba
   a busca interna.
7. Compatibility Assessor classifica cada candidate; Ranking ordena.
8. Grava sessão + candidates + evidências + ofertas + chamadas de
   provedor numa única transação; devolve o resultado já ordenado.

Nenhuma escrita acontece em `parts`, `stock_balances`,
`purchase_price_history` ou `service_orders` — as únicas tabelas escritas
são as cinco do próprio módulo (mais, opcionalmente, uma linha em
`purchase_needs` através da porta oficial de Compras).

## Domínio proprietário vs. lido

O módulo **possui**: busca, candidatos, evidências, compatibilidade,
ofertas, seleção. Ele **lê** (nunca escreve) Estoque e Compras pelas suas
portas de aplicação oficiais (`loadBalance`, `listPriceHistoryForPart`,
`listOpenNeedsForUnit`) e, para o catálogo de peças em si (que não tem
porta tenant-wide pronta — só `listParts`, presa à unidade ativa, e
`searchPartsForPicker`, sem `partNumber`/`brand`), uma leitura direta
(`SELECT`) da tabela `parts` com as mesmas funções de normalização que o
Estoque já exporta. Essa é a única exceção documentada, coberta por um
teste de arquitetura (`part-search-boundary.test.ts`).

## Dependência de mão única

Part Search depende, opcionalmente, de Estoque e de Compras. Nem Estoque
nem Compras sabem que Part Search existe — nenhum dos dois importa nada
do módulo, e um teste de arquitetura garante isso. Automations e Portal
também nunca são importados por Part Search, e o inverso também nunca
acontece.

## Independência do Nexo56 AI

Part Search Core (busca interna, Compatibility Assessor, Ranking,
`PartSearchProvider`, seleção humana) **nunca** depende de `ai.core` — nem
como feature, nem como código. Ver `ai-independence.md` para a explicação
completa e a prova de que nenhum uso real de `AiGateway`/`AiProvider` existe
no fluxo principal.

**Zero imports de `modules/ai`**: a extração de âncoras técnicas
(`extractTechnicalAnchors`) que a normalização de consulta reutiliza é uma
primitive de texto pura e genérica — mora em `src/core/text/technical-anchors.ts`,
ao lado de `normalize.ts` (mesmo padrão: uma operação que nasceu num módulo e
subiu para o core quando um segundo módulo precisou dela, em vez de um
importar do outro ou duplicar a regex). O Nexo56 AI usa a mesma primitive no
seu Technical Anchor Guard (`modules/ai/domain/technical-anchors.ts`,
`checkTechnicalAnchors` — que é a política de comparação, específica de IA,
e continua lá). Um teste de arquitetura (`part-search-boundary.test.ts`)
garante que nenhum arquivo do módulo importa qualquer coisa de
`modules/ai` — domain, application, infrastructure ou UI.

## Por que uma tabela por conceito, e não uma tabela “resultado” genérica

Fundir `Candidate` e `Offer` numa linha só faria uma peça com três ofertas
virar três "candidatos" diferentes — quebrando a regra de deduplicação
conservadora (item 54) e tornando impossível mostrar "a mesma peça, três
condições comerciais" na UI. Separar também é o que permite o ranking
comparar candidatos pela **melhor** oferta sem perder as outras.

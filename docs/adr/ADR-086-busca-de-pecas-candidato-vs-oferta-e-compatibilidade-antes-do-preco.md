# ADR-086 — Busca de Peças: Candidato vs. Oferta, e Compatibilidade antes do Preço

**Status:** Aceito
**Data:** Prompt 21 — Nexo56 AI / Busca de Peças
**Itens atendidos:** 1 a 76, 80 a 220, 234 a 293 (ver relatório final do prompt para a checklist completa)

## Contexto

O Prompt 21 pede uma ferramenta de busca de peças a partir da Ordem de
Serviço: dado um termo/código e o contexto técnico do equipamento, mostrar
o que existe — no estoque interno, no histórico de compra, e
opcionalmente em fontes externas — classificado por compatibilidade. A
tentação óbvia seria misturar "resultado encontrado" com "peça do
catálogo" e ordenar tudo pelo preço mais barato. O prompt proíbe
explicitamente as duas coisas, e registra o princípio que percorre o
desenho inteiro: **"Compatibilidade vem antes do preço."**

## Decisão

### Candidate ≠ Offer ≠ Inventory Item

Um `Candidate` é a identidade técnica observada numa busca (o que é a
peça, e o quanto parece compatível). Um `Offer` é uma condição comercial
de UMA fonte, num instante (`observedAt`) — preço, disponibilidade,
prazo, URL. O mesmo candidate pode ter vários offers (estoque interno,
histórico de compra, fontes externas). Nenhum dos dois é a linha de
`parts` do Estoque (Prompt 10) — essa continua a única fonte de verdade
do catálogo; quando um candidate corresponde a uma peça real, guarda-se
`part_id` como referência de leitura, nunca uma cópia, e nunca um
`INSERT`/`UPDATE` nela.

### Cinco tabelas, cinco conceitos, nunca fundidos

`part_search_sessions` (a busca), `part_search_candidates` (identidade
técnica), `part_search_evidence` (por que o rótulo), `part_search_offers`
(condição comercial temporal), `part_search_provider_calls`
(observabilidade operacional), `part_search_selections` (escolha
humana). Fundir Candidate+Offer numa linha só faria uma peça com três
ofertas virar três "resultados" diferentes, quebrando a deduplicação
conservadora e a leitura "a mesma peça, três condições".

### Compatibility Assessor: puro, determinístico, com veto e teto de IA

Cinco rótulos oficiais — Confirmada, Alta Probabilidade, Provável, Não
Verificada, Incompatível — calculados por uma função pura a partir de
evidências com proveniência. `explicit_incompatibility` veta qualquer
outra evidência (nada "compensa" uma incompatibilidade declarada). Só
duas categorias confirmam: `manufacturer_part_mapping` e
`internal_verified_mapping` — deliberadamente SEM `provider_exact_fit_signal`
(alegação de marketplace nunca é autoridade sozinha) e SEM `ai_inference`
(IA sozinha jamais confirma; seu teto é "Provável"). Ver
`docs/modules/part-search/compatibility.md`.

### Ranking lexicográfico, nunca um score opaco

`compareCandidates` ordena por: classe de compatibilidade, exatidão,
confiabilidade de identificação, disponibilidade, prazo, custo total,
preço, desempate final por id. Cada critério só desempata o anterior —
preço nunca é sequer avaliado se a compatibilidade já decidiu. Prova
literal: uma peça R$50 "Não Verificada" sempre perde para uma peça R$120
"Confirmada". Ver `docs/modules/part-search/ranking.md`.

### Sem provedor externo real definido — mesmo padrão do ADR-085

Nenhuma decisão de fornecedor de catálogo/marketplace foi tomada em
nenhum prompt até aqui. A solução é idêntica à do AI Gateway e de
Comunicação: `CapturePartSearchProvider` fora de produção,
determinístico; `null` em produção, com
`PART_SEARCH_PROVIDER_NOT_CONFIGURED` honesto — e a busca **interna**
continua funcionando sozinha, provando que o módulo não depende de um
provedor real para existir (item 12). `PartSearchProvider != AiGateway`:
a porta representa um catálogo estruturado, nunca um modelo de linguagem.

### Resultado externo é dado não confiável, sempre validado

Todo item do provedor passa por `domain/provider-result-schema.ts` (Zod)
antes de virar Candidate/Offer: preço negativo ou moeda diferente de BRL
é rejeitado, disponibilidade e prazo só aceitam os valores estruturados
que a fonte de fato informou (nunca inferidos de texto vago), URL só
`http`/`https` (nunca `javascript:`/`data:`) e o backend nunca a busca —
só o navegador do usuário, depois de validada. Um item inválido é
descartado individualmente, sem derrubar o restante da resposta.

### Nenhuma escrita em outro domínio, e nenhuma compra sozinha

Part Search lê Estoque e Compras exclusivamente pelas portas de
aplicação oficiais (`loadBalance`, `listPriceHistoryForPart`,
`listOpenNeedsForUnit`). A única exceção documentada de leitura direta é
um `SELECT` em `parts` (catálogo tenant-wide, sem porta pronta que
sirva) — nunca um `INSERT`/`UPDATE`/`DELETE`. Selecionar um candidate
nunca compra, reserva ou move estoque; criar necessidade de compra é uma
segunda ação humana explícita, e só existe para candidates com `part_id`
(nunca um resultado externo puro), usando `createPurchaseNeed` — a porta
oficial de Compras — nunca um `INSERT` direto em `purchase_needs`.

### Idempotência de necessidade de compra sem tocar o schema de Compras

`purchase_needs` não tem `idempotency_key` (ao contrário de
`purchase_orders`/`purchase_receipts`), e alterar o schema de Compras
está fora da propriedade deste prompt. A estratégia adotada é consultar
necessidades abertas da mesma peça/OS antes de criar, reaproveitando a
existente — com uma janela de corrida documentada e aceita (ação exige
clique humano, nunca automação em lote). Ver
`docs/modules/part-search/purchasing-integration.md`.

## Alternativas consideradas

- **Fundir Candidate e Offer numa tabela só.** Rejeitada: perderia a
  distinção "mesma peça, várias condições comerciais" e forçaria
  deduplicação incorreta.
- **Deixar o preço decidir a ordem, com compatibilidade como filtro.**
  Rejeitada explicitamente pelo item 46: o teste oficial do prompt exige
  que uma peça mais cara e mais compatível vença sempre.
- **Deixar a IA confirmar compatibilidade sozinha quando "parecer certo
  o suficiente".** Rejeitada pelos itens 39/175: um modelo de linguagem
  não tem acesso a nenhuma fonte autoritativa própria — confirmar
  compatibilidade a partir de texto seria inventar certeza que não
  existe.
- **Criar Purchase Order automaticamente a partir de um resultado
  selecionado "para agilizar".** Rejeitada pelos itens 95/96/198: o
  Nexo56 nunca compra peça sozinho — é o princípio mais repetido do
  prompt inteiro.
- **Escolher um vendor de marketplace agora "para já ter algo
  funcionando".** Rejeitada pelo item 19, mesmo raciocínio do ADR-085:
  nenhuma decisão comercial foi tomada, e escolher em silêncio
  comprometeria o produto com um contrato que ninguém decidiu.

## Consequências

- Prompt 22 (Base de Conhecimento/Diagnóstico) e Prompt 23
  (APIs/Integrações) podem reusar o `AiGateway` e, se fizer sentido, o
  padrão de `PartSearchProvider` como referência — sem precisar
  reconstruir nenhuma das duas portas.
- Um provedor de marketplace real, quando decidido, entra só em
  `part-search/infrastructure/provider-registry.ts` — nenhuma mudança em
  domínio, aplicação ou UI.
- O relatório deste prompt não pode declarar "busca externa disponível
  em produção": sem provedor real configurado, a V1 prova a arquitetura
  inteira com o provedor de captura e falha de forma honesta
  (`PART_SEARCH_PROVIDER_NOT_CONFIGURED`) em produção — a busca interna
  (Estoque + histórico de compra) é a capacidade real e comprovada desta
  V1.

## Nota de correção (pós-CI #33)

Esta ADR sempre descreveu a Busca de Peças como determinística e capaz de
funcionar sem provedor real (seção "Sem provedor externo real definido",
acima) — mas a implementação mergeada no CI #33 (commit `74b6c87`)
declarou a feature no catálogo como `ai.part_search`, `dependsOn:
['ai.core']`, contradizendo essa própria decisão: desligar o Nexo56 AI
inteiro desligava, por efeito colateral, a busca determinística junto —
inclusive a parte que nunca chama IA nenhuma.

Corrigido no mesmo dia: a feature foi renomeada para
`operations.part_search`, `dependsOn: []`, e a permissão `parts.search`
passou a apontar para ela. Nenhuma outra decisão desta ADR mudou —
Candidate/Offer/Inventory Item, o Compatibility Assessor, o Ranking, o
`PartSearchProvider` e a integração com Compras permanecem exatamente
como descritos acima. Detalhes completos, incluindo a investigação e a
matriz de testes que prova a independência, em
`docs/modules/part-search/ai-independence.md`.

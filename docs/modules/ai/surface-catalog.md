# Catálogo de superfícies

`src/modules/ai/domain/surface-catalog.ts` — `AI_SURFACE_CATALOG`, fechado. O
frontend nunca diz "rode IA em qualquer campo": toda chamada informa uma
`surfaceKey`, e o backend só aceita uma que exista aqui. Qualquer outra é
`AI_SURFACE_NOT_ALLOWED` — nunca uma tentativa de descobrir o campo pelo
nome que o cliente mandou.

## Tabela

| Surface Key                    | Entidade        | Campo           | Tasks permitidas                                                                              | Domain permission       | Unit semantics | Max length |
| ------------------------------ | --------------- | --------------- | --------------------------------------------------------------------------------------------- | ----------------------- | -------------- | ---------- |
| `service_order.internal_notes` | `service_order` | `internalNotes` | `CORRIGIR_PORTUGUES`, `DEIXAR_MAIS_PROFISSIONAL`, `RESUMIR`, `GERAR_PARECER_TECNICO`          | `service_orders.update` | `unit_scoped`  | 2000       |
| `quote.customer_notes`         | `quote`         | `customerNotes` | `CORRIGIR_PORTUGUES`, `DEIXAR_MAIS_PROFISSIONAL`, `RESUMIR`, `DEIXAR_MAIS_CLARO_PARA_CLIENTE` | `quotes.update_draft`   | `unit_scoped`  | 2000       |

Ambos os campos são reais e anteriores ao Prompt 20:
`service_orders.internal_notes` (Prompt 07) e `quotes.customer_notes`
(Prompt 09). Nenhum campo foi inventado para este módulo.

## Por que cada corte

**`GERAR_PARECER_TECNICO` só existe em `service_order.internal_notes`.**
Gerar parecer técnico faz sentido no contexto técnico real de uma OS e
equipamento — nunca numa nota destinada ao cliente. A UI nunca oferece essa
ação como botão global; ela só aparece dentro do contexto real de uma OS.

**`DEIXAR_MAIS_CLARO_PARA_CLIENTE` só existe em `quote.customer_notes`.**
"Deixar mais claro para o cliente" não faz sentido num campo que o cliente
nunca vê — a observação interna da OS é, por definição, interna.

**Cada campo mostra só as tasks compatíveis** (item 65): o menu de ações
nunca lista as cinco em todo lugar; ele é montado a partir de
`surface.allowedTasks`, então uma observação financeira, por exemplo, nunca
oferece "Gerar parecer técnico" — porque essa superfície simplesmente não
está no catálogo com essa task.

## Autorização composta, sempre as duas pontas

Usar Nexo56 AI numa superfície exige, nesta ordem:

1. `ai.use` (permissão) + feature `ai.writing` habilitada — a IA em si.
2. `surface.domainPermission` (`service_orders.update` ou
   `quotes.update_draft`) na **mesma unidade** da entidade — a permissão de
   dominio de quem edita aquele campo hoje, sem IA nenhuma.

`ai.use` nunca substitui a permissão de domínio: um usuário só-leitura não
ganha capacidade de editar por ter `ai.use`. Se o campo não pode ser
editado, "Usar texto" nem aparece.

## `unitSemantics`

As duas superfícies de hoje são `unit_scoped`: toda entidade pertence a uma
unidade só, e a autorização é sempre avaliada **na unidade da entidade**,
nunca na unidade ativa da sessão — mesmo padrão já usado por Orçamentos,
Financeiro e Garantias.

## `contentType`

As duas são `plain_text`. A saída do provedor nunca é renderizada como HTML
sem sanitização; V1 recusa qualquer saída que pareça HTML (`output-validator.ts`).

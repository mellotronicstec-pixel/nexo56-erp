# Integração com Compras

## O que É permitido

Depois de uma **seleção humana explícita** (`selectCandidate`), e só
quando o candidate corresponde a uma peça real do catálogo (`partId`
preenchido — ou seja, veio da busca interna), o usuário pode pedir
"Criar necessidade de compra". Isso chama `createPurchaseNeed`, a porta
de aplicação **oficial** de Compras (`purchasing/application/
purchase-need-service.ts`) — nunca um `INSERT` direto em `purchase_needs`.

## O que NUNCA acontece

- Nenhum Pedido de Compra é criado (`createPurchaseOrder` nunca é
  chamado — coberto por teste de arquitetura).
- Nenhuma compra é enviada a fornecedor.
- Um candidate **externo** (sem `partId`) nunca pode virar necessidade de
  compra — a tentativa falha com `BusinessRuleError` explícita, pedindo
  para cadastrar a peça no Estoque primeiro (ato humano, no módulo dono).
- Selecionar um candidate, sozinho, nunca cria necessidade nenhuma —
  são dois cliques humanos distintos, nunca automático (item 97).

## Idempotência (item 98) — estratégia adotada e sua limitação honesta

`purchase_needs` **não tem** coluna `idempotency_key` no schema real de
Compras (verificado; ao contrário de `purchase_orders`/`purchase_receipts`
que têm). Alterar o schema de Compras está fora da propriedade deste
prompt (item 71 — dependência só num sentido).

A estratégia: antes de criar, `createPurchaseNeedFromSelection` consulta
`listOpenNeedsForUnit` (porta oficial de leitura de Compras) e reaproveita
uma necessidade **aberta**, da **mesma peça** e da **mesma OS** (quando
há), em vez de duplicar. Testado (duas seleções/buscas distintas para a
mesma peça/OS resultam numa única `purchase_needs.id`).

**Limitação documentada**: existe uma janela de corrida entre a consulta
e a criação (duas requisições verdadeiramente simultâneas poderiam, em
teoria, criar duas necessidades). Aceitável para V1 porque a ação exige
um clique humano por vez, não é disparada em lote nem por automação —
diferente do risco que uma ação automática exigiria mitigar. Um índice
único futuro em `purchase_needs` (fora de escopo deste prompt) fecharia
essa janela definitivamente, se o time de Compras decidir adicioná-lo.

## Rastreabilidade

`part_search_selections.purchase_need_id` guarda o vínculo (sem FK —
mesmo padrão do Motor de Automações para referência a outro módulo,
item 71): permite auditar "esta necessidade veio de uma busca", sem
tornar o schema de Compras dependente de Part Search.

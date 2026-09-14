# O que os próximos módulos vão encontrar pronto

Este documento existe para separar **preparado** de **implementado**. Nada aqui
descreve funcionalidade que já funciona.

## Prompt 11 — Fornecedores e Compras

**Implementado:** nada de Compras. Não há `suppliers`, não há
`purchase_orders`, não há recebimento integrado, não há preço de fornecedor.

**Preparado:**

| O que Compras vai precisar | Onde já está                                           |
| -------------------------- | ------------------------------------------------------ |
| qual peça                  | `parts` (catálogo do tenant)                           |
| quantidade necessária      | `stock_reservations.quantity` / `remaining`            |
| unidade demandante         | `stock_balances.unit_id`, `stock_reservations.unit_id` |
| saldo e reserva            | `stock_balances.on_hand` / `reserved`                  |
| necessidade vinculada a OS | `stock_reservations.service_order_id`                  |
| sinal de reposição         | evento `LOW_STOCK_DETECTED` (sem consumidor)           |
| custo histórico            | `stock_movements.unit_cost` / `total_cost`             |
| numeração                  | `SEQUENCE_TYPES.PURCHASE_ORDER` já existe              |

**O que Compras vai precisar acrescentar:** a origem `purchase_order` em
`stock_movements.origin_kind` e a coluna de referência ao pedido. Hoje a origem
de uma entrada é `manual`, e isso é honesto — fingir um pedido que nunca existiu
deixaria linhas órfãs no dia em que Compras chegasse.

## Prompt 21 — Nexo56 AI / Busca de peças

**Implementado:** nada de IA. Não há provider, não há embedding, não há
sinônimo, não há correção ortográfica. A busca é `LIKE` sobre colunas
normalizadas e indexadas.

**Preparado:** o catálogo é entidade própria e extensível. Acrescentar, de forma
aditiva, tabelas de _aliases_, referências equivalentes, compatibilidades,
códigos externos, `confidence` e fonte não exige mudar `parts`.

**Explicitamente não feito (item 113):** não há declaração de compatibilidade
entre peça e equipamento. Não existe tabela de compatibilidade, e nada no
sistema afirma que uma peça serve num aparelho por descrição parecida.

## Leitura de código de barras

**Implementado:** a coluna, a normalização e a busca por ela.
**Pendente:** leitor de câmera. A arquitetura aceita qualquer formato, sem
presumir EAN; o scanner é de outro prompt, e a tela do cadastro diz isso.

## Lote, validade e número de série da peça

**Não implementados**, e por escolha (itens 72 e 73): nem toda peça tem lote,
validade ou série individual, e impor isso faria o cadastro de um parafuso pedir
número de série.

A arquitetura **não impede** a extensão: `stock_movements` é append-only e
aceitaria uma coluna de lote de forma aditiva, com o saldo passando a ser por
(peça, unidade, lote).

## Comunicação e automações

**Não implementados.** Não há canal de mensagem (Prompt 16) nem Rule Engine
(Prompt 19). Os eventos do módulo existem **sem consumidor** — que é exatamente
o que o item 62 pede.

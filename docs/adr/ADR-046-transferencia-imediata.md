# ADR-046 — Transferência entre unidades é imediata na V1

**Status:** Aceito
**Data:** Prompt 10 — Estoque e Peças
**Itens atendidos:** 50, 51, 52, 53, 54, 121

## Contexto

O item 53 pede uma avaliação explícita: a V1 precisa de estado `in_transit`?

Um estado de trânsito só é honesto se alguém confirmar a chegada. O Nexo56 não
acompanha o transporte — não há conferência no destino, não há romaneio, não há
integração com transportadora. Um `in_transit` que ninguém fecha produz saldo
parado em trânsito para sempre: pior que não ter a etapa.

## Decisão

**A transferência é imediata: retira da origem e adiciona ao destino na mesma
transação.** A limitação está documentada aqui e em
`docs/modules/inventory/transfers.md`.

- `stock_transfers` tem **identidade própria** e número humano (`TRF 000012`),
  alocado pela sequência do tenant.
- As **duas movimentações** (`transfer_out` e `transfer_in`) apontam para o
  mesmo `transfer_id`. Sem essa linha, seriam uma saída e uma entrada que
  ninguém correlaciona depois — e que um retry duplicaria pela metade.
- A coluna `status` existe e hoje vale sempre `completed`. Acrescentar
  `in_transit` no dia em que houver conferência no destino será **aditivo**.
- O custo médio acompanha a peça: o destino recebe pelo custo médio da origem.

## Cross-tenant é impossível

Não por checagem da aplicação: as FKs compostas
`(from_unit_id, tenant_id)` e `(to_unit_id, tenant_id) → units(id, tenant_id)`
amarram as duas pontas ao mesmo tenant. O teste de integração tenta o
`INSERT` direto no banco e prova a recusa.

## Idempotência

`uq_stock_transfer_idempotency (tenant_id, idempotency_key)` garante que um
retry não transfere duas vezes. O caso de uso reencontra a transferência
existente e devolve o mesmo número, marcado como reaproveitado.

## Consequências

- O operador vê, na própria tela, a frase "o sistema não acompanha o
  transporte". Nada é prometido além do que existe.
- Se a peça se perder no caminho, o ajuste (com motivo) é o instrumento — e ele
  deixa rastro.
- Ordem fixa das operações (saída da origem primeiro) evita o abraço mortal
  entre transferências A→B e B→A simultâneas.

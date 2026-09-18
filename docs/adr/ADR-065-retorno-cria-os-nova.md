# ADR-065 — Retorno em garantia cria uma OS NOVA; a original nunca reabre

**Status:** Aceito
**Data:** Prompt 13 — Garantias
**Itens atendidos:** 25, 26, 28, 29, 92, 99

## Contexto

O aparelho volta. A primeira ideia de quase todo sistema de assistência é
reabrir a Ordem de Serviço original: "é o mesmo conserto, é a mesma OS".

Não é. A OS original tem um histórico fechado: um orçamento aprovado, um laudo,
um valor cobrado, uma data de entrega, uma assinatura de retirada. Reabri-la
significa **alterar um documento que já foi entregue ao cliente** — e, dali em
diante, ninguém consegue responder "quanto tempo levou o primeiro conserto?" nem
"o cliente pagou por este segundo atendimento?".

Reaproveitar o **número** é pior ainda: dois atendimentos diferentes com o mesmo
identificador destroem a rastreabilidade exatamente onde ela é mais necessária.

## Decisão

**O retorno registra um fato (`warranty_returns`) e, quando cabível, cria uma
Ordem de Serviço NOVA, com número novo, vinculada à garantia e à OS original.**

```
warranty_returns
  warranty_id             → qual garantia foi acionada
  original_service_order_id → de onde veio
  return_service_order_id   → a OS nova (única: uq_warranty_return_new_order)
  reference_date            → a data civil do dia, congelada
  was_enforceable           → a garantia valia NAQUELE dia
  coverage_assessment       → covered | not_covered | undetermined
```

A OS original não é tocada: nem status, nem número, nem histórico.

## `was_enforceable` é congelado, não recalculado

O retorno guarda o que era verdade **no dia**. Uma garantia que vence na semana
seguinte não transforma retroativamente um retorno aceito em recusado, e uma
revogação posterior não apaga o atendimento que já aconteceu.

## Atomicidade real, não aparente

A criação do retorno e a criação da OS acontecem **na mesma transação**, pela
primitiva `planServiceOrderCreation` / `applyServiceOrderCreation` (ADR-049
aplicado às OS). Não há uma janela entre "retorno registrado" e "OS criada" em
que um retorno exista sem sua ordem.

O módulo de Garantias **não duplica** a lógica de criação de OS e **não abre**
transação aninhada: ele chama a primitiva oficial dentro da própria transação.

## Retorno recusado também é registrado

Quando a garantia não vale, ou o defeito não está coberto, o retorno **é
gravado assim mesmo**, sem OS de garantia, com o motivo da recusa. O
atendimento pode seguir pelo caminho comercial normal.

Esconder a recusa deixaria a lista bonita e a loja cega: quando o cliente voltar
pela terceira vez discutindo a mesma coisa, é o registro das duas recusas
anteriores que permite responder com fato em vez de memória.

## Consequências

**Ganhamos:** duas ordens auditáveis, dois históricos íntegros, e a pergunta
"quantos retornos este conserto gerou?" com resposta exata.

**Pagamos:** mais linhas em `service_orders`. É o que significa ter atendido
duas vezes.

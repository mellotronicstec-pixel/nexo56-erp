# ADR-009 — Eventos internos

**Status:** Aceito · **Data:** Prompt 01

## Decisão

- Barramento **em processo**, com registro de handlers por tipo de evento.
- Eventos são **persistidos** em `domain_events` dentro da **mesma transação**
  da operação de negócio (`recordEvent(input, tx)`).
- O **despacho aos handlers ocorre após o commit** (`runInTransaction` coleta e
  só então chama `dispatch`).
- `domain_events.published_at` dá à tabela o formato de **outbox**: nulo
  enquanto não entregue.
- Falha de handler **não** derruba a operação já confirmada: é registrada e o
  evento permanece não publicado, disponível para reprocessamento.

## Motivo

O Prompt 01 (item 32) exige não afirmar que um evento ocorreu antes de a
operação ser confirmada. Persistir na transação e despachar depois resolve os
dois lados: transação revertida não deixa evento nem chama handler; operação
confirmada tem o evento gravado mesmo que o handler falhe.

Não implementamos o worker de outbox agora (seria prematuro), mas a tabela e o
ponto de despacho já permitem adicioná-lo sem tocar no domínio.

## Alternativas consideradas

| Alternativa                   | Por que não                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Kafka / RabbitMQ              | Infraestrutura distribuída proibida nesta fase e impossível na hospedagem inicial. |
| Emitir evento antes do commit | Handler agiria sobre fato não confirmado — exatamente o que o item 32 veta.        |
| Outbox completo com worker    | Prematuro agora; a arquitetura não o impede depois.                                |

## Consequências

- Handlers rodam no mesmo processo da requisição: devem ser rápidos. Trabalho
  pesado deve ser enfileirado como job (ADR-010).
- Um worker futuro pode varrer `published_at IS NULL` sem mudança no domínio.

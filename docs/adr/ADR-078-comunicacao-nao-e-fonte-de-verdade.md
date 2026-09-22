# ADR-078 — A Comunicação informa o fato; ela não é o fato

**Status:** Aceito
**Data:** Prompt 16 — Comunicação
**Itens atendidos:** 1 a 14, 56 a 65, 250

## Contexto

A Ordem de Serviço tem um botão "Informar Ordem Disponível" desde o Prompt 08
— e ele já move a OS para `awaiting_customer_pickup`, já grava na linha do
tempo e já emite `SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED`. O texto da
linha do tempo é honesto de propósito: _"Cliente marcado como avisado. O envio
automático ainda não está disponível."_

O Prompt 16 constrói esse envio. A tentação óbvia — e a que esta ADR recusa —
é fazer o envio **decidir** algo: mover a OS, confirmar o aviso, virar a
autoridade sobre "o cliente sabe do aparelho".

## Decisão 1: cinco vocabulários, cinco motivos de mudar

> Evento de domínio ≠ Mensagem ≠ Template ≠ Canal ≠ Destinatário
> ≠ Tentativa de entrega ≠ Status da OS

Cada um vive na sua tabela ou no seu conjunto de valores, e nenhum é derivado
de outro por atalho:

| Conceito           | Onde mora                     | Muda por causa de                  |
| ------------------ | ----------------------------- | ---------------------------------- |
| Fato operacional   | `service_orders.status`       | Uma pessoa transiciona a OS        |
| Intenção de avisar | `SERVICE_ORDER_..._REQUESTED` | Alguém clica "informar disponível" |
| Modelo de texto    | `communication_templates`     | A empresa reescreve o padrão       |
| Mensagem           | `communication_messages`      | Alguém confirma o envio            |
| Tentativa          | `communication_attempts`      | O provedor responde                |

Misturar duas dessas coisas faz uma mudar quando a outra muda por engano — o
caso mais perigoso sendo "o WhatsApp falhou, então desfaça a OS".

## Decisão 2: a dependência é de mão única, e o Core nunca sabe

`service-order-actions.ts` não importa nada de `modules/communications`. A
costura é feita pelo lado de cá: `registerCommunicationSubscriptions()`
assina `SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED` e, hoje, só registra um
log — sem PII, com `delivered: false` escrito à mão.

Um teste de fronteira falha se `modules/service-orders` importar
`modules/communications`, e outro falha se `modules/communications` importar
`modules/agenda` (a outra feature OPCIONAL do sistema).

Consequência prática: **desligar `communications.core` não muda uma linha do
comportamento da OS**. `notifyCustomerReady` continua transicionando,
continua gravando a linha do tempo, continua emitindo o evento. Só o efeito da
Comunicação some.

## Decisão 3: por que o handler não envia sozinho

Um handler que, ao receber o evento, decide o canal, escolhe um modelo e manda
a mensagem seria a automação do Prompt 19 nascendo escondida dentro do Prompt
16 — configurável por ninguém, desligável por ninguém, e resolvendo por conta
própria três perguntas que só uma pessoa (ou, mais tarde, um motor de regras
explícito) pode responder: **por qual canal**, **com qual texto**, **se deve
enviar**.

O que existe hoje é o ponto de extensão pronto, e uma pessoa que confirma o
envio pela tela de Comunicação — um clique, uma confirmação, nenhuma mágica.

## Decisão 4: `sent` significa aceito pelo provedor — nunca entregue

Os cinco estados de `communication_messages.status` são `queued`, `sending`,
`sent`, `failed`, `cancelled`. Não existem `delivered` nem `read`: nenhum
provedor real está integrado hoje, e inventar esses estados sem a
infraestrutura de webhook que os prova seria mentir na tela.

`sent` tem rótulo deliberadamente mais longo — "Enviada ao provedor" — para
que ninguém confunda com "entregue ao cliente". Quando existir provedor com
confirmação de entrega, `delivered` entra como estado **novo**, com a prova
que o justifica.

## Decisão 5: falha de canal nunca desfaz o fato operacional

`communication_messages` e `communication_attempts` nunca escrevem em
`service_orders`. Um teste de fronteira recusa qualquer `UPDATE`/`INSERT`
Drizzle ou SQL cru contra `service_orders`, `service_order_timeline` ou
`service_order_tasks` dentro do módulo de Comunicação — nos dois sentidos:
nem o sucesso do envio nem a falha tocam a OS.

O aparelho continua pronto mesmo se o WhatsApp recusar a mensagem dez vezes.

## Consequência

Apagar as quatro tabelas de Comunicação não perde nenhum fato operacional —
perde só o registro de quem foi avisado, por onde, e o que aconteceu em cada
tentativa. É exatamente esse limite que autoriza dizer, sem exagero, que a
comunicação **informa** o fato e nunca **é** o fato.

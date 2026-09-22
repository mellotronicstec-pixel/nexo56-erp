# Comunicação — visão geral

**Prompt 16.** Módulo **OPCIONAL** (`communications.core`), dependente
apenas de `core.customers`.

## A pergunta que o módulo responde

> O que a gente falou com o cliente, por onde, e o que aconteceu?

Até o Prompt 16, "informar ordem disponível" gravava a intenção na linha do
tempo da OS e parava por aí — sem envio, sem histórico, sem canal. Este
módulo constrói a camada que efetivamente fala com o cliente, sem virar a
autoridade sobre o que a OS diz que aconteceu.

## O que ele é — e o que ele não é

| É                                   | Não é                                 |
| ----------------------------------- | ------------------------------------- |
| Registro do que foi dito e tentado  | Fonte de verdade de fato operacional  |
| Modelo de texto reutilizável        | Programa (sem `eval`, sem expressão)  |
| Canal e destinatário explícitos     | Disparo de lista, campanha, broadcast |
| Registro de tentativa (append-only) | Confirmação de entrega ou leitura     |
| Consumidor do evento da OS          | Automação ("se X, envie Y")           |

Ver [ADR-078](../../adr/ADR-078-comunicacao-nao-e-fonte-de-verdade.md) para a
separação formal entre evento, mensagem, template, canal, destinatário,
tentativa e status da OS.

## Os cinco estados de uma mensagem

`queued` → `sending` → `sent` **ou** `failed` (`failed` pode voltar a
`queued` por reenvio); `queued`/`failed` podem ir a `cancelled`.

**Não existem `delivered` nem `read`.** `sent` significa "um provedor aceitou
a mensagem" — não "o cliente recebeu" ou "o cliente leu". Nenhum provedor
real está integrado hoje, e nenhuma confirmação de entrega existe para provar
um estado mais forte.

## Os três canais

`whatsapp`, `email`, `sms` — o canal é estável mesmo quando o fornecedor
muda. Quem entrega é um provedor, guardado como texto em
`communication_attempts.provider`, nunca como coluna estrutural.

## O provedor hoje: captura

Não há contrato com nenhum fornecedor de WhatsApp, e-mail ou SMS. Fora de
produção, o sistema usa um **provedor de captura**: registra o que teria sido
enviado, em memória, e não toca a rede. Em produção, não há provedor nenhum —
a mensagem fica registrada como `failed` com `provider_not_configured`, e não
existe variável de ambiente que ligue a captura em produção
(`src/modules/communications/infrastructure/provider-registry.ts`).

## O que este módulo NUNCA faz

- Escrever em `service_orders`, `service_order_timeline` ou
  `service_order_tasks`.
- Mover a Ordem de Serviço por sucesso ou por falha de envio.
- Enviar mensagem automaticamente ao receber um evento (isso é o Prompt 19).
- Reescrever ou "melhorar" o texto do usuário (isso é o Prompt 20).
- Guardar `storage_key` de arquivo — anexos passam pelo serviço autorizado do
  módulo dono (hoje, apenas o certificado de garantia).

## Onde cada coisa mora

| Conceito                             | Arquivo                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| Canais, status, erros, limites       | `domain/communication.ts`                                     |
| Destinatário (retrato)               | `domain/recipient.ts`                                         |
| Template e catálogo de lacunas       | `domain/template.ts`                                          |
| Schema e migration                   | `infrastructure/schema.ts`, `drizzle/0014_communications.sql` |
| Porta do provedor                    | `application/communication-provider.ts`                       |
| Provedor de captura + guarda         | `infrastructure/capture-provider.ts`, `provider-registry.ts`  |
| Criar, processar, reenviar, cancelar | `application/message-service.ts`                              |
| Modelos (CRUD)                       | `application/template-service.ts`                             |
| Leitura para as telas                | `application/message-queries.ts`                              |
| Job de recuperação                   | `application/stuck-message-job.ts`                            |
| Costura com a OS                     | `application/subscriptions.ts`                                |
| Telas                                | `src/app/(app)/comunicacao/**`                                |

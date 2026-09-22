# Comunicação — permissões, PII e segredos

## Três permissões, não seis

| Chave                             | O que abre                                |
| --------------------------------- | ----------------------------------------- |
| `communications.view`             | ver a lista, a ficha e os modelos         |
| `communications.send`             | criar, reenviar e cancelar mensagens      |
| `communications.templates.manage` | criar, editar e arquivar modelos de texto |

**Reenviar e cancelar não têm chave própria.** Reenviar é mandar de novo;
cancelar uma mensagem que ainda não saiu é desfazer o próprio envio — as duas
são a mesma autoridade de `communications.send`, e separá-las criaria o cargo
absurdo de "pode enviar mas não pode consertar o que enviou".

**Editar o modelo é outra autoridade**, porque muda o texto de todas as
mensagens futuras de todas as unidades — configuração da empresa, não
atendimento de balcão.

## Recorte por unidade

Toda leitura e escrita passa por `tenant_id` **e** `unit_id`. A unidade de
uma mensagem ligada a uma OS é a da OS, não a unidade ativa de quem está
escrevendo — avisar sobre uma ordem da loja Centro é ato da loja Centro.

## PII: onde ela pode estar, e onde nunca pode

| PII (telefone, e-mail, texto)           | Pode estar                         | Nunca pode estar                                        |
| --------------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| `communication_messages`                | sim (é o dado)                     | —                                                       |
| Ficha da mensagem (`/comunicacao/[id]`) | sim, inteira                       | —                                                       |
| Lista de mensagens                      | **mascarada**                      | inteira                                                 |
| `domain_events` (payload)               | não                                | telefone, e-mail, corpo, assunto                        |
| `audit_logs` (after/before)             | não                                | telefone, e-mail, corpo                                 |
| Logs de aplicação                       | não                                | `recipientValue`, `recipientDisplay`, `body`, `subject` |
| `communication_attempts.error_detail`   | pode conter contexto do fornecedor | credencial, token, cabeçalho de autenticação            |

O último caso passa por `sanitizeProviderDetail`, que redige padrões de
`Bearer`/`Basic`/`api_key=`/`token:` etc. antes de qualquer gravação — mesmo
quando o "erro" é uma exceção crua do adaptador.

Um teste de fronteira varre `message-service.ts` e falha se qualquer `payload`
de evento ou chamada de `logger` contiver `recipientValue`, `recipientDisplay`,
`body` ou `subject`.

## O destinatário não é digitado

`createMessage` recebe `customerId` + `contactValue`, e `resolveRecipient`
confirma que aquele valor é um contato **cadastrado daquele cliente** —
inclusive a exigência de `is_whatsapp = 1` para o canal WhatsApp. Não existe
caminho por onde um número solto vire mensagem enviada.

## O anexo é referência, não bypass

O módulo **não tem** `storage_key`. Anexar o certificado de garantia lê os
bytes por `readCertificatePdf`, que confere tenant, unidade e permissão de
Garantias — anexar não é um atalho para contornar quem pode ver o quê.

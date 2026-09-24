# Catálogo de ações

Fonte de verdade: `src/modules/automations/domain/action-catalog.ts`,
`AUTOMATION_ACTION_CATALOG`. Duas ações na V1 — e as duas orquestram um
**serviço oficial** de outro módulo; nenhuma escreve tabela alheia, nenhuma
chama provider concreto diretamente (itens 143, 219/220).

| Chave                         | Módulo alvo      | Feature exigida       | Permissão de configuração | Efeito externo            |
| ----------------------------- | ---------------- | --------------------- | ------------------------- | ------------------------- |
| `communication.send_template` | `communications` | `communications.core` | `communications.send`     | sim (mensagem ao cliente) |
| `agenda.create_task`          | `agenda`         | `operations.agenda`   | `agenda.tasks.create`     | não (interno)             |

## `communication.send_template`

Config: `{ templateId, channel }`. Chama
`createMessageFromAutomation` (`src/modules/communications/application/
message-service.ts`) — a mesma função que o resto do sistema usaria, não um
atalho. O **destinatário nunca é texto digitado na regra**: sai do contato
principal do cliente no canal do modelo
(`resolveAutomaticRecipient`, `is_primary=1`, `+is_whatsapp=1` quando o canal
é WhatsApp). Se não houver contato principal no canal, a ação falha com
`INVALID_RECIPIENT` — o Motor nunca adivinha um destinatário.

**Sucesso da ação exige entrega aceita, não apenas fila.** `createMessageFromAutomation`
propaga o resultado real de `processMessage` (o mesmo passo que decide se a
mensagem vira `sent` ou `failed` no caminho manual) — nunca considera a ação
bem-sucedida só por ter enfileirado a mensagem. Se o provedor recusa, não
responde, ou não existe (`provider_not_configured`/`provider_unavailable`
— ver `error-codes.ts`), a ação (e a execução) ficam `failed`. Uma mensagem
já existente (mesma `idempotencyKey`) reaproveitada continua com o status
real que ela já tinha: reuso de uma mensagem `failed` nunca vira sucesso da
ação só por causa do reuso.

## `agenda.create_task`

Config: `{ title, notes?, dueOffsetDays? }` (0 a 90 dias corridos, sem hora —
`due_date` é civil). Chama `createTaskFromAutomation`
(`src/modules/agenda/application/task-service.ts`). Título e observações são
**texto estático da própria regra**, nunca interpolação livre de payload —
elimina de saída qualquer superfície de injeção via condição/gatilho.

## Por que sempre via serviço oficial, nunca escrita direta

Se o Motor inserisse direto em `communication_messages` ou `agenda_tasks`,
ele duplicaria — e poderia divergir de — toda a lógica que esses módulos já
garantem: feature check, idempotência, resolução de destinatário, claim de
processamento. `createMessageFromAutomation`/`createTaskFromAutomation` são
pontos de entrada nomeados, adicionados a cada módulo especificamente para
isto, que reaproveitam a mesma validação e o mesmo caminho de idempotência
que qualquer outra origem já usava — só trocam a origem/autor por
"automação" (`origin: 'domain_event'`, `requestedBy: null`/`createdBy: null`,
`sourceEventId`). Ver `security.md` para por que eles não passam por
`authorize()`.

## `configPermission`: autoridade de configuração por ação

Além de `automations.manage` no escopo da regra, quem **cria ou edita** uma
versão que usa esta ação precisa também da permissão de configuração daquela
ação especificamente (`communications.send` ou `agenda.tasks.create`), no
mesmo escopo da regra — `assertActionPermissions` em `rule-service.ts`. Isso
impede alguém sem permissão de enviar comunicação de configurar uma regra
que manda o Motor enviar em seu lugar.

## Idempotência por ação

Cada ação recebe uma chave derivada e estável —
`automation:{executionId}:action:{actionIndex}` — que vira o
`idempotencyKey` do INSERT no módulo-alvo. Ver `idempotency.md` para a
cadeia completa.

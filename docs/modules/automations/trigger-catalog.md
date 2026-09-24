# Catálogo de gatilhos

Fonte de verdade: `src/modules/automations/domain/trigger-catalog.ts`,
`AUTOMATION_TRIGGERS`. Uma regra só pode referenciar uma das três chaves
abaixo — `parseRuleDefinition` rejeita qualquer string que não exista aqui
(item 171). Não existe "gatilho livre" nem "digite o nome do evento".

| Chave                                           | Família        | Evento de origem                                | Feature exigida        | Ações compatíveis                                   |
| ----------------------------------------------- | -------------- | ----------------------------------------------- | ---------------------- | --------------------------------------------------- |
| `service_order.customer_notification_requested` | `domain_event` | `SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED` | `service_orders.core`  | `communication.send_template`, `agenda.create_task` |
| `inventory.low_stock_detected`                  | `domain_event` | `LOW_STOCK_DETECTED`                            | `inventory.operations` | `agenda.create_task`                                |
| `schedule.daily`                                | `schedule`     | _(nenhum — é o próprio calendário)_             | `automation.core`      | `agenda.create_task`                                |

## Por que só estes três

Cada linha foi escolhida na inspeção profunda que precedeu a implementação
(item 95 do rastreio de tarefas), entre eventos que já existiam e cujo
comentário no próprio código dizia "aqui é onde uma automação se conecta":

- **`service_order.customer_notification_requested`** é a fronteira que o
  Prompt 16 (Comunicação) deixou pronta: alguém confirma, na tela da OS, que
  o cliente precisa ser avisado. O Prompt 19 fecha o laço — antes disso, essa
  confirmação não tinha nenhum efeito automático.
- **`inventory.low_stock_detected`** já existia desde o Prompt 10/11
  (`src/modules/inventory/application/low-stock-job.ts`), publicado no
  outbox **sem nenhum consumidor** até agora — o próprio comentário do
  arquivo dizia isso. O Motor é o primeiro assinante real deste evento.
- **`schedule.daily`** não nasce de um fato; nasce do relógio. Existe para
  cobrir o caso "todo dia, às 9h, verificar/lembrar algo" sem forçar um
  evento de domínio artificial só para existir um gatilho.

## `fields`: o que uma condição pode enxergar

Cada gatilho declara um mapa fechado de campos (`fields`) com tipo
(`string` | `number` | `boolean`). Uma condição só pode referenciar um campo
que esteja nesse mapa — nunca um path arbitrário do payload do evento (item
23). `schedule.daily` não declara nenhum campo: um horário não carrega fato
nenhum para condicionar na V1 (ver `conditions.md`).

## `compatibleActions`: por que Comunicação não aparece em todo gatilho

`inventory.low_stock_detected` e `schedule.daily` **não** compõem com
`communication.send_template` — de propósito (item 138): nenhum dos dois
fatos carrega um cliente/destinatário no contexto. Uma regra de estoque baixo
não tem "para quem mandar mensagem"; um agendamento diário também não. A
lista `compatibleActions` é o que impede essa combinação **por construção**,
não por validação de runtime torcendo o braço do usuário depois.

## `configSchema`: configuração própria do gatilho

Só `schedule.daily` tem: `{ timeOfDay: "HH:mm" }`
(`scheduleDailyConfigSchema`), validado por regex de 24h sem segundos — o
mesmo grão de precisão do tick do Schedule Coordinator (ver
`scheduling.md`). Os outros dois gatilhos têm `configSchema: null`: o
próprio evento já carrega tudo que a regra precisa saber.

## Funções expostas

- `findTrigger(key)` — resolve uma chave para sua definição, ou `undefined`.
- `triggersForEvent(type)` — todos os gatilhos que reagem a um `EventType`
  (usado por `event-processor.ts` para saber quais regras avaliar quando um
  evento chega).
- `isKnownTriggerKey(key)` — usado pelo validador (`rule-definition.ts`) para
  rejeitar qualquer chave fora do catálogo.

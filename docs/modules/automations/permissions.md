# Feature, permissões e escopo

## Feature `automation.core` (OPTIONAL)

Portão único do módulo inteiro (item 72). Desligada para um tenant:

- **Zero execuções novas**, vindas de evento ou de agendamento — nem sequer
  `skipped`. O evento simplesmente não produz rastro nenhum do Motor,
  exatamente como qualquer feature OPTIONAL desligada em outro lugar do
  sistema.
- Menu "Automações" some (checado no server, não só escondido na UI).
  Backend redireciona para `/acesso-negado`.
- **Os módulos operacionais continuam funcionando identicamente** — publicar
  `SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED`/`LOW_STOCK_DETECTED`
  nunca depende de `automation.core`; o publicador nem sabe que o Motor
  existe (ver `execution-model.md`).

Checado em dois lugares, os dois via `checkFeatureEnabledForTenant` (nunca
via um `TenantContext` sintético — ver `security.md`):

1. `processAutomationEvent`, antes de olhar qualquer regra.
2. `runScheduleTick`, **por tenant, dentro do loop** — um tenant desligado
   não bloqueia os outros no mesmo tick.

## Permissões

| Permissão            | Concede                                                      |
| -------------------- | ------------------------------------------------------------ |
| `automations.view`   | ver a lista de regras, o detalhe e o histórico de execuções  |
| `automations.manage` | criar, editar (nova versão), habilitar/desabilitar, arquivar |

Mais a **permissão de configuração de cada ação** usada na regra
(`communications.send`, `agenda.tasks.create` — ver `action-catalog.md`),
exigida além de `automations.manage`.

## Escopo: `UNIT_SET` vs `TENANT_WIDE`

Uma regra é criada com um escopo **persistido**, nunca recalculado depois:

- `UNIT_SET`: opera só nas unidades gravadas em `automation_rule_units` no
  momento da criação.
- `TENANT_WIDE`: só pode ser escolhido por quem tem `automations.manage` no
  escopo TENANT (autorização tenant-wide de verdade, não "acesso a todas as
  unidades que existem hoje"). "Todas as unidades" para um usuário
  autorizado apenas em algumas unidades significa **as unidades autorizadas
  no momento da criação**, fixadas para sempre — nunca um recálculo
  dinâmico que mudaria o comportamento da regra se as permissões do criador
  mudarem depois (item 59).

`schedule.daily` é `UNIT_SET`-only: um agendamento sem unidade nenhuma não
faz sentido (`assertScheduleNeedsUnitSet`).

## Autoridade de configuração (`assertManageAuthority`)

Criar/editar/habilitar/arquivar uma regra `UNIT_SET` exige
`automations.manage` **em cada unidade do escopo da regra** — checado
unidade por unidade, não uma vez no nível do tenant. Uma regra `TENANT_WIDE`
exige a permissão no escopo TENANT. Isso é checado com o `TenantContext`
real de quem está mexendo na regra pela UI — autorização de **configuração**,
distinta da autoridade de **runtime** do próprio Motor (ver `security.md`).

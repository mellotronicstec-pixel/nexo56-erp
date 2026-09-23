# Permissões e Feature do Painel

## A equação de acesso (item 25)

```
Dashboard Access + Feature Access + Domain Permission + Unit Scope = Metric Access
```

Nenhuma das quatro condições, sozinha, é suficiente. `DashboardQueryService`
verifica as quatro, nesta ordem, antes de chamar qualquer adaptador de
domínio:

1. **Dashboard Access** — `requireAccessForPage(FEATURES.ANALYTICS_DASHBOARD,
PERMISSIONS.ANALYTICS_VIEW)` na própria página `/painel`. Sem isto, a
   pessoa nem chega ao `loadDashboard`.
2. **Feature Access** — por domínio, verificado uma única vez por
   requisição via `checkManyAccess` (um snapshot de Effective Access,
   nunca uma consulta por domínio).
3. **Domain Permission** — por domínio E por unidade, via
   `permissionsInScope(context, unitId)` — síncrono, sem ida ao banco,
   porque já está no `TenantContext` carregado na sessão.
4. **Unit Scope** — `AnalyticsScope.selectedUnitIds`, sempre subconjunto de
   `context.authorizedUnitIds` (membership), nunca calculado a partir de
   valor bruto vindo do browser.

Só quando as quatro estão satisfeitas PARA AQUELA UNIDADE o adaptador do
domínio é chamado. Se não estão, o campo correspondente no `DashboardView`
é `null` — nunca um objeto com números zerados, que poderia ser confundido
com "zero eventos" (ver `security.md`, pergunta 5).

## `analytics.view` nunca supera permissão de domínio (item 24)

`analytics.view` abre a TELA. Um cartão financeiro só aparece — e só é
CONSULTADO — para quem também tem `finance.view`. A permissão não é
hierárquica: não existe "quem pode ver o Painel pode ver tudo dentro dele".

## Chaves registradas neste prompt

| Chave                           | Tipo     | Categoria             | Depende de                    |
| ------------------------------- | -------- | --------------------- | ----------------------------- |
| `analytics.dashboard` (feature) | OPTIONAL | abre a tela do Painel | `core.service_orders`         |
| `analytics.view` (permission)   | —        | abre a tela do Painel | feature `analytics.dashboard` |

Nenhuma outra permissão nova foi criada: cada cartão reaproveita a
permissão `*.view` que já existia para aquele domínio (`finance.view`,
`inventory.view`, `purchases.view`, `warranties.view`, `agenda.view`,
`communications.view`, `quotes.view`, `service_orders.view`) — nunca uma
segunda chave paralela só para o Painel.

## Por que `analytics.dashboard` é OPTIONAL, e não CORE

Um tenant recém-provisionado pode preferir operar só pela Central de
Trabalho por um tempo. Diferente de `core.service_orders` (sem OS não há
assistência técnica nenhuma), o Painel é uma camada de interpretação sobre
dados que já existem — o negócio funciona inteiro sem ele. Depende apenas
de `core.service_orders` porque é o único domínio garantidamente presente;
os demais cartões são, eles mesmos, OPTIONAL, e o Painel os consulta
individualmente via `checkManyAccess` em vez de declará-los como
dependência formal da feature.

# Semântica temporal do Painel

Reaproveita integralmente a infraestrutura do ADR-076 ("o navegador não é a
autoridade temporal do domínio") e do ADR-017 (data civil), do Prompt 14.
Nenhum cálculo de data novo foi inventado neste prompt.

## "Hoje" é sempre a data civil do tenant

`AnalyticsScope.today = todayIn(context.tenantTimezone)`, exatamente o
padrão já usado pela Central de Trabalho e pela Agenda. Todas as métricas
`Instant` (distribuição por situação, backlog aging, garantias vigentes,
tarefas vencidas/hoje, itens abaixo do mínimo, necessidades/pedidos em
aberto) usam este valor — nunca `new Date()` cru, nunca o fuso do browser.

## Períodos: instante × dia civil

Duas fontes de dado exigem tratamento diferente, e o código distingue as
duas:

- **Colunas `instant`** (`service_orders.opened_at`,
  `service_orders.status_changed_at`, `quotes.sent_at`,
  `quotes.decided_at`, `warranty_returns.registered_at`,
  `communication_messages.created_at`): o limite do período (`from`/`to`,
  datas civis) é convertido para `00:00:00.000Z`/`23:59:59.999Z` — a MESMA
  conversão que `listServiceOrders` já usa para os filtros `de`/`ate` da
  tela de Ordens de Serviço. Isto NÃO é conversão por fuso do tenant: é a
  mesma convenção pré-existente no código de produção, mantida por
  consistência em vez de introduzir uma segunda regra de fronteira de dia.
- **Colunas `civilDate`** (`agenda_tasks.due_date`,
  `warranties.starts_on`/`ends_on`): comparadas como texto ISO
  (`YYYY-MM-DD`), sem conversão nenhuma — exatamente como `bucketFor` e
  `temporalClassOf` já fazem.

## Períodos pré-definidos

| Chave        | Intervalo                                        | Inclusividade                 |
| ------------ | ------------------------------------------------ | ----------------------------- |
| `today`      | hoje                                             | hoje–hoje                     |
| `7d`         | 7 dias corridos terminando hoje                  | ambos os limites inclusivos   |
| `30d`        | 30 dias corridos terminando hoje                 | idem                          |
| `this_month` | dia 1 do mês corrente até hoje                   | idem                          |
| `last_month` | mês civil ANTERIOR inteiro (dia 1 ao último dia) | idem                          |
| `90d`        | 90 dias corridos terminando hoje                 | idem                          |
| `custom`     | intervalo escolhido pela pessoa                  | idem, com limite (ver abaixo) |

`resolvePeriod` é uma função pura, testada com fixture determinística em
`tests/unit/analytics-scope.test.ts` — inclusive o caso de "mês anterior"
cruzando ano (janeiro → dezembro do ano anterior).

## Filtro personalizado: validação sem quebrar a página (item 16)

Chave desconhecida, datas malformadas, ou início depois do fim: a URL
**nunca** derruba a página — cai em silêncio no padrão seguro (30 dias),
igual à convenção já usada por `parseView`/`parseQueue` na Central de
Trabalho. Intervalo maior que `MAX_CUSTOM_RANGE_DAYS` (366 dias) é
**recortado**, não rejeitado: o início é trazido para `fim - 365 dias`, e a
pessoa vê um período mais estreito do que pediu em vez de um erro.

## DST (item 143)

O único fuso usado em todas as fixtures e no seed do sistema é
`America/Sao_Paulo`. O Brasil **não observa mais horário de verão desde
2019** — não há transição de DST para testar neste fuso, porque ela não
acontece mais na prática. Isto é uma constatação, não uma omissão: testar
uma transição que não ocorre criaria uma fixture artificial sem
correspondência com o comportamento real do sistema em produção. Se um
tenant futuro operar em fuso com DST ativo, a conversão já passa inteira
por `zoned-time.ts` (`zonedCivilToInstant`, que devolve `kind: 'gap' |
'ambiguous'` explicitamente) — a mesma primitiva que resolveria a transição
corretamente, sem código novo no Painel.

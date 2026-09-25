# ADR-084 — Data civil não é instante UTC: fronteira de período é conversão explícita

**Status:** Aceito
**Data:** Prompt 19.1 — hotfix de semântica temporal
**Itens atendidos:** correção de bug determinístico descoberto no fechamento do Prompt 19

## O defeito que isto corrige

Vários adaptadores de Analytics e a listagem de Ordens de Serviço convertiam
uma DATA CIVIL (`"2026-09-24"`, sem fuso) em limite de período assim:

```ts
// ERRADO — trata a data civil como se já fosse instante UTC
function startOfDayUtc(civilDate: string): Date {
  return new Date(`${civilDate}T00:00:00.000Z`);
}
function endOfDayUtc(civilDate: string): Date {
  return new Date(`${civilDate}T23:59:59.999Z`);
}
```

Isso está certo **somente** quando o fuso do tenant é UTC. Para qualquer fuso
**atrás** de UTC — `America/Sao_Paulo` incluído, o único fuso que este sistema
usa em produção hoje — a meia-noite civil real do dia 24 é
`2026-09-24T03:00:00.000Z`, não `2026-09-24T00:00:00.000Z`. O limite ingênuo
exclui todo dado gravado nas primeiras horas UTC do dia: uma Ordem de Serviço
aberta às 23h locais grava `opened_at` por volta de `02:00Z` do dia UTC
seguinte, e o filtro `gte(opened_at, '2026-09-24T00:00:00.000Z')` a devolve
como pertencente ao dia 24 quando, no fuso de quem opera, ela é do dia 23.

O bug foi descoberto durante o fechamento do Prompt 19 (Motor de Automações),
reproduzido também contra o baseline anterior ao Prompt 19 via `git stash` —
confirmando que **não é uma regressão do Motor**, é um defeito de
interpretação temporal pré-existente nos adaptadores de leitura.

## Decisão

**Data civil e instante UTC são tipos diferentes, e a conversão entre eles
exige o fuso do tenant/unidade como parâmetro explícito — nunca implícito,
nunca hardcoded, nunca dependente do fuso do processo Node ou da sessão do
MariaDB** (`client.ts` já força `timezone: 'Z'` no pool — toda leitura/escrita
é UTC literal).

`src/core/time/civil-date.ts` ganha o único par de funções autorizado a
resolver essa fronteira:

```ts
export function startOfCivilDayUtc(civil: string, timeZone: string): Date;

export function civilDateRangeToUtc(
  from: string,
  to: string,
  timeZone: string,
): { startUtc: Date; endExclusiveUtc: Date };
```

`civilDateRangeToUtc` devolve um intervalo **meio-aberto**
`[startUtc, endExclusiveUtc)`: o uso pretendido é sempre
`WHERE column >= startUtc AND column < endExclusiveUtc`, nunca
`BETWEEN`/`<=` com `23:59:59.999` literal. Meio-aberto evita depender de
milissegundos e continua correto quando o último dia civil do período tem 23
ou 25 horas (troca de horário de verão): `endExclusiveUtc` é o início real do
dia seguinte, nunca `start + 24h`.

Nenhum módulo reimplementa essa conversão. Onde um adaptador tinha
`startOfDayUtc`/`endOfDayUtc` locais (Quotes, Comunicação, Garantias, Ordens
de Serviço), a função local foi removida e substituída pela chamada ao
helper central.

### Não duplicar o algoritmo de fuso

`civil-date.ts` **não reimplementa** a aritmética de conversão fuso→instante.
`startOfCivilDayUtc` delega para `zonedCivilToInstant`
(`@/core/time/zoned-time.ts`) — o mesmo primitivo que a Agenda já usa em
`appointment-service.ts` para resolver `startAtLocal`/`endAtLocal` (ADR-076).
Esse primitivo já trata corretamente as bordas de horário de verão
(`gap`/`ambiguous`); manter uma segunda fórmula em `civil-date.ts` divergiria
dele com o tempo. `civil-date.ts` mantém apenas a validação estrita do
formato `YYYY-MM-DD` (`parseCivilDateStrict`) antes de delegar.

### DATEDIFF/DATE() sobre coluna instante — mesma classe de defeito

O mesmo erro aparece em outra forma: `DATEDIFF(hoje, DATE(coluna_instante))`
ou `DATE(coluna) BETWEEN from AND to` em SQL bruto. `DATE()` do MariaDB avalia
no fuso da **sessão** (UTC), não no do tenant — e ainda quebra o uso de índice
sobre a coluna, pois ela deixa de aparecer "nua" na condição. Onde esse padrão
apareceu (antiguidade de backlog e tempo de ciclo em
`service-order-metrics.ts`; soma de custo de garantia em
`warranty-cost-service.ts`), a correção busca o instante bruto e converte para
dia civil em JavaScript com `formatCivilDate`/`civilDaysBetween`, no fuso do
tenant — nunca `DATE()` do banco.

## Contrato do helper

- Entrada: data(s) civil(is) em `YYYY-MM-DD` estrito, mais o fuso IANA
  explícito de quem chama (nunca lido de uma variável global).
- Saída: `Date` UTC inequívoco.
- Erro (nunca instante silenciosamente errado): data civil malformada ou fora
  do calendário, ou fuso IANA inválido — ambos lançam.
- Fonte de fuso é da tenant/unidade, resolvida por quem chama
  (`scope.timezone` em Analytics, `context.tenantTimezone` em OS e no
  certificado de garantia) — o helper em si nunca resolve fuso sozinho.

## O que NÃO foi tocado

- `agenda-queries.ts` já resolvia isto corretamente: busca uma janela UTC
  **larga** (com folga de 1-2 dias) e faz o corte preciso em JavaScript com
  `formatCivilDate(instante, fusoDaUnidade)`, por linha. É uma estratégia
  válida — "buscar largo, cortar preciso" — e equivalente em resultado ao
  helper central; não foi alterado.
- Colunas de DATA CIVIL de verdade (`agenda_tasks.due_date`,
  `financial_titles.due_date`, `financial_movements.effective_date`,
  `warranties.starts_on`/`ends_on`) continuam comparadas como texto ISO contra
  outra data civil — nunca foram o bug, e comparação lexicográfica de
  `YYYY-MM-DD` já ordena corretamente.
- Claim atômico e idempotência do Motor de Automações (Prompt 19,
  migration `0017`) não foram alterados — apenas verificados como compatíveis,
  já que `schedule-coordinator.ts` usa `nowTimeIn`/`todayIn`, que não mudaram
  de assinatura nem de comportamento.

## Migration

Nenhuma. Este é um defeito de **interpretação de consulta**, não de schema:
as colunas já eram `DATETIME(3)` UTC; o que mudou é como o texto do filtro é
convertido antes de alcançá-las. A migration vigente continua sendo
`0017_automations_execution_claim`.

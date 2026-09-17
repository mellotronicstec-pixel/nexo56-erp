# ADR-055 — "Vencido" é derivado, nunca uma coluna

**Status:** Aceito
**Data:** Prompt 12 — Financeiro
**Itens atendidos:** 10, 63, 65, 66, 70, 71

## Contexto

`TITLE_STATUSES` poderia ter cinco valores: `open`, `partially_settled`,
`settled`, `cancelled` e `overdue`. Parece natural — é assim que a pessoa fala.

Mas vencer não é algo que o título **faz**; é algo que **o calendário faz com
ele**. Um título `overdue` persistido exigiria um job noturno reescrevendo
milhões de linhas todo dia à meia-noite, e no dia em que o job falhasse a tela
mostraria "em dia" para uma carteira inteira já vencida — sem nenhum sinal de
que algo deu errado.

Pior: `overdue` ocuparia o lugar de `partially_settled`. Um título vencido que
recebeu metade é as duas coisas ao mesmo tempo, e uma coluna só não comporta
isso.

## Decisão

**`overdue` não existe como situação. É um recorte, calculado na hora.**

```ts
export function isTitleOverdue(snapshot: DueSnapshot, timeZone: string, now = new Date()) {
  if (!isTitleSettleable(snapshot.status)) return false; // liquidado ou cancelado nunca vence
  if (!snapshot.outstanding.isPositive()) return false; // sem saldo, sem cobranca
  return isOverdue(snapshot.dueDate, timeZone, now);
}
```

Três condições, e a terceira é a que costuma ser feita errado.

## O fuso é o da EMPRESA, não o do navegador

Uma parcela que vence dia 15 vence **no dia 15 da loja**. Se o cálculo usasse o
relógio do cliente, o dono viajando para Lisboa veria como vencido, às 2h da
manhã de lá, o que no Brasil ainda é hoje — e ligaria para cobrar.

Por isso `todayIn(context.tenantTimezone)` e nunca `new Date()` no componente.

## O filtro roda no SQL, não em JavaScript

Filtrar depois de paginar quebra a paginação: a página 1 traria 25 linhas e
mostraria 6. A data de hoje é calculada no fuso do tenant e entra na consulta:

```ts
const hoje = todayIn(context.tenantTimezone);
// ... filtro 'overdue':
and(
  inArray(financialTitles.status, ['open', 'partially_settled']),
  lt(financialTitles.dueDate, hoje),
  sql`${financialTitles.amount} > ${financialTitles.settledAmount}`,
);
```

O `total` da paginação e as linhas da página vêm da mesma condição.

## Consequências

**Ganhamos:** nenhum job noturno, nenhuma janela em que o dado está velho, e um
título pode ser `partially_settled` **e** estar vencido — que é o caso real mais
comum de cobrança.

**Pagamos:** `due_date` precisa de índice, e todo lugar que decide "vencido"
precisa do fuso do tenant em mãos. `isTitleOverdue()` exige o `timeZone` como
parâmetro obrigatório justamente para que esquecê-lo seja erro de compilação.

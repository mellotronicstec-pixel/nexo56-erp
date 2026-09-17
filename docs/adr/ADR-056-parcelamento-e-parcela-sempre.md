# ADR-056 — Todo título tem parcelas; a sobra do centavo vai para as primeiras

**Status:** Aceito
**Data:** Prompt 12 — Financeiro
**Itens atendidos:** 32, 33, 34, 35, 36, 37, 57

## Contexto

Duas decisões pequenas que evitam duas classes inteiras de bug.

**Primeira:** um título à vista tem parcelas? A resposta "não, só o parcelado" é
tentadora e cria um `if` em cada consulta, cada tela, cada liquidação — "se tem
parcela, use a parcela; senão, use o título". Esse `if` é esquecido em algum
lugar, e o dia em que for esquecido na liquidação, um pagamento parcial de um
título à vista vai atualizar o título sem atualizar parcela nenhuma.

**Segunda:** R$ 100,00 em 3 vezes. `100 / 3 = 33,333...`. Três parcelas de
R$ 33,33 somam R$ 99,99. O cliente paga tudo e o título fica devendo um centavo
para sempre — `status` nunca chega em `settled`, e ele aparece na lista de
inadimplentes.

## Decisão

### Todo título tem no mínimo uma parcela

À vista é simplesmente **1 de 1**. Não existe título sem parcela, e nenhuma
consulta precisa perguntar se tem.

A liquidação sempre aponta para uma `installment_id`. O `settled_amount` do
título é a soma do das parcelas, e as duas CHECKs garantem que nenhum dos dois
estoure:

```sql
CONSTRAINT ck_fin_title_no_over_settlement CHECK (settled_amount <= amount)
-- e, em financial_installments:
CONSTRAINT ck_fin_installment_no_over_settlement CHECK (settled_amount <= amount)
```

### A sobra vai para as PRIMEIRAS parcelas

```ts
splitAmountIntoInstallments(Money.parse('100.00'), 3);
// => ['33.34', '33.33', '33.33']
```

A conta é feita em `bigint` de centavos — nunca em `number`, nunca com
`toFixed()`. `10000 / 3 = 3333` com resto `1`; o resto é distribuído **um
centavo para cada uma das primeiras parcelas**.

Por que as primeiras e não as últimas? Porque quem paga a primeira parcela está
no balcão, com a maquininha na mão, e vê o valor. Um centavo a mais na primeira
é invisível. Um centavo a mais na **última**, seis meses depois, é uma parcela
com valor diferente das outras que ninguém lembra por quê.

`installmentsSumExactly()` verifica a invariante, e há teste para
R$ 10,00 ÷ 7 — resto 6, seis parcelas de R$ 1,43 e uma de R$ 1,42.

### Vencimentos mensais preservam o dia de referência

`monthlyDueDates('2026-01-31', 3)` devolve `['2026-01-31', '2026-02-28',
'2026-03-31']`. Fevereiro encolhe para o último dia do mês, **mas março volta
para 31** — o dia original é a referência, não o dia da parcela anterior.
Encadear a partir do anterior faria toda a série migrar para dia 28.

## Consequências

**Ganhamos:** uma única forma de ler, somar e liquidar; soma sempre exata;
nenhum título preso a um centavo.

**Pagamos:** um título à vista cria duas linhas em vez de uma. É o preço de não
ter o `if`, e é barato.

**Não fizemos:** juros, multa e correção por atraso. Nada disso está no Prompt
12, e calcular juros sem a política da empresa cadastrada seria inventar número.

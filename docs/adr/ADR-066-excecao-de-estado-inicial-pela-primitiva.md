# ADR-066 — A exceção de estado inicial mora na primitiva, não num campo

**Status:** Aceito
**Data:** Prompt 13 — Garantias
**Itens atendidos:** 27, 31, 92, 110

## Contexto

Uma Ordem de Serviço normal nasce em `awaiting_technical_opinion`: o aparelho
chegou, alguém precisa olhar e dizer o que tem. Uma OS de **retorno em
garantia** não: o diagnóstico já foi feito, o serviço já foi prestado, e o que
falta é consertar de novo. Ela deve nascer em `awaiting_repair`.

Isso é uma exceção legítima. O jeito errado de implementá-la é aceitar um campo
`status` (ou `initialStatus`) no comando de criação — porque então **qualquer**
OS pode nascer em qualquer estado, e a primeira pessoa com o inspetor do
navegador aberto abre uma OS comum já em "Aguardando Conserto", pulando o
parecer técnico e o orçamento.

## Decisão

**A criação aceita uma ORIGEM, não um estado. Quem traduz origem em estado é o
domínio.**

```ts
export type ServiceOrderOrigin =
  | { kind: 'standard' }
  | { kind: 'warranty_return'; warrantyId: string; originalServiceOrderId: string };

export function initialStatusForOrigin(origin: ServiceOrderOrigin): ServiceOrderStatus {
  return origin.kind === 'warranty_return' ? 'awaiting_repair' : SERVICE_ORDER_INITIAL_STATUS;
}
```

A origem `warranty_return` **exige** `warrantyId` e `originalServiceOrderId`:
não existe como declará-la sem apontar a garantia e a ordem de onde veio. O
tipo torna a mentira inexpressável.

## A exceção não chega pela superfície

`createServiceOrder` — a função que o formulário web chama — **não repassa**
`origin`. O schema Zod dela não conhece `origin`, `status` nem `classification`,
e campos extras no `FormData` são descartados. Só
`applyServiceOrderCreation`, chamada de dentro de uma transação por
`registerWarrantyReturn`, constrói a origem de garantia.

Um teste passa exatamente esses campos extras pelo caminho público e verifica
que a OS nasce em `awaiting_technical_opinion` assim mesmo.

## Consequências

**Ganhamos:** a exceção existe onde precisa existir e é inalcançável de fora.
Nenhuma regra nova de validação foi criada para proibir o que o tipo já impede.

**Pagamos:** duas funções onde havia uma (`plan` e `apply`). É o mesmo padrão
que o Estoque e o workflow já usavam — o custo é de forma, não de conceito.

# ADR-067 — Classificação não é status

**Status:** Aceito
**Data:** Prompt 13 — Garantias
**Itens atendidos:** 30, 31, 33, 74

## Contexto

"OS em garantia" parece um estado. Colocá-lo em `service_orders.status` seria a
mudança de menor esforço: um valor a mais no enum, e pronto.

Seria um erro estrutural. Status é **onde a ordem está** no fluxo — e uma OS de
garantia percorre o mesmo fluxo de qualquer outra: conserta, testa, prepara,
entrega. Se "garantia" fosse status, a ordem teria que sair dele para poder
avançar, e o sistema esqueceria que ela é de garantia exatamente quando o
técnico começa a trabalhar.

Pior: cada transição da máquina de estados teria que ganhar um par "versão
garantia", e a matriz dobraria de tamanho sem ganhar uma regra nova.

## Decisão

**`service_orders.classification` é uma coluna separada, com valores
`standard` e `warranty_internal`.**

Classificação é o que a ordem **é**; status é onde ela **está**. As duas
dimensões convivem: uma OS `warranty_internal` pode estar em `awaiting_repair`,
`repair_completed` ou `completed`, exatamente como qualquer outra.

A máquina de estados **não conhece** `classification`. Nenhuma regra de
transição a consulta, e nenhum caminho novo foi criado por causa dela.

## Garantia Interna também não é status

Pelo mesmo motivo, a Garantia Interna não é um valor de `service_orders.status`.
Ela é um registro em `warranties`, com vigência, cobertura e certificado
próprios — coisas que um enum não carrega.

## Consequências

**Ganhamos:** o workflow do Prompt 08 ficou intacto. A matriz de transições tem
hoje as mesmas regras que tinha antes do Prompt 13, mais **uma** (a
reclassificação, ADR-068) — e nenhuma delas pergunta se a ordem é de garantia.

**Pagamos:** uma coluna a mais e a disciplina de não a usar como filtro de
fluxo. Migrations `0011` adiciona `classification` com `DEFAULT 'standard'`, e
toda OS existente continua sendo exatamente o que era.

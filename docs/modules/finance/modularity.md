# Modularidade do Financeiro

## A feature

```ts
FINANCE_CORE: 'finance.core'; // tipo: OPTIONAL
dependsOn: [FEATURES.CORE_CUSTOMERS];
```

**OPCIONAL**, não CORE. Uma assistência técnica pequena pode rodar o Nexo56
inteiro sem financeiro — anotando o que recebeu num caderno — e isso não é uma
configuração degradada, é um plano.

**Depende de `core.customers`** porque conta a receber exige cliente cadastrado
(ADR-053). Não depende de Compras nem de Estoque: quem não compra peça continua
tendo despesa de aluguel e energia.

## Quando está desligada

| Lugar               | O que acontece                             |
| ------------------- | ------------------------------------------ |
| Menu lateral        | a seção "Financeiro" inteira some          |
| `/financeiro/**`    | `requireAccessForPage` recusa              |
| Ficha da OS         | a seção "Financeiro" não é renderizada     |
| Pedido de compra    | a seção "Contas a pagar" não é renderizada |
| Ficha do cliente    | a seção "Financeiro" não é renderizada     |
| Ficha do fornecedor | a seção "Contas a pagar" não é renderizada |

**Todos esses módulos continuam inteiros.** Receber mercadoria nunca dependeu de
haver financeiro; aprovar orçamento também não.

Nenhuma dessas telas mostra um botão cinza ou uma mensagem "módulo indisponível":
a seção simplesmente não existe, que é o que o item 118 do Prompt 00 pede.

## Sem dependência circular

```
Financeiro ──lê──► Ordens de Serviço, Orçamentos, Compras, Clientes, Fornecedores
Financeiro ──✗──► NÃO escreve em nenhum deles
```

Os módulos operacionais **não importam nada** do Financeiro. A seção financeira
na ficha da OS mora em `src/app/(app)/ordens-de-servico/...` — camada de
interface, não de domínio.

`tests/unit/finance-boundary.test.ts` falha se:

- `src/core/**` importar de `src/modules/finance/**`
  (a única exceção é `src/core/db/schema.ts`, o barril do Drizzle, que por
  construção reexporta o schema de todos os módulos — e há teste garantindo que
  ele importe **apenas** o schema, nunca um serviço);
- `src/modules/service-orders/**`, `quotes/**`, `inventory/**` ou
  `purchasing/**` importarem de `finance/**`;
- qualquer arquivo escrever `UPDATE` ou `DELETE` em `financial_movements`.

## Effective Access, não `isAdmin`

Toda visibilidade sai de `checkAccess(context, { featureKey, permission })`, que
combina plano da empresa + feature habilitada + permissão do papel na unidade.
Nenhuma tela decide por `isAdmin ? tudo : nada`.

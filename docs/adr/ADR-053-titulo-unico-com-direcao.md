# ADR-053 — Um título financeiro, com direção, em vez de duas tabelas

**Status:** Aceito
**Data:** Prompt 12 — Financeiro
**Itens atendidos:** 5, 6, 7, 8, 9, 28, 29, 30, 31

## Contexto

Conta a receber e conta a pagar parecem duas coisas. No balcão de uma
assistência técnica elas respondem exatamente às mesmas três perguntas —
**quanto falta, de quem, para quando** — e sofrem exatamente os mesmos
acidentes: pagamento parcial, pagamento em duplicidade por duplo clique,
estorno, cancelamento, parcelamento com sobra de centavo.

O caminho óbvio seria `accounts_receivable` e `accounts_payable`, cada uma com
suas parcelas, suas liquidações, seu estorno. Duas tabelas, dois serviços, dois
conjuntos de testes de concorrência.

O problema não é a duplicação de linhas de código. É que **a correção de um bug
de dinheiro passaria a ter duas casas.** O `UPDATE` condicional que impede
liquidar R$ 600 num saldo de R$ 400 é a peça mais delicada deste módulo; tê-la
escrita duas vezes significa, na prática, que um dia ela será consertada uma vez
só — e ninguém vai descobrir pelo lado que continuou errado, porque o teste
daquele lado também foi escrito duas vezes e também ficou desatualizado.

## Decisão

**Uma tabela `financial_titles` com a coluna `direction` (`receivable` |
`payable`).**

O que é comum fica comum:

- `amount`, `settled_amount`, `status`, `version`, `due_date`, `origin_key`;
- `financial_installments` — toda parcela de todo título;
- `financial_settlements` — toda liquidação, nas duas direções;
- `financial_movements` — o razão, com `direction` própria (`inflow` /
  `outflow`).

O que difere fica explícito, e é pouco:

| Aspecto                  | `receivable`                 | `payable`                 |
| ------------------------ | ---------------------------- | ------------------------- |
| Contraparte válida       | `customer`                   | `supplier` ou `other`     |
| Movimento no razão       | `inflow`                     | `outflow`                 |
| Permissão para liquidar  | `finance.receive`            | `finance.pay`             |
| Permissão para gerenciar | `finance.receivables.manage` | `finance.payables.manage` |
| Prefixo do número        | `CR`                         | `CP`                      |
| Sequência                | `financial_title_receivable` | `financial_title_payable` |

Cada diferença é **uma função pura no domínio**, não um `if` espalhado pelas
telas: `counterpartyMatchesDirection()`, `movementDirectionFor()`,
`settlementPermission()`, `titleManagePermission()`, `sequenceTypeFor()`,
`titleNumberPrefix()`.

## A invariante da contraparte mora no banco

Um cliente não é favorecido de conta a pagar, e um fornecedor não deve dinheiro
para a loja. Isso é regra de negócio, mas é também **integridade de dados**: se
escapar, a listagem de contas a pagar passa a mostrar clientes e ninguém sabe
dizer desde quando.

```sql
CONSTRAINT ck_fin_title_counterparty_direction CHECK (
  (direction = 'receivable' AND counterparty_kind = 'customer')
  OR (direction = 'payable' AND counterparty_kind IN ('supplier', 'other'))
)
```

**A CHECK compara apenas colunas simples** — `direction` e `counterparty_kind`,
nunca `customer_id` ou `supplier_id`. Isso não é estilo: o MariaDB 10.11
responde **erro 1901** quando uma coluna citada numa CHECK que compara duas
colunas também participa de uma `FOREIGN KEY ... ON UPDATE CASCADE`. A migration
0007 já morreu uma vez por causa disso. A coluna `counterparty_kind` existe
justamente para dar à CHECK um alvo que nenhuma FK toca.

## Consequências

**Ganhamos:** um único `settleFinancialTitle()`, um único `reverseSettlement()`,
um único teste de over-settlement concorrente, uma única ficha de título. Quando
o Prompt 13 precisar de um título de garantia, ele herda tudo isso.

**Pagamos:** toda consulta de lista carrega `WHERE direction = ?`, e um
`TitleDirection` errado num parâmetro mostraria a lista trocada. O tipo
`TitleDirection` é uma union fechada de duas strings, e as rotas
`/financeiro/contas-a-receber` e `/financeiro/contas-a-pagar` fixam o valor no
servidor — a direção nunca vem da query string.

**Não fizemos:** uma coluna `overdue`. Vencido é derivado — ver ADR-055.

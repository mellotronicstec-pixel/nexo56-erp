# Financeiro — visão geral

**Prompt 12.** Núcleo financeiro operacional: contas a receber, contas a pagar,
recebimentos, pagamentos, caixa da gaveta e o razão que registra tudo isso.

## O que este módulo é

O financeiro de uma assistência técnica de bairro, não um ERP contábil. Ele
responde três perguntas que se fazem em voz alta no balcão:

1. **Quanto ainda falta receber?** — e de quem, e para quando.
2. **Quanto a loja deve?** — e para quem, e quando vence.
3. **O caixa fechou?** — e, se não fechou, quanto faltou.

## O que este módulo NÃO é

Esta lista é tão importante quanto a de cima, porque cada item aqui é algo que
um sistema financeiro costuma prometer e não entregar:

- **não fala com banco nenhum.** Não há conciliação bancária, não há OFX, não há
  consulta de extrato;
- **não fala com adquirente.** "Cartão parcelado em 3x" é o registro do que foi
  combinado na maquininha, não um recebível de cartão com data de repasse;
- **não emite nota fiscal** e não calcula imposto;
- **não tem PIX automático.** "PIX" é uma forma de pagamento — o nome de como o
  dinheiro chegou, digitado por uma pessoa;
- **não calcula lucro, margem nem DRE.** Receita menos algumas despesas não é
  lucro, e um número grande com nome errado é pior do que número nenhum;
- **não bloqueia cliente.** Não há score, não há limite de crédito. O sistema
  mostra a situação; quem decide atender é a pessoa no balcão;
- **não calcula juros nem multa por atraso.**

## Mapa das entidades

```
financial_accounts      ONDE o dinheiro fica (tem saldo)
payment_methods         COMO ele se moveu   (não tem saldo)
financial_categories    POR QUE entrou/saiu (agrupa, não bloqueia)

financial_titles        a obrigação: direction = receivable | payable
└── financial_installments   toda obrigação tem ao menos UMA (à vista = 1/1)
    └── financial_settlements    cada recebimento/pagamento registrado
        └── financial_movements      o razão: append-only, nunca se edita

cash_sessions           a gaveta aberta de uma unidade
financial_title_timeline  o histórico legível do título
```

## As nove decisões que sustentam o módulo

| #   | Decisão                                                 | ADR                                                                      |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Um título com `direction`, não duas tabelas             | [053](../../adr/ADR-053-titulo-unico-com-direcao.md)                     |
| 2   | O razão é append-only; estorno é contramovimento        | [054](../../adr/ADR-054-razao-financeiro-append-only.md)                 |
| 3   | "Vencido" é derivado, nunca uma coluna                  | [055](../../adr/ADR-055-vencido-derivado.md)                             |
| 4   | Todo título tem parcelas; a sobra vai para as primeiras | [056](../../adr/ADR-056-parcelamento-e-parcela-sempre.md)                |
| 5   | A cobrança da OS nasce de um ato humano                 | [057](../../adr/ADR-057-cobranca-nasce-de-ato-humano.md)                 |
| 6   | Uma conta a pagar por recebimento, não por pedido       | [058](../../adr/ADR-058-uma-conta-a-pagar-por-recebimento.md)            |
| 7   | Conta, forma de pagamento e categoria são três coisas   | [059](../../adr/ADR-059-conta-financeira-e-forma-de-pagamento.md)        |
| 8   | Caixa: um aberto por conta, contagem às cegas           | [060](../../adr/ADR-060-caixa-operacional.md)                            |
| 9   | Liquidação idempotente, sem over-settlement             | [061](../../adr/ADR-061-liquidacao-idempotente-e-sem-over-settlement.md) |

## Modularidade

`finance.core` é uma feature **OPCIONAL** que depende de `core.customers`.

Quando desligada, o item some do menu, as seções de Financeiro somem da ficha da
OS, do pedido de compra, do cliente e do fornecedor — e **todos esses módulos
continuam inteiros**. Receber mercadoria nunca dependeu de haver financeiro.

## Leitura

- [Títulos](titles.md) — receber, pagar, parcelar, cancelar
- [Liquidação e estorno](settlement.md) — o caminho do dinheiro
- [Caixa](cash.md) — abertura, sangria, suprimento, fechamento
- [Contas, formas e categorias](accounts.md)
- [Interface](interface.md) — as sete telas, e as armadilhas de layout que elas ensinaram
- [Integrações](integrations.md) — OS, Orçamento, Compras, Cliente, Fornecedor
- [Concorrência](concurrency.md) — as travas, e por que estão onde estão
- [Permissões](permissions.md)
- [Segurança e dados sensíveis](security.md)
- [Modularidade](modularity.md)
- [O que ficou para depois](future.md)

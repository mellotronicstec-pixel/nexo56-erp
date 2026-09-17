# Integrações do Financeiro

Todas as fronteiras deste módulo são de **mão única**: o Financeiro lê os
módulos operacionais e **nunca escreve neles**. Não há dependência circular.

## Ordem de Serviço

```
Orçamento aprovado ──(sugere o valor)──► [ Gerar cobrança ] ──► CR 000042
```

- a cobrança nasce de um **ato humano** na ficha da OS, não da aprovação do
  orçamento — ver [ADR-057](../../adr/ADR-057-cobranca-nasce-de-ato-humano.md);
- o valor vem pré-preenchido do orçamento `approved`, e continua editável;
- idempotente por `origin_key = 'service_order:<id>'`;
- **o Financeiro não escreve em `service_orders.status`.** Receber não entrega o
  aparelho; entregar não quita a conta.

A ficha da OS ganha uma seção "Financeiro" quando a feature está ativa e a
pessoa tem `finance.view`. Criar a cobrança exige `finance.receivables.manage`
— duas permissões, porque são duas decisões.

### O evento sem consumidor

Quando **todos** os recebíveis de uma OS ficam quitados, o Financeiro emite
`SERVICE_ORDER_FINANCIAL_SETTLED`.

**Ele não tem consumidor hoje.** É o gancho para o Prompt 13 (Garantias), e está
documentado como tal justamente para que ninguém o confunda com uma automação já
existente.

## Compras

```
Pedido R$ 1.000
├── Recebimento 02/04 (R$ 600)  ──►  CP 000010
└── Recebimento 09/04 (R$ 400)  ──►  CP 000011
```

**Uma conta a pagar por RECEBIMENTO**, nunca por pedido — ver
[ADR-058](../../adr/ADR-058-uma-conta-a-pagar-por-recebimento.md). O valor é a
soma de `purchase_receipt_items.total_cost`, calculada pelo servidor.

Idempotente por `origin_key = 'purchase_receipt:<id>'`. Gerar duas vezes devolve
o mesmo título.

| Quem       | Faz                                                           | Não faz                                              |
| ---------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| Compras    | muda `purchase_orders.status`, chama a primitiva do Inventory | não cria título                                      |
| Financeiro | cria e liquida o título                                       | **não** toca `purchase_orders`, **não** toca estoque |

O Prompt 12 não alterou nenhuma migration de Compras nem adicionou coluna alguma
nas tabelas dele.

## Estoque

**Nenhuma.** O Financeiro não atualiza estoque, não lê saldo de peça e não
participa de reserva ou consumo. Pagar não recebe mercadoria.

## Cliente

A ficha do cliente ganha a seção "Financeiro" com total, liquidado, em aberto e
vencido.

**Mostra, não julga.** Não há score, não há limite, não há bloqueio automático.
Um bloqueio automático numa loja de bairro recusaria justamente o cliente antigo
que sempre paga com dez dias de atraso.

## Fornecedor

A mesma seção, com as contas a pagar em aberto.

**Isto não é histórico de preços.** É o que a loja ainda deve a ele. Preço de
peça mora em Compras — juntar as duas coisas faria a pessoa negociar desconto
olhando para um número que é dívida, não custo.

## O que NÃO existe

- conciliação bancária, OFX, extrato de banco;
- integração com adquirente ou antecipação de recebível;
- emissão fiscal;
- WhatsApp, e-mail ou qualquer cobrança automática;
- rule engine, automações, Nexo56 AI.
